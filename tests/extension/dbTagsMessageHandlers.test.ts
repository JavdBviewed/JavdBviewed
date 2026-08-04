/**
 * @file dbTagsMessageHandlers.test.ts
 * @description db tags message handlers 测试
 * @module tests/extension
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getLegacyViewedRecordsFromStorage,
  handleGetAllTags,
} from '../../apps/extension/src/apps/background/dbTagsMessageHandlers';
import { STORAGE_KEYS } from '../../apps/extension/src/utils/config';

describe('db tags message handlers', () => {
  beforeEach(() => {
    awaitChromeStorageClear();
  });

  it('reads chunked legacy viewed records from chrome storage', async () => {
    const key = STORAGE_KEYS.VIEWED_RECORDS;
    await chrome.storage.local.set({
      [`__chunks_meta__:${key}`]: { chunks: 2 },
      [`__chunk__:${key}::1`]: { A: { id: 'A' } },
      [`__chunk__:${key}::2`]: { B: { id: 'B' } },
    });

    await expect(getLegacyViewedRecordsFromStorage()).resolves.toEqual({
      A: { id: 'A' },
      B: { id: 'B' },
    });
  });

  it('builds top tags from IDB records, tag index rows, and legacy records', async () => {
    const sendResponse = vi.fn();

    await handleGetAllTags(
      { payload: { limit: 10 } },
      sendResponse,
      {
        viewedGetAll: vi.fn(async () => [{ id: 'A', tags: ['剧情'] }]),
        viewedTagIndexGetAll: vi.fn(async () => [
          { key: '巨乳::B', tag: '巨乳', videoId: 'B' },
          { key: '巨乳::C', tag: '巨乳', videoId: 'C' },
        ]),
        getLegacyViewedRecords: vi.fn(async () => ({
          D: { id: 'D', tags: ['剧情'] },
        })),
      },
    );

    expect(sendResponse).toHaveBeenCalledWith({
      success: true,
      tags: [
        { name: '剧情', count: 2 },
        { name: '巨乳', count: 2 },
      ],
    });
  });

  it('skips the full viewed-record scan when the canonical tag index is available', async () => {
    const sendResponse = vi.fn();
    const viewedGetAll = vi.fn(async () => [{ id: 'A', tags: ['剧情'] }]);

    await handleGetAllTags(
      { payload: { limit: 10 } },
      sendResponse,
      {
        viewedGetAll,
        viewedTagIndexGetAll: vi.fn(async () => [
          { key: '巨乳::B', tag: '巨乳', videoId: 'B' },
        ]),
        getLegacyViewedRecords: vi.fn(async () => ({})),
        tagIndexIsCanonical: true,
      },
    );

    expect(viewedGetAll).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      success: true,
      tags: [{ name: '巨乳', count: 1 }],
    });
  });
});

function awaitChromeStorageClear(): void {
  chrome.storage.local.clear();
}
