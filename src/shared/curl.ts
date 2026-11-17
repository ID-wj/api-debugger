/**
 * cURL import/export.
 *
 * The module is shared by the extension host and the webview, so it stays free of Node/DOM
 * APIs and works on plain strings only.
 */
import { HTTP_METHODS, newId } from './protocol';
import type { BodyMode, HttpMethod, HttpRequestDraft, KeyValueItem, RawLanguage } from './protocol';

const RAW_CONTENT_TYPES: Record<RawLanguage, string> = {
  json: 'application/json',
  xml: 'application/xml',
  text: 'text/plain',
};

/** Characters that need no quoting in bash / PowerShell. */
const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

function shellQuote(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  if (SHELL_SAFE.test(value)) {
    return value;
  }
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  return `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
}

function enabledItems(items: KeyValueItem[]): KeyValueItem[] {
  return items.filter((item) => item.enabled && item.key.trim().length > 0);
}

/** Encodes a value but keeps `{{variable}}` placeholders readable. */
function encodePreservingVariables(value: string): string {
  return value
    .split(/(\{\{[^{}]*\}\})/)
    .map((part) => (part.startsWith('{{') && part.endsWith('}}') ? part : encodeURIComponent(part)))
    .join('');
}

function buildUrlWithParams(request: HttpRequestDraft): string {
  const url = request.url.trim();
  if (!url) {
    return url;
  }
  const params = enabledItems(request.params);
  if (params.length === 0) {
    return url;
  }
  const query = params
    .map((item) => `${encodePreservingVariables(item.key.trim())}=${encodePreservingVariables(item.value)}`)
    .join('&');
  const separator = !url.includes('?') ? '?' : url.endsWith('?') || url.endsWith('&') ? '' : '&';
  return `${url}${separator}${query}`;
}

function buildHeaders(request: HttpRequestDraft): Array<[string, string]> {
  const headers: Array<[string, string]> = enabledItems(request.headers).map((item) => [item.key.trim(), item.value]);
  if (headers.some(([name]) => name.toLowerCase() === 'content-type')) {
    return headers;
  }
  const body = request.body;
  if (body.mode === 'raw' && body.rawText.length > 0) {
    headers.push(['Content-Type', RAW_CONTENT_TYPES[body.rawLanguage] ?? 'text/plain']);
  } else if (body.mode === 'form-urlencoded' && enabledItems(body.urlencoded).length > 0) {
    headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
  }
  return headers;
}

/**
 * Renders a draft as a single line cURL command that runs in bash, zsh and PowerShell.
 * Placeholders are left untouched so the command can be reused with the same variables.
 */
export function toCurl(request: HttpRequestDraft): string {
  const args: string[] = [`curl -X ${request.method} ${shellQuote(buildUrlWithParams(request))}`];
  for (const [name, value] of buildHeaders(request)) {
    args.push(`-H ${shellQuote(`${name}: ${value}`)}`);
  }

  const body = request.body;
  if (body.mode === 'raw' && body.rawText.length > 0) {
    args.push(`--data-raw ${shellQuote(body.rawText)}`);
  } else if (body.mode === 'form-urlencoded') {
    for (const item of enabledItems(body.urlencoded)) {
      args.push(`--data-urlencode ${shellQuote(`${item.key.trim()}=${item.value}`)}`);
    }
  } else if (body.mode === 'form-data') {
    for (const item of enabledItems(body.formData)) {
      args.push(`--form-string ${shellQuote(`${item.key.trim()}=${item.value}`)}`);
    }
  }
  return args.join(' ');
}

export function looksLikeCurl(input: string): boolean {
  return /(^|\s)curl(\.exe)?\s/i.test(input.trim());
}

export interface CurlParseSuccess {
  ok: true;
  request: HttpRequestDraft;
  warnings: string[];
}

export interface CurlParseFailure {
  ok: false;
  error: string;
}

export type CurlParseResult = CurlParseSuccess | CurlParseFailure;

const ANSI_C_ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  a: '\x07',
  b: '\b',
  f: '\f',
  v: '\v',
  '\\': '\\',
  "'": "'",
  '"': '"',
};

const DOUBLE_QUOTE_ESCAPABLE = new Set(['"', '\\', '$', '`', '\n']);

/** Joins line continuations from bash (`\`), PowerShell (`` ` ``) and cmd (`^`). */
function normalizeCommand(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/\\[ \t]*\n/g, ' ')
    .replace(/`[ \t]*\n/g, ' ')
    .replace(/\^[ \t]*\n/g, ' ')
    .replace(/^\s*\$\s+/, '')
    .trim();
}

/**
 * Splits a command into tokens, understanding single quotes, double quotes, `$'...'`
 * ANSI-C strings and both bash and PowerShell escaping rules.
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let started = false;
  let index = 0;

  const flush = (): void => {
    if (started) {
      tokens.push(current);
      current = '';
      started = false;
    }
  };

  while (index < input.length) {
    const char = input[index];

    if (char === ' ' || char === '\t' || char === '\n') {
      flush();
      index += 1;
      continue;
    }

    if (char === "'") {
      started = true;
      index += 1;
      while (index < input.length) {
        if (input[index] === "'") {
          // `'\''` is the POSIX way of embedding a literal single quote.
          if (input[index + 1] === '\\' && input[index + 2] === "'" && input[index + 3] === "'") {
            current += "'";
            index += 4;
            continue;
          }
          index += 1;
          break;
        }
        current += input[index];
        index += 1;
      }
      continue;
    }

    if (char === '$' && input[index + 1] === "'") {
      started = true;
      index += 2;
      while (index < input.length) {
        const inner = input[index];
        if (inner === "'") {
          index += 1;
          break;
        }
        if (inner === '\\' && index + 1 < input.length) {
          const next = input[index + 1];
          current += ANSI_C_ESCAPES[next] ?? next;
          index += 2;
          continue;
        }
        current += inner;
        index += 1;
      }
      continue;
    }

    if (char === '"') {
      started = true;
      index += 1;
      while (index < input.length) {
        const inner = input[index];
        if (inner === '"') {
          index += 1;
          break;
        }
        if (inner === '\\' && index + 1 < input.length && DOUBLE_QUOTE_ESCAPABLE.has(input[index + 1])) {
          current += input[index + 1] === '\n' ? '' : input[index + 1];
          index += 2;
          continue;
        }
        if (inner === '`' && index + 1 < input.length && '"`$'.includes(input[index + 1])) {
          current += input[index + 1];
          index += 2;
          continue;
        }
        current += inner;
        index += 1;
      }
      continue;
    }

    if (char === '\\' && index + 1 < input.length) {
      started = true;
      current += input[index + 1];
      index += 2;
      continue;
    }

    if (char === '`' && index + 1 < input.length) {
      const next = input[index + 1];
      if (next === 'n' || next === 't') {
        started = true;
        current += next === 'n' ? '\n' : '\t';
        index += 2;
        continue;
      }
      if ('"`$\''.includes(next)) {
        started = true;
        current += next;
        index += 2;
        continue;
      }
    }

    started = true;
    current += char;
    index += 1;
  }

  flush();
  return tokens;
}

