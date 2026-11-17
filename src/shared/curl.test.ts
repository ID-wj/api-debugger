import { describe, expect, it } from 'vitest';
import { createEmptyRequest } from './protocol';
import type { HttpRequestDraft } from './protocol';
import { parseCurl, toCurl } from './curl';

function draft(mutate: (request: HttpRequestDraft) => void): HttpRequestDraft {
  const request = createEmptyRequest();
  mutate(request);
  return request;
}

function item(key: string, value: string, enabled = true) {
  return { id: `${key}-${value}`, key, value, enabled };
}

function expectParsed(input: string) {
  const result = parseCurl(input);
  if (!result.ok) {
    throw new Error(`解析失败：${result.error}`);
  }
  return result;
}

describe('toCurl', () => {
  it('renders method, params, headers and a raw JSON body', () => {
    const command = toCurl(
      draft((request) => {
        request.method = 'POST';
        request.url = 'https://api.example.com/users';
        request.params = [item('page', '2'), item('hidden', 'x', false)];
        request.headers = [item('X-Token', 'abc')];
        request.body = { ...request.body, mode: 'raw', rawLanguage: 'json', rawText: '{"name":"qoder"}' };
      }),
    );

    expect(command).toBe(
      "curl -X POST 'https://api.example.com/users?page=2' -H 'X-Token: abc' " +
        "-H 'Content-Type: application/json' --data-raw '{\"name\":\"qoder\"}'",
    );
  });

  it('keeps variable placeholders readable', () => {
    const command = toCurl(
      draft((request) => {
        request.url = '{{baseUrl}}/users';
        request.params = [item('id', '{{userId}}')];
      }),
    );

    expect(command).toBe("curl -X GET '{{baseUrl}}/users?id={{userId}}'");
  });

  it('escapes single quotes by switching to double quotes', () => {
    const command = toCurl(
      draft((request) => {
        request.url = 'https://example.com/search';
        request.headers = [item('X-Note', "it's $fine")];
      }),
    );

    expect(command).toContain('-H "X-Note: it\'s \\$fine"');
  });

  it('exports form bodies with curl friendly flags', () => {
    const command = toCurl(
      draft((request) => {
        request.url = 'https://example.com/upload';
        request.body = {
          ...request.body,
          mode: 'form-data',
          formData: [item('field', 'value')],
        };
      }),
    );

    expect(command).toContain('--form-string field=value');
    expect(command).not.toContain('Content-Type');
  });
});

describe('parseCurl', () => {
  it('parses URL, query parameters and headers', () => {
    const { request, warnings } = expectParsed(
      "curl 'https://api.example.com/users?page=2&q=a%20b' -H 'X-Token: abc' -H 'Accept: application/json'",
    );

    expect(warnings).toEqual([]);
    expect(request.method).toBe('GET');
    expect(request.url).toBe('https://api.example.com/users');
    expect(request.params.map((param) => [param.key, param.value])).toEqual([
      ['page', '2'],
      ['q', 'a b'],
    ]);
    expect(request.headers.map((header) => [header.key, header.value])).toEqual([
      ['X-Token', 'abc'],
      ['Accept', 'application/json'],
    ]);
    expect(request.body.mode).toBe('none');
  });

  it('parses multi-line commands with backslash continuations', () => {
    const { request } = expectParsed(
      `curl -X PUT 'https://api.example.com/users/1' \\
  -H 'Content-Type: application/json' \\
  -d '{"name":"qoder","active":true}'`,
    );

    expect(request.method).toBe('PUT');
    expect(request.body.mode).toBe('raw');
    expect(request.body.rawLanguage).toBe('json');
    expect(request.body.rawText).toBe('{"name":"qoder","active":true}');
  });

  it('handles a Postman style export with --location and multi-line JSON data', () => {
    const { request } = expectParsed(
      `curl --location 'https://api.example.com/v1/users' \\
--header 'Content-Type: application/json' \\
--header 'Authorization: Bearer {{token}}' \\
--data '{
    "name": "qoder"
}'`,
    );

    expect(request.method).toBe('POST');
    expect(request.body.mode).toBe('raw');
    expect(request.body.rawLanguage).toBe('json');
    expect(request.body.rawText).toContain('"name": "qoder"');
    expect(request.headers.map((header) => header.key)).toEqual(['Content-Type', 'Authorization']);
    expect(request.headers[1].value).toBe('Bearer {{token}}');
  });

  it('understands PowerShell backtick continuations and quoting', () => {
    const { request } = expectParsed(
      'curl.exe -X POST "https://api.example.com/login" `\n  -H "Content-Type: application/x-www-form-urlencoded" `\n  -d "user=a b&pass=secret"',
    );

    expect(request.method).toBe('POST');
    expect(request.body.mode).toBe('form-urlencoded');
    expect(request.body.urlencoded.map((entry) => [entry.key, entry.value])).toEqual([
      ['user', 'a b'],
      ['pass', 'secret'],
    ]);
  });

  it('maps -u to a basic auth header', () => {
    const { request } = expectParsed("curl -u 'user:pass' https://api.example.com/me");

    expect(request.headers.map((header) => [header.key, header.value])).toEqual([
      ['Authorization', 'Basic dXNlcjpwYXNz'],
    ]);
  });

  it('parses form-data fields and drops hand written multipart content type', () => {
    const { request, warnings } = expectParsed(
      "curl https://api.example.com/upload -F 'field=value' -H 'Content-Type: multipart/form-data; boundary=xyz'",
    );

    expect(request.body.mode).toBe('form-data');
    expect(request.body.formData.map((entry) => [entry.key, entry.value])).toEqual([['field', 'value']]);
    expect(request.headers).toEqual([]);
    expect(warnings.join('\n')).toContain('multipart');
  });

  it('moves -G data into query parameters', () => {
    const { request } = expectParsed("curl -G 'https://api.example.com/search' -d 'term=abc' -d 'page=2'");

    expect(request.method).toBe('GET');
    expect(request.body.mode).toBe('none');
    expect(request.params.map((param) => [param.key, param.value])).toEqual([
      ['term', 'abc'],
      ['page', '2'],
    ]);
  });

  it('reports an error when the URL is missing', () => {
    const result = parseCurl("curl -X POST -H 'X-Token: abc'");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('URL');
    }
  });

  it('round trips a generated command', () => {
    const original = draft((request) => {
      request.method = 'POST';
      request.url = 'https://api.example.com/users';
      request.params = [item('page', '2')];
      request.headers = [item('X-Token', 'abc')];
      request.body = { ...request.body, mode: 'raw', rawLanguage: 'json', rawText: '{"name":"qoder"}' };
    });

    const { request } = expectParsed(toCurl(original));

    expect(request.method).toBe(original.method);
    expect(request.url).toBe(original.url);
    expect(request.params.map((param) => [param.key, param.value])).toEqual([['page', '2']]);
    expect(request.body.mode).toBe('raw');
    expect(request.body.rawText).toBe('{"name":"qoder"}');
    expect(request.headers.map((header) => [header.key, header.value])).toEqual([
      ['X-Token', 'abc'],
      ['Content-Type', 'application/json'],
    ]);
  });
});
