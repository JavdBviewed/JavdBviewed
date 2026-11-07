import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpTransport } from '@javdb/sync-client';
let client: typeof import('@javdb/sync-client');

const identity = vi.hoisted(() => ({
  settings: { baseUrl: 'https://cloud.test', accountIdentifier: 'user', deviceId: 'device-1' },
  session: { accessToken: 'private-access', refreshToken: 'private-refresh', userId: 'user-1', deviceId: 'device-1' },
}));
vi.mock('./cloudSettingsStorage', () => ({ loadCloudSettings: async () => identity.settings }));
vi.mock('./chromeTokenStore', () => ({ loadCloudSession: async () => identity.session }));

const caps = { version: 1, kinds: ['emby', 'drive115'], maxPageEntries: 500, maxPageBytes: 2097152 };
const input = { kind: 'emby' as const, sourceId: 'https://media.test', entries: [{ code: 'ABC-123', data: { itemId: '1' } }], complete: true, requestId: 'scan-1' };
let storage: Record<string, any>;
let requests: Array<{ method: string; path: string; body?: any }>;
let respond: (request: { method: string; path: string; body?: any }) => Promise<unknown>;
let writeFailure = false;

function api() {
  const transport: HttpTransport = {
    async request<T>(request): Promise<T> {
      requests.push(JSON.parse(JSON.stringify(request)));
      return await respond(request) as T;
    },
  };
  return client.createApiClient({ baseUrl: identity.settings.baseUrl, tokens: client.createMemoryTokenStore(), transport });
}

function persistedReports() {
  return Object.entries(storage).filter(([key]) => key.startsWith('cloud_index_report_outbox_v1:'));
}

beforeEach(async () => {
  vi.resetModules();
  client = await import('@javdb/sync-client');
  identity.settings.baseUrl = 'https://cloud.test';
  identity.settings.accountIdentifier = 'user';
  identity.session.userId = 'user-1';
  identity.session.deviceId = 'device-1';
  storage = {};
  requests = [];
  writeFailure = false;
  const runtime: { lastError?: { message: string } } = {};
  vi.stubGlobal('chrome', { runtime, storage: { local: {
    get(keys: string[] | string | null, callback: (value: unknown) => void) {
      queueMicrotask(() => callback(structuredClone(keys === null ? storage : Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys]).filter((key) => key in storage).map((key) => [key, storage[key]]),
      ))));
    },
    set(values: Record<string, unknown>, callback: () => void) {
      queueMicrotask(() => {
        if (writeFailure) runtime.lastError = { message: 'private quota detail' };
        else Object.assign(storage, structuredClone(values));
        callback?.();
        delete runtime.lastError;
      });
    },
    remove(keys: string[], callback: () => void) {
      for (const key of keys) delete storage[key];
      queueMicrotask(callback);
    },
  } } });
  respond = async (request) => {
    if (request.path.endsWith('/capabilities')) return caps;
    if (request.method === 'DELETE') return { retired: true };
    return { runId: 'run-1', generation: 1, published: request.method === 'PUT' && request.body.final, revision: 1 };
  };
});
afterEach(() => vi.unstubAllGlobals());

