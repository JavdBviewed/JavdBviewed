import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../../utils/config';
import {
  importHistoricalWatchedFromCurrentLibrary,
  loadMediaCleanupState,
  loadMediaDeletionHistory,
} from './mediaCleanupStorage';

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

vi.mock('../../utils/storage', () => ({
  getValue: storageMock.getValue,
  setValue: storageMock.setValue,
}));

describe('watched media organizer scan', () => {
  beforeEach(() => {
    storageMock.values.clear();
    storageMock.getValue.mockClear();
    storageMock.setValue.mockClear();
  });

  it('finds a completed 115 playback from local watch evidence', async () => {
    storageMock.values.set(STORAGE_KEYS.DRIVE115_LIBRARY_STATE, {
      updatedAt: 2000,
      entries: [{
        code: 'AAA-001',
        title: 'AAA title',
        videoFileId: 'file-1',
        pickCode: 'pick-1',
        fileName: 'AAA-001.mp4',
        folderName: 'AAA-001',
        updatedAt: 2000,
      }],
    });
    storageMock.values.set(STORAGE_KEYS.MEDIA_WATCH_EVIDENCE, {
      version: 2,
      titles: {
        'AAA-001': {
          copies: {
            '115:file-1': {
              source: 'drive115',
              sourceItemId: 'pick-1',
              percent: 100,
              watched: true,
              lastPlayedAt: 3000,
              fileId: 'file-1',
              pickCode: 'pick-1',
              copyId: '115:file-1',
            },
          },
        },
      },
    });

    const result = await importHistoricalWatchedFromCurrentLibrary();

    expect(result.enqueuedCount).toBe(1);
    expect(result.state.items['AAA-001'].copies['115:file-1']).toMatchObject({
      status: 'pending',
      watchedAt: 3000,
      fileName: 'AAA-001.mp4',
    });
  });
});

describe('mediaCleanupStorage legacy migration', () => {
  beforeEach(() => {
    storageMock.values.clear();
    storageMock.getValue.mockClear();
    storageMock.setValue.mockClear();
    storageMock.values.set(STORAGE_KEYS.MEDIA_115_CLEANUP_LIST, {
      updatedAt: 5000,
      items: [
        {
          id: 'AAA-001::file-1::pick-1',
          code: 'AAA-001',
          title: 'AAA title',
          fileId: 'file-1',
          pickCode: 'pick-1',
          reason: 'watched',
          addedAt: 1000,
          status: 'pending',
        },
        {
          id: 'BBB-002::file-2::pick-2',
          code: 'BBB-002',
          title: 'BBB title',
          fileId: 'file-2',
          pickCode: 'pick-2',
          reason: 'watched',
          addedAt: 2000,
          status: 'deleted',
        },
      ],
    });
  });

  it('persists active legacy items into the generic cleanup state on read', async () => {
    const state = await loadMediaCleanupState();

    expect(state.items['AAA-001'].copies['115:file-1'].status).toBe('pending');
    expect(storageMock.setValue).toHaveBeenCalledWith(STORAGE_KEYS.MEDIA_CLEANUP_STATE, state);
  });

  it('persists legacy deleted items into the generic deletion history on read', async () => {
    const history = await loadMediaDeletionHistory();

    expect(history.records['legacy115:BBB-002::file-2::pick-2']).toMatchObject({
      code: 'BBB-002',
      copyId: '115:file-2',
      reason: 'extension_cleanup',
    });
    expect(storageMock.setValue).toHaveBeenCalledWith(STORAGE_KEYS.MEDIA_DELETION_HISTORY, history);
  });
});
