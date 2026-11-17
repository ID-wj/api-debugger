import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { MESSAGE_TYPES } from '../shared/protocol';
import type { FromWebviewMessage, ToWebviewMessage } from '../shared/protocol';

const VALID_TYPES = new Set<string>(MESSAGE_TYPES);

function parseMessage(raw: unknown): FromWebviewMessage | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const type = (raw as { type?: unknown }).type;
  if (typeof type !== 'string' || !VALID_TYPES.has(type)) {
    return undefined;
  }
  return raw as FromWebviewMessage;
}

/**
 * Shared webview plumbing: CSP hardened HTML, nonce injected script/style and a validated
 * message channel. Subclasses only implement `handleMessage`.
 */
export abstract class WebviewHost implements vscode.Disposable {
  protected readonly disposables: vscode.Disposable[] = [];
  protected readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;

  constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, title: string) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    this.panel.title = title;
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'api-debugger.svg');
    this.panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webview')],
    };
    this.panel.webview.html = this.renderHtml();

    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((raw: unknown) => {
        const message = parseMessage(raw);
        if (!message) {
          console.warn('[api-debugger] ignored malformed message from webview');
          return;
        }
        void Promise.resolve(this.handleMessage(message)).catch((error: unknown) => {
          console.error('[api-debugger] failed to handle message', error);
        });
      }),
      this.panel.onDidDispose(() => this.dispose()),
    );
  }

  protected abstract handleMessage(message: FromWebviewMessage): Promise<void> | void;

  protected postMessage(message: ToWebviewMessage): void {
    void this.panel.webview.postMessage(message);
  }

  dispose(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }

  private renderHtml(): string {
    const nonce = randomBytes(16).toString('base64');
    const assets = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'assets');
    const scriptUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(assets, 'app.js'));
    const styleUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(assets, 'app.css'));
    const csp = [
      "default-src 'none'",
      `img-src ${this.panel.webview.cspSource} data: blob:`,
      `style-src ${this.panel.webview.cspSource} 'unsafe-inline'`,
      `font-src ${this.panel.webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="${styleUri}" />
<title>API Debugger</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
