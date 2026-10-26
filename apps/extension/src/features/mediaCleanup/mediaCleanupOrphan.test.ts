/**
 * @file mediaCleanupOrphan.test.ts
 * @description 清理面板孤儿判定纯函数测试（10-26-emby-index-reconcile）：
 * 副本来源键归一化 / 启用来源白名单 / 115 与无地址副本豁免
 * @module features/mediaCleanup
 */
import { describe, expect, it } from 'vitest';
import {
  getCleanupCopyServerKey,
  getValidCleanupSourceKeys,
  isCleanupCopySourceInvalid,
} from './mediaCleanupOrphan';

function settingsOf(servers: Array<Record<string, unknown>>): { emby: { mediaServers: Array<Record<string, unknown>> } } {
  return { emby: { mediaServers: servers } };
}

const VALID_SETTINGS = settingsOf([
  { id: 's1', type: 'emby', name: 'Home', url: 'http://192.168.1.66:18096', enabled: true, apiKey: 'K1' },
]);

describe('getCleanupCopyServerKey', () => {
  it('emby / jellyfin 副本：type:归一化URL', () => {
    expect(getCleanupCopyServerKey({ source: 'emby', serverUrl: 'http://Host:18096/' }))
      .toBe('emby:http://host:18096');
    expect(getCleanupCopyServerKey({ source: 'jellyfin', serverUrl: 'https://jf.example:8096' }))
      .toBe('jellyfin:https://jf.example:8096');
  });

  it('115 / 无地址副本 → null（豁免孤儿判定）', () => {
    expect(getCleanupCopyServerKey({ source: '115', serverUrl: 'http://115.example' })).toBeNull();
    expect(getCleanupCopyServerKey({ source: 'emby' })).toBeNull();
    expect(getCleanupCopyServerKey({ source: 'emby', serverUrl: '  ' })).toBeNull();
  });
});

describe('getValidCleanupSourceKeys', () => {
  it('与资料库索引同一白名单口径（启用 + 地址 + 凭据）', () => {
    const keys = getValidCleanupSourceKeys(VALID_SETTINGS);
    expect(keys.has('emby:http://192.168.1.66:18096')).toBe(true);
    expect(keys.size).toBe(1);
  });

  it('停用 / 无凭据来源不进白名单', () => {
    const keys = getValidCleanupSourceKeys(settingsOf([
      { id: 's1', type: 'emby', url: 'http://a.example:1', enabled: false, apiKey: 'K' },
      { id: 's2', type: 'emby', url: 'http://b.example:1', apiKey: '' },
      { id: 's3', type: 'emby', url: 'http://c.example:1', enabled: true, apiKey: 'K3' },
    ]));
    expect(keys).toEqual(new Set(['emby:http://c.example:1']));
  });

  it('无设置 → 空白名单', () => {
    expect(getValidCleanupSourceKeys(undefined)).toEqual(new Set());
    expect(getValidCleanupSourceKeys({})).toEqual(new Set());
  });
});

describe('isCleanupCopySourceInvalid', () => {
  it('旧地址副本（不在白名单）→ 失效', () => {
    const keys = getValidCleanupSourceKeys(VALID_SETTINGS);
    expect(isCleanupCopySourceInvalid({ source: 'emby', serverUrl: 'http://192.168.1.66:18096' }, keys)).toBe(false);
    expect(isCleanupCopySourceInvalid({ source: 'emby', serverUrl: 'http://47.108.74.231:18096' }, keys)).toBe(true);
  });

  it('大小写 / 尾斜杠差异不算失效', () => {
    const keys = getValidCleanupSourceKeys(VALID_SETTINGS);
    expect(isCleanupCopySourceInvalid({ source: 'emby', serverUrl: 'HTTP://192.168.1.66:18096/' }, keys)).toBe(false);
  });

  it('115 / 无地址副本永不算失效', () => {
    const keys = getValidCleanupSourceKeys(VALID_SETTINGS);
    expect(isCleanupCopySourceInvalid({ source: '115', serverUrl: 'http://115.example' }, keys)).toBe(false);
    expect(isCleanupCopySourceInvalid({ source: 'emby' }, keys)).toBe(false);
    expect(isCleanupCopySourceInvalid({ source: 'emby', serverUrl: '' }, keys)).toBe(false);
  });
});
