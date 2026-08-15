/**
 * @file apiClient.test.ts
 */
import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './apiClient';
import { SyncHttpError } from './fetchTransport';
import { createMemoryTokenStore } from './memoryTokenStore';
import { createMockCloudTransport } from './mockTransport';
import {
  createSyncEngine,
  createMemoryCursorStore,
  createMemoryLocalStore,
  type SyncSessionProgress,
} from './syncEngine';
import type { HttpTransport, TokenStore } from './types';
import type { SyncEntity } from '@javdb/sync-protocol';

describe('apiClient + mock cloud', () => {
  it('registers, logs in, lists devices', async () => {
    const { transport } = createMockCloudTransport();
    const tokens = createMemoryTokenStore();
    const api = createApiClient({
      baseUrl: 'http://mock.local',
      transport,
      tokens,
    });

    await api.register({ identifier: 'u@test', password: 'secret' });
    const login = await api.login({
      identifier: 'u@test',
      password: 'secret',
      device: {
        id: 'dev-1',
        label: 'Test',
        clientType: 'extension',
      },
    });
    expect(login.accessToken).toBeTruthy();
    expect(await tokens.getAccessToken()).toBe(login.accessToken);

    const devices = await api.listDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0]?.id).toBe('dev-1');
  });
});

describe('apiClient authentication recovery', () => {
  it('shares one refresh when two clients retry the same expired session', async () => {
    let accessToken = 'access-old';
    let refreshToken = 'refresh-old';
    let refreshCalls = 0;
    let staleRequests = 0;
    let releaseStaleRequests: (() => void) | undefined;
    let resolveTokenWrite: (() => void) | undefined;
    const staleRequestsReady = new Promise<void>((resolve) => {
      releaseStaleRequests = resolve;
    });
    const tokenWritten = new Promise<void>((resolve) => {
      resolveTokenWrite = resolve;
    });

    const tokens: TokenStore = {
      async getAccessToken() {
        return accessToken;
      },
      async getRefreshToken() {
        return refreshToken;
      },
      async setTokens(pair) {
        accessToken = pair.accessToken;
        refreshToken = pair.refreshToken;
        resolveTokenWrite?.();
      },
      async clear() {
        accessToken = '';
        refreshToken = '';
      },
    };
    const transport: HttpTransport = {
      async request<T>(opts: {
        method: string;
        path: string;
        body?: unknown;
        token?: string | null;
      }): Promise<T> {
        const { method, path, token, body } = opts;
        if (method === 'GET' && path === '/v1/devices') {
          if (token === 'access-old') {
            staleRequests += 1;
            if (staleRequests === 2) releaseStaleRequests?.();
            await staleRequestsReady;
            throw new SyncHttpError(401, 'unauthorized');
          }
          if (token === 'access-new') return [] as T;
          throw new SyncHttpError(401, 'unauthorized');
        }
        if (method === 'POST' && path === '/v1/auth/refresh') {
          refreshCalls += 1;
          const submitted = body as { refreshToken?: string };
          if (refreshCalls === 1 && submitted.refreshToken === 'refresh-old') {
            return {
              accessToken: 'access-new',
              refreshToken: 'refresh-new',
              userId: 'user-1',
              deviceId: 'device-1',
            } as T;
          }
          await tokenWritten;
          throw new SyncHttpError(401, 'invalid refresh');
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      },
    };
    const firstClient = createApiClient({ baseUrl: 'http://mock', tokens, transport });
    const secondClient = createApiClient({ baseUrl: 'http://mock', tokens, transport });

    await expect(Promise.all([firstClient.listDevices(), secondClient.listDevices()])).resolves.toEqual([
      [],
      [],
    ]);
    expect(refreshCalls).toBe(1);
    expect(await tokens.getAccessToken()).toBe('access-new');
    expect(await tokens.getRefreshToken()).toBe('refresh-new');
  });
});

describe('syncEngine session (server-authoritative)', () => {
  it('passes the abort signal to each session request and stops before the next batch', async () => {
    const firstBatch: SyncEntity = {
      id: 'cancel-0',
      type: 'video',
      revision: 1,
      updatedAt: 1,
      payload: { status: 'viewed' },
    };
    const secondBatch: SyncEntity = {
      id: 'cancel-1',
      type: 'video',
      revision: 1,
      updatedAt: 2,
      payload: { status: 'viewed' },
    };
    const controller = new AbortController();
    const signals: Array<AbortSignal | undefined> = [];
    const api = {
      session: vi.fn(async (_request: unknown, options?: { signal?: AbortSignal }) => {
        signals.push(options?.signal);
        controller.abort();
        return {
          protocolVersion: 1,
          apply: [],
          results: [],
          stats: { uploaded: 500, downloaded: 0, merged: 0, rejected: 0, byType: {}, uploadedByType: {}, downloadedByType: {}, rejectedByType: {} },
          cursors: {},
          code: 'SYNC_OK',
          message: 'ok',
        };
      }),
    } as unknown as ReturnType<typeof createApiClient>;
    const local = createMemoryLocalStore() as ReturnType<typeof createMemoryLocalStore> & {
      enqueuePending: (entity: SyncEntity) => Promise<void>;
    };
    for (let index = 0; index < 501; index += 1) {
      await local.enqueuePending(index === 0 ? firstBatch : index === 1 ? secondBatch : { ...firstBatch, id: `cancel-${index}` });
    }

    await expect(createSyncEngine({ api, local, cursors: createMemoryCursorStore() }).syncSession('cancel-device', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(signals).toEqual([controller.signal]);
  });

  it('reports session request telemetry before applying the Cloud response', async () => {
    const { transport } = createMockCloudTransport();
    const tokens = createMemoryTokenStore();
    const api = createApiClient({ baseUrl: 'http://mock', transport, tokens });
    await api.register({ identifier: 'telemetry@t', password: 'p' });
    await api.login({
      identifier: 'telemetry@t',
      password: 'p',
      device: { id: 'dtelemetry', label: 'Telemetry', clientType: 'extension' },
    });
    const video: SyncEntity = {
      id: 'telemetry-video',
      type: 'video',
      revision: 1,
      updatedAt: 10,
      payload: { status: 'viewed' },
    };
    const local = createMemoryLocalStore() as ReturnType<typeof createMemoryLocalStore> & {
      enqueuePending: (e: SyncEntity) => Promise<void>;
    };
    await local.enqueuePending(video);
    const events: SyncSessionProgress[] = [];
    const engine = createSyncEngine({
      api,
      local,
      cursors: createMemoryCursorStore(),
    });

    const result = await engine.syncSession('dtelemetry', {
      onProgress: (event) => events.push(event),
    });

    expect(events.map((event) => event.stage)).toEqual(['uploading', 'applying']);
    expect(events[0]).toMatchObject({ stage: 'uploading', pendingCount: 1 });
    expect(events[0]?.requestBytes).toBeGreaterThan(0);
    expect(events[1]).toMatchObject({ stage: 'applying', uploaded: 1, downloaded: 1 });
    expect(result.metrics.requestBytes).toBe(events[0]?.requestBytes);
    expect(result.metrics.sessionDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('uses the transport-reported gzip body size in session metrics', async () => {
    const api = {
      session: vi.fn(async (
        _request: unknown,
        options?: {
          onRequestBodyMetrics?: (metrics: {
            uncompressedBytes: number;
            transmittedBytes: number;
            contentEncoding?: 'gzip';
          }) => void;
        },
      ) => {
        options?.onRequestBodyMetrics?.({
          uncompressedBytes: 2_048,
          transmittedBytes: 256,
          contentEncoding: 'gzip',
        });
        return {
          protocolVersion: 1,
          apply: [],
          results: [],
          stats: {
            uploaded: 0,
            downloaded: 0,
            merged: 0,
            rejected: 0,
            byType: {},
            uploadedByType: {},
            downloadedByType: {},
            rejectedByType: {},
          },
          cursors: {},
          code: 'SYNC_EMPTY',
          message: '同步完成（无变更）',
        };
      }),
    } as unknown as ReturnType<typeof createApiClient>;

    const result = await createSyncEngine({
      api,
      local: createMemoryLocalStore(),
      cursors: createMemoryCursorStore(),
    }).syncSession('gzip-device');

    expect(result.metrics).toMatchObject({
      requestBytes: 256,
      uncompressedRequestBytes: 2_048,
    });
  });

  it('splits a large pending queue into resumable session batches', async () => {
    const { transport } = createMockCloudTransport();
    let sessionCalls = 0;
    const countingTransport: HttpTransport = {
      async request<T>(opts: {
        method: string;
        path: string;
        body?: unknown;
        token?: string | null;
      }) {
        if (opts.path === '/v1/sync/session') sessionCalls += 1;
        return transport.request<T>(opts);
      },
    };
    const tokens = createMemoryTokenStore();
    const api = createApiClient({ baseUrl: 'http://mock', transport: countingTransport, tokens });
    await api.register({ identifier: 'batch@t', password: 'p' });
    await api.login({
      identifier: 'batch@t',
      password: 'p',
      device: { id: 'dbatch', label: 'Batch', clientType: 'extension' },
    });

    const local = createMemoryLocalStore() as ReturnType<typeof createMemoryLocalStore> & {
      enqueuePending: (entity: SyncEntity) => Promise<void>;
    };
    for (let index = 0; index < 501; index += 1) {
      await local.enqueuePending({
        id: `batch-${index}`,
        type: 'video',
        revision: 1,
        updatedAt: index + 1,
        payload: { status: 'viewed' },
      });
    }
    const events: SyncSessionProgress[] = [];
    const result = await createSyncEngine({
      api,
      local,
      cursors: createMemoryCursorStore(),
    }).syncSession('dbatch', { onProgress: (event) => events.push(event) });

    expect(sessionCalls).toBe(2);
    expect(result.response.stats.uploaded).toBe(501);
    expect(await local.listPending()).toHaveLength(0);
    expect(events.filter((event) => event.stage === 'uploading').map((event) => event.batchCount)).toEqual([2, 2]);
  });

  it('syncSession applies server apply and reports stats.message', async () => {
    const { transport, state } = createMockCloudTransport();
    const tokensA = createMemoryTokenStore();
    const apiA = createApiClient({ baseUrl: 'http://mock', transport, tokens: tokensA });
    await apiA.register({ identifier: 's@t', password: 'p' });
    await apiA.login({
      identifier: 's@t',
      password: 'p',
      device: { id: 'd1', label: 'A', clientType: 'extension' },
    });

    const video: SyncEntity = {
      id: 'v-session',
      type: 'video',
      revision: 1,
      updatedAt: 100,
      payload: { status: 'viewed' },
    };

    const localA = createMemoryLocalStore([video]) as ReturnType<typeof createMemoryLocalStore> & {
      enqueuePending: (e: SyncEntity) => Promise<void>;
    };
    await localA.enqueuePending(video);

    const engineA = createSyncEngine({
      api: apiA,
      local: localA,
      cursors: createMemoryCursorStore(),
    });
    const resultA = await engineA.syncSession('d1');
    expect(resultA.response.stats.uploaded).toBe(1);
    expect(resultA.pushed).toBe(1);
    expect(resultA.response.message).toMatch(/同步/);
    expect(state.entities.size).toBe(1);
    // accepted pending cleared
    expect(await localA.listPending()).toHaveLength(0);

    const tokensB = createMemoryTokenStore();
    const apiB = createApiClient({ baseUrl: 'http://mock', transport, tokens: tokensB });
    await apiB.login({
      identifier: 's@t',
      password: 'p',
      device: { id: 'd2', label: 'B', clientType: 'extension' },
    });
    const localB = createMemoryLocalStore();
    const engineB = createSyncEngine({
      api: apiB,
      local: localB,
      cursors: createMemoryCursorStore(),
    });
    const resultB = await engineB.syncSession('d2');
    expect(resultB.response.stats.downloaded).toBeGreaterThanOrEqual(1);
    expect(resultB.response.code).toBeTruthy();
    const all = await localB.listAll();
    expect(all.some((e) => e.id === 'v-session' && e.type === 'video')).toBe(true);
  });

  it('syncSession empty pending yields SYNC_EMPTY and does not wipe local', async () => {
    const { transport } = createMockCloudTransport();
    const tokens = createMemoryTokenStore();
    const api = createApiClient({ baseUrl: 'http://mock', transport, tokens });
    await api.register({ identifier: 'e@t', password: 'p' });
    await api.login({
      identifier: 'e@t',
      password: 'p',
      device: { id: 'de', label: 'E', clientType: 'extension' },
    });
    const keep: SyncEntity = {
      id: 'keep-local',
      type: 'video',
      revision: 1,
      updatedAt: 1,
      payload: { status: 'viewed' },
    };
    const local = createMemoryLocalStore([keep]);
    const engine = createSyncEngine({
      api,
      local,
      cursors: createMemoryCursorStore(),
    });
    const res = await engine.syncSession('de');
    expect(res.response.code).toBe('SYNC_EMPTY');
    expect(res.response.stats.uploaded).toBe(0);
    expect(res.response.stats.downloaded).toBe(0);
    const all = await local.listAll();
    expect(all.some((e) => e.id === 'keep-local')).toBe(true);
  });

  it('syncSession upsert apply does not remove local-only entities', async () => {
    const { transport } = createMockCloudTransport();
    const tokensA = createMemoryTokenStore();
    const apiA = createApiClient({ baseUrl: 'http://mock', transport, tokens: tokensA });
    await apiA.register({ identifier: 'u@t', password: 'p' });
    await apiA.login({
      identifier: 'u@t',
      password: 'p',
      device: { id: 'da', label: 'A', clientType: 'extension' },
    });
    const cloudOnly: SyncEntity = {
      id: 'cloud-1',
      type: 'video',
      revision: 1,
      updatedAt: 10,
      payload: { status: 'want' },
    };
    const localA = createMemoryLocalStore([cloudOnly]) as ReturnType<typeof createMemoryLocalStore> & {
      enqueuePending: (e: SyncEntity) => Promise<void>;
    };
    await localA.enqueuePending(cloudOnly);
    await createSyncEngine({
      api: apiA,
      local: localA,
      cursors: createMemoryCursorStore(),
    }).syncSession('da');

    const tokensB = createMemoryTokenStore();
    const apiB = createApiClient({ baseUrl: 'http://mock', transport, tokens: tokensB });
    await apiB.login({
      identifier: 'u@t',
      password: 'p',
      device: { id: 'db', label: 'B', clientType: 'extension' },
    });
    const localOnly: SyncEntity = {
      id: 'local-only',
      type: 'video',
      revision: 1,
      updatedAt: 1,
      payload: { status: 'viewed' },
    };
    const localB = createMemoryLocalStore([localOnly]);
    const res = await createSyncEngine({
      api: apiB,
      local: localB,
      cursors: createMemoryCursorStore(),
    }).syncSession('db');
    expect(res.response.stats.downloaded).toBeGreaterThanOrEqual(1);
    const ids = (await localB.listAll()).map((e) => e.id).sort();
    expect(ids).toContain('local-only');
    expect(ids).toContain('cloud-1');
  });

  it('syncSession keeps rejected items in pending', async () => {
    const { transport } = createMockCloudTransport();
    const tokens = createMemoryTokenStore();
    const api = createApiClient({ baseUrl: 'http://mock', transport, tokens });
    await api.register({ identifier: 'rej@t', password: 'p' });
    await api.login({
      identifier: 'rej@t',
      password: 'p',
      device: { id: 'dr', label: 'R', clientType: 'extension' },
    });

    const bad: SyncEntity = {
      id: '',
      type: 'video',
      revision: 1,
      updatedAt: 1,
      payload: { status: 'viewed' },
    };
    const good: SyncEntity = {
      id: 'good-1',
      type: 'video',
      revision: 1,
      updatedAt: 2,
      payload: { status: 'want' },
    };
    const local = createMemoryLocalStore() as ReturnType<typeof createMemoryLocalStore> & {
      enqueuePending: (e: SyncEntity) => Promise<void>;
    };
    await local.enqueuePending(bad);
    await local.enqueuePending(good);

    const res = await createSyncEngine({
      api,
      local,
      cursors: createMemoryCursorStore(),
    }).syncSession('dr');

    expect(res.response.stats.rejected).toBeGreaterThanOrEqual(1);
    expect(res.response.stats.uploaded).toBeGreaterThanOrEqual(1);
    expect(res.response.code).toBe('SYNC_PARTIAL');

    const pending = await local.listPending();
    // rejected (empty id) must remain; accepted good-1 cleared
    expect(pending.some((e) => e.id === '' && e.type === 'video')).toBe(true);
    expect(pending.some((e) => e.id === 'good-1')).toBe(false);
  });

  it('syncSession retries after 401 via refresh', async () => {
    const { transport } = createMockCloudTransport();
    const tokens = createMemoryTokenStore();
    let authFailures = 0;
    const api = createApiClient({
      baseUrl: 'http://mock',
      transport,
      tokens,
      onAuthFailure: () => {
        authFailures += 1;
      },
    });
    await api.register({ identifier: 'ref@t', password: 'p' });
    const login = await api.login({
      identifier: 'ref@t',
      password: 'p',
      device: { id: 'dref', label: 'Ref', clientType: 'extension' },
    });
    const refresh = await tokens.getRefreshToken();
    expect(refresh).toBeTruthy();

    // Corrupt access token; keep refresh so withAuthRetry can recover.
    await tokens.setTokens({
      accessToken: 'access_dead',
      refreshToken: refresh as string,
      userId: login.userId,
      deviceId: login.deviceId,
    });

    const video: SyncEntity = {
      id: 'after-refresh',
      type: 'video',
      revision: 1,
      updatedAt: 1,
      payload: { status: 'viewed' },
    };
    const local = createMemoryLocalStore([video]) as ReturnType<typeof createMemoryLocalStore> & {
      enqueuePending: (e: SyncEntity) => Promise<void>;
    };
    await local.enqueuePending(video);

    const res = await createSyncEngine({
      api,
      local,
      cursors: createMemoryCursorStore(),
    }).syncSession('dref');

    expect(res.response.stats.uploaded).toBe(1);
    expect(await tokens.getAccessToken()).not.toBe('access_dead');
    expect(authFailures).toBe(0);
    expect(await local.listPending()).toHaveLength(0);
  });

  it('syncSession surfaces auth failure when refresh is dead', async () => {
    const { transport } = createMockCloudTransport();
    const tokens = createMemoryTokenStore();
    let authFailures = 0;
    const api = createApiClient({
      baseUrl: 'http://mock',
      transport,
      tokens,
      onAuthFailure: () => {
        authFailures += 1;
      },
    });
    await api.register({ identifier: 'dead@t', password: 'p' });
    await api.login({
      identifier: 'dead@t',
      password: 'p',
      device: { id: 'ddead', label: 'D', clientType: 'extension' },
    });
    await tokens.setTokens({
      accessToken: 'access_dead',
      refreshToken: 'refresh_dead',
      userId: 'u',
      deviceId: 'ddead',
    });

    const local = createMemoryLocalStore();
    await expect(
      createSyncEngine({
        api,
        local,
        cursors: createMemoryCursorStore(),
      }).syncSession('ddead'),
    ).rejects.toBeTruthy();
    expect(authFailures).toBeGreaterThanOrEqual(1);
  });
});

describe('syncEngine', () => {
  it('pushes pending then pulls to another local store', async () => {
    const { transport, state } = createMockCloudTransport();
    const tokensA = createMemoryTokenStore();
    const apiA = createApiClient({ baseUrl: 'http://mock', transport, tokens: tokensA });
    await apiA.register({ identifier: 'a@t', password: 'p' });
    await apiA.login({
      identifier: 'a@t',
      password: 'p',
      device: { id: 'd1', label: 'A', clientType: 'extension' },
    });

    const video: SyncEntity = {
      id: 'v1',
      type: 'video',
      revision: 1,
      updatedAt: 100,
      payload: { status: 'viewed' },
    };

    const localA = createMemoryLocalStore([video]) as ReturnType<typeof createMemoryLocalStore> & {
      enqueuePending: (e: SyncEntity) => Promise<void>;
    };
    await localA.enqueuePending(video);

    const engineA = createSyncEngine({
      api: apiA,
      local: localA,
      cursors: createMemoryCursorStore(),
    });
    const resultA = await engineA.syncNow();
    expect(resultA.pushed).toBe(1);
    expect(state.entities.size).toBe(1);

    const tokensB = createMemoryTokenStore();
    const apiB = createApiClient({ baseUrl: 'http://mock', transport, tokens: tokensB });
    await apiB.login({
      identifier: 'a@t',
      password: 'p',
      device: { id: 'd2', label: 'B', clientType: 'extension' },
    });
    const localB = createMemoryLocalStore();
    const engineB = createSyncEngine({
      api: apiB,
      local: localB,
      cursors: createMemoryCursorStore(),
    });
    const resultB = await engineB.syncNow();
    expect(resultB.pulled).toBeGreaterThanOrEqual(1);
    const all = await localB.listAll();
    expect(all.some((e) => e.id === 'v1' && e.type === 'video')).toBe(true);
  });
});
