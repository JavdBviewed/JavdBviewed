import { STORAGE_KEYS } from '../../utils/config';

export type DataAssetClass =
  | 'account'
  | 'vault'
  | 'rebuildable'
  | 'local-only'
  | 'runtime'
  | 'cache'
  | 'diagnostic'
  | 'legacy-compat';

export type DataAssetStorageKind = 'chrome-storage' | 'dynamic-key' | 'idb-store' | 'settings-path';

export type RestoreMode = 'replace' | 'merge' | 'skip';

export type DataAssetPolicy = {
  id: string;
  storage: {
    kind: DataAssetStorageKind;
    key: string;
    match?: 'exact' | 'prefix';
  };
  assetClass: DataAssetClass;
  webdav: {
    backup: boolean;
    restore: boolean;
    restoreMode?: RestoreMode;
  };
  cloud: {
    full: boolean;
    incremental: boolean;
    entityType?: string;
    allowDelete?: boolean;
  };
  sensitive?: boolean;
  sensitiveFieldsAllowedInCloud?: boolean;
  preserveLocalFields?: readonly string[];
  reason: string;
};

export type SettingsSensitivePathPolicy = {
  path: string;
  assetClass: 'vault';
  currentCloudPolicy: 'allowed';
  futurePolicy: 'vault-candidate';
  reason: string;
};

export const CLOUD_SETTINGS_STORAGE_KEY = 'cloud_sync_settings_v1';
export const CLOUD_AUTO_SYNC_STORAGE_KEY = 'cloud_auto_sync_settings_v1';

export const SETTINGS_SENSITIVE_PATH_POLICIES: readonly SettingsSensitivePathPolicy[] = [
  {
    path: 'webdav.password',
    assetClass: 'vault',
    currentCloudPolicy: 'allowed',
    futurePolicy: 'vault-candidate',
    reason: 'WebDAV 密码当前随完整 settings 进入用户自建 Cloud，未来可迁移到 vault。',
  },
  {
    path: 'drive115.authToken',
    assetClass: 'vault',
    currentCloudPolicy: 'allowed',
    futurePolicy: 'vault-candidate',
    reason: '115 凭据当前随完整 settings 同步，未来如需剥离再单独迁移。',
  },
  {
    path: 'ai.providers.*.apiKey',
    assetClass: 'vault',
    currentCloudPolicy: 'allowed',
    futurePolicy: 'vault-candidate',
    reason: 'AI key 当前允许进入用户自建 Cloud，registry 记录风险边界。',
  },
  {
    path: 'emby.mediaServers.*.password',
    assetClass: 'vault',
    currentCloudPolicy: 'allowed',
    futurePolicy: 'vault-candidate',
    reason: 'Emby/Jellyfin 来源密码当前随完整 settings 备份和同步，未来迁移到凭据 vault。',
  },
  {
    path: 'privacy.privateMode.passwordHash',
    assetClass: 'vault',
    currentCloudPolicy: 'allowed',
    futurePolicy: 'vault-candidate',
    reason: '隐私密码 hash 当前不剥离，未来可迁移到 vault。',
  },
  {
    path: 'privacy.privateMode.passwordSalt',
    assetClass: 'vault',
    currentCloudPolicy: 'allowed',
    futurePolicy: 'vault-candidate',
    reason: '隐私密码 salt 当前不剥离，未来可迁移到 vault。',
  },
] as const;

const chromeStorage = (
  id: string,
  key: string,
  assetClass: DataAssetClass,
  webdav: DataAssetPolicy['webdav'],
  cloud: DataAssetPolicy['cloud'],
  reason: string,
  extra: Pick<DataAssetPolicy, 'sensitive' | 'sensitiveFieldsAllowedInCloud' | 'preserveLocalFields'> = {},
): DataAssetPolicy => ({
  id,
  storage: { kind: 'chrome-storage', key, match: 'exact' },
  assetClass,
  webdav,
  cloud,
  reason,
  ...extra,
});

const dynamicKey = (
  id: string,
  keyPrefix: string,
  assetClass: DataAssetClass,
  webdav: DataAssetPolicy['webdav'],
  cloud: DataAssetPolicy['cloud'],
  reason: string,
): DataAssetPolicy => ({
  id,
  storage: { kind: 'dynamic-key', key: keyPrefix, match: 'prefix' },
  assetClass,
  webdav,
  cloud,
  reason,
});

