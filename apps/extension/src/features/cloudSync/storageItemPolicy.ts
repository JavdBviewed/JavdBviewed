/**
 * @file storageItemPolicy.ts
 * @description Cloud 同步 Chrome Storage 兜底项过滤规则
 * @module features/cloudSync
 */
import type { SyncEntity } from '@javdb/sync-protocol';
import type { IndexReportKind } from '@javdb/sync-client';
import { getIndexReportKinds } from './indexReportOutbox';
import { getCloudStorageAssetPolicy } from '../../shared/dataAssets/assetRegistry';

export const STORAGE_ITEM_TYPE = 'storage_item';

export function shouldSyncStorageItemKey(key: string): boolean {
  if (!key) return false;
  return getCloudStorageAssetPolicy(key)?.cloud.full === true;
}

const INDEX_AGGREGATES: Readonly<Record<string, IndexReportKind>> = {
  emby_library_state: 'emby',
  drive115_library_state: 'drive115',
};

/** Also filters pre-existing base/delta entries, including aggregate tombstones. */
export async function filterOutgoingSyncEntities(entities: SyncEntity[]): Promise<SyncEntity[]> {
  if (!entities.some((e) => e.type === STORAGE_ITEM_TYPE && Object.prototype.hasOwnProperty.call(INDEX_AGGREGATES, e.id))) return entities;
  const kinds = await getIndexReportKinds();
  return entities.filter((entity) => entity.type !== STORAGE_ITEM_TYPE
    || !Object.prototype.hasOwnProperty.call(INDEX_AGGREGATES, entity.id)
    || !kinds.includes(INDEX_AGGREGATES[entity.id]));
}
