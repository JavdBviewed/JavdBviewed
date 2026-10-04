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

/**
 * 大小写折叠兜底（issue#51）：精确键未命中的查询键（如欧美卡原文大小写 vs 记录大写键）
 * 经一次性 getAllKeys 建 小写→原键 映射，折叠命中者按原键取真实状态。
 * summary.id 回传查询键（原文大小写），调用方按原键回写即可；仅 miss 集调用，每批至多 1 次 getAllKeys。
 * 只读路径；写路径（收藏/状态写入）零改动。
 */
export async function viewedStatusGetManyFolded(
  missIds: readonly string[],
): Promise<ViewedStatusSummary[]> {
  const ids = [...new Set(missIds.filter(Boolean))];
  if (ids.length === 0) return [];

  const db = await initDB();
  const keys = (await db.getAllKeys('viewedRecords')) as string[];
  const foldedToKey = new Map<string, string>();
  for (const key of keys) {
    const folded = String(key).toLowerCase();
    if (!foldedToKey.has(folded)) foldedToKey.set(folded, key); // 双键冲突取首（getAllKeys 顺序）
  }

  const result: ViewedStatusSummary[] = [];
  for (const id of ids) {
    const canonical = foldedToKey.get(id.toLowerCase());
    if (!canonical) continue;
    const record = await db.get('viewedRecords', canonical) as VideoRecord | undefined;
    if (record && !record.deletedAt) {
      result.push({ id, status: record.status, isFavorite: record.isFavorite === true });
    }
  }
  return result;
}
