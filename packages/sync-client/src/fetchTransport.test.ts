/**
 * @file fetchTransport.test.ts
 * @description HTTP 传输压缩回归测试
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFetchTransport } from './fetchTransport';

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
});
