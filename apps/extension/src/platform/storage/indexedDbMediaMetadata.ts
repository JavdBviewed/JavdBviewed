import type { VideoRecord } from '../../types';
import { mergeMediaRecordMetadata, type MediaRecordMetadata } from '../../shared/records/mediaMetadataMerge';
import { initDB } from './indexedDbConnection';
import { normalizeViewedRecord, syncViewedSecondaryIndexes } from './indexedDbViewedIndexes';

/** Metadata-only patch. Callers enqueue the committed value for normal video sync. */
export async function patchMediaRecordMetadata(before: VideoRecord, metadata: MediaRecordMetadata): Promise<VideoRecord> {
  const db = await initDB();
  const tx = db.transaction(['viewedRecords', 'viewedByTag', 'viewedByList'], 'readwrite');
  try {
    const store = tx.objectStore('viewedRecords');
    const current = await store.get(before.id);
    if (!current) throw new Error('影片记录已删除，已停止补全');
    const next = normalizeViewedRecord(mergeMediaRecordMetadata(current, before, metadata, Date.now())) as VideoRecord;
    await store.put(next);
    await syncViewedSecondaryIndexes(tx.objectStore('viewedByTag'), tx.objectStore('viewedByList'), current, next);
    await tx.done;
    return next;
  } catch (error) {
    try { tx.abort(); } catch { /* already aborted */ }
    try { await tx.done; } catch { /* preserve original error */ }
    throw error;
  }
}
