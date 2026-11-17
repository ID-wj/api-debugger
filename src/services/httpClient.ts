import type { HttpResult } from '../shared/protocol';
import type { PreparedRequest } from './variableResolver';

export interface HttpOptions {
  timeoutMs: number;
  followRedirects: boolean;
  maxBodyBytes: number;
}

const TEXTUAL_CONTENT_TYPE =
  /^(?:text\/)|json|xml|javascript|ecmascript|x-www-form-urlencoded|graphql|csv|html|yaml/i;

export const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;

interface BodyReadResult {
  buffer: Buffer;
  truncated: boolean;
  size: number;
}

/**
 * Settles as soon as `signal` aborts, even when the wrapped promise never reacts to cancellation.
 * A fetch that already resolved its headers keeps its body promise pending forever if the peer
 * stops sending, which is exactly the case `arrayBuffer()` used to hang on.
 */
function withAbort<T>(promise: Promise<T>, signal: AbortSignal, describe: () => Error): Promise<T> {
  if (signal.aborted) {
    promise.catch(() => undefined);
    return Promise.reject(describe());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(describe());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Streams the body so oversized responses stop downloading as soon as the cap is reached.
 * `response.arrayBuffer()` is avoided on purpose: it has no cancellation point.
 */
async function readBody(response: Response, maxBodyBytes: number): Promise<BodyReadResult> {
  const stream = response.body;
  if (!stream) {
    return { buffer: Buffer.alloc(0), truncated: false, size: 0 };
  }

  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let received = 0;
  let truncated = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value || value.byteLength === 0) {
      continue;
    }
    const chunk = Buffer.from(value);
    received += chunk.byteLength;
    if (received > maxBodyBytes) {
      const keep = maxBodyBytes - (received - chunk.byteLength);
      if (keep > 0) {
        chunks.push(chunk.subarray(0, keep));
      }
      truncated = true;
      void reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(chunk);
  }

  const declared = Number(response.headers.get('content-length') ?? '');
  const size = truncated && Number.isFinite(declared) && declared > 0 ? declared : received;
  return { buffer: Buffer.concat(chunks), truncated, size };
}

/**
 * Executes the request on the extension host (plain Node), which keeps CORS,
 * cookie jars and browser security policies out of the picture entirely.
 */
export async function sendRequest(
  prepared: PreparedRequest,
  requestId: string,
  unresolved: string[],
  options: HttpOptions,
  cancellation: AbortSignal,
): Promise<HttpResult> {
  const controller = new AbortController();
  const signal = controller.signal;
  const forwardAbort = () => controller.abort();
  if (cancellation.aborted) {
    forwardAbort();
  } else {
    cancellation.addEventListener('abort', forwardAbort, { once: true });
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);

  const describeInterruption = (): Error =>
    timedOut ? new Error(`请求超时（${options.timeoutMs}ms）`) : new Error('请求已取消');

  const startedAt = performance.now();
  try {
    const response = await withAbort(
      fetch(prepared.url, {
        method: prepared.method,
        headers: prepared.headers,
        body: prepared.body,
        redirect: options.followRedirects ? 'follow' : 'manual',
        signal,
      }),
      signal,
      describeInterruption,
    );

    const body = await withAbort(readBody(response, options.maxBodyBytes), signal, describeInterruption);
    const durationMs = Math.round(performance.now() - startedAt);
    const contentType = response.headers.get('content-type') ?? '';
    const textual = contentType.length === 0 || TEXTUAL_CONTENT_TYPE.test(contentType);

    return {
      requestId,
      method: prepared.method,
      url: prepared.url,
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers.entries()],
      contentType,
      bodyText: textual ? body.buffer.toString('utf8') : undefined,
      bodyBase64: textual ? undefined : body.buffer.toString('base64'),
      size: body.size,
      durationMs,
      redirected: response.redirected,
      truncated: body.truncated,
      unresolvedVariables: unresolved,
      receivedAt: Date.now(),
    };
  } catch (error) {
    if (cancellation.aborted) {
      throw new Error('请求已取消');
    }
    if (timedOut) {
      throw new Error(`请求超时（${options.timeoutMs}ms）`);
    }
    throw new Error(describeNetworkError(error));
  } finally {
    clearTimeout(timer);
    cancellation.removeEventListener('abort', forwardAbort);
  }
}

function describeNetworkError(error: unknown): string {
  const err = error as { message?: string; cause?: { code?: string; message?: string } };
  const code = err.cause?.code;
  const detail = err.cause?.message ?? err.message ?? String(error);
  switch (code) {
    case 'ENOTFOUND':
      return '域名解析失败（ENOTFOUND）';
    case 'ECONNREFUSED':
      return '连接被拒绝（ECONNREFUSED），目标服务可能未启动';
    case 'ECONNRESET':
      return '连接被重置（ECONNRESET）';
    case 'ETIMEDOUT':
      return '连接超时（ETIMEDOUT）';
    case 'CERT_HAS_EXPIRED':
      return '服务器证书已过期';
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return '服务器使用了不受信任的证书';
    case 'ERR_INVALID_URL':
      return 'URL 格式不正确';
    default:
      return detail;
  }
}
