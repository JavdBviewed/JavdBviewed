/**
 * @file indexReconcile.test.ts
 * @description 资料库索引对账共享纯函数测试：
 * 索引键归一化 / 启用来源白名单 / 孤儿条目对账（改地址 / 删来源 / 停用 /
 * 多源混合 / 配置中未同步成功保留）/ 配置变化 diff / 入库功能开关判定
 * @module features/embyLibrary
 */
import { describe, expect, it } from 'vitest';
import type { EmbyLibraryIndexEntry } from '../types';
import {
  countLibraryEntries,
  getEntryServerIndexKey,
  getServerIndexKey,
  isEmbyServerConfigChanged,
  isLibraryFeatureEnabled,
  reconcileLibraryEntries,
  resolveEnabledMediaServers,
} from './indexReconcile';

const OLD_URL = 'http://192.168.1.66:18096';
const NEW_URL = 'http://47.108.74.231:18096';

function entry(over: Partial<EmbyLibraryIndexEntry> = {}): EmbyLibraryIndexEntry {
  return {
    serverType: 'emby',
    serverName: 'Emby-home',
    serverUrl: OLD_URL,
    itemId: 'item-1',
    itemName: 'AAA-001',
    ...over,
  };
}

function settingsOf(servers: Array<Record<string, unknown>>): { emby: { mediaServers: Array<Record<string, unknown>> } } {
  return { emby: { mediaServers: servers } };
}

const baseServer = {
  id: 'srv-1',
  type: 'emby',
  name: 'Emby-home',
  url: OLD_URL,
  enabled: true,
  apiKey: 'KEY-1',
};

describe('索引键归一化', () => {
  it('服务器键与条目键同口径：尾斜杠 / 大小写归一后一致', () => {
    expect(getServerIndexKey({ type: 'emby', url: 'http://Host:18096/' })).toBe('emby:http://host:18096');
    expect(getEntryServerIndexKey(entry({ serverUrl: 'HTTP://HOST:18096' }))).toBe('emby:http://host:18096');
    expect(getServerIndexKey({ type: 'jellyfin', url: 'https://jf.example:8096' }))
      .toBe(getEntryServerIndexKey(entry({ serverType: 'jellyfin', serverUrl: 'https://jf.example:8096/' })));
  });
});

describe('resolveEnabledMediaServers', () => {
  it('白名单口径：启用 + 地址 + 至少一种凭据；jellyfin 类型与 URL 归一', () => {
    const servers = resolveEnabledMediaServers(settingsOf([
      { id: 'a', type: 'emby', name: 'A', url: `${OLD_URL}/`, apiKey: 'K' },
      { id: 'b', type: 'emby', name: 'B', url: OLD_URL, apiKey: 'K', enabled: false },
      { id: 'c', type: 'emby', name: 'C', url: '', apiKey: 'K' },
      { id: 'd', type: 'emby', name: 'D', url: OLD_URL },
      { id: 'e', type: 'jellyfin', name: 'E', url: 'https://jf.example:8096/', username: 'u', password: 'p' },
    ]));
    expect(servers.map((server) => server.id)).toEqual(['a', 'e']);
    expect(servers[0].url).toBe(OLD_URL);
    expect(servers[1].type).toBe('jellyfin');
    expect(servers[1].url).toBe('https://jf.example:8096');
    expect(servers[1].username).toBe('u');
  });

  it('无 mediaServers / 非数组输入 → 空白名单', () => {
    expect(resolveEnabledMediaServers(undefined)).toEqual([]);
    expect(resolveEnabledMediaServers({})).toEqual([]);
    expect(resolveEnabledMediaServers({ emby: { mediaServers: 'not-an-array' } })).toEqual([]);
  });
});

describe('reconcileLibraryEntries', () => {
  it('改地址：旧键条目移除，新键条目保留', () => {
    const next = reconcileLibraryEntries(
      { 'AAA-001': [entry(), entry({ serverUrl: NEW_URL, itemId: 'item-2' })] },
      [{ type: 'emby', url: NEW_URL }],
    );
    expect(Object.keys(next)).toEqual(['AAA-001']);
    expect(next['AAA-001']).toHaveLength(1);
    expect(next['AAA-001'][0].serverUrl).toBe(NEW_URL);
  });

  it('删来源：该来源条目整体移除，code 键随之清理', () => {
    const next = reconcileLibraryEntries(
      {
        'AAA-001': [entry()],
        'BBB-002': [entry({ serverUrl: OLD_URL, itemName: 'BBB-002' }), entry({ serverUrl: NEW_URL, itemId: 'x', itemName: 'BBB-002' })],
      },
      [{ type: 'emby', url: NEW_URL }],
    );
    expect(next).not.toHaveProperty('AAA-001');
    expect(next['BBB-002']).toHaveLength(1);
  });

  it('多来源混合：仅失效来源被移除，其余保留', () => {
    const next = reconcileLibraryEntries(
      {
        'AAA-001': [
          entry({ serverUrl: NEW_URL, itemId: 'item-new' }),
          entry({ serverType: 'jellyfin', serverUrl: 'https://gone.example:8096', itemId: 'j1' }),
          entry({ serverType: 'jellyfin', serverUrl: 'https://stay.example:8096', itemId: 'j2' }),
        ],
      },
      [{ type: 'emby', url: NEW_URL }, { type: 'jellyfin', url: 'https://stay.example:8096' }],
    );
    expect(next['AAA-001'].map((candidate) => candidate.serverUrl)).toEqual([NEW_URL, 'https://stay.example:8096']);
  });

  it('仍在配置中的来源（含本次未同步成功的）条目保留', () => {
    const next = reconcileLibraryEntries(
      { 'AAA-001': [entry()] },
      [{ type: 'emby', url: OLD_URL }],
    );
    expect(next['AAA-001']).toHaveLength(1);
  });

  it('空 / null / undefined 输入 → 空索引', () => {
    expect(reconcileLibraryEntries(null, [])).toEqual({});
    expect(reconcileLibraryEntries(undefined, [])).toEqual({});
    expect(reconcileLibraryEntries({}, [{ type: 'emby', url: OLD_URL }])).toEqual({});
  });
});