const idbStore = (
  id: string,
  key: string,
  assetClass: DataAssetClass,
  webdav: DataAssetPolicy['webdav'],
  cloud: DataAssetPolicy['cloud'],
  reason: string,
): DataAssetPolicy => ({
  id,
  storage: { kind: 'idb-store', key, match: 'exact' },
  assetClass,
  webdav,
  cloud,
  reason,
});

export const DATA_ASSET_REGISTRY: readonly DataAssetPolicy[] = [
  chromeStorage(
    'storage.settings',
    STORAGE_KEYS.SETTINGS,
    'account',
    { backup: true, restore: true, restoreMode: 'replace' },
    { full: true, incremental: true, entityType: 'storage_item', allowDelete: true },
    '完整扩展设置是可恢复账户资产；Cloud 当前信任用户自建实例。',
    { sensitiveFieldsAllowedInCloud: true },
  ),
  chromeStorage(
    'storage.viewed.legacy',
    STORAGE_KEYS.VIEWED_RECORDS,
    'legacy-compat',
    { backup: true, restore: true, restoreMode: 'merge' },
    { full: false, incremental: false },
    '旧版 viewed map 仅作为备份兼容源；结构化 IDB 是主来源。',
  ),
  chromeStorage(
    'storage.logs.legacy',
    STORAGE_KEYS.LOGS,
    'account',
    { backup: true, restore: true, restoreMode: 'merge' },
    { full: true, incremental: true, entityType: 'storage_item', allowDelete: true },
    '旧版持久日志 key 保留跨端同步兼容，IDB logs 是结构化主来源。',
  ),
  chromeStorage(
    'storage.drive115Logs.legacy',
    'drive115_logs',
    'account',
    { backup: true, restore: true, restoreMode: 'merge' },
    { full: true, incremental: true, entityType: 'storage_item', allowDelete: true },
    '旧版 115 日志 key 保留跨端同步兼容。',
  ),
  chromeStorage(
    'storage.magnetPushLogsBackup.legacy',
    'magnetPushLogs_backup',
    'account',
    { backup: true, restore: true, restoreMode: 'merge' },
    { full: true, incremental: true, entityType: 'storage_item', allowDelete: true },
    '旧版磁力推送日志备份 key 保留跨端同步兼容。',
  ),
  chromeStorage(
    'storage.lastImportStats',
    STORAGE_KEYS.LAST_IMPORT_STATS,
    'account',
    { backup: true, restore: true, restoreMode: 'replace' },
    { full: true, incremental: true, entityType: 'storage_item', allowDelete: true },
    '最近导入结果是用户可见状态，可备份恢复。',
  ),
  chromeStorage(
    'storage.userProfile.legacy',
    STORAGE_KEYS.USER_PROFILE,
    'account',
    { backup: true, restore: true, restoreMode: 'replace' },
    { full: false, incremental: false },
    '用户资料由 user_profile entity 同步，storage key 保留 WebDAV 兼容。',
  ),
  chromeStorage(
    'storage.actorRecords.legacy',
    STORAGE_KEYS.ACTOR_RECORDS,
    'legacy-compat',
    { backup: true, restore: true, restoreMode: 'merge' },
    { full: false, incremental: false },
    '旧版演员 map 仅作为备份兼容源；结构化 IDB 是主来源。',
  ),
  chromeStorage(
    'storage.restoreBackup.base',
    STORAGE_KEYS.RESTORE_BACKUP,
    'account',
    { backup: true, restore: true, restoreMode: 'replace' },
    { full: true, incremental: true, entityType: 'storage_item', allowDelete: true },
    '恢复点索引需要跨端保留。',
  ),
  chromeStorage(
    'storage.webdavLastSelectedBackup',
    STORAGE_KEYS.WEBDAV_LAST_SELECTED_BACKUP,
    'account',
    { backup: true, restore: true, restoreMode: 'replace' },
    { full: true, incremental: true, entityType: 'storage_item', allowDelete: true },
    '上次选择的备份可帮助恢复流程续接。',
  ),
  chromeStorage(
    'storage.privacyState',
    STORAGE_KEYS.PRIVACY_STATE,
    'account',
    { backup: true, restore: true, restoreMode: 'replace' },
    { full: true, incremental: true, entityType: 'storage_item', allowDelete: true },
    '隐私配置是用户资产；当前允许进入用户自建 Cloud。',
    { sensitive: true },
  ),
  chromeStorage(
    'storage.privacySession',
    STORAGE_KEYS.PRIVACY_SESSION,
    'runtime',
    { backup: false, restore: false, restoreMode: 'skip' },
    { full: false, incremental: false },
    '隐私解锁会话只属于当前设备运行态。',
  ),
  chromeStorage(
    'storage.newWorksSubscriptions.legacy',
    STORAGE_KEYS.NEW_WORKS_SUBSCRIPTIONS,
    'account',
    { backup: true, restore: true, restoreMode: 'merge' },
    { full: false, incremental: false },
    '订阅由 new_work_subscription entity 同步，storage key 保留 WebDAV 兼容。',
  ),
  chromeStorage(
    'storage.newWorksRecords.legacy',
    STORAGE_KEYS.NEW_WORKS_RECORDS,
    'legacy-compat',
    { backup: true, restore: true, restoreMode: 'merge' },
    { full: false, incremental: false },
    '旧版新作品 map 仅作为备份兼容源；结构化 IDB 是主来源。',
  ),
  chromeStorage(
    'storage.newWorksConfig',
    STORAGE_KEYS.NEW_WORKS_CONFIG,
    'account',
    { backup: true, restore: true, restoreMode: 'replace' },
    { full: true, incremental: true, entityType: 'storage_item', allowDelete: true },
    '新作品全局配置需要随用户迁移。',
  ),
  chromeStorage(
    'storage.advancedSearchPresets.legacy',
    STORAGE_KEYS.ADV_SEARCH_PRESETS,
    'account',
    { backup: true, restore: true, restoreMode: 'merge' },
    { full: false, incremental: false },
    '高级搜索方案由 search_preset entity 同步，storage key 保留 WebDAV 兼容。',
  ),
  chromeStorage(
    'storage.idbMigrated',
    STORAGE_KEYS.IDB_MIGRATED,
    'local-only',
    { backup: false, restore: false, restoreMode: 'skip' },
    { full: false, incremental: false },
    '迁移完成标记只描述本机存储状态。',
  ),
  chromeStorage(
    'storage.idbLogsMigrated',
    STORAGE_KEYS.IDB_LOGS_MIGRATED,
    'local-only',
    { backup: false, restore: false, restoreMode: 'skip' },
    { full: false, incremental: false },
    '日志迁移完成标记只描述本机存储状态。',
  ),
  chromeStorage(
    'storage.idbActorsMigrated',
    STORAGE_KEYS.IDB_ACTORS_MIGRATED,
    'local-only',
    { backup: false, restore: false, restoreMode: 'skip' },
    { full: false, incremental: false },
    '演员迁移完成标记只描述本机存储状态。',
  ),
  chromeStorage(
    'storage.embyLibraryState',
    STORAGE_KEYS.EMBY_LIBRARY_STATE,
    'account',
    { backup: true, restore: true, restoreMode: 'replace' },
    { full: true, incremental: true, entityType: 'storage_item', allowDelete: true },
    '媒体库命中状态是用户跨端可恢复资产，不属于本地运行态。',
  ),
  chromeStorage(
    'storage.drive115LibraryState',
    STORAGE_KEYS.DRIVE115_LIBRARY_STATE,
    'account',
    { backup: true, restore: true, restoreMode: 'replace' },
    { full: true, incremental: true, entityType: 'storage_item', allowDelete: true },
    '115 片库浅层索引是跨端可恢复资产，与 settings.drive115 凭据分离。',
  ),
  chromeStorage(
    'storage.drive115LibraryIndexProgress',
    STORAGE_KEYS.DRIVE115_LIBRARY_INDEX_PROGRESS,
    'runtime',
    { backup: false, restore: false, restoreMode: 'skip' },
    { full: false, incremental: false },
    '115 片库索引进行中进度只服务当前设备 Dashboard 实时展示。',
  ),
  chromeStorage(
    'storage.drive115LibraryIndexReport',
    STORAGE_KEYS.DRIVE115_LIBRARY_INDEX_REPORT,
    'diagnostic',
    { backup: false, restore: false, restoreMode: 'skip' },
    { full: false, incremental: false },
    '115 片库上一轮索引报告用于本机排查，可重新索引生成。',
  ),
  chromeStorage(
    'storage.media115CleanupList',
    STORAGE_KEYS.MEDIA_115_CLEANUP_LIST,
    'legacy-compat',
    { backup: true, restore: true, restoreMode: 'replace' },
    { full: true, incremental: true, entityType: 'storage_item', allowDelete: true },
    '旧版 115 单来源清理清单保留迁移和备份兼容，新写入使用通用清理状态。',
  ),
  chromeStorage(
    'storage.mediaWatchEvidence',
    STORAGE_KEYS.MEDIA_WATCH_EVIDENCE,
    'account',
    { backup: true, restore: true, restoreMode: 'merge' },
    { full: true, incremental: true, entityType: 'storage_item', allowDelete: true },
    '真实观看证据是跨端业务状态。',
  ),
  chromeStorage(
    'storage.mediaCleanupState',
    STORAGE_KEYS.MEDIA_CLEANUP_STATE,
    'account',
    { backup: true, restore: true, restoreMode: 'merge' },
    { full: true, incremental: true, entityType: 'storage_item', allowDelete: true },
    '跨来源待清理队列包含用户确认状态，需要跨端备份与续接。',
  ),
  chromeStorage(
    'storage.mediaDeletionHistory',
    STORAGE_KEYS.MEDIA_DELETION_HISTORY,
    'account',
    { backup: true, restore: true, restoreMode: 'merge' },
    { full: true, incremental: true, entityType: 'storage_item', allowDelete: true },
    '已看副本的删除历史是持久审计账本，用于找回记录而非恢复视频文件。',
  ),
  chromeStorage(
    'storage.dashboardLastPage',
    STORAGE_KEYS.DASHBOARD_LAST_PAGE,
    'account',
    { backup: true, restore: true, restoreMode: 'replace' },
    { full: true, incremental: true, entityType: 'storage_item', allowDelete: true },
    'Dashboard 恢复位置是轻量用户偏好。',
  ),
  chromeStorage(
    'storage.cloudSettings',
    CLOUD_SETTINGS_STORAGE_KEY,
    'account',
    { backup: true, restore: true, restoreMode: 'merge' },
    { full: true, incremental: true, entityType: 'storage_item', allowDelete: false },
    'Cloud 连接地址、设备名与登录凭据可备份和同步；应用时必须保护本机 deviceId，会话令牌保持本机。',
    { preserveLocalFields: ['deviceId'] },
  ),
  chromeStorage(
    'storage.cloudAutoSyncSettings',
    CLOUD_AUTO_SYNC_STORAGE_KEY,
    'account',
    { backup: true, restore: true, restoreMode: 'replace' },
    { full: true, incremental: true, entityType: 'storage_item', allowDelete: true },
    'Cloud 自动同步偏好是可恢复用户设置。',
  ),
  chromeStorage(
    'storage.cloudSession',
    'cloud_sync_session_v1',
    'runtime',
    { backup: false, restore: false, restoreMode: 'skip' },
    { full: false, incremental: false },
    'Cloud 会话状态只属于本机运行态。',
  ),
  chromeStorage(
    'storage.cloudPending',
    'cloud_sync_pending_v1',
    'runtime',
    { backup: false, restore: false, restoreMode: 'skip' },
    { full: false, incremental: false },
    'Cloud pending 队列不能跨端复制。',
  ),
  chromeStorage(
    'storage.cloudCursors',
    'cloud_sync_cursors_v1',
    'runtime',
    { backup: false, restore: false, restoreMode: 'skip' },
    { full: false, incremental: false },
    'Cloud 游标是本机同步进度。',
  ),
  chromeStorage(
    'storage.telemetryClientState',
    'telemetry_client_state',
    'local-only',
    { backup: false, restore: false, restoreMode: 'skip' },
    { full: false, incremental: false },
    '遥测客户端状态只描述本机。',
  ),
  chromeStorage(
    'storage.serverEndpointState',
    'server_endpoint_state',
    'runtime',
    { backup: false, restore: false, restoreMode: 'skip' },
    { full: false, incremental: false },
    '服务端端点探测状态是运行态。',
  ),
  chromeStorage(
    'storage.alarmDiagnostics',
    'alarmDiagnostics:v1',
    'diagnostic',
    { backup: false, restore: false, restoreMode: 'skip' },
    { full: false, incremental: false },
    '闹钟诊断数据不应跨端恢复。',
  ),
  chromeStorage(
    'storage.performanceOptimizerSnapshot',
    'performanceOptimizerSnapshot',
    'diagnostic',
    { backup: false, restore: false, restoreMode: 'skip' },
    { full: false, incremental: false },
    '性能快照属于诊断数据。',
  ),
  chromeStorage(
    'storage.routesUpdateStatus',
    'routes_update_status',
    'runtime',
    { backup: false, restore: false, restoreMode: 'skip' },
    { full: false, incremental: false },
    '线路更新状态可重新计算。',
  ),
  chromeStorage(
    'storage.actorRemarksCache',
    'actor_remarks_cache',
    'cache',
    { backup: false, restore: false, restoreMode: 'skip' },
    { full: false, incremental: false },
    '演员备注缓存可重建。',
  ),
  chromeStorage(
    'storage.aiModelsCache',
    'ai_models_cache',
    'cache',
    { backup: false, restore: false, restoreMode: 'skip' },
    { full: false, incremental: false },
    'AI 模型列表缓存可重新拉取。',
  ),
  chromeStorage(
    'storage.drive115QuotaCache',
    'drive115_quota_cache',
    'cache',
    { backup: false, restore: false, restoreMode: 'skip' },
    { full: false, incremental: false },
    '115 空间配额缓存可重新拉取。',
  ),
  chromeStorage(
    'storage.webdavWarnLastAt',
    'webdav-warn-last-at',
    'runtime',
    { backup: false, restore: false, restoreMode: 'skip' },
    { full: false, incremental: false },
    'WebDAV 提醒节流时间只属于本机。',
  ),

  dynamicKey(
    'storage.restoreBackup.dynamic',
    `${STORAGE_KEYS.RESTORE_BACKUP}_`,
    'account',
    { backup: true, restore: true, restoreMode: 'replace' },
    { full: true, incremental: true, entityType: 'storage_item', allowDelete: true },
    '具体恢复点 key 使用 restore_backup_* 前缀。',
  ),
  dynamicKey(
    'storage.taskCenter.dynamic',
    'taskCenter:',
    'runtime',
    { backup: false, restore: false, restoreMode: 'skip' },
    { full: false, incremental: false },
    '任务中心快照和去重索引是运行态。',
  ),
  dynamicKey(
    'storage.cache.dynamic',
    'cache_',
    'cache',
    { backup: false, restore: false, restoreMode: 'skip' },
    { full: false, incremental: false },
    'cache_* 均视为可重建缓存。',
  ),
  dynamicKey(
    'storage.idbMigrated.dynamic',
    'idb_',
    'local-only',
    { backup: false, restore: false, restoreMode: 'skip' },
    { full: false, incremental: false },
    'idb_*_migrated 标记描述本机迁移状态。',
  ),

  idbStore(
    'idb.viewedRecords',
    'viewedRecords',
    'account',
    { backup: true, restore: true, restoreMode: 'merge' },
    { full: true, incremental: true, entityType: 'video', allowDelete: true },
    '核心番号记录。',
  ),
  idbStore(
    'idb.viewedByTag',
    'viewedByTag',
    'rebuildable',
    { backup: false, restore: false, restoreMode: 'skip' },
    { full: false, incremental: false },
    '标签反查索引可从 viewedRecords 重建。',
  ),
  idbStore(
    'idb.viewedByList',
    'viewedByList',
    'rebuildable',
    { backup: false, restore: false, restoreMode: 'skip' },
    { full: false, incremental: false },
    '清单反查索引可从 viewedRecords 重建。',
  ),
  idbStore(
    'idb.lists',
    'lists',
    'account',
    { backup: true, restore: true, restoreMode: 'merge' },
    { full: true, incremental: true, entityType: 'list', allowDelete: true },
    '本地清单、系列和标签记录。',
  ),
  idbStore(
    'idb.logs',
    'logs',
    'account',
    { backup: true, restore: true, restoreMode: 'merge' },
    { full: true, incremental: true, entityType: 'log', allowDelete: false },
    '持久日志需要全量和增量同步。',
  ),
  idbStore(
    'idb.actors',
    'actors',
    'account',
    { backup: true, restore: true, restoreMode: 'merge' },
    { full: true, incremental: true, entityType: 'actor', allowDelete: true },
    '演员库记录。',
  ),
  idbStore(
    'idb.newWorks',
    'newWorks',
    'account',
    { backup: true, restore: true, restoreMode: 'merge' },
    { full: true, incremental: true, entityType: 'new_work', allowDelete: true },
    '新作品发现记录。',
  ),
  idbStore(
    'idb.magnets',
    'magnets',
    'cache',
    { backup: true, restore: true, restoreMode: 'merge' },
    { full: true, incremental: true, entityType: 'magnet', allowDelete: true },
    '磁力搜索缓存当前作为可迁移辅助资产保留。',
  ),
  idbStore(
    'idb.magnetPushLogs',
    'magnetPushLogs',
    'account',
    { backup: true, restore: true, restoreMode: 'merge' },
    { full: true, incremental: true, entityType: 'magnet_push_log', allowDelete: false },
    '115 推送日志需要全量和增量同步。',
  ),
  idbStore(
    'idb.insightsViews',
    'insightsViews',
    'account',
    { backup: true, restore: true, restoreMode: 'merge' },
    { full: true, incremental: true, entityType: 'insights_view', allowDelete: true },
    'Insights 每日视图统计。',
  ),
  idbStore(
    'idb.insightsReports',
    'insightsReports',
    'account',
    { backup: true, restore: true, restoreMode: 'merge' },
    { full: true, incremental: true, entityType: 'insights_report', allowDelete: true },
    'Insights 月报。',
  ),
  idbStore(
    'idb.newWorksDailyStats',
    'newWorksDailyStats',
    'account',
    { backup: true, restore: true, restoreMode: 'merge' },
    { full: true, incremental: true, entityType: 'new_work_daily_stat', allowDelete: true },
    '新作品每日统计快照。',
  ),
] as const;

