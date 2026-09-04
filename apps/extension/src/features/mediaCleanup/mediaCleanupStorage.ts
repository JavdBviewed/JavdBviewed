import { STORAGE_KEYS } from '../../utils/config';
import { getValue, setValue } from '../../utils/storage';
import type { EmbyLibraryState } from '../embyLibrary/types';
import {
  EMPTY_MEDIA_CLEANUP_STATE,
  EMPTY_MEDIA_DELETION_HISTORY,
  enqueueWatchedTitle,
  importHistoricalWatched,
  markCleanupCopyResult,
  resetFailedCleanupCopyToPending,
  migrateLegacy115CleanupState,
  migrateLegacy115DeletionHistory,
  type Legacy115CleanupState,
  type MediaCleanupState,
  type MediaDeletionHistoryState,
} from './mediaCleanupModel';
import {
  applyCleanupWatchEvidence,
  attachMatchingCleanupCopies,
  buildEmbyCleanupSnapshots,
  buildDrive115CleanupSnapshots,
  collectEmbyServerKeys,
  mergeCleanupTitleSnapshots,
  processEmbySyncCleanupState,
  type CleanupWatchEvidenceState,
  type Drive115CleanupLibraryState,
} from './mediaCleanupSync';

export async function loadMediaCleanupState(): Promise<MediaCleanupState> {
  const [current, legacy] = await Promise.all([
    getValue(STORAGE_KEYS.MEDIA_CLEANUP_STATE, EMPTY_MEDIA_CLEANUP_STATE),
    getValue<Legacy115CleanupState>(STORAGE_KEYS.MEDIA_115_CLEANUP_LIST, { items: [], updatedAt: 0 }),
  ]);
  const migrated = migrateLegacy115CleanupState(current, legacy);
  if (migrated !== current) await saveMediaCleanupState(migrated);
  return migrated;
}

export async function saveMediaCleanupState(state: MediaCleanupState): Promise<void> {
  await setValue(STORAGE_KEYS.MEDIA_CLEANUP_STATE, state);
}

export async function loadMediaDeletionHistory(): Promise<MediaDeletionHistoryState> {
  const [current, legacy] = await Promise.all([
    getValue(STORAGE_KEYS.MEDIA_DELETION_HISTORY, EMPTY_MEDIA_DELETION_HISTORY),
    getValue<Legacy115CleanupState>(STORAGE_KEYS.MEDIA_115_CLEANUP_LIST, { items: [], updatedAt: 0 }),
  ]);
  const migrated = migrateLegacy115DeletionHistory(current, legacy);
  if (migrated !== current) await saveMediaDeletionHistory(migrated);
  return migrated;
}

export async function saveMediaDeletionHistory(state: MediaDeletionHistoryState): Promise<void> {
  await setValue(STORAGE_KEYS.MEDIA_DELETION_HISTORY, state);
}

export async function processPersistedEmbySyncCleanup(input: {
  previous: EmbyLibraryState;
  next: EmbyLibraryState;
  successfulServerKeys: ReadonlySet<string>;
  removedServerKeys?: ReadonlySet<string>;
  now: number;
}): Promise<{ enqueuedCount: number; baselineCount: number }> {
  const [cleanup, history, drive115State] = await Promise.all([
    loadMediaCleanupState(),
    loadMediaDeletionHistory(),
    getValue<Drive115CleanupLibraryState>(STORAGE_KEYS.DRIVE115_LIBRARY_STATE, { entries: [], updatedAt: 0 }),
  ]);
  const result = processEmbySyncCleanupState({
    ...input,
    cleanup,
    history,
    additionalTitles: buildDrive115CleanupSnapshots(drive115State),
  });
  await Promise.all([
    saveMediaCleanupState(result.cleanup),
    saveMediaDeletionHistory(result.history),
  ]);
  return {
    enqueuedCount: result.enqueuedCount,
    baselineCount: result.baselineCount,
  };
}

