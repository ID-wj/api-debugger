import * as vscode from 'vscode';
import { RequestPanel } from './panels/requestPanel';
import { ApiStore } from './services/collectionStore';
import { looksLikeCurl, toCurl } from './shared/curl';
import type { HistoryEntry, SavedRequest } from './shared/protocol';
import { CollectionTreeProvider, SavedRequestItem } from './views/collectionTree';
import { EnvironmentTreeProvider } from './views/environmentTree';
import { HistoryItem, HistoryTreeProvider } from './views/historyTree';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const store = new ApiStore(context);
  try {
    await store.init();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`API Debugger 初始化存储目录失败：${detail}`);
  }

  context.subscriptions.push(
    store,
    vscode.window.registerTreeDataProvider('apiDebugger.environment', new EnvironmentTreeProvider(store)),
    vscode.window.registerTreeDataProvider('apiDebugger.collections', new CollectionTreeProvider(store)),
    vscode.window.registerTreeDataProvider('apiDebugger.history', new HistoryTreeProvider(store)),
    vscode.commands.registerCommand('apiDebugger.openPanel', () => {
      RequestPanel.createOrShow(context, store);
    }),
    vscode.commands.registerCommand('apiDebugger.sendRequest', () => {
      RequestPanel.current?.triggerSend();
    }),
    vscode.commands.registerCommand('apiDebugger.refresh', async () => {
      await store.reload();
    }),
    vscode.commands.registerCommand('apiDebugger.clearHistory', async () => {
      const confirmed = await vscode.window.showWarningMessage('确定要清空全部请求历史吗？', { modal: true }, '清空');
      if (confirmed === '清空') {
        await store.clearHistory();
      }
    }),
    vscode.commands.registerCommand('apiDebugger.selectEnvironment', async (name?: unknown) => {
      if (typeof name === 'string') {
        await store.setActiveEnvironment(name);
        return;
      }
      const state = store.snapshot;
      const picked = await vscode.window.showQuickPick(
        [
          { label: '不使用环境', description: '仅使用全局变量', value: null as string | null },
          ...state.environments.map((environment) => ({
            label: environment.name,
            description: `${Object.keys(environment.variables).length} 个变量`,
            value: environment.name as string | null,
          })),
        ],
        { placeHolder: '选择要激活的环境' },
      );
      if (picked) {
        await store.setActiveEnvironment(picked.value);
      }
    }),
    vscode.commands.registerCommand('apiDebugger.openHistoryEntry', (value?: unknown) => {
      const entry = asHistoryEntry(value);
      if (!entry) {
        return;
      }
      const panel = RequestPanel.createOrShow(context, store);
      panel.loadRequest(entry.request);
    }),
    vscode.commands.registerCommand('apiDebugger.openSavedRequest', (value?: unknown) => {
      const saved = asSavedRequest(value);
      if (!saved) {
        return;
      }
      const panel = RequestPanel.createOrShow(context, store);
      panel.loadRequest(saved.request);
    }),
    vscode.commands.registerCommand('apiDebugger.importCurl', async () => {
      // Prefill with the clipboard when it already holds a curl command.
      let clipboard = '';
      try {
        clipboard = await vscode.env.clipboard.readText();
      } catch {
        clipboard = '';
      }
      const text = looksLikeCurl(clipboard) ? clipboard : undefined;
      RequestPanel.createOrShow(context, store).openCurlDialog('import', text);
    }),
    vscode.commands.registerCommand('apiDebugger.exportCurl', () => {
      RequestPanel.createOrShow(context, store).openCurlDialog('export');
    }),
    vscode.commands.registerCommand('apiDebugger.copyAsCurl', async (value?: unknown) => {
      const request = asSavedRequest(value)?.request ?? asHistoryEntry(value)?.request;
      if (!request) {
        return;
      }
      await vscode.env.clipboard.writeText(toCurl(request));
      vscode.window.setStatusBarMessage('已复制 cURL 命令到剪贴板', 3000);
    }),
    vscode.commands.registerCommand('apiDebugger.deleteHistoryEntry', async (value?: unknown) => {
      const entry = asHistoryEntry(value);
      if (entry) {
        await store.deleteHistoryEntry(entry.id);
      }
    }),
    vscode.commands.registerCommand('apiDebugger.deleteSavedRequest', async (value?: unknown) => {
      const saved = asSavedRequest(value);
      if (saved) {
        await store.deleteSavedRequest(saved.id);
      }
    }),
  );
}

function asHistoryEntry(value: unknown): HistoryEntry | undefined {
  if (value instanceof HistoryItem) {
    return value.entry;
  }
  if (typeof value === 'object' && value !== null && 'request' in value && 'id' in value) {
    return value as HistoryEntry;
  }
  return undefined;
}

function asSavedRequest(value: unknown): SavedRequest | undefined {
  if (value instanceof SavedRequestItem) {
    return value.saved;
  }
  if (typeof value === 'object' && value !== null && 'request' in value && 'name' in value) {
    return value as SavedRequest;
  }
  return undefined;
}

export function deactivate(): void {
  // Nothing to clean up: all resources are registered in `context.subscriptions`.
}
