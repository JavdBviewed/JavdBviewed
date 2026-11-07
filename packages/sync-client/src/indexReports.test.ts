import { describe, expect, it } from 'vitest';
import { createApiClient } from './apiClient';
import { SyncHttpError } from './fetchTransport';
import { createMemoryTokenStore } from './memoryTokenStore';
import { createIndexReportPages, discoverIndexReports } from './indexReports';
import type { HttpTransport, IndexReportPage } from './types';

const source = { kind: 'emby' as const, sourceId: 'https://media.example.test' };
const capabilities = { version: 1, kinds: ['emby', 'drive115'], maxPageEntries: 500, maxPageBytes: 2097152 };

describe('authenticated index report API', () => {
  it('shares auth refresh for discovery, start, put and retirement without changing request bodies', async () => {
    const tokens = createMemoryTokenStore();
    await tokens.setTokens({ accessToken: 'old', refreshToken: 'refresh', userId: 'u', deviceId: 'd' });
    const requests: Array<{ method: string; path: string; body?: unknown; token?: string | null }> = [];
    const transport: HttpTransport = {
      async request<T>(request: Parameters<HttpTransport['request']>[0]): Promise<T> {
        requests.push(request);
        if (request.path === '/v1/auth/refresh') return { accessToken: 'new', refreshToken: 'next' } as T;
        if (request.token === 'old') throw new SyncHttpError(401, 'expired');
        if (request.path.endsWith('/capabilities')) return capabilities as T;
        if (request.method === 'DELETE') return { retired: true } as T;
        return { runId: 'run/1', generation: 1, published: request.method === 'PUT', revision: 1 } as T;
      },
    };
    const api = createApiClient({ baseUrl: 'https://cloud.test', tokens, transport });
    const page = { ...source, page: 0, final: true, complete: true, entries: [] };
    await Promise.all([
      api.getIndexReportCapabilities!(),
      api.startIndexReport!({ ...source, requestId: 'scan-1' }),
      api.putIndexReport!('run/1', page),
      api.retireIndexSource!(source),
    ]);
    expect(requests.filter((r) => r.path === '/v1/auth/refresh')).toHaveLength(1);
    const retried = requests.filter((r) => r.token === 'new');
    expect(retried).toEqual(expect.arrayContaining([
      { method: 'GET', path: '/v1/index-reports/capabilities', token: 'new' },
      { method: 'POST', path: '/v1/index-reports', body: { ...source, requestId: 'scan-1' }, token: 'new' },
      { method: 'PUT', path: '/v1/index-reports/run%2F1', body: page, token: 'new' },
      { method: 'DELETE', path: '/v1/index-sources', body: source, token: 'new' },
    ]));
  });

  it('treats missing optional methods and capability 404 as unsupported, but surfaces other failures', async () => {
    expect(await discoverIndexReports({})).toBeNull();
    const transport: HttpTransport = { async request() { throw new SyncHttpError(404, 'old server'); } };
    const api = createApiClient({ baseUrl: 'https://cloud.test', tokens: createMemoryTokenStore(), transport });
    expect(await discoverIndexReports(api)).toBeNull();
    transport.request = async () => { throw new SyncHttpError(503, 'private server body'); };
    await expect(discoverIndexReports(api)).rejects.toThrow();
  });
});

describe('index report pages', () => {
  it('publishes an empty complete scan as one final page', () => {
    expect(createIndexReportPages({ ...source, entries: [], complete: true })).toEqual([
      { ...source, page: 0, final: true, complete: true, entries: [] },
    ]);
  });

  it('limits pages to 500 items and declares completeness only on the final page', () => {
    const entries = Array.from({ length: 501 }, (_, id) => ({ code: 'ABC-123', data: { itemId: String(id) } }));
    const pages = createIndexReportPages({ ...source, entries, complete: true });
    expect(pages.map((p) => p.entries.length)).toEqual([500, 1]);
    expect(pages[0]).toMatchObject({ page: 0, final: false });
    expect(pages[0]).not.toHaveProperty('complete');
    expect(pages[1]).toMatchObject({ page: 1, final: true, complete: true });
    expect(pages.flatMap((p) => p.entries)).toEqual(entries);
  });

  it('counts UTF-8 bytes including the envelope and preserves immutable retry pages', () => {
    const entries = Array.from({ length: 3 }, (_, id) => ({ code: 'ABC-123', data: { itemId: String(id), itemName: '影'.repeat(300_000) } }));
    const pages = createIndexReportPages({ ...source, entries, complete: false });
    expect(pages.map((p) => p.entries.length)).toEqual([2, 1]);
    for (const page of pages) expect(new TextEncoder().encode(JSON.stringify(page)).length).toBeLessThanOrEqual(2097152);
    const retry = JSON.stringify(pages);
    entries[0].data.itemName = 'changed after queue';
    expect(JSON.stringify(pages)).toBe(retry);
    expect(pages[1]).toMatchObject({ final: true, complete: false });
  });

  it('honors smaller advertised bounds and rejects one oversize entry or an oversize scan explicitly', () => {
    const input = { ...source, entries: [{ code: 'ABC-123', data: { itemName: '影'.repeat(100) } }], complete: true };
    expect(() => createIndexReportPages(input, { maxPageBytes: 200, maxPageEntries: 500 })).toThrow();
    expect(() => createIndexReportPages({ ...input, entries: Array(100001).fill({ code: 'A', data: {} }) })).toThrow();
    const pages: IndexReportPage[] = createIndexReportPages({ ...input, entries: Array(3).fill({ code: 'A', data: {} }) }, { maxPageEntries: 2, maxPageBytes: 300 });
    expect(pages.map((p) => p.entries.length)).toEqual([2, 1]);
  });
});

