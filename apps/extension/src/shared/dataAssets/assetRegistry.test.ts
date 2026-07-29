import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '../../utils/config';
import {
  DATA_ASSET_REGISTRY,
  SETTINGS_SENSITIVE_PATH_POLICIES,
  getCloudIncrementalIdbStoreNames,
  getCloudStorageAssetPolicy,
  getIdbStoreAssetPolicy,
  getWebDAVBackupIdbStoreNames,
  getWebDAVRestorableStorageKeys,
  resolveChromeStorageAssetPolicy,
  resolveIdbStoreAssetPolicy,
} from './assetRegistry';

const root = process.cwd();

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(root, relativePath), 'utf8');
}

function collectIdbObjectStores(): string[] {
  const source = readSource('apps/extension/src/platform/storage/indexedDbConnection.ts');
  return Array.from(source.matchAll(/createObjectStore\(['"]([^'"]+)['"]/g))
    .map(match => match[1])
    .filter((store, index, stores) => stores.indexOf(store) === index)
    .sort();
}

describe('data asset registry guard', () => {
  it('registers every STORAGE_KEYS value or a matching dynamic key pattern', () => {
    const missing = Object.values(STORAGE_KEYS)
      .filter(key => !resolveChromeStorageAssetPolicy(key))
      .sort();

    expect(missing).toEqual([]);
  });

  it('registers every IndexedDB object store declared by schema migrations', () => {
    const missing = collectIdbObjectStores()
      .filter(store => !resolveIdbStoreAssetPolicy(store))
      .sort();

    expect(missing).toEqual([]);
  });

  it('classifies known dynamic storage key patterns and hard-fails unknown keys', () => {
    expect(resolveChromeStorageAssetPolicy('restore_backup_2026-07-20')?.assetClass).toBe('account');
    expect(resolveChromeStorageAssetPolicy('taskCenter:snapshot')?.assetClass).toBe('runtime');
    expect(resolveChromeStorageAssetPolicy('cache_actor_ABC')?.assetClass).toBe('cache');
    expect(resolveChromeStorageAssetPolicy('unknown_future_feature_key')).toBeUndefined();
  });

  it('exposes channel policy lists from one registry source', () => {
    expect(getCloudStorageAssetPolicy(STORAGE_KEYS.SETTINGS)?.cloud.full).toBe(true);
    expect(getCloudStorageAssetPolicy('cloud_sync_settings_v1')?.cloud.full).toBe(true);
    expect(getCloudStorageAssetPolicy(STORAGE_KEYS.DRIVE115_LIBRARY_STATE)?.cloud.full).toBe(true);
    expect(getCloudStorageAssetPolicy(STORAGE_KEYS.MEDIA_WATCH_EVIDENCE)?.cloud.full).toBe(true);
    expect(getCloudStorageAssetPolicy(STORAGE_KEYS.MEDIA_WATCH_EVIDENCE)?.cloud.incremental).toBe(true);
    expect(resolveChromeStorageAssetPolicy(STORAGE_KEYS.MEDIA_WATCH_EVIDENCE)?.webdav.restoreMode).toBe('merge');
    expect(getCloudStorageAssetPolicy(STORAGE_KEYS.DRIVE115_LIBRARY_INDEX_PROGRESS)).toBeUndefined();
    expect(getCloudStorageAssetPolicy('cloud_sync_session_v1')).toBeUndefined();

    expect(getWebDAVRestorableStorageKeys()).toEqual(
      expect.arrayContaining([
        STORAGE_KEYS.PRIVACY_STATE,
        STORAGE_KEYS.EMBY_LIBRARY_STATE,
        STORAGE_KEYS.DRIVE115_LIBRARY_STATE,
        STORAGE_KEYS.MEDIA_WATCH_EVIDENCE,
        STORAGE_KEYS.MEDIA_115_CLEANUP_LIST,
        STORAGE_KEYS.DASHBOARD_LAST_PAGE,
        'cloud_sync_settings_v1',
        'cloud_auto_sync_settings_v1',
        STORAGE_KEYS.WEBDAV_LAST_SELECTED_BACKUP,
      ]),
    );

    expect(getWebDAVBackupIdbStoreNames()).toEqual(
      expect.arrayContaining([
        'viewedRecords',
        'actors',
        'lists',
        'newWorks',
        'magnets',
        'logs',
        'magnetPushLogs',
        'insightsViews',
        'insightsReports',
        'newWorksDailyStats',
      ]),
    );

    expect(getCloudIncrementalIdbStoreNames()).toEqual(
      expect.arrayContaining(['logs', 'magnetPushLogs']),
    );
  });

  it('keeps settings sensitive paths documented while allowing full Cloud sync for now', () => {
    const settingsPolicy = resolveChromeStorageAssetPolicy(STORAGE_KEYS.SETTINGS);

    expect(settingsPolicy?.cloud.full).toBe(true);
    expect(settingsPolicy?.sensitiveFieldsAllowedInCloud).toBe(true);
    expect(SETTINGS_SENSITIVE_PATH_POLICIES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'webdav.password', currentCloudPolicy: 'allowed' }),
        expect.objectContaining({ path: 'drive115.authToken', currentCloudPolicy: 'allowed' }),
        expect.objectContaining({ path: 'ai.providers.*.apiKey', currentCloudPolicy: 'allowed' }),
        expect.objectContaining({ path: 'privacy.privateMode.passwordHash', currentCloudPolicy: 'allowed' }),
        expect.objectContaining({ path: 'privacy.privateMode.passwordSalt', currentCloudPolicy: 'allowed' }),
      ]),
    );
  });

  it('does not contain duplicate asset ids', () => {
    const ids = DATA_ASSET_REGISTRY.map(asset => asset.id);
    const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);

    expect(duplicateIds).toEqual([]);
  });
});
