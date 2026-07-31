/**
 * @file assetMatrix.ts
 * @description Full sync asset matrix: account / vault / rebuildable / local.
 * Source of truth for what may enter Cloud vs stay on-device.
 * @module @javdb/sync-protocol
 */

import { SYNC_ENTITY_TYPES, type SyncEntityType } from './types';

export type CloudAssetClass = 'account' | 'vault' | 'rebuildable' | 'local';

export type ConflictStrategy =
  | 'LWW-record'
  | 'LWW-key'
  | 'LWW-item'
  | 'set-tombstone'
  | 'n/a';

export interface AssetMatrixRow {
  asset: string;
  storage: string;
  cloudClass: CloudAssetClass;
  entityType: SyncEntityType | '-';
  vaultKind?: string;
  conflict: ConflictStrategy;
  webdavAlign: boolean | 'partial';
  notes?: string;
}

/** Account-scoped entities that must be covered by pull/push. */
export const ACCOUNT_ENTITY_TYPES: readonly SyncEntityType[] = SYNC_ENTITY_TYPES;

export const ASSET_MATRIX: readonly AssetMatrixRow[] = [
  // ----- account -----
  {
    asset: 'videos',
    storage: 'IDB viewedRecords; legacy key viewed',
    cloudClass: 'account',
    entityType: 'video',
    conflict: 'LWW-record',
    webdavAlign: true,
    notes: 'soft-delete via deletedAt; set fields use set-tombstone in merge helpers',
  },
  {
    asset: 'actors',
    storage: 'IDB actors; legacy actor_records',
    cloudClass: 'account',
    entityType: 'actor',
    conflict: 'LWW-record',
    webdavAlign: true,
  },
  {
    asset: 'lists',
    storage: 'IDB lists',
    cloudClass: 'account',
    entityType: 'list',
    conflict: 'LWW-record',
    webdavAlign: true,
  },
  {
    asset: 'new_works_records',
    storage: 'IDB newWorks; key new_works_records',
    cloudClass: 'account',
    entityType: 'new_work',
    conflict: 'LWW-record',
    webdavAlign: true,
  },
  {
    asset: 'new_works_subscriptions',
    storage: 'new_works_subscriptions',
    cloudClass: 'account',
    entityType: 'new_work_subscription',
    conflict: 'LWW-record',
    webdavAlign: true,
  },
  {
    asset: 'user_profile',
    storage: 'user_profile',
    cloudClass: 'account',
    entityType: 'user_profile',
    conflict: 'LWW-record',
    webdavAlign: true,
  },
  {
    asset: 'preferences',
    storage: 'settings whitelist paths',
    cloudClass: 'account',
    entityType: 'preference',
    conflict: 'LWW-key',
    webdavAlign: 'partial',
    notes: 'never whole-blob settings; secrets go to vault',
  },
  {
    asset: 'search_presets',
    storage: 'adv_search_presets',
    cloudClass: 'account',
    entityType: 'search_preset',
    conflict: 'LWW-record',
    webdavAlign: true,
  },
  {
    asset: 'magnets',
    storage: 'IDB magnets',
    cloudClass: 'account',
    entityType: 'magnet',
    conflict: 'LWW-record',
    webdavAlign: true,
  },
  {
    asset: 'insights_views',
    storage: 'IDB insightsViews',
    cloudClass: 'account',
    entityType: 'insights_view',
    conflict: 'LWW-record',
    webdavAlign: false,
  },
  {
    asset: 'insights_reports',
    storage: 'IDB insightsReports',
    cloudClass: 'account',
    entityType: 'insights_report',
    conflict: 'LWW-record',
    webdavAlign: false,
  },
  {
    asset: 'new_works_daily_stats',
    storage: 'IDB newWorksDailyStats',
    cloudClass: 'account',
    entityType: 'new_work_daily_stat',
    conflict: 'LWW-record',
    webdavAlign: false,
  },
  {
    asset: 'storage_items',
    storage: 'chrome.storage.local keys not covered by structured entities',
    cloudClass: 'account',
    entityType: 'storage_item',
    conflict: 'LWW-record',
    webdavAlign: 'partial',
    notes: 'generic fallback for recoverable storage keys; excludes device-local session/pending/cursor and migration flags',
  },
  {
    asset: 'emby_library_state',
    storage: 'emby_library_state',
    cloudClass: 'account',
    entityType: 'storage_item',
    conflict: 'LWW-record',
    webdavAlign: false,
  },
  {
    asset: 'drive115_library_state',
    storage: 'drive115_library_state',
    cloudClass: 'account',
    entityType: 'storage_item',
    conflict: 'LWW-record',
    webdavAlign: true,
    notes: '115 library shallow index; credentials remain in settings/vault policy, not this asset',
  },
  {
    asset: 'media_watch_evidence',
    storage: 'media_watch_evidence',
    cloudClass: 'account',
    entityType: 'storage_item',
    conflict: 'LWW-record',
    webdavAlign: false,
  },
  {
    asset: 'media_cleanup_state',
    storage: 'media_cleanup_state',
    cloudClass: 'account',
    entityType: 'storage_item',
    conflict: 'LWW-record',
    webdavAlign: true,
    notes: 'cross-source cleanup queue; physical deletion always requires explicit confirmation',
  },
  {
    asset: 'media_deletion_history',
    storage: 'media_deletion_history',
    cloudClass: 'account',
    entityType: 'storage_item',
    conflict: 'LWW-record',
    webdavAlign: true,
    notes: 'persistent audit ledger only; does not imply recoverable media files',
  },
  {
    asset: 'dashboard_last_page',
    storage: 'dashboard_last_page',
    cloudClass: 'account',
    entityType: 'storage_item',
    conflict: 'LWW-record',
    webdavAlign: false,
  },
  {
    asset: 'last_import_stats',
    storage: 'last_import_stats',
    cloudClass: 'account',
    entityType: 'storage_item',
    conflict: 'LWW-record',
    webdavAlign: true,
  },
  {
    asset: 'restore_backup',
    storage: 'restore_backup / webdav_last_selected_backup',
    cloudClass: 'account',
    entityType: 'storage_item',
    conflict: 'LWW-record',
    webdavAlign: true,
  },
  {
    asset: 'privacy_state',
    storage: 'privacy_state',
    cloudClass: 'account',
    entityType: 'storage_item',
    conflict: 'LWW-record',
    webdavAlign: false,
  },
  {
    asset: 'media_115_cleanup_list',
    storage: 'media_115_cleanup_list',
    cloudClass: 'account',
    entityType: 'storage_item',
    conflict: 'LWW-record',
    webdavAlign: false,
    notes: 'legacy compatibility source; new writes use media_cleanup_state',
  },
  {
    asset: 'logs',
    storage: 'IDB logs; legacy persistent_logs / drive115_logs',
    cloudClass: 'account',
    entityType: 'log',
    conflict: 'LWW-record',
    webdavAlign: true,
    notes: 'general + drive115 unified logs; storage legacy keys also ride storage_item',
  },
  {
    asset: 'magnet_push_logs',
    storage: 'IDB magnetPushLogs; legacy magnetPushLogs_backup',
    cloudClass: 'account',
    entityType: 'magnet_push_log',
    conflict: 'LWW-record',
    webdavAlign: true,
  },
  {
    asset: 'cloud_connection_settings',
    storage: 'cloud_sync_settings_v1',
    cloudClass: 'account',
    entityType: 'storage_item',
    conflict: 'LWW-record',
    webdavAlign: false,
    notes: 'sync baseUrl/deviceLabel/account credentials; deviceId stays device-local and session tokens stay local',
  },
  {
    asset: 'cloud_auto_sync_settings',
    storage: 'cloud_auto_sync_settings_v1',
    cloudClass: 'account',
    entityType: 'storage_item',
    conflict: 'LWW-record',
    webdavAlign: false,
  },
  // ----- vault -----
  {
    asset: 'webdav_credentials',
    storage: 'settings webdav configs',
    cloudClass: 'vault',
    entityType: '-',
    vaultKind: 'webdav',
    conflict: 'LWW-item',
    webdavAlign: true,
  },
  {
    asset: 'drive115_credentials',
    storage: 'settings drive115',
    cloudClass: 'vault',
    entityType: '-',
    vaultKind: 'drive115',
    conflict: 'LWW-item',
    webdavAlign: true,
  },
  {
    asset: 'ai_api_keys',
    storage: 'settings AI keys if any',
    cloudClass: 'vault',
    entityType: '-',
    vaultKind: 'ai',
    conflict: 'LWW-item',
    webdavAlign: false,
    notes: 'confirm field paths at integration; treat API keys as vault',
  },
  // ----- rebuildable -----
  {
    asset: 'viewedByTag',
    storage: 'IDB viewedByTag',
    cloudClass: 'rebuildable',
    entityType: '-',
    conflict: 'n/a',
    webdavAlign: false,
    notes: 'rebuild from videos.tags',
  },
  {
    asset: 'viewedByList',
    storage: 'IDB viewedByList',
    cloudClass: 'rebuildable',
    entityType: '-',
    conflict: 'n/a',
    webdavAlign: false,
    notes: 'rebuild from videos.listIds + lists',
  },
  // ----- local -----
  {
    asset: 'telemetry_client_state',
    storage: 'telemetry client key',
    cloudClass: 'local',
    entityType: '-',
    conflict: 'n/a',
    webdavAlign: false,
  },
  {
    asset: 'privacy_session',
    storage: 'privacy_session',
    cloudClass: 'local',
    entityType: '-',
    conflict: 'n/a',
    webdavAlign: false,
  },
  {
    asset: 'idb_migration_flags',
    storage: 'idb_*_migrated',
    cloudClass: 'local',
    entityType: '-',
    conflict: 'n/a',
    webdavAlign: false,
  },
  {
    asset: 'cloud_device_tokens',
    storage: 'device-local secure store / cloud_sync_session_v1',
    cloudClass: 'local',
    entityType: '-',
    conflict: 'n/a',
    webdavAlign: false,
    notes: 'per-device access/refresh; never sync as business entity',
  },
  {
    asset: 'cloud_runtime_queue',
    storage: 'cloud_sync_pending_v1 / cloud_sync_cursors_v1',
    cloudClass: 'local',
    entityType: '-',
    conflict: 'n/a',
    webdavAlign: false,
    notes: 'device runtime sync state; never sync',
  },
  {
    asset: 'drive115_library_index_progress',
    storage: 'drive115_library_index_progress',
    cloudClass: 'local',
    entityType: '-',
    conflict: 'n/a',
    webdavAlign: false,
    notes: 'in-progress indexing snapshot for current-device dashboard runtime only',
  },
  {
    asset: 'webdav_local_client_identity',
    storage: 'webdav clientId profile',
    cloudClass: 'local',
    entityType: '-',
    conflict: 'n/a',
    webdavAlign: false,
    notes: 'separate from Cloud device registry',
  },
] as const;