function decodeQueryComponent(value: string): string {
  const spaced = value.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(spaced);
  } catch {
    return spaced;
  }
}

function splitPairs(text: string): Array<[string, string]> {
  return text
    .split('&')
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0)
    .map((piece): [string, string] => {
      const separator = piece.indexOf('=');
      if (separator === -1) {
        return [decodeQueryComponent(piece), ''];
      }
      return [decodeQueryComponent(piece.slice(0, separator)), decodeQueryComponent(piece.slice(separator + 1))];
    });
}

function looksUrlEncoded(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('<')) {
    return false;
  }
  return /^[^\s=&]+=/.test(trimmed);
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Minimal UTF-8 aware base64 encoder, used for `-u user:password`. */
function base64(input: string): string {
  const bytes: number[] = [];
  for (const character of input) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }

  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const chunk = (bytes[index] << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);
    output += BASE64_ALPHABET[(chunk >> 18) & 63] + BASE64_ALPHABET[(chunk >> 12) & 63];
    output += index + 1 < bytes.length ? BASE64_ALPHABET[(chunk >> 6) & 63] : '=';
    output += index + 2 < bytes.length ? BASE64_ALPHABET[chunk & 63] : '=';
  }
  return output;
}

interface RawHeader {
  name: string;
  value: string;
}

