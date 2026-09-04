import { getDrive115V2Service } from '../drive115/v2';
import { isAttachmentFileName, parse115FolderCid } from './mediaCleanupDelete';

/**
 * 删除 115 视频所在文件夹内的封面/缩略图/字幕等附属文件。
 * 仅删除明确的附属文件（不删视频本身，也不删同目录其他视频），全部移入 115 回收站。
 * 全部失败/无附属文件时返回 ok:false，不影响视频本身已删除的结论。
 */
export async function deleteDrive115FolderAttachments(input: {
  cid?: string;
  folderPath?: string;
  videoFileName?: string;
}): Promise<{ ok: boolean; message: string; removed?: number }> {
  const cid = input.cid || parse115FolderCid(input.folderPath);
  if (!cid) return { ok: false, message: '缺少视频所在文件夹的 cid，无法清理附属文件' };

  const service = getDrive115V2Service();
  const token = await service.getValidAccessToken();
  if (!token.success) {
    return { ok: false, message: (token as { message?: string }).message || '115 凭证不可用' };
  }

  const list = await service.listFiles({
    accessToken: token.accessToken,
    cid,
    limit: 1150,
    show_dir: 0,
  });
  if (!list.success || !Array.isArray(list.data)) {
    return { ok: false, message: list.message || '读取视频文件夹列表失败' };
  }

  const targets = list.data
    .filter((file) => Number(file.fc) === 1)
    .filter((file) => isAttachmentFileName(String(file.fn || file.file_name || ''), input.videoFileName))
    .map((file) => String(file.fid || file.file_id || '').trim())
    .filter(Boolean);
  if (targets.length === 0) return { ok: false, message: '该文件夹中没有需要清理的附属文件' };

  const deleted = await service.deleteFiles({
    accessToken: token.accessToken,
    fileIds: targets,
  });
  if (!deleted.success) {
    return { ok: false, message: deleted.message || '附属文件删除失败' };
  }
  return { ok: true, message: `已清理 ${targets.length} 个附属文件`, removed: targets.length };
}
