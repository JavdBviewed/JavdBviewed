import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PENDING_KEY = 'cloud_sync_pending_v1';
const PENDING_DELTA_KEY = 'cloud_sync_pending_delta_v1';
const SESSION_KEY = 'cloud_sync_session_v1';
const SETTINGS_KEY = 'cloud_sync_settings_v1';

const SESSION_RECORD = {
  accessToken: 'test-access-token',
  refreshToken: 'test-refresh-token',
  userId: 'user-1',
  deviceId: 'device-1',
  savedAt: 0,
};

describe('chromePendingStore', () => {
  let storedValues: Record<string, unknown>;
  let storageGet: ReturnType<typeof vi.fn>;
  let storageSet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    storedValues = {
      [PENDING_KEY]: [],
      [SESSION_KEY]: { ...SESSION_RECORD },
    };
    storageGet = vi.fn((_keys: string[], callback: (items: Record<string, unknown>) => void) => {
      queueMicrotask(() => callback(structuredClone(storedValues)));
    });
    storageSet = vi.fn((items: Record<string, unknown>, callback: () => void) => {
      queueMicrotask(() => {
        storedValues = { ...storedValues, ...structuredClone(items) };
        callback();
      });
    });
    vi.stubGlobal('chrome', { storage: { local: { get: storageGet, set: storageSet } } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps every pending entity when two updates arrive before the first write finishes', async () => {
    const { listCloudPending, upsertCloudPending } = await import('./chromePendingStore');

    await Promise.all([
      upsertCloudPending([{ type: 'video', id: 'ABP-001' }] as any),
      upsertCloudPending([{ type: 'video', id: 'ABP-002' }] as any),
    ]);

    expect(await listCloudPending()).toEqual([
      { type: 'video', id: 'ABP-001' },
      { type: 'video', id: 'ABP-002' },
    ]);
  });

  it('appends a new entity to the small delta without rewriting the existing pending base', async () => {
    storedValues[PENDING_KEY] = [
      { type: 'video', id: 'ABP-001' },
      { type: 'video', id: 'ABP-002' },
    ];
    const { listCloudPending, upsertCloudPending } = await import('./chromePendingStore');

    await upsertCloudPending([{ type: 'video', id: 'ABP-003' }] as any);

    expect(storedValues[PENDING_KEY]).toEqual([
      { type: 'video', id: 'ABP-001' },
      { type: 'video', id: 'ABP-002' },
    ]);
    expect(storedValues[PENDING_DELTA_KEY]).toEqual({
      'video\u0000ABP-003': { type: 'video', id: 'ABP-003' },
    });
    expect(await listCloudPending()).toEqual([
      { type: 'video', id: 'ABP-001' },
      { type: 'video', id: 'ABP-002' },
      { type: 'video', id: 'ABP-003' },
    ]);
  });

  it('does not persist diagnostic or magnet push logs in the pending delta', async () => {
    const { listCloudPending, upsertCloudPending } = await import('./chromePendingStore');

    await upsertCloudPending([
      { type: 'log', id: 'info-1', payload: { level: 'INFO' } },
      { type: 'log', id: 'debug-1', payload: { level: 'DEBUG' } },
      { type: 'log', id: 'warn-1', payload: { level: 'WARN' } },
      { type: 'log', id: 'error-1', payload: { level: 'ERROR' } },
      { type: 'magnet_push_log', id: 'magnet-1', payload: { status: 'done' } },
      { type: 'video', id: 'ABP-004' },
    ] as any);

    expect(await listCloudPending()).toEqual([{ type: 'video', id: 'ABP-004' }]);
  });

  describe('cloud availability gate', () => {
    it('does not enqueue when there is no cloud session and no saved credentials', async () => {
      delete storedValues[SESSION_KEY];
      const { listCloudPending, upsertCloudPending } = await import('./chromePendingStore');

      await upsertCloudPending([{ type: 'video', id: 'ABP-001' }] as any);

      expect(storageSet).not.toHaveBeenCalled();
      expect(storedValues[PENDING_DELTA_KEY]).toBeUndefined();
      expect(await listCloudPending()).toEqual([]);
    });

    it('treats settings without an accountIdentifier as no saved credentials', async () => {
      delete storedValues[SESSION_KEY];
      storedValues[SETTINGS_KEY] = { baseUrl: 'http://127.0.0.1:18080', accountIdentifier: '' };
      const { upsertCloudPending } = await import('./chromePendingStore');

      await upsertCloudPending([{ type: 'video', id: 'ABP-001' }] as any);

      expect(storageSet).not.toHaveBeenCalled();
      expect(storedValues[PENDING_DELTA_KEY]).toBeUndefined();
    });

    it('still enqueues when saved credentials exist even without a session', async () => {
      delete storedValues[SESSION_KEY];
      storedValues[SETTINGS_KEY] = { baseUrl: 'http://127.0.0.1:18080', accountIdentifier: 'alice' };
      const { listCloudPending, upsertCloudPending } = await import('./chromePendingStore');

      await upsertCloudPending([{ type: 'video', id: 'ABP-001' }] as any);

      expect(storedValues[PENDING_DELTA_KEY]).toEqual({
        'video\u0000ABP-001': { type: 'video', id: 'ABP-001' },
      });
      expect(await listCloudPending()).toEqual([{ type: 'video', id: 'ABP-001' }]);
    });

    it('re-enqueues after a session appears without a module reload', async () => {
      delete storedValues[SESSION_KEY];
      const { upsertCloudPending } = await import('./chromePendingStore');

      await upsertCloudPending([{ type: 'video', id: 'ABP-001' }] as any);
      expect(storageSet).not.toHaveBeenCalled();

      storedValues[SESSION_KEY] = { ...SESSION_RECORD };
      await upsertCloudPending([{ type: 'video', id: 'ABP-001' }] as any);

      expect(storedValues[PENDING_DELTA_KEY]).toEqual({
        'video\u0000ABP-001': { type: 'video', id: 'ABP-001' },
      });
    });
  });

  describe('no-op skip', () => {
    it('skips writing when the upserted entity is identical to the current effective value', async () => {
      storedValues[PENDING_KEY] = [{ type: 'video', id: 'ABP-001', payload: { watchedAt: 1 } }];
      const { listCloudPending, upsertCloudPending } = await import('./chromePendingStore');

      await upsertCloudPending([{ type: 'video', id: 'ABP-001', payload: { watchedAt: 1 } }] as any);

      expect(storageSet).not.toHaveBeenCalled();
      expect(storedValues[PENDING_DELTA_KEY]).toBeUndefined();
      expect(await listCloudPending()).toEqual([{ type: 'video', id: 'ABP-001', payload: { watchedAt: 1 } }]);
    });

    it('skips when the entity only exists in the pending base, not in a previous delta', async () => {
      storedValues[PENDING_KEY] = [{ type: 'actor', id: 'actor-9', payload: { name: 'A' } }];
      storedValues[PENDING_DELTA_KEY] = {
        'actor\u0000actor-9': { type: 'actor', id: 'actor-9', payload: { name: 'A' } },
      };
      const { upsertCloudPending } = await import('./chromePendingStore');

      await upsertCloudPending([{ type: 'actor', id: 'actor-9', payload: { name: 'A' } }] as any);

      expect(storageSet).not.toHaveBeenCalled();
    });

    it('only writes the changed entities of a mixed batch', async () => {
      storedValues[PENDING_KEY] = [
        { type: 'video', id: 'ABP-001', payload: { watchedAt: 1 } },
        { type: 'video', id: 'ABP-002', payload: { watchedAt: 2 } },
      ];
      const { listCloudPending, upsertCloudPending } = await import('./chromePendingStore');

      await upsertCloudPending([
        { type: 'video', id: 'ABP-001', payload: { watchedAt: 1 } },
        { type: 'video', id: 'ABP-002', payload: { watchedAt: 22 } },
      ] as any);

      expect(storageSet).toHaveBeenCalledTimes(1);
      expect(storedValues[PENDING_KEY]).toEqual([
        { type: 'video', id: 'ABP-001', payload: { watchedAt: 1 } },
        { type: 'video', id: 'ABP-002', payload: { watchedAt: 2 } },
      ]);
      expect(storedValues[PENDING_DELTA_KEY]).toEqual({
        'video\u0000ABP-002': { type: 'video', id: 'ABP-002', payload: { watchedAt: 22 } },
      });
      expect(await listCloudPending()).toEqual([
        { type: 'video', id: 'ABP-001', payload: { watchedAt: 1 } },
        { type: 'video', id: 'ABP-002', payload: { watchedAt: 22 } },
      ]);
    });

    it('treats key-order-different but equal payload as unchanged', async () => {
      storedValues[PENDING_KEY] = [{ type: 'video', id: 'ABP-001', payload: { a: 1, b: 2 } }];
      const { upsertCloudPending } = await import('./chromePendingStore');

      await upsertCloudPending([{ type: 'video', id: 'ABP-001', payload: { b: 2, a: 1 } }] as any);

      expect(storageSet).not.toHaveBeenCalled();
    });
  });

  describe('cross-context storage authority', () => {
    it('clearCloudPending keeps delta entries another context wrote to storage after this context cached state', async () => {
      const { clearCloudPending, listCloudPending, upsertCloudPending } = await import('./chromePendingStore');

      // 本上下文（模拟页面）先建立视图：入队 videoA
      await upsertCloudPending([{ type: 'video', id: 'ABP-A' }] as any);

      // 另一上下文（模拟 SW）直接把 videoB 写入 storage
      const prevDelta = (storedValues[PENDING_DELTA_KEY] ?? {}) as Record<string, unknown>;
      storedValues[PENDING_DELTA_KEY] = { ...prevDelta, 'video\u0000ABP-B': { type: 'video', id: 'ABP-B' } };

      // 本上下文只清理已接受的 videoA
      await clearCloudPending([{ type: 'video', id: 'ABP-A' }]);

      expect(await listCloudPending()).toEqual([{ type: 'video', id: 'ABP-B' }]);
    });

    it('upsertCloudPending keeps concurrent entries another context wrote to storage', async () => {
      const { listCloudPending, upsertCloudPending } = await import('./chromePendingStore');

      await upsertCloudPending([{ type: 'video', id: 'ABP-A' }] as any);
      const prevDelta = (storedValues[PENDING_DELTA_KEY] ?? {}) as Record<string, unknown>;
      storedValues[PENDING_DELTA_KEY] = { ...prevDelta, 'video\u0000ABP-B': { type: 'video', id: 'ABP-B' } };

      await upsertCloudPending([{ type: 'video', id: 'ABP-C' }] as any);

      expect(await listCloudPending()).toEqual([
        { type: 'video', id: 'ABP-A' },
        { type: 'video', id: 'ABP-B' },
        { type: 'video', id: 'ABP-C' },
      ]);
    });

    it('ensureInitialPending does not clobber entries another context enqueued after this context read empty', async () => {
      const { ensureInitialPending, listCloudPending } = await import('./chromePendingStore');

      // 本上下文先读一次空队列（旧实现在这里缓存了空快照）
      await listCloudPending();
      storedValues[PENDING_DELTA_KEY] = { 'video\u0000ABP-X': { type: 'video', id: 'ABP-X' } };

      const enqueued = await ensureInitialPending([{ type: 'video', id: 'ABP-LOCAL' }] as any);

      expect(enqueued).toBe(0);
      expect(await listCloudPending()).toEqual([{ type: 'video', id: 'ABP-X' }]);
    });
  });

  describe('ensureInitialPending first-sync seeding gate', () => {
    const CURSORS_KEY = 'cloud_sync_cursors_v1';

    it('still first-pushes the full local snapshot when the device has never synced (cursors empty)', async () => {
      const { ensureInitialPending, listCloudPending } = await import('./chromePendingStore');

      const enqueued = await ensureInitialPending([{ type: 'video', id: 'ABP-LOCAL' }] as any);

      expect(enqueued).toBe(1);
      expect(await listCloudPending()).toEqual([{ type: 'video', id: 'ABP-LOCAL' }]);
    });

    it('does not reseed the full base once cursors exist, so a quiet sync cannot re-push the stale settings blob', async () => {
      storedValues[CURSORS_KEY] = { storage_item: 829, video: 77 };
      const { ensureInitialPending, listCloudPending } = await import('./chromePendingStore');

      const enqueued = await ensureInitialPending([
        { type: 'video', id: 'ABP-LOCAL' },
        { type: 'storage_item', id: 'settings' },
      ] as any);

      expect(enqueued).toBe(0);
      expect(await listCloudPending()).toEqual([]);
    });
  });
});
