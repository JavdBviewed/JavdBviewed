/**
 * @file fetchTransport.ts
 * @description Default HTTP transport using global fetch (no chrome APIs).
 * @module @javdb/sync-client
 */

import type { HttpTransport, RequestBodyMetrics } from './types';

const GZIP_THRESHOLD_BYTES = 16 * 1024;

/**
 * 探测到服务端拒绝 gzip body（旧版 Cloud 没有 gzip 解码中间件，
 * 或中间反代损坏压缩流）后整会话停用 gzip，后续请求直接发明文 JSON。
 */
let gzipRejectedByServer = false;

async function gzipText(text: string): Promise<Blob | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([text])
      .stream()
      .pipeThrough(new CompressionStream('gzip'));
    return await new Response(stream).blob();
  } catch {
    // Older extension runtimes may expose fetch without CompressionStream.
    return null;
  }
}

export class SyncHttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'SyncHttpError';
    this.status = status;
    this.body = body;
  }
}

export function createFetchTransport(baseUrl: string): HttpTransport {
  const root = baseUrl.replace(/\/+$/, '');
  async function sendRequest<T>(
    opts: {
      method: string;
      path: string;
      body?: unknown;
      token?: string | null;
      signal?: AbortSignal;
      onRequestBodyMetrics?: (metrics: RequestBodyMetrics) => void;
    },
    useGzip: boolean,
  ): Promise<T> {
    const { method, path, body, token, signal, onRequestBodyMetrics } = opts;
    const url = `${root}${path.startsWith('/') ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    let requestBody: string | Blob | undefined;
    if (body !== undefined) {
      const json = JSON.stringify(body);
      const uncompressedBytes = new TextEncoder().encode(json).byteLength;
      headers['Content-Type'] = 'application/json';
      if (useGzip && uncompressedBytes >= GZIP_THRESHOLD_BYTES) {
        const compressed = await gzipText(json);
        if (compressed) {
          requestBody = compressed;
          headers['Content-Encoding'] = 'gzip';
        }
      }
      requestBody ??= json;
      onRequestBodyMetrics?.({
        uncompressedBytes,
        transmittedBytes: requestBody instanceof Blob ? requestBody.size : uncompressedBytes,
        contentEncoding: headers['Content-Encoding'] === 'gzip' ? 'gzip' : undefined,
      });
    }
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(url, {
      method,
      headers,
      body: requestBody,
      signal,
    });

    if (res.status === 204) {
      return undefined as T;
    }

    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      const msg =
        typeof parsed === 'object' && parsed && 'message' in parsed
          ? String((parsed as { message: unknown }).message)
          : `HTTP ${res.status}`;
      throw new SyncHttpError(res.status, msg, parsed);
    }

    return parsed as T;
  }

  return {
    async request<T>(opts: {
      method: string;
      path: string;
      body?: unknown;
      token?: string | null;
      signal?: AbortSignal;
      onRequestBodyMetrics?: (metrics: RequestBodyMetrics) => void;
    }): Promise<T> {
      // 仅对大 body 的 POST/PUT 启用 gzip；探测到旧服务端拒绝后整会话停用。
      const wantsGzip =
        !gzipRejectedByServer &&
        (opts.method === 'POST' || opts.method === 'PUT') &&
        opts.body !== undefined;
      if (!wantsGzip) {
        return sendRequest(opts, false);
      }
      try {
        return await sendRequest(opts, true);
      } catch (err) {
        if (!(err instanceof SyncHttpError) || err.status !== 400) throw err;
        const msg = String(err.message || '').trim().toLowerCase();
        // gzip body 被服务端拒收的典型信号：invalid json / invalid gzip body；
        // 401 认证失败等其它错误一律透传，避免掩盖真实问题。
        if (!msg.includes('invalid')) throw err;
        gzipRejectedByServer = true;
        return sendRequest(opts, false);
      }
    },
  };
}

/** 测试专用：重置 gzip 拒绝探测标志。 */
export function __resetGzipRejectedForTest(): void {
  gzipRejectedByServer = false;
}
