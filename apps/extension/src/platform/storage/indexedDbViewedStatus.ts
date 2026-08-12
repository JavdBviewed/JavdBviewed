/**
 * @file indexedDbViewedStatus.ts
 * @description 已看记录轻量状态查询 —— 仅返回列表状态所需字段
 * @module platform/storage
 */
import type { VideoRecord, ViewedStatusSummary } from '../../types';
import { initDB } from './indexedDbConnection';
import { chunkViewedStatusIds } from './viewedStatusBatch';

/** 只读取指定番号的观看状态，避免同步新作品时复制整张番号库。 */
export async function viewedStatusGetMany(
  videoIds: readonly string[],
): Promise<ViewedStatusSummary[]> {
  const batches = chunkViewedStatusIds(videoIds);
  if (batches.length === 0) return [];

  const db = await initDB();
  const result: ViewedStatusSummary[] = [];
  for (const ids of batches) {
    for (const id of ids) {
      const record = await db.get('viewedRecords', id) as VideoRecord | undefined;
      if (record && !record.deletedAt) {
        result.push({ id: record.id, status: record.status, isFavorite: record.isFavorite === true });
      }
    }
  }
  return result;
}
