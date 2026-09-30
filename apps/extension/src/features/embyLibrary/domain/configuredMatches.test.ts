/**
 * @file configuredMatches.test.ts
 * @description 已配置启用服务器过滤的媒体库索引匹配（徽章与列表隐藏共用口径）
 * 纯函数单测：多主机/禁用服务器/URL 归一化/无配置零命中。
 * @module features/embyLibrary/domain
 */
import { describe, expect, it } from 'vitest';
import { findConfiguredLibraryMatches, getConfiguredServerKeys } from './configuredMatches';
import type { EmbyLibraryIndex, EmbyLibraryIndexEntry } from '../types';

const mkEntry = (serverType: 'emby' | 'jellyfin', serverUrl: string, overrides: Partial<EmbyLibraryIndexEntry> = {}): EmbyLibraryIndexEntry => ({
  serverType,
  serverName: 'Home',
  serverUrl,
  itemId: 'item-1',
  itemName: 'AAA-001',
  updatedAt: 1,
  ...overrides,
});

const SERVERS = [
  { id: 's1', type: 'emby', name: 'Home', url: 'http://emby.local:8096/', enabled: true, apiKey: 'k' },
  { id: 's2', type: 'jellyfin', name: 'JF', url: 'http://jf.local:8096', enabled: true, apiKey: 'k' },
];

const index: EmbyLibraryIndex = {
  updatedAt: 1,
  entries: {
    'AAA-001': [
      mkEntry('emby', 'http://emby.local:8096'),
      mkEntry('jellyfin', 'http://jf.local:8096', { itemId: 'item-2' }),
      mkEntry('emby', 'http://other.local:9999', { itemId: 'item-3' }),
    ],
  },
};

describe('getConfiguredServerKeys', () => {
  it('仅收 enabled!==false 且有 url 的服务器；jellyfin 键带类型前缀', () => {
    const keys = getConfiguredServerKeys(SERVERS);
    expect(keys).toContain('emby:http://emby.local:8096');
    expect(keys).toContain('jellyfin:http://jf.local:8096');
    expect(keys.size).toBe(2);
  });

  it('禁用服务器 / 空 url / 非数组 → 排除或零集合', () => {
    expect(getConfiguredServerKeys([{ ...SERVERS[0], enabled: false }]).size).toBe(0);
    expect(getConfiguredServerKeys([{ ...SERVERS[0], url: '' }]).size).toBe(0);
    expect(getConfiguredServerKeys(undefined).size).toBe(0);
    expect(getConfiguredServerKeys(null).size).toBe(0);
    expect(getConfiguredServerKeys('nope').size).toBe(0);
  });
});

describe('findConfiguredLibraryMatches', () => {
  it('多主机：同番号多服务器条目按已配置集合过滤（未配置服务器条目排除）', () => {
    const matches = findConfiguredLibraryMatches(index, 'AAA-001', SERVERS);
    expect(matches.map((m) => m.itemId).sort()).toEqual(['item-1', 'item-2']);
  });

  it('URL 归一化：配置带尾斜杠仍匹配条目（与旧私有实现口径一致）', () => {
    const matches = findConfiguredLibraryMatches(index, 'AAA-001', [
      { ...SERVERS[0], url: 'http://emby.local:8096' },
    ]);
    expect(matches.map((m) => m.itemId)).toEqual(['item-1']);
  });

  it('无已配置服务器 / 番号未索引 / 空索引 → 零命中（零误隐前提）', () => {
    expect(findConfiguredLibraryMatches(index, 'AAA-001', [])).toEqual([]);
    expect(findConfiguredLibraryMatches(index, 'ZZZ-999', SERVERS)).toEqual([]);
    expect(findConfiguredLibraryMatches(null, 'AAA-001', SERVERS)).toEqual([]);
    expect(findConfiguredLibraryMatches({ entries: {}, updatedAt: 0 } as EmbyLibraryIndex, 'AAA-001', SERVERS)).toEqual([]);
  });
});