export async function enqueueCompletedPlayback(input: {
  code: string;
  title?: string;
  source: 'emby' | 'jellyfin' | 'drive115';
  copyId: string;
  serverName?: string;
  serverUrl?: string;
  serverId?: string;
  itemId?: string;
  fileId?: string;
  pickCode?: string;
  fileName?: string;
  folderPath?: string;
  watchedAt?: number;
}): Promise<{ added: boolean; state: MediaCleanupState }> {
  const code = String(input.code || '').trim().toUpperCase();
  const copyId = String(input.copyId || '').trim();
  if (!code || !copyId) throw new Error('缺少影片或来源副本标识');
  const now = input.watchedAt || Date.now();
  const state = await loadMediaCleanupState();
  const nowMs = Date.now();
  const result = enqueueWatchedTitle(state, {
    titleId: code,
    code,
    title: String(input.title || code).trim() || code,
    copies: [{
      copyId,
      source: input.source === 'drive115' ? '115' : input.source,
      serverName: input.serverName,
      serverUrl: input.serverUrl,
      serverId: input.serverId,
      itemId: input.itemId,
      fileId: input.fileId,
      pickCode: input.pickCode,
      fileName: input.fileName,
      folderPath: input.folderPath,
      watchedAt: now,
      lastFoundAt: now,
    }],
  }, nowMs);
  await saveMediaCleanupState(result.state);
  return result;
}

/**
 * 操作记录里「失败」副本的重试入口：重置状态后立即执行删除，返回真实删除结果。
 * 用户无需再回到待处理手动确认一次；只有 failed 状态的副本可重试（幂等）。
 */
export async function retryFailedCleanupCopy(input: {
  titleId: string;
  copyId: string;
  deleteCopy: (copy: MediaCleanupState['items'][string]['copies'][string]) => Promise<{
    ok: boolean;
    message: string;
  }>;
}): Promise<{ ok: boolean; changed: boolean; message: string }> {
  const cleanup = await loadMediaCleanupState();
  const next = resetFailedCleanupCopyToPending({
    cleanup,
    titleId: input.titleId,
    copyId: input.copyId,
  });
  if (!next.changed) {
    return { ok: true, changed: false, message: '该副本当前不是失败状态，无需重试' };
  }
  await saveMediaCleanupState(next.cleanup);
  const executed = await executeQueuedCleanupCopy({
    titleId: input.titleId,
    copyId: input.copyId,
    deleteCopy: input.deleteCopy,
  });
  return { ok: executed.ok, changed: true, message: executed.message };
}

export async function executeQueuedCleanupCopy(input: {
  titleId: string;
  copyId: string;
  deleteCopy: (copy: MediaCleanupState['items'][string]['copies'][string]) => Promise<{
    ok: boolean;
    message: string;
  }>;
}): Promise<{ ok: boolean; message: string; cleanup: MediaCleanupState }> {
  const [cleanup, history] = await Promise.all([
    loadMediaCleanupState(),
    loadMediaDeletionHistory(),
  ]);
  const copy = cleanup.items[input.titleId]?.copies[input.copyId];
  if (!copy) return { ok: false, message: '待清理副本不存在或已移除', cleanup };
  const result = await input.deleteCopy(copy);
  const next = markCleanupCopyResult({
    cleanup,
    history,
    titleId: input.titleId,
    copyId: input.copyId,
    success: result.ok,
    error: result.ok ? undefined : result.message,
    message: result.ok ? result.message : undefined,
  });
  await Promise.all([
    saveMediaCleanupState(next.cleanup),
    saveMediaDeletionHistory(next.history),
  ]);
  return { ok: result.ok, message: result.message, cleanup: next.cleanup };
}

export async function importHistoricalWatchedFromCurrentLibrary(): Promise<{
  enqueuedCount: number;
  convergedCount: number;
  state: MediaCleanupState;
}> {
  const [cleanup, libraryState, drive115State, watchEvidence] = await Promise.all([
    loadMediaCleanupState(),
    getValue<EmbyLibraryState>(STORAGE_KEYS.EMBY_LIBRARY_STATE, { entries: {}, updatedAt: 0 }),
    getValue<Drive115CleanupLibraryState>(STORAGE_KEYS.DRIVE115_LIBRARY_STATE, { entries: [], updatedAt: 0 }),
    getValue<CleanupWatchEvidenceState>(STORAGE_KEYS.MEDIA_WATCH_EVIDENCE, { version: 2, titles: {} }),
  ]);
  const snapshots = applyCleanupWatchEvidence(
    mergeCleanupTitleSnapshots([
      buildEmbyCleanupSnapshots(
      libraryState,
      collectEmbyServerKeys(libraryState),
      ),
      buildDrive115CleanupSnapshots(drive115State),
    ]),
    watchEvidence,
  );
  const result = importHistoricalWatched(cleanup, snapshots);
  await saveMediaCleanupState(result.state);
  return {
    enqueuedCount: result.enqueuedCount,
    convergedCount: result.convergedCount,
    state: result.state,
  };
}
