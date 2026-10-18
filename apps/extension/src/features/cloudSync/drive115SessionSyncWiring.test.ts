/**
 * @file drive115SessionSyncWiring.test.ts
 * @description 10-13 线：applyRemote settings 分支 115 会话方向性保护接线测试
 * （G3-ii：local 非空 + 远端空 → 保 local，防另一台设备无关设置写静默抹会话）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbSpies = vi.hoisted(() => ({
  initDB: vi.fn(async () => {
    throw new Error('wiring tests: no IDB');
  }),
  viewedBulkPut: vi.fn(async () => undefined),
  viewedGet: vi.fn(async () => undefined),
  actorsBulkPut: vi.fn(async () => undefined),
  actorsGet: vi.fn(async () => undefined),
  listsBulkPut: vi.fn(async () => undefined),
  listsGet: vi.fn(async () => undefined),
  newWorksBulkPut: vi.fn(async () => undefined),
  newWorksGet: vi.fn(async () => undefined),
  newWorksDelete: vi.fn(async () => undefined),
}));

vi.mock('../../platform/storage/indexedDb', () => dbSpies);

function makeChromeStub(initial: Record<string, unknown>): { getStore: () => Record<string, unknown> } {
  let store: Record<string, unknown> = structuredClone(initial);
  const local = {
    get: vi.fn((keys: unknown, cb: (items: Record<string, unknown>) => void) => {
      queueMicrotask(() => {
        if (keys === null || keys === undefined) {
          cb(structuredClone(store));
          return;
        }
        const out: Record<string, unknown> = {};
        const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
        for (const k of list) if (store[k] !== undefined) out[k] = structuredClone(store[k]);
        cb(out);
      });
    }),
    set: vi.fn((items: Record<string, unknown>, cb?: () => void) => {
      store = { ...store, ...structuredClone(items) };
      queueMicrotask(() => cb?.());
    }),
    remove: vi.fn((_keys: string | string[], cb?: () => void) => {
      queueMicrotask(() => cb?.());
    }),
  };
  vi.stubGlobal('chrome', {
    storage: { local },
    runtime: {
      id: 'test-extension-id',
      lastError: undefined,
      sendMessage: vi.fn(() => Promise.reject(new Error('no background in wiring tests'))),
    },
  });
  return { getStore: () => store };
}

const LOCAL_115 = {
  v2AuthMode: 'openlist_manual',
  v2AccessToken: 'AT-115-local',
  v2RefreshToken: 'RT-115-local',
  v2TokenExpiresAt: 1893456000,
  v2RefreshTokenStatus: 'valid',
  v2AccessTokenStatus: 'valid',
  v2LastTokenRefreshAtSec: 1760000000,
};
const REMOTE_115 = { ...LOCAL_115, v2AccessToken: 'AT-115-remote', v2RefreshToken: 'RT-115-remote' };

function settingsEntity(value: unknown): Record<string, unknown> {
  return { type: 'storage_item', id: 'settings', payload: { key: 'settings', value }, updatedAt: 999 };
}

describe('10-13 settings 分支 115 会话方向性保护', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('applyRemote settings：local 有 115 会话 + 远端 blob 无 drive115 → 保 local 会话（G3-ii 核心）', async () => {
    const stub = makeChromeStub({
      settings: { theme: 'light', drive115: { ...LOCAL_115, v2ClientId: 'cid-keep' } },
    });
    const { createExtensionEntityStore } = await import('./extensionEntityStore');
    await createExtensionEntityStore().applyRemote([
      // 另一台设备改设置（无 115 会话）→ 整 blob 上云 → 本端 pull
      settingsEntity({ theme: 'dark' }),
    ]);

    const local = stub.getStore().settings as any;
    // 会话键族逐键保 local（旧码=整 blob 替换 → 此处先红）
    expect(local.drive115.v2AccessToken).toBe('AT-115-local');
    expect(local.drive115.v2RefreshToken).toBe('RT-115-local');
    expect(local.drive115.v2TokenExpiresAt).toBe(1893456000);
    // 其余键随 incoming LWW
    expect(local.theme).toBe('dark');
  });

  it('applyRemote settings：local 无会话 + 远端有 → 取远端（跨设备送达，现状语义）', async () => {
    const stub = makeChromeStub({ settings: { theme: 'light', drive115: { v2ClientId: 'cid' } } });
    const { createExtensionEntityStore } = await import('./extensionEntityStore');
    await createExtensionEntityStore().applyRemote([settingsEntity({ theme: 'light', drive115: REMOTE_115 })]);

    const local = stub.getStore().settings as any;
    expect(local.drive115.v2AccessToken).toBe('AT-115-remote');
    expect(local.drive115.v2RefreshToken).toBe('RT-115-remote');
  });

  it('applyRemote settings：双端会话值不同 → 远端胜（现状锁，无时间戳比较）', async () => {
    const stub = makeChromeStub({ settings: { drive115: LOCAL_115 } });
    const { createExtensionEntityStore } = await import('./extensionEntityStore');
    await createExtensionEntityStore().applyRemote([settingsEntity({ drive115: REMOTE_115 })]);

    const local = stub.getStore().settings as any;
    expect(local.drive115.v2AccessToken).toBe('AT-115-remote');
  });

  it('applyRemote settings：115 保护与 emby id 并集合并共存（两保护面互不干扰）', async () => {
    const stub = makeChromeStub({
      settings: {
        drive115: LOCAL_115,
        emby: {
          mediaServers: [
            { id: 'lx', name: 'LocalX', url: 'http://127.0.0.1:38098', accessToken: 'AT-emby-local' },
          ],
        },
      },
    });
    const { createExtensionEntityStore } = await import('./extensionEntityStore');
    await createExtensionEntityStore().applyRemote([
      settingsEntity({
        emby: { mediaServers: [{ id: 'ry', name: 'RemoteY', url: 'http://127.0.0.1:38099' }] },
      }),
    ]);

    const local = stub.getStore().settings as any;
    const ids = local.emby.mediaServers.map((s: any) => s.id).sort();
    expect(ids).toEqual(['lx', 'ry']);
    // emby 会话隔离回归零位移
    expect(local.emby.mediaServers.find((s: any) => s.id === 'lx').accessToken).toBe('AT-emby-local');
    expect(local.emby.mediaServers.find((s: any) => s.id === 'ry').accessToken).toBeUndefined();
    // 115 会话保护生效
    expect(local.drive115.v2AccessToken).toBe('AT-115-local');
  });

  it('applyRemote settings：非会话 drive115 键随 LWW（v2ClientId 远端胜，键族边界接线）', async () => {
    const stub = makeChromeStub({
      settings: { drive115: { ...LOCAL_115, v2ClientId: 'cid-local' } },
    });
    const { createExtensionEntityStore } = await import('./extensionEntityStore');
    await createExtensionEntityStore().applyRemote([settingsEntity({ drive115: { v2ClientId: 'cid-remote' } })]);

    const local = stub.getStore().settings as any;
    expect(local.drive115.v2ClientId).toBe('cid-remote');
    expect(local.drive115.v2AccessToken).toBe('AT-115-local');
  });
});
