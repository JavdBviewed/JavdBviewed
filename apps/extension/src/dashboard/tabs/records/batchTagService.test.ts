import { describe, expect, it, vi } from 'vitest';
import { executeRecordsBatchAddTags } from './batchTagService';
import type { VideoRecord } from '../../../types';

function record(id: string, tags: string[] = [], manuallyEditedFields: string[] = [], userTags: string[] = []): VideoRecord {
  return {
    id,
    title: id,
    status: 'browsed',
    tags,
    userTags,
    manuallyEditedFields,
    updatedAt: 1,
  };
}

describe('records batch tag service', () => {
  it('adds unique local tags without changing scraped tags or locking the scraped field', async () => {
    const visibleRecord = record('A', ['中文字幕'], ['title'], ['old']);
    const putRecord = vi.fn(async () => undefined);

    const result = await executeRecordsBatchAddTags({
      videoIds: ['A'],
      newTags: ['old', 'new'],
      getVisibleRecords: () => [visibleRecord],
      getRecordById: vi.fn(),
      putRecord,
      now: () => 1000,
    });

    expect(result).toEqual({ successCount: 1, failCount: 0 });
    expect(putRecord).toHaveBeenCalledWith(expect.objectContaining({
      id: 'A',
      tags: ['中文字幕'],
      userTags: ['old', 'new'],
      manuallyEditedFields: ['title'],
      updatedAt: 1000,
    }));
    expect(visibleRecord.tags).toEqual(['中文字幕']);
    expect(visibleRecord.userTags).toEqual(['old', 'new']);
    expect(visibleRecord.manuallyEditedFields).toEqual(['title']);
    expect(visibleRecord.updatedAt).toBe(1000);
  });

  it('loads records that are outside the current visible page', async () => {
    const hiddenRecord = record('B', []);
    const getRecordById = vi.fn(async () => hiddenRecord);

    const result = await executeRecordsBatchAddTags({
      videoIds: ['B'],
      newTags: ['字幕'],
      getVisibleRecords: () => [],
      getRecordById,
      putRecord: vi.fn(async () => undefined),
    });

    expect(result).toEqual({ successCount: 1, failCount: 0 });
    expect(getRecordById).toHaveBeenCalledWith('B');
  });

  it('counts missing records and persistence failures as failures', async () => {
    const result = await executeRecordsBatchAddTags({
      videoIds: ['missing', 'broken'],
      newTags: ['tag'],
      getVisibleRecords: () => [record('broken')],
      getRecordById: vi.fn(async () => undefined),
      putRecord: vi.fn(async () => {
        throw new Error('failed');
      }),
    });

    expect(result).toEqual({ successCount: 0, failCount: 2 });
  });
});
