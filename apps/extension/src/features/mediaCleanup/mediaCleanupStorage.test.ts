import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../../utils/config';
import {
  importHistoricalWatchedFromCurrentLibrary,
  loadMediaCleanupState,
  loadMediaDeletionHistory,
  retryFailedCleanupCopy,
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

describe('retryFailedCleanupCopy', () => {
  beforeEach(() => {
    storageMock.values.clear();
  });

  async function seedFailedCopy() {
    await storageMock.setValue(STORAGE_KEYS.MEDIA_CLEANUP_STATE, {
      version: 1,
      observedWatchedCopyIds: ['115:file-1'],
      updatedAt: 1000,
      items: {
        'AAA-001': {
          id: 'AAA-001',
          titleId: 'AAA-001',
          code: 'AAA-001',
          title: 'AAA-001 title',
          reason: 'watched',
          addedAt: 900,
          updatedAt: 1000,
          copies: {
            '115:file-1': {
              copyId: '115:file-1',
              source: '115',
              serverName: '115 片库',
              fileId: 'file-1',
              fileName: 'AAA-001.mp4',
              lastFoundAt: 900,
              watchedAt: 950,
              status: 'failed',
              error: '115 凭证不可用',
              updatedAt: 1000,
            },
          },
        },
      },
    });
  }

  it('resets a failed copy and immediately executes the deletion, returning the real result', async () => {
    await seedFailedCopy();
    const deleteCopy = vi.fn(async () => ({ ok: true, message: '已删除 115 文件' }));
    const result = await retryFailedCleanupCopy({
      titleId: 'AAA-001',
      copyId: '115:file-1',
      deleteCopy,
    });
    expect(result).toMatchObject({ ok: true, changed: true, message: '已删除 115 文件' });
    expect(deleteCopy).toHaveBeenCalledTimes(1);
    const saved = storageMock.values.get(STORAGE_KEYS.MEDIA_CLEANUP_STATE) as {
      items: Record<string, { copies: Record<string, { status: string }> }>;
    };
    // 终态是 deleted（而不是退回 pending 等用户再点一次）
    expect(saved.items['AAA-001'].copies['115:file-1'].status).toBe('deleted');
  });

  it('propagates a failed deletion without leaving the copy stuck in pending', async () => {
    await seedFailedCopy();
    const deleteCopy = vi.fn(async () => ({ ok: false, message: '115 凭证不可用' }));
    const result = await retryFailedCleanupCopy({
      titleId: 'AAA-001',
      copyId: '115:file-1',
      deleteCopy,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toBe('115 凭证不可用');
    const saved = storageMock.values.get(STORAGE_KEYS.MEDIA_CLEANUP_STATE) as {
      items: Record<string, { copies: Record<string, { status: string }> }>;
    };
    // 仍为 failed，操作记录里可继续重试
    expect(saved.items['AAA-001'].copies['115:file-1'].status).toBe('failed');
  });

  it('is a no-op for copies that are not in failed status', async () => {
    await seedFailedCopy();
    const deleteCopy = vi.fn(async () => ({ ok: true, message: 'ok' }));
    const result = await retryFailedCleanupCopy({
      titleId: 'AAA-001',
      copyId: '115:file-2',
      deleteCopy,
    });
    expect(result).toMatchObject({ ok: true, changed: false });
    expect(deleteCopy).not.toHaveBeenCalled();
  });
});

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
