import { getDrive115V2Service } from '../drive115/v2';
import { is115FileGoneResult } from '../drive115/v2/errorCodes';
import { getSettings } from '../../utils/storage';
import { deleteMediaCleanupCopy } from './mediaCleanupDelete';
import { deleteDrive115FolderAttachments } from './mediaCleanupDrive115';
import type { MediaCleanupCopySnapshot } from './mediaCleanupModel';
import { executeQueuedCleanupCopy } from './mediaCleanupStorage';

type DeleteResult = { ok: boolean; message: string };

type MediaCleanupDeleteDependencies = {
  executeQueuedCleanupCopy: typeof executeQueuedCleanupCopy;
  deleteCopy: (copy: MediaCleanupCopySnapshot) => Promise<DeleteResult>;
};

async function deleteCopyWithConfiguredSource(copy: MediaCleanupCopySnapshot): Promise<DeleteResult> {
  return deleteMediaCleanupCopy(copy, {
    getSettings,
    fetchImpl: fetch,
    deleteDrive115File: async (fileId) => {
      const service = getDrive115V2Service();
      const token = await service.getValidAccessToken();
      if (!token.success) {
        return { ok: false, message: (token as { message?: string }).message || '115 凭证不可用' };
      }
      const deleted = await service.deleteFiles({
        accessToken: token.accessToken,
        fileIds: [fileId],
      });
      return {
        ok: deleted.success,
        message: deleted.message || (deleted.success ? '已删除 115 文件' : '115 删除失败'),
        // 115 明确说文件已不存在时透传，让上层按删除成功收敛（幂等）
        fileGone: !deleted.success && is115FileGoneResult(deleted.raw),
      };
    },
    deleteDrive115FolderAttachments: async (input) => deleteDrive115FolderAttachments({
      ...input,
      videoFileName: copy.fileName,
    }),
  });
}

export const DEFAULT_DEPENDENCIES: MediaCleanupDeleteDependencies = {
  executeQueuedCleanupCopy,
  deleteCopy: deleteCopyWithConfiguredSource,
};

export function handleMediaCleanupDeleteCopy(
  message: { titleId?: unknown; copyId?: unknown },
  sendResponse: (response: unknown) => void,
  dependencies: MediaCleanupDeleteDependencies = DEFAULT_DEPENDENCIES,
): true {
  void (async () => {
    try {
      const result = await dependencies.executeQueuedCleanupCopy({
        titleId: String(message?.titleId || '').trim(),
        copyId: String(message?.copyId || '').trim(),
        deleteCopy: dependencies.deleteCopy,
      });
      sendResponse({ success: result.ok, ...result });
    } catch (error) {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
  return true;
}