function isPolicyForStorageKind(
  asset: DataAssetPolicy,
  kind: DataAssetStorageKind,
): boolean {
  return asset.storage.kind === kind;
}

function matchesAssetKey(asset: DataAssetPolicy, key: string): boolean {
  if (asset.storage.match === 'prefix') {
    if (asset.id === 'storage.idbMigrated.dynamic') {
      return key.startsWith(asset.storage.key) && key.endsWith('_migrated');
    }
    return key.startsWith(asset.storage.key);
  }
  return asset.storage.key === key;
}

export function resolveChromeStorageAssetPolicy(key: string): DataAssetPolicy | undefined {
  if (!key) return undefined;
  return DATA_ASSET_REGISTRY.find(
    asset =>
      (isPolicyForStorageKind(asset, 'chrome-storage') ||
        isPolicyForStorageKind(asset, 'dynamic-key')) &&
      matchesAssetKey(asset, key),
  );
}

export function getCloudStorageAssetPolicy(key: string): DataAssetPolicy | undefined {
  const policy = resolveChromeStorageAssetPolicy(key);
  if (!policy?.cloud.full && !policy?.cloud.incremental) return undefined;
  return policy;
}

export function resolveIdbStoreAssetPolicy(storeName: string): DataAssetPolicy | undefined {
  if (!storeName) return undefined;
  return DATA_ASSET_REGISTRY.find(
    asset => isPolicyForStorageKind(asset, 'idb-store') && matchesAssetKey(asset, storeName),
  );
}

