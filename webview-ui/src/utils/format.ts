export interface DisplayBody {
  text: string;
  html: string;
  kind: 'json' | 'text';
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (char) => (char === '&' ? '&amp;' : char === '<' ? '&lt;' : '&gt;'));
}

const JSON_TOKEN =
  /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

export function highlightJson(prettyJson: string): string {
  return escapeHtml(prettyJson).replace(JSON_TOKEN, (match, literal: string | undefined, colon: string | undefined) => {
    if (literal) {
      return colon ? `<span class="tok-key">${literal}</span>${colon}` : `<span class="tok-str">${literal}</span>`;
    }
    if (match === 'true' || match === 'false' || match === 'null') {
      return `<span class="tok-lit">${match}</span>`;
    }
    return `<span class="tok-num">${match}</span>`;
  });
}

export function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

export function prepareBody(text: string, contentType: string): DisplayBody {
  const looksLikeJson = /json/i.test(contentType) || /^\s*[[{]/.test(text);
  if (looksLikeJson) {
    try {
      const pretty = JSON.stringify(JSON.parse(text), null, 2);
      return { text: pretty, html: highlightJson(pretty), kind: 'json' };
    } catch {
      // Not valid JSON after all: fall back to plain text.
    }
  }
  return { text, html: escapeHtml(text), kind: 'text' };
}
