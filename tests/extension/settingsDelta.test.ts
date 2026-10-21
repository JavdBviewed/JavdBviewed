/**
 * @file settingsDelta.test.ts
 * @description settings 分节 delta 并发安全写原语（S1-3）
 */
import { describe, expect, it, vi } from 'vitest';
import { readRawSettingsOrUndefined, saveSettingsSectionDelta, saveSettingsTopLevelDelta } from '../../apps/extension/src/utils/settingsDelta';

function makeWriter(overrides: {
  raw?: () => Promise<any>;
  rawError?: boolean;
  merged?: () => Promise<any>;
  saved?: any[];
} = {}) {
  const saved: any[] = overrides.saved || [];
  return {
    writer: {
      readRawSettings: overrides.raw === undefined
        ? (overrides.rawError ? (() => { throw new Error('storage down'); }) : undefined)
        : overrides.raw,
      getMergedSettings: overrides.merged,
      saveSettings: vi.fn(async (s: any) => { saved.push(s); }),
    },
    saved,
  };
}

describe('readRawSettingsOrUndefined', () => {
  it('读取器未提供时返回 undefined', async () => {
    expect(await readRawSettingsOrUndefined()).toBeUndefined();
    expect(await readRawSettingsOrUndefined(undefined)).toBeUndefined();
  });

  it('读取器抛错时返回 undefined（回退旧行为）', async () => {
    expect(await readRawSettingsOrUndefined(() => Promise.reject(new Error('x')))).toBeUndefined();
  });

  it('读取器返回 null/数组时返回空对象而非 undefined', async () => {
    expect(await readRawSettingsOrUndefined(async () => null)).toEqual({});
    expect(await readRawSettingsOrUndefined(async () => [1, 2] as any)).toEqual({});
  });
});

describe('saveSettingsSectionDelta', () => {
  it('并发 seed 在重读窗口内落盘时，其他节被保留，delta 基于最新节合并', async () => {
    const { writer, saved } = makeWriter({
      raw: async () => ({
        webdav: { clientId: 'seed-client' },
        drive115: { v2AccessToken: 'latest-at', v2MinRefreshIntervalMin: 90 },
      }),
    });
    const stale = { drive115: { v2AccessToken: 'stale-at' }, display: { theme: 'dark' } };

    const written = await saveSettingsSectionDelta(writer, stale, 'drive115', (latestDrv) => ({
      v2AccessToken: 'new-at',
      v2Extra: Number(latestDrv.v2MinRefreshIntervalMin) * 2,
    }));

    expect(saved).toHaveLength(1);
    // 并发写入的其他节保留
    expect(written.webdav).toEqual({ clientId: 'seed-client' });
    // 陈旧快照里独有的其他节（display）不被写入
    expect(written.display).toBeUndefined();
    // 最新节字段保留 + 自身 delta 生效
    expect(written.drive115.v2AccessToken).toBe('new-at');
    expect(written.drive115.v2MinRefreshIntervalMin).toBe(90);
    expect(written.drive115.v2Extra).toBe(180);
    expect(written).toBe(saved[0]);
  });

  it('原始读未提供时回退 getMergedSettings（写前新鲜 merged 重读）', async () => {
    const { writer, saved } = makeWriter({
      merged: async () => ({ webdav: { url: 'https://dav.example' }, other: { kept: true } }),
    });

    await saveSettingsSectionDelta(writer, null, 'webdav', () => ({ clientLastSyncAt: 't' }));

    expect(saved).toHaveLength(1);
    expect(saved[0].other).toEqual({ kept: true });
    expect(saved[0].webdav).toEqual({ url: 'https://dav.example', clientLastSyncAt: 't' });
  });

  it('原始读未提供且无 getMergedSettings 时回退 staleBase（入口快照整对象）', async () => {
    const { writer, saved } = makeWriter({});
    const stale = { drive115: { a: 1 }, display: { theme: 'dark' } };

    await saveSettingsSectionDelta(writer, stale, 'drive115', () => ({ b: 2 }));

    expect(saved[0].display).toEqual({ theme: 'dark' });
    expect(saved[0].drive115).toEqual({ a: 1, b: 2 });
  });

  it('原始读抛错时回退 getMergedSettings，不阻断写入', async () => {
    const { writer, saved } = makeWriter({
      rawError: true,
      merged: async () => ({ webdav: {} }),
    });

    await saveSettingsSectionDelta(writer, { legacy: true }, 'webdav', () => ({ x: 1 }));

    expect(saved).toHaveLength(1);
    expect(saved[0].webdav).toEqual({ x: 1 });
    expect(saved[0].legacy).toBeUndefined();
  });

  it('getMergedSettings 抛错时继续回退 staleBase', async () => {
    const { writer, saved } = makeWriter({
      rawError: true,
      merged: () => Promise.reject(new Error('merged down')),
    });

    await saveSettingsSectionDelta(writer, { drive115: { keep: 1 } }, 'drive115', () => ({ add: 1 }));

    expect(saved[0].drive115).toEqual({ keep: 1, add: 1 });
  });

  it('目标节缺失时按空节处理，不报错', async () => {
    const { writer, saved } = makeWriter({ raw: async () => ({}) });

    await saveSettingsSectionDelta(writer, null, 'drive115', () => ({ v2AccessToken: 't' }));

    expect(saved[0].drive115).toEqual({ v2AccessToken: 't' });
  });
});

