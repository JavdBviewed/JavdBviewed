/**
 * @file fetchTransport.test.ts
 * @description HTTP 传输压缩回归测试
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * gzip 拒绝探测是模块级单例。
 * 测试顺序保证：401 用例在前（不触发拒绝），retry 用例各自独立 transport。
 */
import { createFetchTransport, __resetGzipRejectedForTest } from './fetchTransport';

describe('createFetchTransport request compression', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('gzip-compresses large JSON request bodies and preserves their content', async () => {
    let captured: RequestInit | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string, init?: RequestInit) => {
        captured = init;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );

    const body = { changes: [{ id: 'large', payload: 'x'.repeat(20_000) }] };
    await createFetchTransport('http://cloud.test').request({
      method: 'POST',
      path: '/v1/sync/session',
      body,
    });

    expect(captured?.headers).toMatchObject({
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
    });
    const compressed = captured?.body;
    expect(compressed).toBeInstanceOf(Blob);
    const inflated = await new Response(
      (compressed as Blob).stream().pipeThrough(new DecompressionStream('gzip')),
    ).text();
    expect(JSON.parse(inflated)).toEqual(body);
  });

  it('reports the actual gzip body size to request telemetry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );

    let metrics: { uncompressedBytes: number; transmittedBytes: number; contentEncoding?: string } | undefined;
    await createFetchTransport('http://cloud.test').request({
      method: 'POST',
      path: '/v1/sync/session',
      body: { changes: [{ id: 'large', payload: 'x'.repeat(20_000) }] },
      onRequestBodyMetrics: (next) => {
        metrics = next;
      },
    });

    expect(metrics).toMatchObject({ contentEncoding: 'gzip' });
    expect(metrics?.transmittedBytes).toBeLessThan(metrics?.uncompressedBytes ?? 0);
  });

  it('keeps small JSON request bodies uncompressed', async () => {
    let captured: RequestInit | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string, init?: RequestInit) => {
        captured = init;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );

    await createFetchTransport('http://cloud.test').request({
      method: 'POST',
      path: '/v1/auth/login',
      body: { identifier: 'admin', password: 'secret' },
    });

    expect(captured?.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(captured?.headers).not.toHaveProperty('Content-Encoding');
    expect(captured?.body).toBe(JSON.stringify({ identifier: 'admin', password: 'secret' }));
  });

  it('passes an abort signal through to fetch', async () => {
    let captured: RequestInit | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string, init?: RequestInit) => {
        captured = init;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );

    const controller = new AbortController();
    await createFetchTransport('http://cloud.test').request({
      method: 'GET',
      path: '/health',
      signal: controller.signal,
    });

    expect(captured?.signal).toBe(controller.signal);
  });

  it('retries plain JSON after a 400 invalid json when the server rejects the gzip body', async () => {
    __resetGzipRejectedForTest();
      const calls: Array<{ encoding?: string; body: unknown }> = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_input: string, init?: RequestInit) => {
          calls.push({
            encoding: (init?.headers as Record<string, string>)?.['Content-Encoding'],
            body: init?.body,
          });
          if (calls.length === 1) {
            return new Response(
              JSON.stringify({ code: 'invalid_json', message: 'invalid json' }),
              { status: 400, headers: { 'Content-Type': 'application/json' } },
            );
          }
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }),
      );

      const res = await createFetchTransport('http://cloud.test').request<{ ok: boolean }>({
        method: 'POST',
        path: '/v1/sync/session',
        body: { changes: [{ id: 'x', payload: 'y'.repeat(20_000) }] },
      });

      expect(res).toEqual({ ok: true });
      expect(calls).toHaveLength(2);
      expect(calls[0].encoding).toBe('gzip');
      expect(calls[0].body).toBeInstanceOf(Blob);
      expect(calls[1].encoding).toBeUndefined();
      expect(typeof calls[1].body).toBe('string');
      expect(JSON.parse(String(calls[1].body)).changes[0].id).toBe('x');
  });

  it('retries plain JSON after a 400 invalid gzip body (legacy server without gzip middleware)', async () => {
    __resetGzipRejectedForTest();
      const calls: Array<{ encoding?: string }> = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_input: string, init?: RequestInit) => {
          calls.push({ encoding: (init?.headers as Record<string, string>)?.['Content-Encoding'] });
          if (calls.length === 1) {
            return new Response(
              JSON.stringify({ code: 'invalid_gzip', message: 'invalid gzip body' }),
              { status: 400, headers: { 'Content-Type': 'application/json' } },
            );
          }
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }),
      );

      const res = await createFetchTransport('http://cloud.test').request<{ ok: boolean }>({
        method: 'POST',
        path: '/v1/sync/session',
        body: { changes: [{ id: 'x', payload: 'y'.repeat(20_000) }] },
      });

      expect(res).toEqual({ ok: true });
      expect(calls).toHaveLength(2);
      expect(calls[0].encoding).toBe('gzip');
      expect(calls[1].encoding).toBeUndefined();
  });

  it('does not retry after a 401 auth failure on a gzip body', async () => {
    __resetGzipRejectedForTest();
      const calls: Array<{ encoding?: string }> = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_input: string, init?: RequestInit) => {
          calls.push({ encoding: (init?.headers as Record<string, string>)?.['Content-Encoding'] });
          return new Response(
            JSON.stringify({ code: 'unauthorized', message: 'invalid credentials' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          );
        }),
      );

      await expect(
        createFetchTransport('http://cloud.test').request<{ ok: boolean }>({
          method: 'POST',
          path: '/v1/sync/session',
          body: { changes: [{ id: 'x', payload: 'y'.repeat(20_000) }] },
        }),
      ).rejects.toMatchObject({ status: 401, message: 'invalid credentials' });
      expect(calls).toHaveLength(1);
      expect(calls[0].encoding).toBe('gzip');
  });

  it('stops using gzip for later requests once a server rejected the gzip body', async () => {
    __resetGzipRejectedForTest();
      const calls: Array<{ encoding?: string; body: unknown }> = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_input: string, init?: RequestInit) => {
          calls.push({
            encoding: (init?.headers as Record<string, string>)?.['Content-Encoding'],
            body: init?.body,
          });
          if (calls.length === 1) {
            return new Response(
              JSON.stringify({ code: 'invalid_json', message: 'invalid json' }),
              { status: 400, headers: { 'Content-Type': 'application/json' } },
            );
          }
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }),
      );

      const transport = createFetchTransport('http://cloud.test');
      const big = { changes: [{ id: 'x', payload: 'y'.repeat(20_000) }] };
      await transport.request({ method: 'POST', path: '/v1/sync/session', body: big });
      await transport.request({ method: 'POST', path: '/v1/sync/session', body: big });

      expect(calls).toHaveLength(3);
      expect(calls[0].encoding).toBe('gzip');
      expect(calls[1].encoding).toBeUndefined();
      expect(calls[2].encoding).toBeUndefined();
      expect(typeof calls[2].body).toBe('string');
  });
});