describe('durable local index reports', () => {
  it('restarts from persisted run/page and retries the identical body after response loss', async () => {
    let outbox = await import('./indexReportOutbox');
    const entries = Array.from({ length: 501 }, (_, id) => ({ code: 'ABC-123', data: { itemId: String(id) } }));
    await outbox.queueLocalIndexReport({ ...input, entries });
    const normal = respond;
    respond = async (request) => {
      if (request.method === 'PUT' && request.body.page === 1) throw new Error('private response body');
      return normal(request);
    };
    expect(await outbox.flushIndexReportOutbox(api())).toMatchObject({ failed: 1 });
    expect(persistedReports()).toHaveLength(1);
    const lostPage = requests.find((r) => r.method === 'PUT' && r.body.page === 1);
    storage = JSON.parse(JSON.stringify(storage));
    vi.resetModules();
    outbox = await import('./indexReportOutbox');
    respond = normal;
    expect(await outbox.flushIndexReportOutbox(api())).toMatchObject({ failed: 0 });
    const pages = requests.filter((r) => r.method === 'PUT');
    expect(pages.map((r) => r.body.page)).toEqual([0, 1, 1]);
    expect(pages[2]).toEqual(lostPage);
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(1);
    expect(persistedReports()).toHaveLength(0);
    expect(JSON.stringify(storage)).not.toContain('private');
  });

  it('retains the same requestId when the start response is lost', async () => {
    const outbox = await import('./indexReportOutbox');
    await outbox.queueLocalIndexReport({ ...input, requestId: undefined });
    const normal = respond;
    respond = async (request) => {
      if (request.method === 'POST') throw new Error('lost start');
      return normal(request);
    };
    await outbox.flushIndexReportOutbox(api());
    respond = normal;
    await outbox.flushIndexReportOutbox(api());
    const starts = requests.filter((r) => r.method === 'POST');
    expect(starts).toHaveLength(2);
    expect(starts[0].body.requestId).toBeTruthy();
    expect(starts[1].body).toEqual(starts[0].body);
  });

  it('never overwrites a newer queued report with an older in-flight completion', async () => {
    const outbox = await import('./indexReportOutbox');
    await outbox.queueLocalIndexReport(input);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const normal = respond;
    respond = async (request) => {
      if (request.method === 'PUT') { entered(); await wait; }
      return normal(request);
    };
    const flush = outbox.flushIndexReportOutbox(api());
    await started;
    await outbox.queueLocalIndexReport({ ...input, requestId: 'scan-2', entries: [], complete: false });
    release();
    await flush;
    expect(JSON.stringify(persistedReports())).toContain('scan-2');
    respond = normal;
    await outbox.flushIndexReportOutbox(api());
    expect(requests.filter((r) => r.method === 'POST').map((r) => r.body.requestId)).toEqual(['scan-1', 'scan-2']);
    expect(persistedReports()).toHaveLength(0);
  });

  it('isolates connection, producer, kind and source and invalidates capability on identity changes', async () => {
    const outbox = await import('./indexReportOutbox');
    await outbox.queueLocalIndexReport(input);
    await outbox.queueLocalIndexReport({ ...input, sourceId: 'https://second.test' });
    await outbox.queueLocalIndexReport({ ...input, kind: 'drive115', sourceId: 'hash:root' });
    identity.session.deviceId = 'device-2';
    await outbox.queueLocalIndexReport(input);
    identity.settings.baseUrl = 'https://second-cloud.test';
    await outbox.queueLocalIndexReport(input);
    expect(persistedReports()).toHaveLength(5);
    await outbox.flushIndexReportOutbox(api());
    expect(persistedReports()).toHaveLength(4);
    expect(await outbox.getIndexReportKinds()).toEqual(['emby']);
    identity.session.userId = 'other-user';
    expect(await outbox.getIndexReportKinds()).toEqual([]);
    await outbox.flushIndexReportOutbox(api());
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(1);
    expect(JSON.stringify(persistedReports())).not.toContain('private-access');
    expect(JSON.stringify(persistedReports())).not.toContain('private-refresh');
  });

  it('falls back only on capability 404 and retains unsupported reports for a later upgrade', async () => {
    const outbox = await import('./indexReportOutbox');
    await outbox.queueLocalIndexReport(input);
    respond = async () => { throw new client.SyncHttpError(404, 'private body'); };
    expect(await outbox.flushIndexReportOutbox(api())).toMatchObject({ failed: 0, supported: false });
    expect(await outbox.getIndexReportKinds()).toEqual([]);
    expect(persistedReports()).toHaveLength(1);
    expect(requests.map((r) => r.path)).toEqual(['/v1/index-reports/capabilities']);
    expect(await outbox.flushIndexReportOutbox({})).toMatchObject({ failed: 0, supported: false });
  });

  it('retains failed retirements and sends only kind/source, preserving order before a later scan', async () => {
    const outbox = await import('./indexReportOutbox');
    await outbox.queueIndexSourceRetirement('emby', input.sourceId);
    await outbox.queueLocalIndexReport(input);
    const normal = respond;
    respond = async (request) => {
      if (request.method === 'DELETE') throw new client.SyncHttpError(500, 'private body');
      return normal(request);
    };
    expect(await outbox.flushIndexReportOutbox(api())).toMatchObject({ failed: 1 });
    expect(requests.some((r) => r.method === 'POST')).toBe(false);
    respond = normal;
    await outbox.flushIndexReportOutbox(api());
    const retire = requests.filter((r) => r.method === 'DELETE');
    expect(retire.map((r) => r.body)).toEqual([{ kind: 'emby', sourceId: input.sourceId }, { kind: 'emby', sourceId: input.sourceId }]);
    expect(persistedReports()).toHaveLength(0);
  });

  it('rejects failed persistence with fixed text and leaves the last saved report intact', async () => {
    const outbox = await import('./indexReportOutbox');
    await outbox.queueLocalIndexReport(input);
    writeFailure = true;
    await expect(outbox.queueLocalIndexReport({ ...input, requestId: 'scan-2' })).rejects.toThrow('媒体索引报告保存失败，请重试');
    expect(JSON.stringify(persistedReports())).toContain('scan-1');
    expect(JSON.stringify(persistedReports())).not.toContain('scan-2');
  });

  it('rejects credential-bearing sources and overlong request IDs before writing storage', async () => {
    const outbox = await import('./indexReportOutbox');
    await expect(outbox.queueLocalIndexReport({ ...input, sourceId: 'https://user:secret@media.test?token=secret' })).rejects.toThrow();
    await expect(outbox.queueLocalIndexReport({ ...input, requestId: '影'.repeat(43) })).rejects.toThrow();
    expect(persistedReports()).toHaveLength(0);
  });
});