describe('isEmbyServerConfigChanged', () => {
  it('地址真实变化 → true', () => {
    expect(isEmbyServerConfigChanged(settingsOf([baseServer]), settingsOf([{ ...baseServer, url: NEW_URL }]))).toBe(true);
  });

  it('地址尾斜杠 / 大小写差异 → false', () => {
    expect(isEmbyServerConfigChanged(settingsOf([baseServer]), settingsOf([{ ...baseServer, url: `${OLD_URL}/` }]))).toBe(false);
    expect(isEmbyServerConfigChanged(settingsOf([baseServer]), settingsOf([{ ...baseServer, url: 'HTTP://192.168.1.66:18096' }]))).toBe(false);
  });

  it('名称 / 库目录选择变化 → false', () => {
    expect(isEmbyServerConfigChanged(settingsOf([baseServer]), settingsOf([{ ...baseServer, name: '改名' }]))).toBe(false);
    expect(isEmbyServerConfigChanged(settingsOf([baseServer]), settingsOf([{ ...baseServer, libraryIds: ['lib-1'] }]))).toBe(false);
  });

  it('凭证变化（apiKey / accessToken / userId）→ true', () => {
    expect(isEmbyServerConfigChanged(settingsOf([baseServer]), settingsOf([{ ...baseServer, apiKey: 'KEY-2' }]))).toBe(true);
    expect(isEmbyServerConfigChanged(settingsOf([{ ...baseServer, apiKey: '', accessToken: 'AT-1' }]),
      settingsOf([{ ...baseServer, apiKey: '', accessToken: 'AT-2' }]))).toBe(true);
    expect(isEmbyServerConfigChanged(settingsOf([{ ...baseServer, userId: 'U1' }]),
      settingsOf([{ ...baseServer, userId: 'U2' }]))).toBe(true);
  });

  it('启用态翻转 / 增删来源 → true', () => {
    expect(isEmbyServerConfigChanged(settingsOf([baseServer]), settingsOf([{ ...baseServer, enabled: false }]))).toBe(true);
    expect(isEmbyServerConfigChanged(settingsOf([baseServer]),
      settingsOf([{ ...baseServer, enabled: true }, { id: 'srv-2', type: 'emby', name: 'B', url: NEW_URL, enabled: true, apiKey: 'K2' }]))).toBe(true);
    expect(isEmbyServerConfigChanged(
      settingsOf([baseServer, { id: 'srv-2', type: 'emby', name: 'B', url: NEW_URL, enabled: true, apiKey: 'K2' }]),
      settingsOf([baseServer]),
    )).toBe(true);
  });

  it('不参与同步资格判定的来源变化不触发（停用来源改地址）', () => {
    expect(isEmbyServerConfigChanged(
      settingsOf([{ ...baseServer, enabled: false }]),
      settingsOf([{ ...baseServer, enabled: false, url: NEW_URL }]),
    )).toBe(false);
  });

  it('双空 / undefined → false', () => {
    expect(isEmbyServerConfigChanged(undefined, undefined)).toBe(false);
    expect(isEmbyServerConfigChanged(settingsOf([]), settingsOf([]))).toBe(false);
    expect(isEmbyServerConfigChanged(undefined, settingsOf([]))).toBe(false);
  });
});

describe('countLibraryEntries / isLibraryFeatureEnabled', () => {
  it('countLibraryEntries 统计全部条目，null 安全', () => {
    expect(countLibraryEntries(null)).toBe(0);
    expect(countLibraryEntries(undefined)).toBe(0);
    expect(countLibraryEntries({ a: [entry(), entry()], b: [] })).toBe(2);
  });

  it('isLibraryFeatureEnabled：未显式关闭 + 任一启用信号', () => {
    expect(isLibraryFeatureEnabled({ libraryEnabled: true })).toBe(true);
    expect(isLibraryFeatureEnabled({ libraryStatus: { enabled: true } })).toBe(true);
    expect(isLibraryFeatureEnabled({})).toBe(false);
    expect(isLibraryFeatureEnabled(undefined)).toBe(false);
    expect(isLibraryFeatureEnabled({ libraryEnabled: false })).toBe(false);
    expect(isLibraryFeatureEnabled({ libraryEnabled: false, libraryStatus: { enabled: true } })).toBe(false);
  });
});
