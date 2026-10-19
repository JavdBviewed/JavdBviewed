/**
 * @file store.test.ts
 * @description 索引 state 规范化单测
 * @module features/drive115/mediaLibrary
 */
import { describe, expect, it } from 'vitest';
import { lookupByCode, normalizeDrive115LibraryState } from './store';

describe('store', () => {
  it('normalizes dirty state and drops invalid entries', () => {
    const state = normalizeDrive115LibraryState({
      version: 9,
      updatedAt: 123,
      entries: [
        {
          folderCid: 'f1',
          videoFileId: 'v1',
          pickCode: 'p1',
          code: 'ABC-1',
          title: 'ABC-1',
          fileName: 'a.mp4',
        },
        { folderCid: '', videoFileId: 'x', pickCode: 'y' },
        null,
      ],
      stats: { indexed: 1 },
    });
    expect(state.version).toBe(1);
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].key).toBe('f1:v1');
    expect(state.stats.indexed).toBe(1);
  });

  it('lookups by code case-insensitively', () => {
    const state = normalizeDrive115LibraryState({
      entries: [
        {
          folderCid: 'f',
          videoFileId: '1',
          pickCode: 'p',
          code: 'SSIS-001',
          title: 'SSIS-001',
          fileName: 'a.mp4',
        },
      ],
    });
    expect(lookupByCode(state, 'ssis-001')).toHaveLength(1);
    expect(lookupByCode(state, 'NONE')).toHaveLength(0);
  });
});

import {
  isDrive115IndexDirManifestUsable,
  normalizeDirManifest,
} from './store';
import type { Drive115IndexDirManifest } from './types';

function makeManifest(overrides: Partial<Drive115IndexDirManifest> = {}): Drive115IndexDirManifest {
  const base: Drive115IndexDirManifest = {
    version: 1,
    rootCids: ['root'],
    scanDepth: 2,
    discoveredAt: 1_700_000_000_000,
    expiresAt: 1_700_000_000_000 + 24 * 60 * 60_000,
    rootListings: { root: { listingComplete: true, offset: 0 } },
    items: [
      { cid: 'f1', name: 'SSIS-001', parentCid: 'root', depth: 1, rootCid: 'root', status: 'pending' },
    ],
  };
  return { ...base, ...overrides };
}

describe('store · R5.7 目录清单规范化与有效性', () => {
  it('normalize：脏数据兜底（去重/状态回退/游标取整）', () => {
    const normalized = normalizeDirManifest({
      rootCids: ['root', 'root', ''],
      scanDepth: 3,
      discoveredAt: 100,
      expiresAt: 200,
      rootListings: { root: { listingComplete: true, offset: '7' }, junk: null },
      items: [
        { cid: 'f1', name: 'A', parentCid: 'root', depth: 1, rootCid: 'root', status: 'processed' },
        { cid: 'f1', name: 'dup', parentCid: 'root', depth: 1, rootCid: 'root', status: 'pending' },
        { cid: 'f2', name: 'B', parentCid: 'root', depth: 'x', rootCid: 'root', status: 'weird' },
        null,
      ],
    });
    expect(normalized?.rootCids).toEqual(['root']);
    expect(normalized?.scanDepth).toBe(3);
    expect(normalized?.rootListings).toEqual({ root: { listingComplete: true, offset: 7 } });
    expect(normalized?.items).toHaveLength(2);
    expect(normalized?.items[0].status).toBe('processed');
    expect(normalized?.items[1]).toMatchObject({ cid: 'f2', status: 'pending', depth: 1 });
  });

  it('normalize：时间字段无效或缺根目录时整体丢弃', () => {
    expect(normalizeDirManifest({ ...makeManifest(), expiresAt: 50, discoveredAt: 100 })).toBeNull();
    expect(normalizeDirManifest({ ...makeManifest(), discoveredAt: 0 })).toBeNull();
    expect(normalizeDirManifest(null)).toBeNull();
    expect(normalizeDirManifest({ items: [] })).toBeNull();
  });

  it('isUsable：有效/过期/根目录不一致/深度不一致（深度按 clamp 口径比较）', () => {
    const now = 1_700_000_000_000;
    expect(isDrive115IndexDirManifestUsable(makeManifest(), ['root'], 2, now)).toBe(true);
    // expiresAt <= now 视为过期
    expect(isDrive115IndexDirManifestUsable(makeManifest(), ['root'], 2, makeManifest().expiresAt)).toBe(false);
    expect(isDrive115IndexDirManifestUsable(makeManifest({ rootCids: ['other'] }), ['root'], 2, now)).toBe(false);
    expect(isDrive115IndexDirManifestUsable(makeManifest({ scanDepth: 3 }), ['root'], 2, now)).toBe(false);
    // 深度缺省按 clamp 默认 2 比较
    expect(isDrive115IndexDirManifestUsable(makeManifest({ scanDepth: 2 }), ['root'], undefined, now)).toBe(true);
    expect(isDrive115IndexDirManifestUsable(null, ['root'], 2, now)).toBe(false);
  });
});
