import * as vscode from 'vscode';
import type { ApiStore } from '../services/collectionStore';
import type { HistoryEntry } from '../shared/protocol';

function statusIcon(status: number | null): string {
  if (status === null) {
    return 'circle-outline';
  }
  if (status >= 500) {
    return 'error';
  }
  return status >= 400 ? 'warning' : 'pass';
}

function describePath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function relativeTime(at: number): string {
  const diff = Date.now() - at;
  const minute = 60000;
  if (diff < minute) {
    return '刚刚';
  }
  if (diff < 60 * minute) {
    return `${Math.round(diff / minute)} 分钟前`;
  }
  if (diff < 24 * 60 * minute) {
    return `${Math.round(diff / (60 * minute))} 小时前`;
  }
  return new Date(at).toLocaleDateString();
}

export class HistoryItem extends vscode.TreeItem {
  override readonly contextValue = 'historyEntry';

  constructor(readonly entry: HistoryEntry) {
    super(`${entry.request.method} ${describePath(entry.request.url)}`, vscode.TreeItemCollapsibleState.None);
    const status = entry.status === null ? '-' : String(entry.status);
    const duration = entry.durationMs === null ? '-' : `${entry.durationMs}ms`;
    this.description = `${status} · ${duration} · ${relativeTime(entry.at)}`;
    this.iconPath = new vscode.ThemeIcon(statusIcon(entry.status));
    this.tooltip = new vscode.MarkdownString(
      `${entry.request.url}\n\n${new Date(entry.at).toLocaleString()}`,
    );
    this.command = { command: 'apiDebugger.openHistoryEntry', title: 'Open Request', arguments: [entry] };
  }
}

export class HistoryTreeProvider implements vscode.TreeDataProvider<HistoryItem>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly subscription: vscode.Disposable;

  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly store: ApiStore) {
    this.subscription = store.onDidChange(() => this.changeEmitter.fire());
  }

  getTreeItem(element: HistoryItem): vscode.TreeItem {
    return element;
  }

  getChildren(): HistoryItem[] {
    return this.store.snapshot.history.map((entry) => new HistoryItem(entry));
  }

  dispose(): void {
    this.subscription.dispose();
    this.changeEmitter.dispose();
  }
}
