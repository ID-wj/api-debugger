import * as vscode from 'vscode';
import type { ApiStore } from '../services/collectionStore';
import type { SavedRequest } from '../shared/protocol';

export class SavedRequestItem extends vscode.TreeItem {
  override readonly contextValue = 'savedRequest';

  constructor(readonly saved: SavedRequest) {
    super(saved.name, vscode.TreeItemCollapsibleState.None);
    this.description = `${saved.request.method} ${saved.request.url}`;
    this.iconPath = new vscode.ThemeIcon('symbol-method');
    this.tooltip = new vscode.MarkdownString(`${saved.name}\n\n${saved.request.method} ${saved.request.url}`);
    this.command = { command: 'apiDebugger.openSavedRequest', title: 'Open Saved Request', arguments: [saved] };
  }
}

export class GroupItem extends vscode.TreeItem {
  override readonly contextValue = 'collectionGroup';

  constructor(readonly group: string, children: SavedRequestItem[]) {
    super(group, vscode.TreeItemCollapsibleState.Expanded);
    this.description = String(children.length);
    this.iconPath = new vscode.ThemeIcon('folder');
    this.children = children;
  }

  readonly children: SavedRequestItem[];
}

export type CollectionNode = GroupItem | SavedRequestItem;

export class CollectionTreeProvider implements vscode.TreeDataProvider<CollectionNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly subscription: vscode.Disposable;

  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly store: ApiStore) {
    this.subscription = store.onDidChange(() => this.changeEmitter.fire());
  }

  getTreeItem(element: CollectionNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: CollectionNode): CollectionNode[] {
    const saved = this.store.snapshot.collections;
    if (element instanceof GroupItem) {
      return element.children;
    }
    if (element) {
      return [];
    }

    const groups = new Map<string, SavedRequestItem[]>();
    for (const item of saved) {
      const bucket = groups.get(item.group) ?? [];
      bucket.push(new SavedRequestItem(item));
      groups.set(item.group, bucket);
    }
    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([group, children]) => new GroupItem(group, children));
  }

  dispose(): void {
    this.subscription.dispose();
    this.changeEmitter.dispose();
  }
}
