/**
 * @file libraryReconcileCloudWiring.test.ts
 * @description 云 pull-apply emby 设置落盘后的索引即时对账接线（10-26-emby-index-reconcile）：
 * 同 id 改地址 → 孤儿条目当场清除 + 触发一次后台同步；回声（无配置变化）不触发
 * @module features/cloudSync
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

const handlersMock = vi.hoisted(() => ({
  handleEmbyLibrarySync: vi.fn((message: unknown, cb?: (response: unknown) => void) => {
    cb?.({ success: true, synced: 1, failed: 0 });
  }),
}));

vi.mock('../../platform/storage/indexedDb', () => dbSpies);
vi.mock('../embyLibrary/background/handlers', () => handlersMock);

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

const OLD_URL = 'http://192.168.1.66:18096';
const NEW_URL = 'http://47.108.74.231:18096';

function server(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'srv-1',
    type: 'emby',
    name: 'Emby-home',
    url: OLD_URL,
    enabled: true,
    apiKey: 'KEY-1',
    ...over,
  };
}

function settingsEntity(value: unknown): Record<string, unknown> {
  return { type: 'storage_item', id: 'settings', payload: { key: 'settings', value }, updatedAt: 999 };
}

function initialStore(): Record<string, unknown> {
  return {
    settings: {
      emby: { enabled: true, libraryEnabled: true, mediaServers: [server()] },
    },
    emby_library_state: {
      entries: {
        'AAA-001': [
          { serverType: 'emby', serverName: 'Emby-home', serverUrl: OLD_URL, itemId: 'item-1', itemName: 'AAA-001' },
        ],
      },
      updatedAt: 1000,
    },
  };
}

async function flushFireAndForget(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('云 pull-apply emby 设置 → 索引即时对账', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('同 id 改地址：旧键条目当场清除 + 触发一次后台 manual 同步', async () => {
    const stub = makeChromeStub(initialStore());
    const { createExtensionEntityStore } = await import('./extensionEntityStore');
    await createExtensionEntityStore().applyRemote([
      settingsEntity({ emby: { enabled: true, libraryEnabled: true, mediaServers: [server({ url: NEW_URL })] } }),
    ]);
    await flushFireAndForget();

    const merged = stub.getStore().settings as { emby: { mediaServers: Array<{ url: string }> } };
    expect(merged.emby.mediaServers[0].url).toBe(NEW_URL);
    const state = stub.getStore().emby_library_state as { entries: Record<string, unknown[]> };
    expect(state.entries).toEqual({});
    expect(handlersMock.handleEmbyLibrarySync).toHaveBeenCalledTimes(1);
    expect(handlersMock.handleEmbyLibrarySync.mock.calls[0]?.[0]).toMatchObject({ manual: true });
  });

  it('回声（远端与本地配置一致）：不剪枝、不触发同步', async () => {
    const stub = makeChromeStub(initialStore());
    const { createExtensionEntityStore } = await import('./extensionEntityStore');
    await createExtensionEntityStore().applyRemote([
      settingsEntity({ emby: { enabled: true, libraryEnabled: true, mediaServers: [server()] } }),
    ]);
    await flushFireAndForget();

    const state = stub.getStore().emby_library_state as { entries: Record<string, unknown[]> };
    expect(state.entries['AAA-001']).toHaveLength(1);
    expect(handlersMock.handleEmbyLibrarySync).not.toHaveBeenCalled();
  });

  it('改地址但入库功能关闭：剪枝但不触发同步', async () => {
    const stub = makeChromeStub(initialStore());
    const { createExtensionEntityStore } = await import('./extensionEntityStore');
    await createExtensionEntityStore().applyRemote([
      settingsEntity({ emby: { enabled: true, libraryEnabled: false, mediaServers: [server({ url: NEW_URL })] } }),
    ]);
    await flushFireAndForget();

    const state = stub.getStore().emby_library_state as { entries: Record<string, unknown[]> };
    expect(state.entries).toEqual({});
    expect(handlersMock.handleEmbyLibrarySync).not.toHaveBeenCalled();
  });
});
