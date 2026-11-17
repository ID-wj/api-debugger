import type { HttpMethod, HttpRequestDraft, KeyValueItem } from '../shared/protocol';

/** Variable sources, ordered from highest to lowest priority. */
export interface VariableScope {
  environment?: Record<string, string>;
  collection?: Record<string, string>;
  globals?: Record<string, string>;
}

export interface PreparedRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface PrepareResult {
  request?: PreparedRequest;
  unresolved: string[];
  error?: string;
}

const RAW_CONTENT_TYPES: Record<string, string> = {
  json: 'application/json',
  xml: 'application/xml',
  text: 'text/plain',
};

export function hasVariables(input: string): boolean {
  return /\{\{\s*([^{}]+?)\s*\}\}/.test(input);
}

export function resolveVariables(input: string, scope: VariableScope, unresolved = new Set<string>()): string {
  return input.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, rawName: string) => {
    const name = rawName.trim();
    const value = scope.environment?.[name] ?? scope.collection?.[name] ?? scope.globals?.[name];
    if (value === undefined) {
      unresolved.add(name);
      return match;
    }
    return value;
  });
}

function enabledItems(items: KeyValueItem[]): KeyValueItem[] {
  return items.filter((item) => item.enabled && (item.key.trim().length > 0 || item.value.length > 0));
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());
}

/**
 * Turns a draft filled with `{{variables}}` into a concrete request that can be handed to fetch.
 * Never throws: invalid input is reported through `error`.
 */
export function prepareRequest(draft: HttpRequestDraft, scope: VariableScope): PrepareResult {
  const unresolved = new Set<string>();
  const rawUrl = resolveVariables(draft.url.trim(), scope, unresolved);
  if (!rawUrl) {
    return { unresolved: [...unresolved], error: '请先填写请求 URL' };
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { unresolved: [...unresolved], error: `URL 无效：${rawUrl}` };
  }

  for (const param of enabledItems(draft.params)) {
    const key = resolveVariables(param.key.trim(), scope, unresolved);
    if (!key) {
      continue;
    }
    url.searchParams.append(key, resolveVariables(param.value, scope, unresolved));
  }

  const headers: Record<string, string> = {};
  for (const header of enabledItems(draft.headers)) {
    const key = resolveVariables(header.key.trim(), scope, unresolved);
    if (!key) {
      continue;
    }
    headers[key] = resolveVariables(header.value, scope, unresolved);
  }

  const body = buildBody(draft, scope, unresolved, headers);
  return {
    request: { method: draft.method, url: url.toString(), headers, body },
    unresolved: [...unresolved],
  };
}

function buildBody(
  draft: HttpRequestDraft,
  scope: VariableScope,
  unresolved: Set<string>,
  headers: Record<string, string>,
): string | undefined {
  const body = draft.body;
  if (!body || body.mode === 'none') {
    return undefined;
  }

  if (body.mode === 'raw') {
    const text = resolveVariables(body.rawText, scope, unresolved);
    if (text.length > 0 && !hasHeader(headers, 'content-type')) {
      headers['Content-Type'] = RAW_CONTENT_TYPES[body.rawLanguage] ?? 'text/plain';
    }
    return text;
  }

  if (body.mode === 'form-urlencoded') {
    const params = new URLSearchParams();
    for (const item of enabledItems(body.urlencoded)) {
      const key = resolveVariables(item.key.trim(), scope, unresolved);
      if (!key) {
        continue;
      }
      params.append(key, resolveVariables(item.value, scope, unresolved));
    }
    if (!hasHeader(headers, 'content-type')) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    return params.toString();
  }

  const fields: Array<{ key: string; value: string }> = [];
  for (const item of enabledItems(body.formData)) {
    const key = resolveVariables(item.key.trim(), scope, unresolved);
    if (!key) {
      continue;
    }
    fields.push({ key, value: resolveVariables(item.value, scope, unresolved) });
  }

  const multipart = buildMultipartBody(fields);
  if (!hasHeader(headers, 'content-type')) {
    headers['Content-Type'] = multipart.contentType;
  }
  return multipart.body;
}

/**
 * Multipart is assembled by hand so the request needs no global FormData and the body
 * stays inspectable in tests. Only text fields are supported in this version.
 */
function buildMultipartBody(fields: Array<{ key: string; value: string }>): { body: string; contentType: string } {
  const boundary = `----api-debugger-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const parts = fields.map(
    (field) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${field.key.replace(/["\r\n]/g, '_')}"\r\n\r\n${field.value}\r\n`,
  );
  parts.push(`--${boundary}--\r\n`);
  return { body: parts.join(''), contentType: `multipart/form-data; boundary=${boundary}` };
}