function pushHeader(headers: RawHeader[], raw: string, warnings: string[]): void {
  if (raw.startsWith('@')) {
    warnings.push('暂不支持从文件读取请求头，已忽略');
    return;
  }
  const separator = raw.indexOf(':');
  if (separator === -1) {
    const name = raw.replace(/;$/, '').trim();
    if (name && raw.endsWith(';')) {
      headers.push({ name, value: '' });
      return;
    }
    warnings.push(`无法识别的请求头：${raw}`);
    return;
  }
  const name = raw.slice(0, separator).trim();
  if (!name) {
    return;
  }
  headers.push({ name, value: raw.slice(separator + 1).trim() });
}

function pushFormField(fields: RawHeader[], raw: string, literal: boolean, warnings: string[]): void {
  const separator = raw.indexOf('=');
  if (separator <= 0) {
    warnings.push(`无法识别的表单字段：${raw}`);
    return;
  }
  const name = raw.slice(0, separator);
  let value = raw.slice(separator + 1);
  if (!literal) {
    if (value.startsWith('@') || value.startsWith('<')) {
      warnings.push(`表单字段 ${name} 引用了文件，已按文本保留`);
    } else {
      const typeIndex = value.indexOf(';type=');
      if (typeIndex !== -1) {
        value = value.slice(0, typeIndex);
      }
    }
  }
  fields.push({ name, value });
}

const IGNORED_VALUE_FLAGS = new Set([
  '-m',
  '--max-time',
  '--connect-timeout',
  '-o',
  '--output',
  '-w',
  '--write-out',
  '-c',
  '--cookie-jar',
  '-x',
  '--proxy',
  '--cacert',
  '--capath',
  '--cert',
  '--cert-type',
  '--key',
  '--key-type',
  '--retry',
  '--retry-delay',
  '--retry-max-time',
  '--resolve',
  '--interface',
  '--limit-rate',
  '--max-filesize',
  '--keepalive-time',
]);

const IGNORED_BOOLEAN_FLAGS = new Set([
  '-s',
  '--silent',
  '-S',
  '--show-error',
  '-k',
  '--insecure',
  '-L',
  '--location',
  '-i',
  '--include',
  '-v',
  '--verbose',
  '-f',
  '--fail',
  '-N',
  '--no-buffer',
  '-4',
  '-6',
  '-g',
  '--globoff',
  '--compressed',
  '--http1.1',
  '--http2',
  '--http2-prior-knowledge',
  '--no-progress-meter',
  '--path-as-is',
]);

function toItems(pairs: Array<[string, string]>): KeyValueItem[] {
  return pairs.map(([key, value]) => ({ id: newId('kv'), key, value, enabled: true }));
}

function toHeaderItems(headers: RawHeader[]): KeyValueItem[] {
  return headers.map((header) => ({ id: newId('kv'), key: header.name, value: header.value, enabled: true }));
}

/**
 * Parses a cURL command (bash / zsh / PowerShell / cmd flavours) into a request draft.
 * Unknown but harmless options are skipped and reported through `warnings`.
 */
