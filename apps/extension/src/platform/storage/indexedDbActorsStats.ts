/**
 * @file indexedDbActorsStats.ts
 * @description IndexedDB 演员统计查询
 * @module platform/storage
 */
import { initDB } from './indexedDbConnection';

export interface ActorsStats {
  total: number;
  byGender: Record<string, number>;
  byCategory: Record<string, number>;
  blacklisted: number;
  recentlyAdded: number;
  recentlyUpdated: number;
}

export async function actorsStats(): Promise<ActorsStats> {
  const db = await initDB();
  const tx = db.transaction('actors');
  const store = tx.store;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const countIndexed = (indexName: 'by_gender' | 'by_category' | 'by_createdAt' | 'by_updatedAt', key: IDBValidKey | IDBKeyRange): Promise<number> => (
    store.index(indexName).count(key as any).catch(() => 0)
  );
  // IndexedDB does not support boolean index keys, so legacy `blacklisted`
  // values are absent from `by_blacklisted` and must be counted directly.
  const blacklistedActors = await store.getAll();
  const [
    total, female, male, unknownGender, censored, uncensored, western, unknownCategory, recentlyAdded, recentlyUpdated,
  ] = await Promise.all([
    store.count(),
    countIndexed('by_gender', IDBKeyRange.only('female')),
    countIndexed('by_gender', IDBKeyRange.only('male')),
    countIndexed('by_gender', IDBKeyRange.only('unknown')),
    countIndexed('by_category', IDBKeyRange.only('censored')),
    countIndexed('by_category', IDBKeyRange.only('uncensored')),
    countIndexed('by_category', IDBKeyRange.only('western')),
    countIndexed('by_category', IDBKeyRange.only('unknown')),
    countIndexed('by_createdAt', IDBKeyRange.lowerBound(weekAgo, true)),
    countIndexed('by_updatedAt', IDBKeyRange.lowerBound(weekAgo, true)),
  ]);

  return {
    total,
    byGender: { female, male, unknown: unknownGender },
    byCategory: { censored, uncensored, western, unknown: unknownCategory },
    blacklisted: blacklistedActors.filter((actor: any) => actor?.blacklisted === true).length,
    recentlyAdded,
    recentlyUpdated,
  };
}
