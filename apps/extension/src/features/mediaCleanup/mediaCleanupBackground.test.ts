import { describe, expect, it, vi } from 'vitest';
import { handleMediaCleanupDeleteCopy } from './mediaCleanupBackground';
import type { MediaCleanupCopySnapshot } from './mediaCleanupModel';

const queuedCopy: MediaCleanupCopySnapshot = {
  copyId: '115:file-1',
  source: '115',
  fileId: 'file-1',
  lastFoundAt: 1000,
};

describe('mediaCleanupBackground', () => {
  it('keeps the message channel open and returns the persisted deletion result', async () => {
    const sendResponse = vi.fn();
    const deleteCopy = vi.fn(async () => ({ ok: true, message: '已删除' }));
    const executeQueuedCleanupCopy = vi.fn(async (input: {
      titleId: string;
      copyId: string;
      deleteCopy: (copy: MediaCleanupCopySnapshot) => Promise<{ ok: boolean; message: string }>;
    }) => {
      const result = await input.deleteCopy(queuedCopy);
      return { ...result, cleanup: { version: 1, items: {}, observedWatchedCopyIds: [], updatedAt: 1 } };
    });

    const handled = handleMediaCleanupDeleteCopy({
      type: 'MEDIA_CLEANUP_DELETE_COPY',
      titleId: 'AAA-001',
      copyId: '115:file-1',
    }, sendResponse, { executeQueuedCleanupCopy, deleteCopy });

    expect(handled).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(executeQueuedCleanupCopy).toHaveBeenCalledWith(expect.objectContaining({
      titleId: 'AAA-001',
      copyId: '115:file-1',
    }));
    expect(deleteCopy).toHaveBeenCalledWith(queuedCopy);
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      ok: true,
      message: '已删除',
    }));
  });

  it('sanitizes identifiers and returns an error response when deletion throws', async () => {
    const sendResponse = vi.fn();
    const executeQueuedCleanupCopy = vi.fn(async () => {
      throw new Error('权限不足');
    });

    const handled = handleMediaCleanupDeleteCopy({
      titleId: '  AAA-001  ',
      copyId: '  emby:https://home:item-1  ',
    }, sendResponse, {
      executeQueuedCleanupCopy,
      deleteCopy: vi.fn(),
    });

    expect(handled).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: '权限不足',
    }));
    expect(executeQueuedCleanupCopy).toHaveBeenCalledWith(expect.objectContaining({
      titleId: 'AAA-001',
      copyId: 'emby:https://home:item-1',
    }));
  });
});
