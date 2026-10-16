/**
 * @file embySettingsSyncWiring.test.ts
 * @description X2 云 settings 同步模型接线测试（10-13 线）：
 * - pull：applyRemote settings 分支 = 按源 id 并集合并 + 会话剥离 + 墓碑前移（替换整 blob LWW）
 * - push 全量：collectLocalSyncEntities 的 settings 实体入队前剥离会话（本地 storage 不动）
 * - push 增量：enqueueStorageItemChange('settings', ...) 入队前剥离会话
 * - 保存侧：saveSettings 打条目级 updatedAt（与既有墓碑钩点同址，fail-open）
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

type ChromeStub = {
  getStore: () => Record<string, unknown>;
};

function makeChromeStub(initial: Record<string, unknown>): ChromeStub {
  let store: Record<string, unknown> = structuredClone(initial);
  const local = {
    get: vi.fn((keys: unknown, cb: (items: Record<string, unknown>) => void) => {
      queueMicrotask(() => {
        if (keys === null || keys === undefined) {
          cb(structuredClone(store));
          return;
        }
        if (typeof keys === 'string') {
          const out: Record<string, unknown> = {};
          if (store[keys] !== undefined) out[keys] = structuredClone(store[keys]);
          cb(out);
          return;
        }
        if (Array.isArray(keys)) {
          const out: Record<string, unknown> = {};
          for (const k of keys) if (store[k] !== undefined) out[k] = structuredClone(store[k]);
          cb(out);
          return;
        }
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(keys as Record<string, unknown>)) {
          out[k] = store[k] !== undefined ? structuredClone(store[k]) : (keys as Record<string, unknown>)[k];
        }
        cb(out);
      });
    }),
    set: vi.fn((items: Record<string, unknown>, cb?: () => void) => {
      store = { ...store, ...structuredClone(items) };
      queueMicrotask(() => cb?.());
    }),
    remove: vi.fn((keys: string | string[], cb?: () => void) => {
      const list = Array.isArray(keys) ? keys : [keys];
      store = Object.fromEntries(Object.entries(store).filter(([k]) => !list.includes(k)));
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

const LOCAL_SESSION = {
  accessToken: 'AT-local',
  userId: 'UID-local',
  userDisplayName: 'UDN-local',
  tokenObtainedAt: 111,
};
const REMOTE_SESSION = {
  accessToken: 'AT-remote',
  userId: 'UID-remote',
  userDisplayName: 'UDN-remote',
  tokenObtainedAt: 222,
};

function server(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'srv-1',
    type: 'emby',
    name: 'Srv1',
    url: 'http://127.0.0.1:38098',
    enabled: true,
    ...over,
  };
}

function settingsEntity(value: unknown): Record<string, unknown> {
  return { type: 'storage_item', id: 'settings', payload: { key: 'settings', value }, updatedAt: 999 };
}

function mediaServersOf(store: ChromeStub): Array<Record<string, any>> {
  return (store.getStore().settings as any)?.emby?.mediaServers ?? [];
}

describe('X2 settings 同步接线', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('applyRemote settings：按源 id 并集合并 + 会话隔离 + 远端子设置 LWW（验收 1/2/4）', async () => {
    const stub = makeChromeStub({
      settings: {
        theme: 'light',
        emby: {
          enabled: true,
          mediaServers: [
            { ...server({ id: 'lx', name: 'LocalX' }), ...LOCAL_SESSION, updatedAt: 100 },
          ],
        },
      },
    });
    const { createExtensionEntityStore } = await import('./extensionEntityStore');
    await createExtensionEntityStore().applyRemote([
      settingsEntity({
        theme: 'dark',
        emby: {
          enabled: true,
          libraryEnabled: false,
          mediaServers: [
            { ...server({ id: 'ry', name: 'RemoteY' }), ...REMOTE_SESSION, updatedAt: 300 },
            { ...server({ id: 'lx', name: 'RenamedX' }), ...REMOTE_SESSION, updatedAt: 400 },
          ],
        },
      }),
    ]);

    const local = stub.getStore().settings as any;
    const byId = Object.fromEntries(local.emby.mediaServers.map((s: any) => [s.id, s]));
    // 并集：双端源都在
    expect(Object.keys(byId).sort()).toEqual(['lx', 'ry']);
    // 同 id lx：远端 updatedAt 400 > 本地 100 → 非会话字段取远端
    expect(byId.lx.name).toBe('RenamedX');
    // 本地已有会话保留（不是远端的）
    expect(byId.lx.accessToken).toBe('AT-local');
    expect(byId.lx.userId).toBe('UID-local');
    // ry：本地无会话 → 不接收远端会话
    for (const f of ['accessToken', 'userId', 'userDisplayName', 'tokenObtainedAt']) {
      expect(byId.ry[f]).toBeUndefined();
    }
    // 远端 emby 子设置/顶层 LWW
    expect(local.theme).toBe('dark');
    expect(local.emby.libraryEnabled).toBe(false);
    // 本地 storage 写的是合并结果（整 blob 里无远端会话残留）
    expect(JSON.stringify(local)).not.toContain('AT-remote');
  });

  it('applyRemote settings：墓碑前移到 pull 应用层 → 死源不复活（验收 3）', async () => {
    const stub = makeChromeStub({
      settings: {
        emby: { mediaServers: [server({ id: 'x', name: 'X' }), server({ id: 'y', name: 'Y' })] },
      },
    });
    const { createExtensionEntityStore } = await import('./extensionEntityStore');
    await createExtensionEntityStore().applyRemote([
      // A 删了 X：远端 blob 无 X 活体，但带墓碑 X（此处故意同时塞活体 X 模拟陈旧推回）
      settingsEntity({
        emby: {
          mediaServers: [server({ id: 'y', name: 'Y2' }), server({ id: 'x', name: 'X-stale' })],
          deletedServerIds: ['x'],
        },
      }),
    ]);

    const local = stub.getStore().settings as any;
    const ids = local.emby.mediaServers.map((s: any) => s.id);
    expect(ids).not.toContain('x');
    expect(ids).toContain('y');
    expect(local.emby.mediaServers.find((s: any) => s.id === 'y').name).toBe('Y2');
    expect(local.emby.deletedServerIds).toContain('x');
  });

  it('collectLocalSyncEntities：全量 push 的 settings 实体剥离会话，本地 storage 不动', async () => {
    const localSettings = {
      theme: 'light',
      drive115: { v2AccessToken: 'v2-at-keep', v2RefreshToken: 'v2-rt-keep' },
      emby: { mediaServers: [{ ...server({ id: 's' }), ...LOCAL_SESSION }] },
    };
    const stub = makeChromeStub({ settings: localSettings });
    // 全量采集顶层 initDB 不被 try 包裹：给可分节 catch 的假 db（各 store getAll 抛错=无数据）
    dbSpies.initDB.mockImplementationOnce(async () => ({
      getAll: async () => {
        throw new Error('no store in wiring tests');
      },
      put: async () => undefined,
    }));
    const { collectLocalSyncEntities } = await import('./extensionEntityStore');
    const entities = await collectLocalSyncEntities();

    const se = entities.find((e) => e.type === 'storage_item' && e.id === 'settings');
    expect(se).toBeTruthy();
    const pushed = (se!.payload as any).value;
    expect(pushed.emby.mediaServers[0].accessToken).toBeUndefined();
    expect(pushed.emby.mediaServers[0].userId).toBeUndefined();
    expect(pushed.emby.mediaServers[0].userDisplayName).toBeUndefined();
    expect(pushed.emby.mediaServers[0].tokenObtainedAt).toBeUndefined();
    // 凭据类字段（username/password/apiKey）不在剥离范围
    expect(pushed.emby.mediaServers[0].name).toBe('Srv1');
    // 115 会话保留（用户 10-15 定案：跨设备云同步）
    expect(pushed.drive115.v2AccessToken).toBe('v2-at-keep');
    // 本地 storage 原样未动
    expect((stub.getStore().settings as any).emby.mediaServers[0].accessToken).toBe('AT-local');
  });

  it('enqueueStorageItemChange：增量 push 的 settings 入队前剥离会话', async () => {
    makeChromeStub({
      cloud_sync_pending_v1: [],
      cloud_sync_session_v1: { accessToken: 'sess-token-for-wiring' },
    });
    const { enqueueStorageItemChange } = await import('./enqueueLocalChange');
    await enqueueStorageItemChange('settings', {
      emby: { mediaServers: [{ ...server({ id: 's' }), ...LOCAL_SESSION }] },
      drive115: { v2AccessToken: 'v2-at-keep' },
    });

    const { listCloudPending } = await import('./chromePendingStore');
    const pending = (await listCloudPending()) as any[];
    const e = pending.find((p) => p.type === 'storage_item' && p.id === 'settings');
    expect(e).toBeTruthy();
    expect(e.payload.value.emby.mediaServers[0].accessToken).toBeUndefined();
    expect(e.payload.value.drive115.v2AccessToken).toBe('v2-at-keep');
  });

  it('saveSettings：条目级 updatedAt 打戳 + 与既有墓碑钩点共存（fail-open）', async () => {
    const stub = makeChromeStub({
      settings: { emby: { mediaServers: [server({ id: 'a', name: 'A' })] } },
    });
    const { saveSettings } = await import('../../utils/storage');

    // 新增 b（打戳），a 未变更且无原戳（不加键）
    await saveSettings({ emby: { mediaServers: [server({ id: 'a', name: 'A' }), server({ id: 'b', name: 'B' })] } } as any);
    let saved = (stub.getStore().settings as any).emby.mediaServers;
    const byId = (arr: Array<Record<string, any>>) => Object.fromEntries(arr.map((s: any) => [s.id, s]));
    let m = byId(saved);
    expect(typeof m.b.updatedAt).toBe('number');
    expect('updatedAt' in m.a).toBe(false);

    // a 改名（打戳），b 删除（墓碑钩点记录 b）
    await saveSettings({ emby: { mediaServers: [server({ id: 'a', name: 'A2' })] } } as any);
    saved = (stub.getStore().settings as any).emby.mediaServers;
    m = byId(saved);
    expect(typeof m.a.updatedAt).toBe('number');
    expect((stub.getStore().settings as any).emby.deletedServerIds).toContain('b');
  });
});
