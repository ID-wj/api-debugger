import * as vscode from 'vscode';
import type {
  Environment,
  HistoryEntry,
  HttpRequestDraft,
  PanelSettings,
  PersistedState,
  SavedRequest,
} from '../shared/protocol';
import { newId } from '../shared/protocol';

const ENVIRONMENTS_FILE = 'environments.json';
const COLLECTIONS_FILE = 'collections.json';
const HISTORY_FILE = 'history.json';

const DEFAULT_GROUP = 'My Collection';
const DEFAULT_MAX_HISTORY = 200;
const DEFAULT_TIMEOUT = 30000;

interface EnvironmentsFile {
  globals: Record<string, string>;
  environments: Environment[];
  activeEnvironment: string | null;
}

function emptyState(): PersistedState {
  return { globals: {}, environments: [], activeEnvironment: null, collections: [], history: [] };
}

/**
 * Owns everything that survives a window reload: environments, saved requests and history.
 * State lives in the workspace (`.api-debugger/*.json`) so it can be reviewed and committed.
 */
export class ApiStore implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  private state: PersistedState = emptyState();
  private directory: vscode.Uri | undefined;
  private watcher: vscode.FileSystemWatcher | undefined;
  private reloadTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async init(): Promise<void> {
    this.directory = this.resolveDirectory();
    await vscode.workspace.fs.createDirectory(this.directory);
    await this.reload();

    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(this.directory, '*.json'));
    const scheduleReload = () => this.scheduleReload();
    watcher.onDidChange(scheduleReload);
    watcher.onDidCreate(scheduleReload);
    watcher.onDidDelete(scheduleReload);
    this.watcher = watcher;
  }

  dispose(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
    }
    this.watcher?.dispose();
    this.changeEmitter.dispose();
  }

  get snapshot(): PersistedState {
    return this.state;
  }

  get settings(): PanelSettings {
    const config = vscode.workspace.getConfiguration('api-debugger');
    return {
      timeout: config.get<number>('timeout') ?? DEFAULT_TIMEOUT,
      followRedirects: config.get<boolean>('followRedirects') ?? true,
    };
  }

  resolveDirectory(): vscode.Uri {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return this.context.globalStorageUri;
    }
    const configured =
      vscode.workspace.getConfiguration('api-debugger').get<string>('storageDir')?.trim() || '.api-debugger';
    return vscode.Uri.joinPath(folder.uri, configured);
  }

  async reload(): Promise<void> {
    const directory = this.requireDirectory();
    const [rawEnvironments, collections, history] = await Promise.all([
      this.readJson<Partial<EnvironmentsFile>>(directory, ENVIRONMENTS_FILE, {}),
      this.readJson<SavedRequest[]>(directory, COLLECTIONS_FILE, []),
      this.readJson<HistoryEntry[]>(directory, HISTORY_FILE, []),
    ]);

    const environmentsFile: Partial<EnvironmentsFile> =
      rawEnvironments && typeof rawEnvironments === 'object' ? rawEnvironments : {};

    this.state = {
      globals: environmentsFile.globals ?? {},
      environments: (environmentsFile.environments ?? [])
        .filter((item): item is Environment => typeof item?.name === 'string' && item.name.length > 0)
        .map((item) => ({ name: item.name, variables: item.variables ?? {} })),
      activeEnvironment: environmentsFile.activeEnvironment ?? null,
      collections: Array.isArray(collections) ? collections.filter((item) => typeof item?.id === 'string') : [],
      history: Array.isArray(history) ? history.filter((item) => typeof item?.id === 'string') : [],
    };
    this.changeEmitter.fire();
  }

  async addHistory(request: HttpRequestDraft, status: number, durationMs: number): Promise<void> {
    const signature = `${request.method} ${request.url}`;
    const entry: HistoryEntry = { id: newId('h'), at: Date.now(), status, durationMs, request };
    const history = this.state.history.filter((item) => `${item.request.method} ${item.request.url}` !== signature);
    history.unshift(entry);

    this.state = { ...this.state, history: history.slice(0, this.maxHistory()) };
    await this.persistHistory();
  }

  async deleteHistoryEntry(id: string): Promise<void> {
    this.state = { ...this.state, history: this.state.history.filter((item) => item.id !== id) };
    await this.persistHistory();
  }

  async clearHistory(): Promise<void> {
    this.state = { ...this.state, history: [] };
    await this.persistHistory();
  }

  async saveRequest(name: string, group: string, request: HttpRequestDraft): Promise<SavedRequest> {
    const saved: SavedRequest = {
      id: newId('req'),
      name: name.trim() || `${request.method} ${request.url}`,
      group: group.trim() || DEFAULT_GROUP,
      request,
    };
    this.state = { ...this.state, collections: [...this.state.collections, saved] };
    await this.persistCollections();
    return saved;
  }

  async deleteSavedRequest(id: string): Promise<void> {
    this.state = { ...this.state, collections: this.state.collections.filter((item) => item.id !== id) };
    await this.persistCollections();
  }

  async setActiveEnvironment(name: string | null): Promise<void> {
    if (name !== null && !this.state.environments.some((item) => item.name === name)) {
      return;
    }
    this.state = { ...this.state, activeEnvironment: name };
    await this.persistEnvironments();
  }

  get activeVariables(): Record<string, string> {
    const active = this.state.environments.find((item) => item.name === this.state.activeEnvironment);
    return active?.variables ?? {};
  }

  private maxHistory(): number {
    const configured = vscode.workspace.getConfiguration('api-debugger').get<number>('maxHistory');
    return Math.max(10, configured ?? DEFAULT_MAX_HISTORY);
  }

  private requireDirectory(): vscode.Uri {
    if (!this.directory) {
      throw new Error('API Debugger storage is not initialized');
    }
    return this.directory;
  }

  private async readJson<T>(directory: vscode.Uri, file: string, fallback: T): Promise<T> {
    try {
      const raw = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(directory, file));
      return JSON.parse(Buffer.from(raw).toString('utf8')) as T;
    } catch {
      return fallback;
    }
  }

  private async writeJson(directory: vscode.Uri, file: string, value: unknown): Promise<void> {
    const content = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(directory, file), content);
  }

  private async persistEnvironments(): Promise<void> {
    const file: EnvironmentsFile = {
      globals: this.state.globals,
      environments: this.state.environments,
      activeEnvironment: this.state.activeEnvironment,
    };
    await this.writeJson(this.requireDirectory(), ENVIRONMENTS_FILE, file);
    this.changeEmitter.fire();
  }

  private async persistCollections(): Promise<void> {
    await this.writeJson(this.requireDirectory(), COLLECTIONS_FILE, this.state.collections);
    this.changeEmitter.fire();
  }

  private async persistHistory(): Promise<void> {
    await this.writeJson(this.requireDirectory(), HISTORY_FILE, this.state.history);
    this.changeEmitter.fire();
  }

  private scheduleReload(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
    }
    this.reloadTimer = setTimeout(() => {
      void this.reload();
    }, 150);
  }
}

export { DEFAULT_GROUP };
