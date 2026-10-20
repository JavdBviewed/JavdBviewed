/**
 * @file javdbSessionVault.test.ts
 * @description 10-19 线 2：javdb 会话 cookie 采集 + 云端 vault 桥接（A.2）单测
 *
 * C1 互操作向量（与线 1 /tmp/c1vec/main.go 定案一致，逐字锁）：
 * salt="javdb-session-v1"（16B）/ PBKDF2-HMAC-SHA512 / 210000 / 32B key
 * AES-256-GCM / 12B nonce / ct=base64(nonce||ct||tag)
 * 日志纪律：只断言布尔/计数/原因码（凭据零回显，不进日志）
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION } from '@javdb/sync-client';
import type { VaultItem } from '@javdb/sync-protocol';

const enqueueMocks = vi.hoisted(() => ({
  scheduleEnqueue: vi.fn(),
}));
vi.mock('./enqueueLocalChange', () => ({ scheduleEnqueue: enqueueMocks.scheduleEnqueue }));

import {
  JAVDB_MIRROR_HOSTS,
  JAVDB_SESSION_COOKIE_WHITELIST,
  JAVDB_SESSION_PBKDF2_ITERATIONS,
  JAVDB_SESSION_SALT,
  JAVDB_SESSION_VAULT_ITEM_ID,
  JAVDB_SESSION_VAULT_KIND,
  collectJavdbSessionCookies,
  decryptJavdbSessionCiphertext,
  deleteJavdbSessionVault,
  deriveJavdbSessionBits,
  encryptJavdbSessionPayload,
  fetchJavdbSessionVaultStatus,
  filterJavdbSessionCookies,
  hostMatchesJavdbFamily,
  initJavdbSessionCookieWatcher,
  pushJavdbSessionVault,
  pushJavdbSessionVaultIfEnabled,
  readCloudScanConfig,
} from './javdbSessionVault';

type CookieStub = { name: string; value?: string; domain?: string; hostOnly?: boolean };

function makeChromeStub(opts: { cookies?: CookieStub[]; config?: unknown; cloudSettings?: Record<string, unknown> } = {}) {
  const store: Record<string, unknown> = {};
  if (opts.config !== undefined) store.new_works_config = opts.config;
  if (opts.cloudSettings) store.cloud_sync_settings_v1 = opts.cloudSettings;
  const cookieStore: CookieStub[] = (opts.cookies ?? []).map((c) => ({ ...c }));
  const listeners: Array<(change: unknown) => void> = [];
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn((keys: unknown, cb: (items: Record<string, unknown>) => void) => {
          queueMicrotask(() => {
            const out: Record<string, unknown> = {};
            const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(store);
            for (const k of list) if (store[k] !== undefined) out[k] = structuredClone(store[k]);
            cb(out);
          });
        }),
        set: vi.fn((items: Record<string, unknown>, cb?: () => void) => {
          Object.assign(store, structuredClone(items));
          queueMicrotask(() => cb?.());
        }),
        remove: vi.fn((_k: unknown, cb?: () => void) => {
          queueMicrotask(() => cb?.());
        }),
      },
    },
    cookies: {
      getAll: vi.fn((_q: unknown, cb: (cookies: CookieStub[]) => void) => {
        queueMicrotask(() => cb(cookieStore.map((c) => ({ ...c }))));
      }),
      onChanged: {
        addListener: vi.fn((l: (change: unknown) => void) => {
          listeners.push(l);
        }),
        removeListener: vi.fn((l: (change: unknown) => void) => {
          const i = listeners.indexOf(l);
          if (i >= 0) listeners.splice(i, 1);
        }),
      },
    },
    runtime: { id: 'test-extension-id', lastError: undefined },
  });
  return {
    emitCookieChange: (change: unknown) => {
      for (const l of [...listeners]) l(change);
    },
    getStore: () => store,
    listenerCount: () => listeners.length,
  };
}

function makeVaultApi(overrides: Record<string, unknown> = {}) {
  return {
    listVault: vi.fn(async () => ({ protocolVersion: PROTOCOL_VERSION, items: [] as VaultItem[] })),
    putVault: vi.fn(async () => ({})),
    deleteVault: vi.fn(async () => undefined),
    ...overrides,
  };
}

const CLOUD_SETTINGS = {
  baseUrl: 'http://127.0.0.1:18091',
  deviceLabel: 't',
  accountIdentifier: 'admin',
  accountPassword: 'vector-test-pw',
  deviceId: 'dev-1',
  updatedAt: 1,
};

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('javdbSessionVault C1 加密互操作', () => {
  it('锁值常量与线 1 一致（salt/迭代/白名单/域家族/vault id+kind）', () => {
    expect(JAVDB_SESSION_SALT).toBe('javdb-session-v1');
    expect(JAVDB_SESSION_PBKDF2_ITERATIONS).toBe(210000);
    expect(JAVDB_SESSION_COOKIE_WHITELIST).toEqual(['_jdb_session', 'cf_clearance', 'over18']);
    expect(JAVDB_MIRROR_HOSTS).toEqual(['javdb.com', 'javdb570.com', 'javdb575.com', 'javbus.com']);
    expect(JAVDB_SESSION_VAULT_ITEM_ID).toBe('javdb-session');
    expect(JAVDB_SESSION_VAULT_KIND).toBe('javdb-session');
  });

  it('PBKDF2 密钥 hex 与线 1 Go 向量逐字一致', async () => {
    const bits = await deriveJavdbSessionBits('vector-test-pw');
    expect(bits.byteLength).toBe(32);
    expect(toHex(bits)).toBe('6ff2f42eb4db26af734f39b73fd49a60577e52a511d16f61692d9d7b615f53b0');
  });

  it('固定 nonce 密文 b64 与线 1 Go 向量逐字一致 + 解密往返', async () => {
    const payload = { cookies: { auth_token: 'abc123', locale: 'zh' }, obtainedAt: 1760800000000 };
    const nonce = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const b64 = await encryptJavdbSessionPayload(payload, 'vector-test-pw', nonce);
    expect(b64).toBe(
      'AQIDBAUGBwgJCgsMp0K4z4fVut4pv/epKB/fHdgVK9dZTfJEAr7u8pkY+o1xUi9068FwLNlPpFZT7PynSwFBtiY3MflsLNWkAvc64KPmEPfz9u5TW63qDhNRL1aGlRus+6lSgjVpwbs=',
    );
    const back = await decryptJavdbSessionCiphertext(b64, 'vector-test-pw');
    expect(back).toEqual(payload);
  });

  it('错误密码解密必败（GCM 认证性）', async () => {
    const b64 = await encryptJavdbSessionPayload(
      { cookies: { a: 'b' }, obtainedAt: 1 },
      'vector-test-pw',
    );
    await expect(decryptJavdbSessionCiphertext(b64, 'wrong-pw')).rejects.toThrow();
  });
});

describe('javdbSessionVault cookie 过滤（纯函数）', () => {
  it('白名单 3 项 + javdb 域家族取交集；label host=首个命中域', () => {
    const snap = filterJavdbSessionCookies([
      { name: '_jdb_session', value: 'S1', domain: '.javdb570.com' },
      { name: 'cf_clearance', value: 'CF1', domain: 'javdb570.com' },
      { name: 'over18', value: '1', domain: '.javdb.com' },
      { name: 'list_mode', value: 'all', domain: '.javdb570.com' },
      { name: 'theme', value: 'dark', domain: '.javdb570.com' },
      { name: '_jdb_session', value: 'OTHER', domain: '.evil.com' },
    ]);
    expect(snap.cookies).toEqual({ _jdb_session: 'S1', cf_clearance: 'CF1', over18: '1' });
    expect(snap.host).toBe('javdb570.com');
  });

  it('子域命中（sub.javdb.com）与仿冒后缀拒绝（javdb.com.evil.com）', () => {
    expect(hostMatchesJavdbFamily('sub.javdb.com')).toBe(true);
    expect(hostMatchesJavdbFamily('javdb570.com')).toBe(true);
    expect(hostMatchesJavdbFamily('javdb.com.evil.com')).toBe(false);
    expect(hostMatchesJavdbFamily('evil.com')).toBe(false);
  });

  it('空输入 → 空子集 + host null', () => {
    const snap = filterJavdbSessionCookies([]);
    expect(snap.cookies).toEqual({});
    expect(snap.host).toBeNull();
  });
});

describe('javdbSessionVault 配置读取（new_works_config.cloudScan）', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('缺省 = 关/20/10', async () => {
    makeChromeStub({});
    expect(await readCloudScanConfig()).toEqual({ enabled: false, batchSize: 20, intervalMinutes: 10 });
  });

  it('显式值透传', async () => {
    makeChromeStub({ config: { cloudScan: { enabled: true, batchSize: 50, intervalMinutes: 30 } } });
    expect(await readCloudScanConfig()).toEqual({ enabled: true, batchSize: 50, intervalMinutes: 30 });
  });

  it('越界夹取（batchSize 1-100 / intervalMinutes 1-1440）', async () => {
    makeChromeStub({ config: { cloudScan: { batchSize: 999, intervalMinutes: 0 } } });
    expect(await readCloudScanConfig()).toEqual({ enabled: false, batchSize: 100, intervalMinutes: 1 });
  });

  it('垃圾形状 → 缺省（不抛）', async () => {
    makeChromeStub({ config: 'garbage' });
    expect(await readCloudScanConfig()).toEqual({ enabled: false, batchSize: 20, intervalMinutes: 10 });
  });
});

describe('javdbSessionVault 推送门控', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('无已存云密码 → no-credentials（不触 vault api）', async () => {
    makeChromeStub({ cloudSettings: { ...CLOUD_SETTINGS, accountPassword: '' }, cookies: [{ name: '_jdb_session', value: 'S', domain: '.javdb570.com' }] });
    const api = makeVaultApi();
    const r = await pushJavdbSessionVault('test', { vaultApi: api });
    expect(r).toEqual({ ok: false, reason: 'no-credentials' });
    expect(api.putVault).not.toHaveBeenCalled();
  });

  it('白名单 cookie 为零 → no-cookies（不触 vault api）', async () => {
    makeChromeStub({ cloudSettings: CLOUD_SETTINGS, cookies: [{ name: 'theme', value: 'dark', domain: '.javdb570.com' }] });
    const api = makeVaultApi();
    const r = await pushJavdbSessionVault('test', { vaultApi: api });
    expect(r).toEqual({ ok: false, reason: 'no-cookies' });
    expect(api.putVault).not.toHaveBeenCalled();
  });

  it('成功路径：vault 项 id/kind/label=采集 host，密文可解密回原 payload，protocolVersion 在位', async () => {
    makeChromeStub({
      cloudSettings: CLOUD_SETTINGS,
      cookies: [{ name: '_jdb_session', value: 'S-live', domain: '.javdb570.com' }],
    });
    const api = makeVaultApi();
    const r = await pushJavdbSessionVault('manual-sync', { vaultApi: api });
    expect(r.ok).toBe(true);
    expect(api.putVault).toHaveBeenCalledTimes(1);
    const [id, body] = api.putVault.mock.calls[0] as unknown as [string, { protocolVersion: number; item: VaultItem }];
    expect(id).toBe('javdb-session');
    expect(body.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(body.item.id).toBe('javdb-session');
    expect(body.item.kind).toBe('javdb-session');
    expect(body.item.label).toBe('javdb570.com');
    expect(body.item.revision).toBe(1);
    expect(body.item.updatedByDeviceId).toBe('dev-1');
    expect(typeof body.item.updatedAt).toBe('number');
    const plain = await decryptJavdbSessionCiphertext(body.item.ciphertext, CLOUD_SETTINGS.accountPassword);
    expect(plain.cookies).toEqual({ _jdb_session: 'S-live' });
    expect(typeof plain.obtainedAt).toBe('number');
  });

  it('putVault 失败 → push-failed（不外抛）', async () => {
    makeChromeStub({
      cloudSettings: CLOUD_SETTINGS,
      cookies: [{ name: '_jdb_session', value: 'S', domain: '.javdb570.com' }],
    });
    const api = makeVaultApi({ putVault: vi.fn(async () => { throw new Error('boom'); }) });
    const r = await pushJavdbSessionVault('manual-sync', { vaultApi: api });
    expect(r).toEqual({ ok: false, reason: 'push-failed' });
  });

  it('collectJavdbSessionCookies 走 chrome.cookies.getAll（回调形态）', async () => {
    const stub = makeChromeStub({ cookies: [{ name: 'over18', value: '1', domain: 'javbus.com' }] });
    const snap = await collectJavdbSessionCookies();
    expect(snap.cookies).toEqual({ over18: '1' });
    expect(snap.host).toBe('javbus.com');
    expect(stub.getStore()).toBeDefined();
  });
});

describe('javdbSessionVault push revision read-then-bump（云侧 PutVault 静默 no-op 守卫）', () => {
  afterEach(() => vi.unstubAllGlobals());

  const COOKIES = [{ name: '_jdb_session', value: 'S', domain: '.javdb570.com' }];

  function putRevision(api: ReturnType<typeof makeVaultApi>): number {
    const [, body] = api.putVault.mock.calls[0] as unknown as [string, { item: VaultItem }];
    return body.item.revision;
  }

  it('既有项 rev=3 → PUT 正序 rev=4（18091 盘上场景复现）', async () => {
    makeChromeStub({ cloudSettings: CLOUD_SETTINGS, cookies: COOKIES });
    const api = makeVaultApi({
      listVault: vi.fn(async () => ({ protocolVersion: PROTOCOL_VERSION, items: [{ id: 'javdb-session', kind: 'javdb-session', ciphertext: 'stale-ct', revision: 3, updatedAt: 1 }] })),
    });
    const r = await pushJavdbSessionVault('manual-sync', { vaultApi: api });
    expect(r.ok).toBe(true);
    expect(putRevision(api)).toBe(4);
  });

  it('墓碑项（deletedAt 在位）同样正序 bump（移除后重设登录态=期望复活）', async () => {
    makeChromeStub({ cloudSettings: CLOUD_SETTINGS, cookies: COOKIES });
    const api = makeVaultApi({
      listVault: vi.fn(async () => ({ protocolVersion: PROTOCOL_VERSION, items: [{ id: 'javdb-session', kind: 'javdb-session', ciphertext: 'stale-ct', revision: 5, updatedAt: 1, deletedAt: 2 }] })),
    });
    const r = await pushJavdbSessionVault('manual-sync', { vaultApi: api });
    expect(r.ok).toBe(true);
    expect(putRevision(api)).toBe(6);
  });

  it('listVault 读失败 → fallback rev=1 仍推送（不抛不跳过）', async () => {
    makeChromeStub({ cloudSettings: CLOUD_SETTINGS, cookies: COOKIES });
    const api = makeVaultApi({
      listVault: vi.fn(async () => {
        throw new Error('net');
      }),
    });
    const r = await pushJavdbSessionVault('manual-sync', { vaultApi: api });
    expect(r.ok).toBe(true);
    expect(putRevision(api)).toBe(1);
  });

  it('既有项脏形状 rev=0 → fallback 1', async () => {
    makeChromeStub({ cloudSettings: CLOUD_SETTINGS, cookies: COOKIES });
    const api = makeVaultApi({
      listVault: vi.fn(async () => ({ protocolVersion: PROTOCOL_VERSION, items: [{ id: 'javdb-session', kind: 'javdb-session', ciphertext: 'stale-ct', revision: 0, updatedAt: 1 }] })),
    });
    const r = await pushJavdbSessionVault('manual-sync', { vaultApi: api });
    expect(r.ok).toBe(true);
    expect(putRevision(api)).toBe(1);
  });
});

describe('javdbSessionVault vault 状态与删除', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('present / absent（无项）/ absent（墓碑）/ error 四态', async () => {
    const item = { id: 'javdb-session', kind: 'javdb-session', ciphertext: 'x', revision: 1, updatedAt: 1 };
    makeChromeStub({});
    let api = makeVaultApi({ listVault: vi.fn(async () => ({ protocolVersion: PROTOCOL_VERSION, items: [item] })) });
    expect(await fetchJavdbSessionVaultStatus({ vaultApi: api })).toBe('present');

    api = makeVaultApi({ listVault: vi.fn(async () => ({ protocolVersion: PROTOCOL_VERSION, items: [] })) });
    expect(await fetchJavdbSessionVaultStatus({ vaultApi: api })).toBe('absent');

    api = makeVaultApi({ listVault: vi.fn(async () => ({ protocolVersion: PROTOCOL_VERSION, items: [{ ...item, deletedAt: 2 }] })) });
    expect(await fetchJavdbSessionVaultStatus({ vaultApi: api })).toBe('absent');

    api = makeVaultApi({ listVault: vi.fn(async () => { throw new Error('net'); }) });
    expect(await fetchJavdbSessionVaultStatus({ vaultApi: api })).toBe('error');
  });

  it('删除成功/失败', async () => {
    makeChromeStub({});
    const api = makeVaultApi();
    expect(await deleteJavdbSessionVault({ vaultApi: api })).toEqual({ ok: true });
    expect(api.deleteVault).toHaveBeenCalledWith('javdb-session');
    const bad = makeVaultApi({ deleteVault: vi.fn(async () => { throw new Error('net'); }) });
    expect(await deleteJavdbSessionVault({ vaultApi: bad })).toEqual({ ok: false, reason: 'delete-failed' });
  });
});

describe('javdbSessionVault cookie watcher（background 接线）', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  const enabledConfig = { cloudScan: { enabled: true, batchSize: 20, intervalMinutes: 10 } };

  async function emitAndSettle(change: unknown, stub: ReturnType<typeof makeChromeStub>): Promise<void> {
    stub.emitCookieChange(change);
    await flush();
  }

  it('未开启云扫描 → 白名单 cookie 变更零入队（零自动推送）', async () => {
    const stub = makeChromeStub({ config: {}, cloudSettings: CLOUD_SETTINGS, cookies: [] });
    initJavdbSessionCookieWatcher();
    await emitAndSettle({ cookie: { name: '_jdb_session', domain: '.javdb570.com', value: 'x' }, removed: false }, stub);
    expect(enqueueMocks.scheduleEnqueue).not.toHaveBeenCalled();
  });

  it('开启但无云密码 → 零入队', async () => {
    const stub = makeChromeStub({ config: enabledConfig, cloudSettings: { ...CLOUD_SETTINGS, accountPassword: '' }, cookies: [] });
    initJavdbSessionCookieWatcher();
    await emitAndSettle({ cookie: { name: '_jdb_session', domain: '.javdb570.com', value: 'x' }, removed: false }, stub);
    expect(enqueueMocks.scheduleEnqueue).not.toHaveBeenCalled();
  });

  it('开启+有密码：白名单 cookie 于 javdb 域变更 → 入队一次（随既有同步推送）', async () => {
    const stub = makeChromeStub({ config: enabledConfig, cloudSettings: CLOUD_SETTINGS, cookies: [] });
    initJavdbSessionCookieWatcher();
    await emitAndSettle({ cookie: { name: 'cf_clearance', domain: 'javdb570.com', value: 'y' }, removed: false }, stub);
    expect(enqueueMocks.scheduleEnqueue).toHaveBeenCalledTimes(1);
    expect(typeof enqueueMocks.scheduleEnqueue.mock.calls[0][0]).toBe('function');
  });

  it('非白名单名 / 非 javdb 域 / removed → 均不入队', async () => {
    const stub = makeChromeStub({ config: enabledConfig, cloudSettings: CLOUD_SETTINGS, cookies: [] });
    initJavdbSessionCookieWatcher();
    await emitAndSettle({ cookie: { name: 'list_mode', domain: '.javdb570.com', value: 'z' }, removed: false }, stub);
    await emitAndSettle({ cookie: { name: '_jdb_session', domain: '.evil.com', value: 'z' }, removed: false }, stub);
    await emitAndSettle({ cookie: { name: '_jdb_session', domain: '.javdb570.com', value: 'z' }, removed: true }, stub);
    expect(enqueueMocks.scheduleEnqueue).not.toHaveBeenCalled();
  });

  it('init 幂等（重复调用不重复挂监听）', async () => {
    const stub = makeChromeStub({ config: enabledConfig, cloudSettings: CLOUD_SETTINGS, cookies: [] });
    initJavdbSessionCookieWatcher();
    initJavdbSessionCookieWatcher();
    expect(stub.listenerCount()).toBe(1);
  });

  it('pushJavdbSessionVaultIfEnabled：未开启零副作用且永不抛', async () => {
    makeChromeStub({ config: {} });
    await expect(pushJavdbSessionVaultIfEnabled('toggle-on')).resolves.toBeUndefined();
    expect(enqueueMocks.scheduleEnqueue).not.toHaveBeenCalled();
  });
});
