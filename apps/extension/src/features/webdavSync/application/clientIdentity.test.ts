import { describe, expect, it, vi } from 'vitest';
import { ensureWebDAVClientIdentity, type WebDAVSettingsAdapter } from './clientIdentity';
import { applyEmbyDeletedServerTombstones } from '../../../shared/embyDeletedServers';

/**
 * 竞态场景背景：SW 启动期 ensureWebDAVClientIdentity 做读-改-写全量 settings，
 * 读与写之间窗口内落盘的并发写入（测试 seed / 用户操作）会被旧读值覆盖。
 * 修复后：写回只基于“写回前重读的原始值 + 自身 delta”，绝不写全默认值实例。
 */

interface InMemoryStore {
  raw: Record<string, any> | null;
  rawReads: number;
  rawSequence: Array<Record<string, any> | null>;
  saved: Array<Record<string, any>>;
}

function makeAdapter(store: InMemoryStore): WebDAVSettingsAdapter & { getRawCalls: () => number } {
  const DEFAULTS: Record<string, any> = {
    videoEnhancement: { enabled: true },
    webdav: {},
  };
  return {
    getSettings: async () => ({ ...DEFAULTS, ...store.raw, webdav: { ...(store.raw?.webdav || {}) } }),
    saveSettings: async (settings: any) => {
      store.saved.push(JSON.parse(JSON.stringify(settings)));
      store.raw = settings;
    },
    readRawSettings: async () => {
      store.rawReads += 1;
      if (store.rawSequence.length > 0 && store.rawReads <= store.rawSequence.length) {
        // leveldb 提交单调性：脚本值可见即 commit 已落盘，提交进 store 供后续读
        store.raw = store.rawSequence[store.rawReads - 1];
        return store.raw;
      }
      return store.raw;
    },
    getRawCalls: () => store.rawReads,
  };
}

