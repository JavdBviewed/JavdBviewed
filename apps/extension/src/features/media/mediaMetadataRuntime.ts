import { viewedGet, viewedGetAll } from '../../platform/storage/indexedDb';
import { refreshMediaRecordById } from '../records/refresh/application/mediaRecordRefresh';
import { MEDIA_METADATA_TASKS_KEY, MediaMetadataTaskService, type MediaMetadataBatch } from './mediaMetadataTasks';

function readBatches(value: unknown): MediaMetadataBatch[] {
  if (value === undefined) return [];
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('batches' in value) || !Array.isArray(value.batches)) {
    throw new Error('媒体资料任务记录不可读取，原数据已保留');
  }
  const batches = value.batches as MediaMetadataBatch[];
  if (batches.some(b => !b || typeof b.id !== 'string' || !['pending', 'running', 'paused', 'completed', 'cancelled'].includes(b.status)
    || !Number.isFinite(b.createdAt) || !Number.isFinite(b.updatedAt) || !Array.isArray(b.items)
    || b.items.some(i => !i || typeof i.recordId !== 'string' || !i.recordId.startsWith('media:') || typeof i.title !== 'string'
      || (i.code !== undefined && typeof i.code !== 'string') || !['pending', 'running', 'done', 'failed', 'unidentified'].includes(i.status)))) {
    throw new Error('媒体资料任务记录不完整，原数据已保留');
  }
  return batches;
}

/** Background is the sole writer. Page components submit commands, never write task snapshots. */
export const mediaMetadataTasks = new MediaMetadataTaskService({
  load: async () => readBatches((await chrome.storage.local.get(MEDIA_METADATA_TASKS_KEY))[MEDIA_METADATA_TASKS_KEY]),
  save: async batches => { await chrome.storage.local.set({ [MEDIA_METADATA_TASKS_KEY]: { version: 1, batches } }); },
  records: viewedGetAll,
  refresh: async id => {
    const current = await viewedGet(id);
    if (!current || current.deletedAt) throw new Error('影片不存在或已移入回收站');
    // A single-record refresh may already have completed this queued item.
    if (current.javdbUrl) return;
    await refreshMediaRecordById(id);
  },
  id: () => crypto.randomUUID(), now: Date.now,
});

export async function handleMediaMetadataMessage(message: { type: string; batchId?: unknown; runId?: unknown }, sender: chrome.runtime.MessageSender) {
  try {
    const dashboard = chrome.runtime.getURL('dashboard/dashboard.html');
    const senderUrl = sender.url || sender.tab?.url || '';
    if (sender.id !== chrome.runtime.id || (sender.frameId !== undefined && sender.frameId !== 0) || senderUrl.split(/[?#]/)[0] !== dashboard) {
      throw new Error('请从扩展管理页操作资料同步');
    }
    if (message.type === 'MEDIA_METADATA:LIST') return { success: true, batches: await mediaMetadataTasks.list() };
    if (typeof message.batchId !== 'string' || !message.batchId) throw new Error('批次标识无效');
    switch (message.type) {
      case 'MEDIA_METADATA:CONFIRM': return { success: true, batch: await mediaMetadataTasks.confirm(message.batchId) };
      case 'MEDIA_METADATA:STEP':
        if (typeof message.runId !== 'string') throw new Error('请先确认资料同步');
        return { success: true, batch: await mediaMetadataTasks.step(message.batchId, message.runId) };
      case 'MEDIA_METADATA:PAUSE': return { success: true, batch: await mediaMetadataTasks.pause(message.batchId) };
      case 'MEDIA_METADATA:DISMISS': return { success: true, batch: await mediaMetadataTasks.dismiss(message.batchId) };
      default: throw new Error('不支持的资料同步操作');
    }
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : '资料同步操作失败' }; }
}
