import * as vscode from 'vscode';
import type { ApiStore } from '../services/collectionStore';
import type { Environment } from '../shared/protocol';

export class EnvironmentItem extends vscode.TreeItem {
  override readonly contextValue = 'environment';

  constructor(readonly environment: Environment, active: boolean) {
    super(environment.name, vscode.TreeItemCollapsibleState.None);
    const count = Object.keys(environment.variables).length;
    this.description = active ? '当前环境' : `${count} 个变量`;
    this.iconPath = new vscode.ThemeIcon(active ? 'check' : 'symbol-variable');
    this.tooltip = new vscode.MarkdownString(
      Object.entries(environment.variables)
        .map(([key, value]) => `${key} = ${value}`)
        .join('\n\n') || '该环境暂无变量',
    );
    this.command = {
      command: 'apiDebugger.selectEnvironment',
      title: 'Use Environment',
      arguments: [environment.name],
    };
  }
}

export class EnvironmentTreeProvider implements vscode.TreeDataProvider<EnvironmentItem>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly subscription: vscode.Disposable;

  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly store: ApiStore) {
    this.subscription = store.onDidChange(() => this.changeEmitter.fire());
  }

  getTreeItem(element: EnvironmentItem): vscode.TreeItem {
    return element;
  }

  getChildren(): EnvironmentItem[] {
    const { environments, activeEnvironment } = this.store.snapshot;
    return environments.map((environment) => new EnvironmentItem(environment, environment.name === activeEnvironment));
  }

  dispose(): void {
    this.subscription.dispose();
    this.changeEmitter.dispose();
  }
}
