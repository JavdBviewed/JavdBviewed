/**
 * @file fetchTransport.ts
 * @description Default HTTP transport using global fetch (no chrome APIs).
 * @module @javdb/sync-client
 */

import type { HttpTransport, RequestBodyMetrics } from './types';

const GZIP_THRESHOLD_BYTES = 16 * 1024;

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
  return {
    async request<T>(opts: {
      method: string;
      path: string;
      body?: unknown;
      token?: string | null;
      signal?: AbortSignal;
      onRequestBodyMetrics?: (metrics: RequestBodyMetrics) => void;
    }): Promise<T> {
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
        if (uncompressedBytes >= GZIP_THRESHOLD_BYTES) {
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
    },
  };
}
