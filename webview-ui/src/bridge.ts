import type { FromWebviewMessage, ToWebviewMessage } from '@shared/protocol';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare const acquireVsCodeApi: (() => VsCodeApi) | undefined;

const MOCK_DELAY = 350;

function mockState() {
  return {
    globals: {} as Record<string, string>,
    environments: [
      { name: 'dev', variables: { baseUrl: 'https://httpbin.org', token: 'dev-token' } },
      { name: 'prod', variables: { baseUrl: 'https://httpbin.org', token: 'prod-token' } },
    ],
    activeEnvironment: 'dev',
    collections: [],
    history: [],
  };
}

/**
 * Browser-only fallback so the UI can be iterated with `vite dev` outside VS Code.
 * It answers the same messages the extension host would answer.
 */
function createMockApi(): VsCodeApi {
  const respond = (message: ToWebviewMessage) => window.postMessage(message, '*');

  return {
    postMessage(message: unknown) {
      const incoming = message as FromWebviewMessage;
      if (incoming.type === 'ready') {
        window.setTimeout(
          () => respond({ type: 'init', state: mockState(), theme: 'dark', settings: { timeout: 30000, followRedirects: true } }),
          0,
        );
        return;
      }
      if (incoming.type === 'send') {
        window.setTimeout(() => respond({ type: 'pending', requestId: incoming.requestId }), 0);
        window.setTimeout(() => {
          respond({
            type: 'response',
            requestId: incoming.requestId,
            result: {
              requestId: incoming.requestId,
              method: incoming.request.method,
              url: incoming.request.url,
              status: 200,
              statusText: 'OK',
              headers: [
                ['content-type', 'application/json'],
                ['x-mock', 'true'],
              ],
              contentType: 'application/json',
              bodyText: JSON.stringify({ mock: true, echo: incoming.request.url, note: 'vite dev preview' }),
              size: 96,
              durationMs: MOCK_DELAY,
              redirected: false,
              truncated: false,
              unresolvedVariables: [],
              receivedAt: Date.now(),
            },
          });
        }, MOCK_DELAY);
      }
    },
    getState: () => undefined,
    setState: () => undefined,
  };
}

const api: VsCodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : createMockApi();

export const isBrowserPreview = typeof acquireVsCodeApi !== 'function';

export function postToExtension(message: FromWebviewMessage): void {
  api.postMessage(message);
}

export function onExtensionMessage(handler: (message: ToWebviewMessage) => void): () => void {
  const listener = (event: MessageEvent) => handler(event.data as ToWebviewMessage);
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