describe('report request identity binding', () => {
  it('rejects a request whose connection base differs from the API base before sending credentials', async () => {
    let calls = 0;
    const transport: HttpTransport = { async request<T>() { calls++; return { retired: true } as T; } };
    const api = createApiClient({ baseUrl: 'https://cloud-a.test', tokens: createMemoryTokenStore({ accessToken: 'b-token' }), transport });
    await expect(api.retireIndexSource!(source, {
      auth: { baseUrl: 'https://cloud-b.test', assertCurrent: async () => {} },
    })).rejects.toThrow('Cloud 连接已变更');
    expect(calls).toBe(0);
  });

  it('does not retry or refresh a 401 after the bound account changes', async () => {
    let current = 'a';
    const requests: Array<{ path: string; token?: string | null }> = [];
    const tokens = createMemoryTokenStore({ accessToken: 'a-token', refreshToken: 'a-refresh' });
    const transport: HttpTransport = {
      async request<T>(request: Parameters<HttpTransport['request']>[0]): Promise<T> {
        requests.push(request);
        if (requests.length === 1) {
          current = 'b';
          await tokens.setTokens({ accessToken: 'b-token', refreshToken: 'b-refresh', userId: 'b-user', deviceId: 'b-device' });
          throw new SyncHttpError(401, 'expired');
        }
        return { retired: true } as T;
      },
    };
    const api = createApiClient({ baseUrl: 'https://cloud.test', tokens, transport });
    await expect(api.retireIndexSource!(source, {
      auth: { baseUrl: 'https://cloud.test', assertCurrent: async () => { if (current !== 'a') throw new Error('Cloud 连接已变更'); } },
    })).rejects.toThrow('Cloud 连接已变更');
    expect(requests).toHaveLength(1);
    expect(await tokens.getAccessToken()).toBe('b-token');
  });

  it('does not install a refresh response into a replacement session', async () => {
    let current = 'a';
    const tokens = createMemoryTokenStore({ accessToken: 'a-token', refreshToken: 'a-refresh' });
    const transport: HttpTransport = {
      async request<T>(request: Parameters<HttpTransport['request']>[0]): Promise<T> {
        if (request.path === '/v1/auth/refresh') {
          current = 'b';
          await tokens.setTokens({ accessToken: 'b-token', refreshToken: 'b-refresh', userId: 'b-user', deviceId: 'b-device' });
          return { accessToken: 'refreshed-a', refreshToken: 'refreshed-a', userId: 'a-user', deviceId: 'a-device' } as T;
        }
        if (request.token === 'a-token') throw new SyncHttpError(401, 'expired');
        return { retired: true } as T;
      },
    };
    const api = createApiClient({ baseUrl: 'https://cloud.test', tokens, transport });
    await expect(api.retireIndexSource!(source, {
      auth: { baseUrl: 'https://cloud.test', assertCurrent: async () => { if (current !== 'a') throw new Error('Cloud 连接已变更'); } },
    })).rejects.toThrow('Cloud 连接已变更');
    expect(await tokens.getAccessToken()).toBe('b-token');
    expect(await tokens.getRefreshToken()).toBe('b-refresh');
  });
});

describe('report request cancellation', () => {
  it('passes the same signal to discovery, start, each PUT and retirement', async () => {
    const controller = new AbortController();
    const seen: Array<AbortSignal | undefined> = [];
    const api = createApiClient({ baseUrl: 'https://cloud.test', tokens: createMemoryTokenStore(), transport: {
      async request<T>(request: Parameters<HttpTransport['request']>[0]): Promise<T> {
        seen.push(request.signal);
        return (request.path.endsWith('/capabilities') ? capabilities : { retired: true, runId: 'run', published: true }) as T;
      },
    } });
    const options = { signal: controller.signal };
    await discoverIndexReports(api, options);
    await api.startIndexReport!({ ...source, requestId: 'scan' }, options);
    await api.putIndexReport!('run', { ...source, page: 0, final: true, entries: [] }, options);
    await api.retireIndexSource!(source, options);
    expect(seen).toEqual(Array(4).fill(controller.signal));
  });

  it.each(['before request', 'after 401', 'during refresh'])('stops %s without retrying or clearing the session', async (stage) => {
    const controller = new AbortController();
    const tokens = createMemoryTokenStore();
    await tokens.setTokens({ accessToken: 'old', refreshToken: 'refresh', userId: 'u', deviceId: 'd' });
    const sent: Array<Parameters<HttpTransport['request']>[0]> = [];
    const api = createApiClient({ baseUrl: 'https://cloud.test', tokens, transport: {
      async request<T>(request: Parameters<HttpTransport['request']>[0]): Promise<T> {
        sent.push(request);
        if (request.path === '/v1/auth/refresh') {
          controller.abort();
          // Even a transport delivering a late successful response must not trigger a retry.
          return { accessToken: 'late', refreshToken: 'late-refresh' } as T;
        }
        if (request.token === 'old') {
          if (stage === 'after 401') controller.abort();
          throw new SyncHttpError(401, 'expired');
        }
        return { retired: true } as T;
      },
    } });
    if (stage === 'before request') controller.abort();
    await expect(api.retireIndexSource!(source, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(sent.map((request) => request.path)).toEqual(stage === 'before request' ? [] : stage === 'after 401'
      ? ['/v1/index-sources'] : ['/v1/index-sources', '/v1/auth/refresh']);
    for (const request of sent) expect(request.signal).toBe(controller.signal);
    expect(await tokens.getAccessToken()).toBe('old');
    expect(await tokens.getRefreshToken()).toBe('refresh');
  });
});