describe('ensureWebDAVClientIdentity 竞态安全', () => {
  it('并发 seed 落盘在重读窗口内时，seed 内容被保留而非被全默认值覆盖', async () => {
    const store: InMemoryStore = { raw: null, rawReads: 0, rawSequence: [null, { videoEnhancement: { enabled: false } }], saved: [] };
    const adapter = makeAdapter(store);

    await ensureWebDAVClientIdentity(adapter);

    expect(store.saved).toHaveLength(1);
    const saved = store.saved[0];
    // seed 的内容必须保留（旧实现会写 videoEnhancement.enabled=true 的全默认实例）
    expect(saved.videoEnhancement).toEqual({ enabled: false });
    // 身份字段补全
    expect(saved.webdav.clientId).toBeTruthy();
    expect(saved.webdav.clientInstalledAt).toBeTruthy();
    expect(saved.webdav.browserName).toBeTruthy();
    expect(saved.webdav.deviceLabel).toBeTruthy();
  });

  it('fresh profile 下只写 partial blob（webdav 身份节），不写全默认值实例', async () => {
    const store: InMemoryStore = { raw: null, rawReads: 0, rawSequence: [], saved: [] };
    const adapter = makeAdapter(store);

    await ensureWebDAVClientIdentity(adapter);

    expect(store.saved).toHaveLength(1);
    const saved = store.saved[0];
    expect(Object.keys(saved)).toEqual(['webdav']);
    expect(saved.webdav.clientId).toBeTruthy();
  });

  it('身份字段齐全时不写回，直接返回 merged 视图', async () => {
    const store: InMemoryStore = {
      raw: { webdav: { clientId: 'existing-id', clientInstalledAt: '2026-01-01T00:00:00.000Z', browserName: 'Chrome', deviceLabel: 'Chrome' } },
      rawReads: 0,
      rawSequence: [],
      saved: [],
    };
    const adapter = makeAdapter(store);

    const result = await ensureWebDAVClientIdentity(adapter);

    expect(store.saved).toHaveLength(0);
    expect(result.webdav.clientId).toBe('existing-id');
  });

  it('部分身份已存在时只补缺失字段，不覆盖已有值', async () => {
    const store: InMemoryStore = { raw: { webdav: { clientId: 'existing-id' } }, rawReads: 0, rawSequence: [], saved: [] };
    const adapter = makeAdapter(store);

    await ensureWebDAVClientIdentity(adapter);

    expect(store.saved).toHaveLength(1);
    expect(store.saved[0].webdav.clientId).toBe('existing-id');
    expect(store.saved[0].webdav.browserName).toBeTruthy();
  });

  it('adapter 未提供 readRawSettings 时保持旧行为（merged 视图全量写回）', async () => {
    const saved: Array<Record<string, any>> = [];
    const legacyAdapter: WebDAVSettingsAdapter = {
      getSettings: async () => ({ videoEnhancement: { enabled: true }, webdav: {} }),
      saveSettings: async (settings: any) => { saved.push(settings); },
    };

    await ensureWebDAVClientIdentity(legacyAdapter);

    expect(saved).toHaveLength(1);
    // 旧契约：全量 merged 视图 + 身份
    expect(saved[0].videoEnhancement).toEqual({ enabled: true });
    expect(saved[0].webdav.clientId).toBeTruthy();
  });

  it('readRawSettings 抛错时回退旧行为，不阻断身份初始化', async () => {
    const saved: Array<Record<string, any>> = [];
    const adapter: WebDAVSettingsAdapter = {
      getSettings: async () => ({ videoEnhancement: { enabled: false }, webdav: {} }),
      saveSettings: async (settings: any) => { saved.push(settings); },
      readRawSettings: async () => { throw new Error('boom'); },
    };

    await ensureWebDAVClientIdentity(adapter);

    expect(saved).toHaveLength(1);
    expect(saved[0].webdav.clientId).toBeTruthy();
  });

  it('写回返回值包含补全后的身份字段', async () => {
    const store: InMemoryStore = { raw: null, rawReads: 0, rawSequence: [], saved: [] };
    const adapter = makeAdapter(store);

    const result = await ensureWebDAVClientIdentity(adapter);

    expect(result.webdav.clientId).toBeTruthy();
    expect(result.webdav.browserName).toBeTruthy();
  });

  /**
   * C1 根因锁（10-21）：seed 的 set 先发出但 leveldb commit 可晚于 identity 的读——
   * call2 时先提交 seed 再返回提交前值（null）。修复后写入必须保留 seed 节，
   * 且钩子（prev=seed vs next 含 emby 节）不得误打 emby.deletedServerIds 墓碑。
   */
  it('并发 seed（display+emby）commit 晚于首读时：节保留且不误打 emby 墓碑（钩子负锁）', async () => {
    const seed = {
      display: { hideInMediaLibrary: true },
      emby: { mediaServers: [{ id: 'srv-w', name: 'W-Srv', url: 'http://10.255.250.1:18096', enabled: true }] },
    };
    const store: InMemoryStore = { raw: null, rawReads: 0, rawSequence: [], saved: [] };
    const adapter: WebDAVSettingsAdapter = {
      getSettings: async () => ({ videoEnhancement: { enabled: true }, webdav: { ...(store.raw?.webdav || {}) } }),
      readRawSettings: async () => {
        store.rawReads += 1;
        if (store.rawReads === 2) {
          // 模拟 storage commit 抖动：读发生前一刻 seed 才落盘，本次读仍看不到
          store.raw = JSON.parse(JSON.stringify(seed));
          return null;
        }
        return store.raw;
      },
      // 复刻真实共享 saveSettings 的墓碑钩子：prev=写时点存储值（戳钩子不触及本锁断言面，不模拟）
      saveSettings: async (settings: any) => {
        const prev = store.raw === null ? undefined : JSON.parse(JSON.stringify(store.raw));
        const next = JSON.parse(JSON.stringify(settings));
        applyEmbyDeletedServerTombstones(prev, next);
        store.raw = next;
        store.saved.push(next);
      },
    };

    const result = await ensureWebDAVClientIdentity(adapter);

    expect(store.saved).toHaveLength(1);
    const saved = store.saved[0];
    // 并发节必须保留（旧实现写 {webdav:identity} 整包，display/emby 被抹）
    expect(saved.display).toEqual({ hideInMediaLibrary: true });
    expect(saved.emby.mediaServers).toEqual([{ id: 'srv-w', name: 'W-Srv', url: 'http://10.255.250.1:18096', enabled: true }]);
    // 墓碑负锁：旧实现 next 无 emby 节，钩子对比 prev=seed 会追加 deletedServerIds
    expect(saved.emby.deletedServerIds).toBeUndefined();
    // 身份字段补全 + 返回契约（merged 视图含补全身份）
    expect(saved.webdav.clientId).toBeTruthy();
    expect(result.webdav.clientId).toBeTruthy();
  });

  /**
   * C1 零写锁（10-21）：并发窗口内身份字段已完整落盘时，不得再发起写
   * （旧实现 freshRaw 命中后仍以首读 delta 覆盖写回，冗余且覆盖并发新值）。
   */
  it('并发窗内身份字段已落盘时：零写，返回 merged 视图且不覆盖并发值', async () => {
    const identity = {
      clientId: 'seed-client-id',
      clientInstalledAt: '2026-01-01T00:00:00.000Z',
      browserName: 'Chrome',
      deviceLabel: 'Chrome',
    };
    const store: InMemoryStore = {
      raw: { webdav: { ...identity } },
      rawReads: 0,
      rawSequence: [null, { webdav: { ...identity } }],
      saved: [],
    };
    const adapter = makeAdapter(store);

    const result = await ensureWebDAVClientIdentity(adapter);

    expect(store.saved).toHaveLength(0);
    expect(result.webdav.clientId).toBe('seed-client-id');
  });

});