describe('local source registry', () => {
  it('remembers delivered empty sources and retires only removed local sources once', async () => {
    let outbox = await import('./indexReportOutbox');
    await outbox.queueLocalIndexReport({ ...input, entries: [] });
    await outbox.queueLocalIndexReport({ ...input, sourceId: 'https://offline.test' });
    await outbox.flushIndexReportOutbox(api());
    expect(persistedReports()).toHaveLength(0);
    vi.resetModules();
    outbox = await import('./indexReportOutbox');
    await outbox.reconcileLocalIndexSources('emby', ['https://offline.test']);
    await outbox.reconcileLocalIndexSources('emby', ['https://offline.test']);
    expect(persistedReports()).toHaveLength(1);
    await outbox.flushIndexReportOutbox(api());
    const retired = requests.filter((r) => r.method === 'DELETE');
    expect(retired.map((r) => r.body)).toEqual([{ kind: 'emby', sourceId: input.sourceId }]);
    await outbox.reconcileLocalIndexSources('emby', ['https://offline.test']);
    expect(persistedReports()).toHaveLength(0);
  });

  it('keeps registry isolated by producer and connection and includes queued empty sources', async () => {
    const outbox = await import('./indexReportOutbox');
    await outbox.queueLocalIndexReport({ ...input, entries: [] });
    identity.session.deviceId = 'other-device';
    await outbox.reconcileLocalIndexSources('emby', []);
    expect(persistedReports()).toHaveLength(1);
    identity.session.deviceId = 'device-1';
    identity.settings.baseUrl = 'https://other-cloud.test';
    await outbox.reconcileLocalIndexSources('emby', []);
    expect(persistedReports()).toHaveLength(1);
    identity.settings.baseUrl = 'https://cloud.test';
    await outbox.reconcileLocalIndexSources('emby', []);
    await outbox.flushIndexReportOutbox(api());
    expect(requests.filter((r) => r.method === 'DELETE').map((r) => r.body.sourceId)).toEqual([input.sourceId]);
  });
});

it('clears report capability when the current API lacks optional methods', async () => {
  const outbox = await import('./indexReportOutbox');
  await outbox.queueLocalIndexReport(input);
  await outbox.flushIndexReportOutbox(api());
  expect(await outbox.getIndexReportKinds()).toEqual(['emby']);
  expect(await outbox.flushIndexReportOutbox({})).toMatchObject({ supported: false, failed: 0 });
  expect(await outbox.getIndexReportKinds()).toEqual([]);
});

describe('retirement identity changes during 401', () => {
  it.each(['baseUrl', 'accountIdentifier', 'userId', 'deviceId'] as const)('never retries with another session after %s changes', async (field) => {
    const outbox = await import('./indexReportOutbox');
    await outbox.queueIndexSourceRetirement('emby', input.sourceId);
    const sent: Array<{ path: string; token?: string | null }> = [];
    let token = 'a-token';
    const boundApi = client.createApiClient({
      baseUrl: 'https://cloud.test',
      tokens: {
        getAccessToken: async () => token,
        getRefreshToken: async () => `${token}-refresh`,
        setTokens: async (pair) => { token = pair.accessToken; }, clear: async () => { token = ''; },
      },
      transport: {
        async request<T>(request: Parameters<HttpTransport['request']>[0]): Promise<T> {
          sent.push(request);
          if (request.path.endsWith('/capabilities')) return caps as T;
          if (request.method === 'DELETE' && token === 'a-token') {
            if (field === 'baseUrl') identity.settings.baseUrl = 'https://cloud-b.test';
            else if (field === 'accountIdentifier') identity.settings.accountIdentifier = 'account-b';
            else identity.session[field] = 'session-b';
            token = 'b-token';
            throw new client.SyncHttpError(401, 'expired');
          }
          return { retired: true } as T;
        },
      },
    });
    expect(await outbox.flushIndexReportOutbox(boundApi)).toMatchObject({ failed: 1 });
    expect(sent.filter((request) => request.path === '/v1/index-sources')).toHaveLength(1);
    expect(sent.some((request) => request.token === 'b-token')).toBe(false);
    expect(persistedReports()).toHaveLength(1);
  });
});

