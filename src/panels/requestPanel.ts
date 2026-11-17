import * as vscode from 'vscode';
import { DEFAULT_GROUP } from '../services/collectionStore';
import type { ApiStore } from '../services/collectionStore';
import { DEFAULT_MAX_BODY_BYTES, sendRequest } from '../services/httpClient';
import { prepareRequest } from '../services/variableResolver';
import type { VariableScope } from '../services/variableResolver';
import { normalizeRequestDraft } from '../shared/protocol';
import type { CurlDialogMode, FromWebviewMessage, HttpRequestDraft, ThemeKind, ToWebviewMessage } from '../shared/protocol';
import { WebviewHost } from './webviewHost';

const VIEW_TYPE = 'apiDebugger.request';

function currentThemeKind(): ThemeKind {
  const kind = vscode.window.activeColorTheme.kind;
  if (kind === vscode.ColorThemeKind.Light) {
    return 'light';
  }
  return kind === vscode.ColorThemeKind.Dark ? 'dark' : 'high-contrast';
}

function describeEndpoint(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

export class RequestPanel extends WebviewHost {
  static current: RequestPanel | undefined;

  private readonly inFlight = new Map<string, AbortController>();

  private webviewReady = false;

  private pendingMessages: ToWebviewMessage[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, private readonly store: ApiStore) {
    super(panel, extensionUri, 'API Debugger');

    this.disposables.push(
      this.store.onDidChange(() => this.postMessage({ type: 'state', state: this.store.snapshot })),
      vscode.window.onDidChangeActiveColorTheme(() => this.postMessage({ type: 'theme', kind: currentThemeKind() })),
    );
  }

  static createOrShow(context: vscode.ExtensionContext, store: ApiStore): RequestPanel {
    if (RequestPanel.current) {
      RequestPanel.current.panel.reveal();
      return RequestPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'API Debugger', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')],
    });
    RequestPanel.current = new RequestPanel(panel, context.extensionUri, store);
    return RequestPanel.current;
  }

  loadRequest(request: HttpRequestDraft): void {
    this.panel.reveal();
    this.sendOrQueue({ type: 'loadRequest', request });
  }

  triggerSend(): void {
    this.sendOrQueue({ type: 'triggerSend' });
  }

  /**
   * Asks the webview to open the cURL dialog. Messages sent before the webview finished loading
   * are queued so a command started from a tree view or the palette never gets lost.
   */
  openCurlDialog(mode: CurlDialogMode, text?: string): void {
    this.panel.reveal();
    this.sendOrQueue({ type: 'openCurlDialog', mode, text });
  }

  private sendOrQueue(message: ToWebviewMessage): void {
    if (this.webviewReady) {
      this.postMessage(message);
    } else {
      this.pendingMessages.push(message);
    }
  }

  override dispose(): void {
    for (const controller of this.inFlight.values()) {
      controller.abort();
    }
    this.inFlight.clear();
    if (RequestPanel.current === this) {
      RequestPanel.current = undefined;
    }
    super.dispose();
  }

  protected async handleMessage(message: FromWebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready': {
        this.webviewReady = true;
        this.postMessage({
          type: 'init',
          state: this.store.snapshot,
          theme: currentThemeKind(),
          settings: this.store.settings,
        });
        const pending = this.pendingMessages;
        this.pendingMessages = [];
        for (const message of pending) {
          this.postMessage(message);
        }
        return;
      }
      case 'send':
        await this.handleSend(message.requestId, message.request);
        return;
      case 'cancel': {
        const controller = this.inFlight.get(message.requestId);
        if (controller) {
          controller.abort();
          // Report the cancellation straight away instead of waiting for the transport to unwind,
          // so the panel never stays in the pending state when the socket refuses to settle.
          this.postMessage({ type: 'error', requestId: message.requestId, message: '请求已取消' });
        }
        return;
      }
      case 'saveRequest':
        await this.handleSave(message.request);
        return;
      case 'deleteSavedRequest':
        await this.store.deleteSavedRequest(message.id);
        return;
      case 'deleteHistoryEntry':
        await this.store.deleteHistoryEntry(message.id);
        return;
      case 'clearHistory':
        await this.store.clearHistory();
        return;
      case 'setActiveEnvironment':
        await this.store.setActiveEnvironment(message.name);
        return;
      case 'copyToClipboard':
        await vscode.env.clipboard.writeText(message.text);
        return;
      default:
        return;
    }
  }

  private async handleSend(requestId: string, raw: unknown): Promise<void> {
    const draft = normalizeRequestDraft(raw);
    if (!draft) {
      this.postMessage({ type: 'error', message: '请求数据格式不正确，已忽略' });
      return;
    }

    const prepared = prepareRequest(draft, this.variableScope());
    if (!prepared.request) {
      const suffix = prepared.unresolved.length > 0 ? `（未解析变量：${prepared.unresolved.join(', ')}）` : '';
      this.postMessage({ type: 'error', message: `${prepared.error ?? '请求无法发送'}${suffix}` });
      return;
    }

    const controller = new AbortController();
    this.inFlight.set(requestId, controller);
    this.postMessage({ type: 'pending', requestId });

    try {
      const result = await sendRequest(
        prepared.request,
        requestId,
        prepared.unresolved,
        {
          timeoutMs: this.store.settings.timeout,
          followRedirects: this.store.settings.followRedirects,
          maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
        },
        controller.signal,
      );
      this.postMessage({ type: 'response', requestId, result });
      await this.store.addHistory(draft, result.status, result.durationMs);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const suffix = prepared.unresolved.length > 0 ? `（未解析变量：${prepared.unresolved.join(', ')}）` : '';
      this.postMessage({ type: 'error', requestId, message: `${detail}${suffix}` });
    } finally {
      this.inFlight.delete(requestId);
    }
  }

  private async handleSave(raw: unknown): Promise<void> {
    const draft = normalizeRequestDraft(raw);
    if (!draft) {
      this.postMessage({ type: 'error', message: '请求数据格式不正确，无法保存' });
      return;
    }

    const suggested = draft.url ? `${draft.method} ${describeEndpoint(draft.url)}` : draft.method;
    const name = await vscode.window.showInputBox({
      title: '保存请求',
      prompt: '为这个请求起个名字',
      value: suggested,
      ignoreFocusOut: true,
    });
    if (name === undefined) {
      return;
    }

    const group = await vscode.window.showInputBox({
      title: '保存请求',
      prompt: '保存到哪个分组',
      value: DEFAULT_GROUP,
      ignoreFocusOut: true,
    });
    if (group === undefined) {
      return;
    }

    const saved = await this.store.saveRequest(name, group, draft);
    vscode.window.setStatusBarMessage(`已保存请求：${saved.name}（${saved.group}）`, 3000);
  }

  private variableScope(): VariableScope {
    return { environment: this.store.activeVariables, globals: this.store.snapshot.globals };
  }
}