describe('saveSettingsTopLevelDelta', () => {
  /**
   * records 页场景锁（10-21 A 组）：页内保存（3 顶层键口径）不得抹掉
   * 网络/后台窗口内并发落盘的其他节；stale 页快照里的陈旧节不入写。
   */
  it('页内保存（顶层 3 键）不抹后台并发写入的节，stale 独有节不入写', async () => {
    const { writer, saved } = makeWriter({
      raw: async () => ({
        recordsPerPage: 24,
        emby: { mediaServers: [{ id: 'srv-x', name: 'X-Srv' }], deletedServerIds: [] },
        display: { theme: 'dark' },
      }),
    });
    const stale = {
      showCoversInRecords: false,
      recordsViewMode: 'grid',
      recordsPerPage: 20,
      emby: { mediaServers: [] },
    };

    const written = await saveSettingsTopLevelDelta(
      writer, stale,
      ['showCoversInRecords', 'recordsViewMode', 'recordsPerPage'],
      () => ({ showCoversInRecords: true, recordsViewMode: 'list', recordsPerPage: 30 }),
    );

    expect(saved).toHaveLength(1);
    // 后台并发节保留（整包 raw 写会把 emby 旧快照/缺节写回，display 蒸发）
    expect(written.emby).toEqual({ mediaServers: [{ id: 'srv-x', name: 'X-Srv' }], deletedServerIds: [] });
    expect(written.display).toEqual({ theme: 'dark' });
    // 本页负责键按最新值落（stale 的 20 不回写）
    expect(written.recordsPerPage).toBe(30);
    expect(written.showCoversInRecords).toBe(true);
    expect(written.recordsViewMode).toBe('list');
    expect(written).toBe(saved[0]);
  });

  it('只合并指定顶层键，其余键按最新 raw 保留', async () => {
    const { writer, saved } = makeWriter({ raw: async () => ({ alpha: 1, beta: 2 }) });

    const written = await saveSettingsTopLevelDelta(writer, null, ['alpha'], () => ({ alpha: 9 }));

    expect(saved).toHaveLength(1);
    expect(written.alpha).toBe(9);
    expect(written.beta).toBe(2);
    expect(written).toBe(saved[0]);
  });

  it('staleBase 独有的节不写入（不推陈旧整包）', async () => {
    const { writer, saved } = makeWriter({ raw: async () => ({ beta: 2 }) });

    await saveSettingsTopLevelDelta(writer, { onlyInStale: true }, ['beta'], () => ({ beta: 7 }));

    expect(saved[0].beta).toBe(7);
    expect(saved[0].onlyInStale).toBeUndefined();
  });

  it('原始读未提供时回退 getMergedSettings（写前新鲜 merged 重读）', async () => {
    const { writer, saved } = makeWriter({
      merged: async () => ({ beta: 2, other: { kept: true } }),
    });

    await saveSettingsTopLevelDelta(writer, null, ['beta'], () => ({ beta: 5 }));

    expect(saved).toHaveLength(1);
    expect(saved[0].beta).toBe(5);
    expect(saved[0].other).toEqual({ kept: true });
  });

  it('原始读抛错时回退 getMergedSettings，不阻断写入', async () => {
    const { writer, saved } = makeWriter({
      rawError: true,
      merged: async () => ({ beta: 2 }),
    });

    await saveSettingsTopLevelDelta(writer, { legacy: true }, ['beta'], () => ({ beta: 5 }));

    expect(saved).toHaveLength(1);
    expect(saved[0].beta).toBe(5);
    expect(saved[0].legacy).toBeUndefined();
  });

  it('getMergedSettings 抛错时继续回退 staleBase', async () => {
    const { writer, saved } = makeWriter({
      rawError: true,
      merged: () => Promise.reject(new Error('merged down')),
    });

    await saveSettingsTopLevelDelta(writer, { beta: 1 }, ['beta'], () => ({ beta: 5 }));

    expect(saved[0].beta).toBe(5);
  });

  it('buildDelta 可按指定键取最新值做条件合并', async () => {
    const { writer, saved } = makeWriter({ raw: async () => ({ alpha: 5 }) });

    await saveSettingsTopLevelDelta(writer, null, ['alpha'], (latest) => ({ alpha: Number(latest.alpha) + 1 }));

    expect(saved[0].alpha).toBe(6);
  });
});
