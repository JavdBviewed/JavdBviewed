/**
 * @file index.ts
 * @description Cloud 同步扩展侧入口（配置/会话/API/本地实体适配/立即同步/自动入队）
 * @module features/cloudSync
 */
export {
  CLOUD_SETTINGS_STORAGE_KEY,
  loadCloudSettings,
  saveCloudSettings,
  normalizeCloudBaseUrl,
  createDefaultCloudSettings,
  type CloudConnectionSettings,
} from './cloudSettingsStorage';
export {
  CLOUD_SESSION_STORAGE_KEY,
  createChromeTokenStore,
  loadCloudSession,
  type CloudSessionRecord,
} from './chromeTokenStore';
export {
  createExtensionCloudClient,
  type ExtensionCloudClientOptions,
} from './createExtensionCloudClient';
export { createChromeCursorStore, CLOUD_CURSORS_STORAGE_KEY } from './chromeCursorStore';
export {
  createExtensionEntityStore,
  collectLocalSyncEntities,
  preparePushQueueStats,
  assertExtensionCloudAdapterCoverage,
  EXTENSION_SYNC_ENTITY_TYPES,
} from './extensionEntityStore';
export {
  runCloudSyncNow,
  type CloudSyncNowOptions,
  type CloudSyncNowResult,
  type CloudSyncProgress,
} from './runCloudSyncNow';
export {
  createExtensionCloudFacade,
  extensionCloudFacade,
  type CloudFacadeState,
  type CloudHealthResult,
  type CloudLoginInput,
  type CloudConnectionInput,
  type ExtensionCloudFacade,
  type ExtensionCloudFacadeOptions,
} from './extensionCloudFacade';
export {
  countByType,
  formatTypeCounts,
  humanizeCloudError,
  SYNC_TYPE_LABELS,
  type TypeCountMap,
} from './syncStats';
export {
  loadCloudAutoSyncSettings,
  saveCloudAutoSyncSettings,
  CLOUD_AUTO_SYNC_STORAGE_KEY,
  DEFAULT_CLOUD_AUTO_SYNC,
  type CloudAutoSyncSettings,
} from './autoSyncSettings';
export {
  enqueueVideoChange,
  enqueueVideoChanges,
  enqueueActorChange,
  enqueueActorChanges,
  enqueueListChange,
  enqueueListChanges,
  enqueueNewWorkChange,
  enqueueNewWorkChanges,
  enqueueMagnetChanges,
  enqueueInsightsViewChange,
  enqueueInsightsViews,
  enqueueInsightsReportChange,
  enqueueNewWorkDailyStatChange,
  enqueueStorageItemChange,
  scheduleEnqueue,
} from './enqueueLocalChange';
export {
  CLOUD_AUTO_SYNC_ALARM,
  setupCloudAutoSyncAlarm,
  runCloudSyncExclusive,
} from './backgroundCloudSync';
