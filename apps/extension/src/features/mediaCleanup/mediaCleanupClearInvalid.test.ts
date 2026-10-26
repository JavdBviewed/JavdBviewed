/**
 * @file mediaCleanupClearInvalid.test.ts
 * @description 「清除失效条目」存储层测试（10-26-emby-index-reconcile）：
 * 删索引条目（同 code + 来源键 + itemId）+ 副本置 skipped 写操作记录 /
 * 幂等 / 115 与终态副本跳过 / 空 code 键整体移除
 * @module features/mediaCleanup
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../../utils/config';

const storageMock = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  return {
    values,
    getValue: vi.fn(async (key: string, fallback: unknown) => values.get(key) ?? fallback),
    setValue: vi.fn(async (key: string, value: unknown) => {
      values.set(key, value);
    }),
  };
});

vi.mock('../../utils/storage', () => storageMock);

import { CLEAR_INVALID_SOURCE_MESSAGE, clearInvalidSourceCopies } from './mediaCleanupStorage';
import type { MediaCleanupState } from './mediaCleanupModel';

const OLD_URL = 'http://192.168.1.66:18096';
const NEW_URL = 'http://47.108.74.231:18096';

const ORPHAN_COPY_ID = 'emby:1';
const VALID_COPY_ID = 'emby:2';

function seedState(copies: Record<string, unknown>): MediaCleanupState {
  const state: MediaCleanupState = {
    version: 1,
    items: {
      'AAA-001': {
        id: 'AAA-001',
        titleId: 'AAA-001',
        code: 'AAA-001',
        title: 'AAA-001 title',
        reason: 'watched',
        addedAt: 900,
        updatedAt: 1000,
        copies: copies as MediaCleanupState['items']['AAA-001']['copies'],
      },
    },
    observedWatchedCopyIds: Object.keys(copies),
    updatedAt: 1000,
  };
  storageMock.values.set(STORAGE_KEYS.MEDIA_CLEANUP_STATE, state);
  return state;
}

function seedLibraryEntries(entries: Record<string, unknown[]>): void {
  storageMock.values.set(STORAGE_KEYS.EMBY_LIBRARY_STATE, { entries, updatedAt: 500 });
}

function pendingCopy(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    copyId: ORPHAN_COPY_ID,
    source: 'emby',
    serverName: 'Emby-home',
    serverUrl: OLD_URL,
    itemId: 'item-1',
    fileName: 'AAA-001.mp4',
    lastFoundAt: 900,
    status: 'pending',
    updatedAt: 1000,
    ...over,
  };
}

describe('clearInvalidSourceCopies', () => {
  beforeEach(() => {
    storageMock.values.clear();
  });

  it('清除孤儿：删对应索引条目 + 副本置 skipped 并写操作记录文案', async () => {
    seedState({ [ORPHAN_COPY_ID]: pendingCopy() });
    seedLibraryEntries({
      'AAA-001': [{ serverType: 'emby', serverUrl: OLD_URL, itemId: 'item-1', itemName: 'AAA-001' }],
    });

    const result = await clearInvalidSourceCopies({ targets: [{ titleId: 'AAA-001', copyId: ORPHAN_COPY_ID }] });
    expect(result).toEqual({ clearedCount: 1, removedEntryCount: 1, skippedCount: 0 });

    const state = storageMock.values.get(STORAGE_KEYS.MEDIA_CLEANUP_STATE) as MediaCleanupState;
    const copy = state.items['AAA-001'].copies[ORPHAN_COPY_ID];
    expect(copy.status).toBe('skipped');
    expect(copy.message).toBe(CLEAR_INVALID_SOURCE_MESSAGE);
    expect(copy.error).toBeUndefined();

    const library = storageMock.values.get(STORAGE_KEYS.EMBY_LIBRARY_STATE) as { entries: Record<string, unknown[]> };
    expect(library.entries).toEqual({});
  });

  it('同 code 同来源两条目：按 itemId 只删命中一条', async () => {
    seedState({
      [ORPHAN_COPY_ID]: pendingCopy(),
      [VALID_COPY_ID]: pendingCopy({ copyId: VALID_COPY_ID, itemId: 'item-2' }),
    });
    seedLibraryEntries({
      'AAA-001': [
        { serverType: 'emby', serverUrl: OLD_URL, itemId: 'item-1', itemName: 'AAA-001' },
        { serverType: 'emby', serverUrl: OLD_URL, itemId: 'item-2', itemName: 'AAA-001' },
      ],
    });

    const result = await clearInvalidSourceCopies({ targets: [{ titleId: 'AAA-001', copyId: ORPHAN_COPY_ID }] });
    expect(result).toEqual({ clearedCount: 1, removedEntryCount: 1, skippedCount: 0 });

    const library = storageMock.values.get(STORAGE_KEYS.EMBY_LIBRARY_STATE) as { entries: Record<string, unknown[]> };
    expect(library.entries['AAA-001']).toHaveLength(1);
    expect(library.entries['AAA-001'][0].itemId).toBe('item-2');
  });

  it('code 下条目全部移除 → code 键整体删除，其它 code 不受影响', async () => {
    seedState({ [ORPHAN_COPY_ID]: pendingCopy() });
    seedLibraryEntries({
      'AAA-001': [{ serverType: 'emby', serverUrl: OLD_URL, itemId: 'item-1', itemName: 'AAA-001' }],
      'BBB-002': [{ serverType: 'emby', serverUrl: NEW_URL, itemId: 'other', itemName: 'BBB-002' }],
    });

    const result = await clearInvalidSourceCopies({ targets: [{ titleId: 'AAA-001', copyId: ORPHAN_COPY_ID }] });
    expect(result).toEqual({ clearedCount: 1, removedEntryCount: 1, skippedCount: 0 });

    const library = storageMock.values.get(STORAGE_KEYS.EMBY_LIBRARY_STATE) as { entries: Record<string, unknown[]> };
    expect(library.entries).not.toHaveProperty('AAA-001');
    expect(library.entries['BBB-002']).toHaveLength(1);
  });

  it('幂等：副本已是 skipped → 计 skipped，不再写存储', async () => {
    const state = seedState({ [ORPHAN_COPY_ID]: pendingCopy() });
    seedLibraryEntries({ 'AAA-001': [{ serverType: 'emby', serverUrl: OLD_URL, itemId: 'item-1', itemName: 'AAA-001' }] });

    const first = await clearInvalidSourceCopies({ targets: [{ titleId: 'AAA-001', copyId: ORPHAN_COPY_ID }] });
    expect(first.clearedCount).toBe(1);
    const writesAfterFirst = storageMock.setValue.mock.calls.length;

    const second = await clearInvalidSourceCopies({ targets: [{ titleId: 'AAA-001', copyId: ORPHAN_COPY_ID }] });
    expect(second).toEqual({ clearedCount: 0, removedEntryCount: 0, skippedCount: 1 });
    expect(storageMock.setValue.mock.calls.length).toBe(writesAfterFirst);
    expect(state.items['AAA-001'].copies[ORPHAN_COPY_ID].status).toBe('pending');
  });

  it('115 / 无地址 / 已删除副本 → 计 skipped，索引不动', async () => {
    seedState({
      c115: { copyId: 'c115', source: '115', fileId: 'f1', lastFoundAt: 900, status: 'pending', updatedAt: 1000 },
      cnoaddr: { copyId: 'cnoaddr', source: 'emby', lastFoundAt: 900, status: 'pending', updatedAt: 1000 },
      cdeleted: pendingCopy({ copyId: 'cdeleted', status: 'deleted', message: '已从来源删除' }),
    });
    seedLibraryEntries({ 'AAA-001': [{ serverType: 'emby', serverUrl: OLD_URL, itemId: 'item-1', itemName: 'AAA-001' }] });

    const result = await clearInvalidSourceCopies({
      targets: [
        { titleId: 'AAA-001', copyId: 'c115' },
        { titleId: 'AAA-001', copyId: 'cnoaddr' },
        { titleId: 'AAA-001', copyId: 'cdeleted' },
      ],
    });
    expect(result).toEqual({ clearedCount: 0, removedEntryCount: 0, skippedCount: 3 });
    const library = storageMock.values.get(STORAGE_KEYS.EMBY_LIBRARY_STATE) as { entries: Record<string, unknown[]> };
    expect(library.entries['AAA-001']).toHaveLength(1);
  });

  it('目标缺失（未知 titleId / copyId）→ 计 skipped', async () => {
    seedState({ [ORPHAN_COPY_ID]: pendingCopy() });
    const result = await clearInvalidSourceCopies({
      targets: [
        { titleId: 'ZZZ-999', copyId: ORPHAN_COPY_ID },
        { titleId: 'AAA-001', copyId: 'no-such-copy' },
      ],
    });
    expect(result).toEqual({ clearedCount: 0, removedEntryCount: 0, skippedCount: 2 });
  });
});