export function assetsByClass(cloudClass: CloudAssetClass): AssetMatrixRow[] {
  return ASSET_MATRIX.filter((row) => row.cloudClass === cloudClass);
}

export function accountEntityTypesFromMatrix(): SyncEntityType[] {
  const types = new Set<SyncEntityType>();
  for (const row of ASSET_MATRIX) {
    if (row.cloudClass === 'account' && row.entityType !== '-') {
      types.add(row.entityType);
    }
  }
  return [...types].sort();
}

/**
 * Assert matrix account entity types match the frozen SYNC_ENTITY_TYPES list.
 * Throws if the contract drifts.
 */
export function assertAccountEntityTypesComplete(): void {
  const fromMatrix = new Set(accountEntityTypesFromMatrix());
  const expected = new Set(ACCOUNT_ENTITY_TYPES);
  for (const t of expected) {
    if (!fromMatrix.has(t)) {
      throw new Error(`assetMatrix missing account entityType: ${t}`);
    }
  }
  for (const t of fromMatrix) {
    if (!expected.has(t)) {
      throw new Error(`assetMatrix has undeclared account entityType: ${t}`);
    }
  }
}

/** Preference / settings path classification helpers (string paths, not values). */
export type SettingsPathClass = 'syncable' | 'secret' | 'local';

