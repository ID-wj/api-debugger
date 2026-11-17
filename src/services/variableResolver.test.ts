import { describe, expect, it } from 'vitest';
import { createEmptyRequest } from '../shared/protocol';
import { prepareRequest, resolveVariables } from './variableResolver';

describe('resolveVariables', () => {
  it('prefers environment values over global values', () => {
    const unresolved = new Set<string>();
    const value = resolveVariables(
      '{{baseUrl}}/users',
      { environment: { baseUrl: 'https://env.example.com' }, globals: { baseUrl: 'https://global.example.com' } },
      unresolved,
    );

    expect(value).toBe('https://env.example.com/users');
    expect([...unresolved]).toEqual([]);
  });

  it('keeps unknown placeholders untouched and reports them', () => {
    const unresolved = new Set<string>();
    const value = resolveVariables('{{baseUrl}}/users/{{missing}}', { environment: { baseUrl: 'https://a' } }, unresolved);

    expect(value).toBe('https://a/users/{{missing}}');
    expect([...unresolved]).toEqual(['missing']);
  });
});

describe('prepareRequest', () => {
  it('appends enabled params to the existing query string', () => {
    const draft = createEmptyRequest();
    draft.url = 'https://example.com/users?existing=1';
    draft.params = [
      { id: 'a', key: 'page', value: '2', enabled: true },
      { id: 'b', key: 'skipped', value: 'x', enabled: false },
    ];

    const result = prepareRequest(draft, {});

    expect(result.error).toBeUndefined();
    expect(result.request?.url).toBe('https://example.com/users?existing=1&page=2');
  });

  it('adds a default content type for raw JSON bodies', () => {
    const draft = createEmptyRequest();
    draft.url = 'https://example.com/users';
    draft.method = 'POST';
    draft.body = { ...draft.body, mode: 'raw', rawLanguage: 'json', rawText: '{"name":"{{userName}}"}' };

    const result = prepareRequest(draft, { environment: { userName: 'qoder' } });

    expect(result.request?.headers['Content-Type']).toBe('application/json');
    expect(result.request?.body).toBe('{"name":"qoder"}');
  });

  it('encodes form-urlencoded bodies', () => {
    const draft = createEmptyRequest();
    draft.url = 'https://example.com/login';
    draft.method = 'POST';
    draft.body = {
      ...draft.body,
      mode: 'form-urlencoded',
      urlencoded: [
        { id: 'a', key: 'user', value: 'a b', enabled: true },
        { id: 'b', key: 'pass', value: 'secret', enabled: true },
      ],
    };

    const result = prepareRequest(draft, {});

    expect(result.request?.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(result.request?.body).toBe('user=a+b&pass=secret');
  });

  it('builds multipart bodies with a generated boundary', () => {
    const draft = createEmptyRequest();
    draft.url = 'https://example.com/upload';
    draft.method = 'POST';
    draft.body = {
      ...draft.body,
      mode: 'form-data',
      formData: [{ id: 'a', key: 'field', value: 'value', enabled: true }],
    };

    const result = prepareRequest(draft, {});

    expect(result.request?.headers['Content-Type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(result.request?.body).toContain('Content-Disposition: form-data; name="field"');
    expect(result.request?.body?.endsWith('--\r\n')).toBe(true);
  });

  it('reports invalid URLs instead of throwing', () => {
    const draft = createEmptyRequest();
    draft.url = 'not-a-url';

    const result = prepareRequest(draft, {});

    expect(result.request).toBeUndefined();
    expect(result.error).toContain('URL 无效');
  });
});
