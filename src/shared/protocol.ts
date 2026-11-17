/**
 * Types shared between the extension host and the webview.
 * Everything in this module must stay JSON serializable.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export const HTTP_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export type ThemeKind = 'light' | 'dark' | 'high-contrast';

export type CurlDialogMode = 'import' | 'export';

export interface KeyValueItem {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export type RawLanguage = 'json' | 'xml' | 'text';
export type BodyMode = 'none' | 'raw' | 'form-urlencoded' | 'form-data';

export interface RequestBody {
  mode: BodyMode;
  rawLanguage: RawLanguage;
  rawText: string;
  urlencoded: KeyValueItem[];
  formData: KeyValueItem[];
}

export interface HttpRequestDraft {
  method: HttpMethod;
  url: string;
  params: KeyValueItem[];
  headers: KeyValueItem[];
  body: RequestBody;
}

export interface HttpResult {
  requestId: string;
  method: string;
  url: string;
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  contentType: string;
  bodyText?: string;
  bodyBase64?: string;
  size: number;
  durationMs: number;
  redirected: boolean;
  truncated: boolean;
  unresolvedVariables: string[];
  receivedAt: number;
}

export interface HistoryEntry {
  id: string;
  at: number;
  status: number | null;
  durationMs: number | null;
  request: HttpRequestDraft;
}

export interface SavedRequest {
  id: string;
  name: string;
  group: string;
  request: HttpRequestDraft;
}

export interface Environment {
  name: string;
  variables: Record<string, string>;
}

export interface PersistedState {
  globals: Record<string, string>;
  environments: Environment[];
  activeEnvironment: string | null;
  collections: SavedRequest[];
  history: HistoryEntry[];
}

export interface PanelSettings {
  timeout: number;
  followRedirects: boolean;
}

export type FromWebviewMessage =
  | { type: 'ready' }
  | { type: 'send'; requestId: string; request: HttpRequestDraft }
  | { type: 'cancel'; requestId: string }
  | { type: 'saveRequest'; request: HttpRequestDraft }
  | { type: 'deleteSavedRequest'; id: string }
  | { type: 'deleteHistoryEntry'; id: string }
  | { type: 'clearHistory' }
  | { type: 'setActiveEnvironment'; name: string | null }
  | { type: 'copyToClipboard'; text: string };

export type ToWebviewMessage =
  | { type: 'init'; state: PersistedState; theme: ThemeKind; settings: PanelSettings }
  | { type: 'state'; state: PersistedState }
  | { type: 'pending'; requestId: string }
  | { type: 'response'; requestId: string; result: HttpResult }
  | { type: 'error'; requestId?: string; message: string }
  | { type: 'loadRequest'; request: HttpRequestDraft }
  | { type: 'triggerSend' }
  | { type: 'openCurlDialog'; mode: CurlDialogMode; text?: string }
  | { type: 'theme'; kind: ThemeKind };

export const MESSAGE_TYPES: readonly FromWebviewMessage['type'][] = [
  'ready',
  'send',
  'cancel',
  'saveRequest',
  'deleteSavedRequest',
  'deleteHistoryEntry',
  'clearHistory',
  'setActiveEnvironment',
  'copyToClipboard',
];

let idCounter = 0;

export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createEmptyRequest(): HttpRequestDraft {
  return {
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    body: { mode: 'none', rawLanguage: 'json', rawText: '', urlencoded: [], formData: [] },
  };
}

export function cloneRequest(request: HttpRequestDraft): HttpRequestDraft {
  return JSON.parse(JSON.stringify(request)) as HttpRequestDraft;
}

function normalizeItems(value: unknown): KeyValueItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Partial<KeyValueItem> => typeof item === 'object' && item !== null)
    .map((item) => ({
      id: typeof item.id === 'string' && item.id ? item.id : newId('kv'),
      key: typeof item.key === 'string' ? item.key : '',
      value: typeof item.value === 'string' ? item.value : '',
      enabled: item.enabled !== false,
    }));
}

function normalizeBody(value: unknown): RequestBody {
  const body = (typeof value === 'object' && value !== null ? value : {}) as Partial<RequestBody>;
  const mode: BodyMode =
    body.mode === 'raw' || body.mode === 'form-urlencoded' || body.mode === 'form-data' ? body.mode : 'none';
  const rawLanguage: RawLanguage = body.rawLanguage === 'xml' || body.rawLanguage === 'text' ? body.rawLanguage : 'json';
  return {
    mode,
    rawLanguage,
    rawText: typeof body.rawText === 'string' ? body.rawText : '',
    urlencoded: normalizeItems(body.urlencoded),
    formData: normalizeItems(body.formData),
  };
}

/**
 * Coerces an untrusted payload coming from the webview into a valid request draft.
 * Returns undefined when the payload cannot represent a request at all.
 */
export function normalizeRequestDraft(value: unknown): HttpRequestDraft | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const draft = value as Partial<HttpRequestDraft>;
  if (typeof draft.url !== 'string') {
    return undefined;
  }
  const method =
    typeof draft.method === 'string' && (HTTP_METHODS as readonly string[]).includes(draft.method)
      ? (draft.method as HttpMethod)
      : 'GET';
  return {
    method,
    url: draft.url,
    params: normalizeItems(draft.params),
    headers: normalizeItems(draft.headers),
    body: normalizeBody(draft.body),
  };
}