/**
 * Heuristic path classifier for settings keys.
 * Integration may override with an explicit whitelist; secrets must never be syncable.
 */
export function classifySettingsPath(path: string): SettingsPathClass {
  const p = path.toLowerCase();
  if (
    p.includes('password')
    || p.includes('token')
    || p.includes('secret')
    || p.includes('cookie')
    || p.includes('apikey')
    || p.includes('api_key')
    || p.includes('credential')
  ) {
    return 'secret';
  }
  if (
    p.includes('webdav')
    || p.includes('drive115')
    || p.includes('proxy')
    || p.includes('endpoint')
    || p.endsWith('url') && (p.includes('server') || p.includes('base'))
  ) {
    // 连接配置：凭据进入 vault；裸 URL 仍可能接近敏感信息
    if (p.includes('password') || p.includes('token') || p.includes('user')) {
      return 'secret';
    }
  }
  if (
    p.includes('path')
    || p.includes('session')
    || p.includes('window')
    || p.includes('device')
    || p.includes('telemetry')
  ) {
    return 'local';
  }
  return 'syncable';
}

/** Guard: secret classification must never be treated as syncable entity path. */
export function assertNoSecretMarkedSyncable(
  entries: ReadonlyArray<{ path: string; class: SettingsPathClass }>,
): void {
  for (const e of entries) {
    if (e.class === 'syncable' && classifySettingsPath(e.path) === 'secret') {
      throw new Error(`secret path marked syncable: ${e.path}`);
    }
  }
}
