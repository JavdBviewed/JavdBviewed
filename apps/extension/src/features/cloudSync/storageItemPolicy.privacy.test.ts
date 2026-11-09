/** @description 设备私密运行态不能经历史pending、别名或墓碑跨设备传播 */
import { describe, expect, it, vi } from 'vitest';
import type { SyncEntity } from '@javdb/sync-protocol';
import { filterOutgoingSyncEntities, shouldReceiveStorageItemKey, shouldSyncStorageItemKey } from './storageItemPolicy';
import { getWebDAVRestorableStorageKeys, resolveChromeStorageAssetPolicy } from '../../shared/dataAssets/assetRegistry';
vi.mock('./indexReportOutbox', () => ({ getIndexReportKinds: async () => [] }));
const privateKeys = ['privacy_state', 'privacy_session', 'privacy_encryption_key'];
describe('device privacy runtime policy', () => {
  it.each(privateKeys)('never syncs or restores %s as an account asset', key => {
    expect(shouldSyncStorageItemKey(key)).toBe(false); expect(shouldReceiveStorageItemKey(key)).toBe(false);
    expect(getWebDAVRestorableStorageKeys()).not.toContain(key);
    expect(resolveChromeStorageAssetPolicy(key)?.webdav.backup === true).toBe(false);
  });
  it('filters historical pending aliases and tombstones, preserving actual settings', async () => {
    const entries: SyncEntity[] = privateKeys.flatMap(key => [
      { type: 'storage_item', id: key, updatedAt: 1, payload: { key, value: 'opaque' } },
      { type: 'storage_item', id: 'alias', updatedAt: 1, payload: { key: ` ${key} `, value: 'opaque' } },
      { type: 'storage_item', id: key, updatedAt: 1, deletedAt: 1, payload: null },
    ]);
    const settings: SyncEntity = { type: 'storage_item', id: 'settings', updatedAt: 1, payload: { key: 'settings', value: {} } };
    expect(await filterOutgoingSyncEntities([...entries, settings])).toEqual([settings]);
  });
});