export function getIdbStoreAssetPolicy(storeName: string): DataAssetPolicy | undefined {
  const policy = resolveIdbStoreAssetPolicy(storeName);
  if (!policy?.cloud.full && !policy?.webdav.backup && !policy?.webdav.restore) return undefined;
  return policy;
}

export function getWebDAVRestorableStorageKeys(): string[] {
  return DATA_ASSET_REGISTRY
    .filter(asset => asset.storage.kind === 'chrome-storage')
    .filter(asset => asset.webdav.restore)
    .map(asset => asset.storage.key)
    .sort();
}

export function getWebDAVBackupStoragePolicies(): DataAssetPolicy[] {
  return DATA_ASSET_REGISTRY
    .filter(asset => asset.storage.kind === 'chrome-storage' || asset.storage.kind === 'dynamic-key')
    .filter(asset => asset.webdav.backup);
}

export function getWebDAVBackupIdbStoreNames(): string[] {
  return DATA_ASSET_REGISTRY
    .filter(asset => asset.storage.kind === 'idb-store')
    .filter(asset => asset.webdav.backup)
    .map(asset => asset.storage.key)
    .sort();
}

export function getWebDAVRestorableIdbStoreNames(): string[] {
  return DATA_ASSET_REGISTRY
    .filter(asset => asset.storage.kind === 'idb-store')
    .filter(asset => asset.webdav.restore)
    .map(asset => asset.storage.key)
    .sort();
}

export function getCloudFullIdbStoreNames(): string[] {
  return DATA_ASSET_REGISTRY
    .filter(asset => asset.storage.kind === 'idb-store')
    .filter(asset => asset.cloud.full)
    .map(asset => asset.storage.key)
    .sort();
}

export function getCloudIncrementalIdbStoreNames(): string[] {
  return DATA_ASSET_REGISTRY
    .filter(asset => asset.storage.kind === 'idb-store')
    .filter(asset => asset.cloud.incremental)
    .map(asset => asset.storage.key)
    .sort();
}