describe('terminal report runs', () => {
  it.each([404, 409])('ends a rejected old report (%s) without changing its ID and lets a fresh scan and retirement run', async (status) => {
    const outbox = await import('./indexReportOutbox');
    await outbox.queueLocalIndexReport(input);
    const normal = respond;
    respond = async (request) => {
      if (request.method === 'POST') {
        if (status === 409) throw new client.SyncHttpError(409, 'private revoked request');
        return { runId: 'expired-run', generation: 1, published: false, revision: 0 };
      }
      if (request.method === 'PUT') throw new client.SyncHttpError(404, 'private expired run');
      return normal(request);
    };
    expect(await outbox.flushIndexReportOutbox(api())).toMatchObject({ terminated: 1 });
    await outbox.queueLocalIndexReport({ ...input, requestId: 'fresh-scan' });
    await outbox.queueIndexSourceRetirement('emby', input.sourceId);
    respond = normal;
    await outbox.flushIndexReportOutbox(api());
    await outbox.flushIndexReportOutbox(api());
    expect(requests.filter((r) => r.method === 'POST').map((r) => r.body.requestId)).toEqual(['scan-1', 'fresh-scan']);
    expect(requests.filter((r) => r.method === 'DELETE')).toHaveLength(1);
    expect(requests.filter((r) => r.method === 'PUT' && r.path.endsWith('/expired-run'))).toHaveLength(status === 404 ? 1 : 0);
    const before = requests.length;
    await expect(outbox.queueLocalIndexReport(input)).rejects.toThrow('媒体索引报告已失效，请重新扫描');
    expect(requests).toHaveLength(before);
    expect(JSON.stringify(storage)).not.toContain('private revoked');
  });

  it('does not terminate start-404 or page-409 errors as if they were an expired run', async () => {
    const outbox = await import('./indexReportOutbox');
    await outbox.queueLocalIndexReport(input);
    const normal = respond;
    respond = async (request) => {
      if (request.method === 'POST') throw new client.SyncHttpError(404, 'missing route');
      return normal(request);
    };
    expect(await outbox.flushIndexReportOutbox(api())).toMatchObject({ failed: 1 });
    respond = normal;
    await outbox.flushIndexReportOutbox(api());
    expect(requests.filter((r) => r.method === 'POST').map((r) => r.body.requestId)).toEqual(['scan-1', 'scan-1']);
  });
});

describe('outbox cancellation', () => {
  it('retains the acknowledged run/page and stops subsequent pages and sources after cancellation', async () => {
    const outbox = await import('./indexReportOutbox');
    const controller = new AbortController();
    const entries = Array.from({ length: 1001 }, (_, id) => ({ code: 'ABC-123', data: { itemId: String(id) } }));
    await outbox.queueLocalIndexReport({ ...input, entries });
    await outbox.queueIndexSourceRetirement('drive115', 'account:root');
    const normal = respond;
    respond = async (request) => {
      if (request.method === 'PUT' && request.body.page === 1) {
        controller.abort();
        throw new DOMException('cancelled', 'AbortError');
      }
      return normal(request);
    };
    await expect(outbox.flushIndexReportOutbox(api(), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(requests.filter((request) => request.method === 'PUT').map((request) => request.body.page)).toEqual([0, 1]);
    expect(requests.some((request) => request.method === 'DELETE')).toBe(false);
    expect(persistedReports().find(([, queue]) => queue.kind === 'emby')![1].jobs[0]).toMatchObject({ runId: 'run-1', requestId: 'scan-1', nextPage: 1 });
    expect(persistedReports().find(([, queue]) => queue.kind === 'emby')![1].jobs[0].error).toBeUndefined();
    respond = normal;
    await outbox.flushIndexReportOutbox(api());
    expect(requests.filter((request) => request.method === 'PUT').map((request) => request.body.page)).toEqual([0, 1, 1, 2]);
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1);
    expect(requests.filter((request) => request.method === 'DELETE')).toHaveLength(1);
    expect(persistedReports()).toHaveLength(0);
  });

  it('does not discover capabilities or mutate queued jobs for an already cancelled flush', async () => {
    const outbox = await import('./indexReportOutbox');
    await outbox.queueLocalIndexReport(input);
    const before = structuredClone(storage);
    const controller = new AbortController();
    controller.abort();
    await expect(outbox.flushIndexReportOutbox(api(), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(requests).toEqual([]);
    expect(storage).toEqual(before);
  });
});
