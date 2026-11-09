/**
 * @file storageItemPolicy.ts
 * @description Cloud 同步 Chrome Storage 兜底项过滤规则
 * @module features/cloudSync
 */
import { STORAGE_KEYS } from '../../utils/config';
import type { SyncEntity } from '@javdb/sync-protocol';
import type { IndexReportKind } from '@javdb/sync-client';
import { getIndexReportKinds } from './indexReportOutbox';
import { getCloudStorageAssetPolicy } from '../../shared/dataAssets/assetRegistry';

export const STORAGE_ITEM_TYPE = 'storage_item';

export function shouldSyncStorageItemKey(key: string): boolean {
  if (!key || key.trim() === STORAGE_KEYS.LOCAL_MEDIA_LIBRARY_STATE) return false;
  return getCloudStorageAssetPolicy(key)?.cloud.full === true;
}

/** 入站允许只读聚合；出站仍使用shouldSyncStorageItemKey。 */
export function shouldReceiveStorageItemKey(key: string): boolean {
  return key === STORAGE_KEYS.LOCAL_MEDIA_LIBRARY_STATE || shouldSyncStorageItemKey(key);
}

const DEVICE_PRIVACY_KEYS = new Set<string>([
  STORAGE_KEYS.PRIVACY_STATE, STORAGE_KEYS.PRIVACY_SESSION, 'privacy_encryption_key',
]);

/** 阻挡历史pending与入站别名，防止id和payload.key互相绕过。 */
export function isDevicePrivacyEntity(entity: SyncEntity): boolean {
  if (entity.type !== STORAGE_ITEM_TYPE) return false;
  const payload = entity.payload;
  const key = payload && typeof payload === 'object' && 'key' in payload ? payload.key : undefined;
  return [entity.id, key].some(value => typeof value === 'string' && DEVICE_PRIVACY_KEYS.has(value.trim()));
}

function isLocalMediaAggregate(entity: SyncEntity): boolean {
  if (entity.type !== STORAGE_ITEM_TYPE) return false;
  const payload = entity.payload;
  const key = payload && typeof payload === 'object' && 'key' in payload ? payload.key : undefined;
  return [entity.id, key].some((value) => typeof value === 'string'
    && value.trim() === STORAGE_KEYS.LOCAL_MEDIA_LIBRARY_STATE);
}

const INDEX_AGGREGATES: Readonly<Record<string, IndexReportKind>> = {
  emby_library_state: 'emby',
  drive115_library_state: 'drive115',
};

/** Also filters pre-existing base/delta entries, including aggregate tombstones. */
export async function filterOutgoingSyncEntities(entities: SyncEntity[]): Promise<SyncEntity[]> {
  const outgoing = entities.filter((entity) => !isLocalMediaAggregate(entity) && !isDevicePrivacyEntity(entity));
  if (!outgoing.some((e) => e.type === STORAGE_ITEM_TYPE && Object.prototype.hasOwnProperty.call(INDEX_AGGREGATES, e.id))) return outgoing;
  const kinds = await getIndexReportKinds();
  return outgoing.filter((entity) => entity.type !== STORAGE_ITEM_TYPE
    || !Object.prototype.hasOwnProperty.call(INDEX_AGGREGATES, entity.id)
    || !kinds.includes(INDEX_AGGREGATES[entity.id]));
}
