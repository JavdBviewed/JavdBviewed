/**
 * @file viewedInjectedSourceTagCleanup.test.ts
 * @description 详情页来源污染标签清理测试
 * @module tests/extension
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VideoRecord } from '../../apps/extension/src/types';

function makeRecord(id: string, patch: Partial<VideoRecord>): VideoRecord {
  return {
    id,
    title: id,
    status: 'browsed',
    tags: [],
    createdAt: 100,
    updatedAt: 200,
    ...patch,
  };
}

describe('injected source tag cleanup', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('removes known injected source names from tags and categories only', async () => {
    const { cleanVideoRecordInjectedSourceTags } = await import('../../apps/extension/src/shared/utils/tagFilter');
    const record = makeRecord('ABC-001', {
      tags: ['剧情', 'Wiki', '中文字幕', 'xslist', '98堂', '迅雷字幕'],
      categories: ['剧情', 'Wiki', '中文字幕', '迅雷字幕'],
    });

    const result = cleanVideoRecordInjectedSourceTags(record, 1234);

    expect(result.changed).toBe(true);
    expect(result.tagsRemoved).toBe(4);
    expect(result.categoriesRemoved).toBe(2);
    expect(result.record.tags).toEqual(['剧情', '中文字幕']);
    expect(result.record.categories).toEqual(['剧情', '中文字幕']);
    expect(result.record.updatedAt).toBe(1234);
  });

  it('cleans matching viewed records and refreshes tag indexes through one transaction', async () => {
    const records = [
      makeRecord('ABC-001', { tags: ['剧情', 'Wiki', 'xslist'], categories: ['剧情', 'xslist'] }),
      makeRecord('ABC-002', { tags: ['中文字幕'], categories: ['中文字幕'] }),
      makeRecord('ABC-003', { tags: ['98堂'], categories: ['98堂'], deletedAt: 999 }),
    ];
    const tagStore = { delete: vi.fn(() => Promise.resolve()), put: vi.fn(() => Promise.resolve()) };
    const listStore = { delete: vi.fn(() => Promise.resolve()), put: vi.fn(() => Promise.resolve()) };
    const viewedStore = { put: vi.fn(() => Promise.resolve()) };
    const tx = {
      objectStore: vi.fn((name: string) => {
        if (name === 'viewedRecords') return viewedStore;
        if (name === 'viewedByTag') return tagStore;
        return listStore;
      }),
      done: Promise.resolve(),
    };
    const mockDB = {
      getAll: vi.fn(() => Promise.resolve(records)),
      transaction: vi.fn(() => tx),
    };

    vi.doMock('../../apps/extension/src/platform/storage/indexedDbConnection', () => ({
      initDB: vi.fn(() => Promise.resolve(mockDB)),
    }));
    vi.doMock('../../apps/extension/src/features/cloudSync/enqueueLocalChange', () => ({
      scheduleEnqueue: vi.fn(),
      enqueueVideoChanges: vi.fn(),
    }));

    const { viewedCleanInjectedSourceTags } = await import('../../apps/extension/src/platform/storage/indexedDb');

    const result = await viewedCleanInjectedSourceTags({ nowMs: 5555 });

    expect(result).toEqual({
      scannedCount: 2,
      affectedCount: 1,
      tagsRemoved: 2,
      categoriesRemoved: 1,
      removedTagNames: ['Wiki', 'xslist'],
      dryRun: false,
    });
    expect(mockDB.transaction).toHaveBeenCalledWith(['viewedRecords', 'viewedByTag', 'viewedByList'], 'readwrite');
    expect(viewedStore.put).toHaveBeenCalledWith(expect.objectContaining({
      id: 'ABC-001',
      tags: ['剧情'],
      categories: ['剧情'],
      updatedAt: 5555,
    }));
    expect(tagStore.delete).toHaveBeenCalledWith('wiki::ABC-001');
    expect(tagStore.delete).toHaveBeenCalledWith('xslist::ABC-001');
  });

  it('supports dry run without writing records', async () => {
    const records = [makeRecord('ABC-001', { tags: ['剧情', 'Wiki'], categories: ['剧情'] })];
    const mockDB = {
      getAll: vi.fn(() => Promise.resolve(records)),
      transaction: vi.fn(),
    };

    vi.doMock('../../apps/extension/src/platform/storage/indexedDbConnection', () => ({
      initDB: vi.fn(() => Promise.resolve(mockDB)),
    }));

    const { viewedCleanInjectedSourceTags } = await import('../../apps/extension/src/platform/storage/indexedDb');

    const result = await viewedCleanInjectedSourceTags({ dryRun: true, nowMs: 5555 });

    expect(result.affectedCount).toBe(1);
    expect(result.tagsRemoved).toBe(1);
    expect(result.dryRun).toBe(true);
    expect(mockDB.transaction).not.toHaveBeenCalled();
  });
});