export function parseCurl(input: string): CurlParseResult {
  const tokens = tokenize(normalizeCommand(input));
  if (tokens.length === 0) {
    return { ok: false, error: '没有可解析的 cURL 内容' };
  }

  const warnings: string[] = [];
  let index = 0;
  if (/^(.*[\\/])?curl(\.exe)?$/i.test(tokens[0])) {
    index = 1;
  } else {
    warnings.push('未找到 curl 命令，已按选项解析');
  }

  const headers: RawHeader[] = [];
  const dataChunks: string[] = [];
  const formFields: RawHeader[] = [];
  const queryPairs: Array<[string, string]> = [];
  let method: string | undefined;
  let url = '';
  let getMode = false;
  let headMode = false;
  let jsonMode = false;
  let usedUrlencode = false;

  while (index < tokens.length) {
    const token = tokens[index];
    index += 1;

    if (token === '--') {
      const trailing = tokens[index];
      if (trailing !== undefined && !url) {
        url = trailing;
        index += 1;
      }
      continue;
    }

    if (!token.startsWith('-') || token === '-') {
      if (!url) {
        url = token;
      } else {
        warnings.push(`忽略多余参数：${token}`);
      }
      continue;
    }

    let name = token;
    let inlineValue: string | undefined;
    if (token.startsWith('--') && token.includes('=')) {
      const separator = token.indexOf('=');
      name = token.slice(0, separator);
      inlineValue = token.slice(separator + 1);
    }

    const readValue = (): string | undefined => {
      if (inlineValue !== undefined) {
        return inlineValue;
      }
      const value = tokens[index];
      if (value !== undefined) {
        index += 1;
      }
      return value;
    };

    if (IGNORED_BOOLEAN_FLAGS.has(name)) {
      continue;
    }
    if (IGNORED_VALUE_FLAGS.has(name)) {
      readValue();
      continue;
    }

    switch (name) {
      case '-X':
      case '--request': {
        const value = readValue();
        if (value) {
          method = value.trim().toUpperCase();
        }
        break;
      }
      case '-H':
      case '--header': {
        const value = readValue();
        if (value !== undefined) {
          pushHeader(headers, value, warnings);
        }
        break;
      }
      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-ascii':
      case '--data-binary': {
        const value = readValue();
        if (value === undefined) {
          break;
        }
        if (value.startsWith('@')) {
          warnings.push('暂不支持从文件读取请求体，已忽略');
          break;
        }
        dataChunks.push(value);
        break;
      }
      case '--data-urlencode': {
        const value = readValue();
        if (value === undefined) {
          break;
        }
        if (value.startsWith('@')) {
          warnings.push('暂不支持从文件读取请求体，已忽略');
          break;
        }
        usedUrlencode = true;
        dataChunks.push(value);
        break;
      }
      case '--json': {
        const value = readValue();
        if (value !== undefined) {
          jsonMode = true;
          dataChunks.push(value);
        }
        break;
      }
      case '-F':
      case '--form':
      case '--form-string': {
        const value = readValue();
        if (value !== undefined) {
          pushFormField(formFields, value, name === '--form-string', warnings);
        }
        break;
      }
      case '-u':
      case '--user': {
        const value = readValue();
        if (value) {
          headers.push({ name: 'Authorization', value: `Basic ${base64(value)}` });
        }
        break;
      }
      case '-A':
      case '--user-agent': {
        const value = readValue();
        if (value !== undefined) {
          headers.push({ name: 'User-Agent', value });
        }
        break;
      }
      case '-e':
      case '--referer': {
        const value = readValue();
        if (value !== undefined) {
          headers.push({ name: 'Referer', value });
        }
        break;
      }
      case '-b':
      case '--cookie': {
        const value = readValue();
        if (value) {
          if (value.includes('=')) {
            headers.push({ name: 'Cookie', value });
          } else {
            warnings.push(`忽略 cookie 文件：${value}`);
          }
        }
        break;
      }
      case '--url': {
        const value = readValue();
        if (value) {
          url = value;
        }
        break;
      }
      case '--url-query': {
        const value = readValue();
        if (value) {
          queryPairs.push(...splitPairs(value));
        }
        break;
      }
      case '-G':
      case '--get':
        getMode = true;
        break;
      case '-I':
      case '--head':
        headMode = true;
        break;
      case '-T':
      case '--upload-file': {
        const value = readValue();
        warnings.push(`暂不支持上传文件：${value ?? ''}`.trim());
        break;
      }
      default:
        if (name.startsWith('--')) {
          warnings.push(`忽略未知选项：${name}`);
        } else if (name.length > 2) {
          warnings.push(`忽略未知选项：${name}`);
        }
        break;
    }
  }

  if (!url) {
    return { ok: false, error: '未找到请求 URL' };
  }

  const fragmentIndex = url.indexOf('#');
  const fragment = fragmentIndex === -1 ? '' : url.slice(fragmentIndex);
  const withoutFragment = fragmentIndex === -1 ? url : url.slice(0, fragmentIndex);
  const queryIndex = withoutFragment.indexOf('?');
  const baseUrl = (queryIndex === -1 ? withoutFragment : withoutFragment.slice(0, queryIndex)) + fragment;
  const params: Array<[string, string]> =
    queryIndex === -1 ? [] : splitPairs(withoutFragment.slice(queryIndex + 1));
  params.push(...queryPairs);

  const dataText = dataChunks.join('&');
  const contentType = headers.find((header) => header.name.toLowerCase() === 'content-type')?.value.toLowerCase() ?? '';

  let bodyMode: BodyMode = 'none';
  let rawLanguage: RawLanguage = 'json';
  let rawText = '';
  let urlencoded: Array<[string, string]> = [];
  const formData: Array<[string, string]> = formFields.map((field) => [field.name, field.value]);

  if (formData.length > 0 && dataText) {
    warnings.push('同时存在表单字段与 -d 数据，已按 form-data 处理');
  }

  if (formData.length > 0) {
    bodyMode = 'form-data';
  } else if (dataText) {
    if (jsonMode || contentType.includes('json') || /^\s*[{[]/.test(dataText)) {
      bodyMode = 'raw';
      rawLanguage = 'json';
      rawText = dataText;
    } else if (contentType.includes('xml')) {
      bodyMode = 'raw';
      rawLanguage = 'xml';
      rawText = dataText;
    } else if (contentType.includes('x-www-form-urlencoded') || usedUrlencode || looksUrlEncoded(dataText)) {
      bodyMode = 'form-urlencoded';
      urlencoded = splitPairs(dataText);
    } else {
      bodyMode = 'raw';
      rawLanguage = 'text';
      rawText = dataText;
    }
  }

  let rawMethod = headMode ? 'HEAD' : (method ?? '');
  if (getMode && rawMethod !== 'HEAD') {
    rawMethod = 'GET';
  }
  if (!rawMethod) {
    rawMethod = bodyMode === 'none' ? 'GET' : 'POST';
  }

  // fetch refuses a body on GET/HEAD, so curl data is folded back into the query string.
  if ((rawMethod === 'GET' || rawMethod === 'HEAD') && bodyMode !== 'none') {
    const queryFields = bodyMode === 'form-urlencoded' ? urlencoded : bodyMode === 'form-data' ? formData : [];
    if (queryFields.length > 0) {
      params.push(...queryFields);
      warnings.push(`${rawMethod} 请求的数据已转为查询参数`);
    } else if (rawText) {
      warnings.push(`${rawMethod} 请求不支持请求体，已忽略 -d 数据`);
    }
    bodyMode = 'none';
    rawText = '';
  }

  const methodSupported = (HTTP_METHODS as readonly string[]).includes(rawMethod);
  if (!methodSupported) {
    warnings.push(`不支持的方法 ${rawMethod}，已改为 GET`);
  }
  const resolvedMethod: HttpMethod = methodSupported ? (rawMethod as HttpMethod) : 'GET';

  const effectiveHeaders =
    bodyMode === 'form-data'
      ? headers.filter((header) => {
          const isMultipart =
            header.name.toLowerCase() === 'content-type' && header.value.toLowerCase().includes('multipart/form-data');
          return !isMultipart;
        })
      : headers;
  if (effectiveHeaders.length !== headers.length) {
    warnings.push('已忽略手写的 multipart Content-Type，发送时会重新生成 boundary');
  }

  return {
    ok: true,
    warnings,
    request: {
      method: resolvedMethod,
      url: baseUrl,
      params: toItems(params),
      headers: toHeaderItems(effectiveHeaders),
      body: {
        mode: bodyMode,
        rawLanguage,
        rawText,
        urlencoded: toItems(urlencoded),
        formData: toItems(formData),
      },
    },
  };
}
