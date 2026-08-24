/** @description 遥测领域类型定义 —— 匿名使用统计上报 */

/** 遥测事件类型 */
export type TelemetryEventType = 'startup' | 'heartbeat' | 'error_report';
/** 发布渠道 */
export type TelemetryChannel = 'stable' | 'beta' | 'dev';
/** 数量分桶（脱敏处理，避免上报精确数量） */
export type TelemetryCountBucket =
  | '0'
  | '1-9'
  | '10-49'
  | '50-99'
  | '100-499'
  | '500-999'
  | '1000-1999'
  | '2000-4999'
  | '5000-9999'
  | '10000-19999'
  | '20000-49999'
  | '50000-79999'
  | '80000-99999'
  | '100000+'
  | '1000+'
  | 'unknown';

/** 遥测设置 */
export interface TelemetrySettings {
  enabled: boolean;
  endpoint: string;                                   // 上报接口地址
  channel: TelemetryChannel;
}

/** 客户端状态（本地存储） */
export interface TelemetryClientState {
  installId: string;                                  // 安装唯一 ID（持久化）
  sessionId: string;                                  // 会话 ID（每次启动重新生成）
  sessionStartedAt: string;
  lastStartupAt?: number;
  lastHeartbeatAt?: number;                           // 最后心跳时间
  lastSuccessAt?: number;                             // 最后成功上报时间
}

/** 运行时环境信息（脱敏后上报） */
export interface TelemetryRuntimeInfo {
  version: string;
  build?: number;
  browser?: string;
  browserVersion?: string;
  platform?: string;
  platformVersion?: string;
  locale?: string;
  timezone?: string;
}

/** 错误上报负载 */
export interface TelemetryErrorPayload {
  component?: string;                                 // 出错模块
  code?: string;
  message?: string;
  stackHash?: string;                                 // 堆栈哈希（脱敏，不报完整堆栈）
  fatal?: boolean;                                    // 是否致命错误
}

/** 完整遥测上报负载 */
export interface TelemetryPayload {
  schemaVersion: 1;                                   // 负载格式版本
  eventId: string;                                    // 事件唯一 ID（用于去重）
  deviceId?: string;                                  // 设备 ID
  installId: string;
  anonymous: true;                                    // 固定为 true，保证匿名
  event: TelemetryEventType;
  client: {                                           // 扩展版本与环境信息
    extensionVersion: string;
    build?: number;
    channel?: TelemetryChannel;
    browser?: string;
    browserVersion?: string;
    platform?: string;
    platformVersion?: string;
    locale?: string;
    timezone?: string;
  };
  activity: {                                         // 会话活跃度
    sessionId: string;
    activityAt: string;
    sessionStartedAt: string;
    activeDurationSeconds: number;
    surface: 'background';
  };
  features: {                                         // 各功能启用状态（布尔值，不含敏感数据）
    webdavEnabled: boolean;
    drive115Enabled: boolean;
    actorSyncEnabled: boolean;
    actorAutoSyncEnabled: boolean;
    aiEnabled: boolean;
    magnetSearchEnabled: boolean;
    magnetAutoSearchEnabled: boolean;
    newWorksAutoCheckEnabled: boolean;
    videoEnhancementEnabled: boolean;
    titleTranslationEnabled: boolean;
    externalSearchEnabled: boolean;
    onlineAvailabilityEnabled: boolean;
    subtitleSearchEnabled: boolean;
    fc2BreakerEnabled: boolean;
    reviewBreakerEnabled: boolean;
    relatedListsEnabled: boolean;
    actorRemarksEnabled: boolean;
    actorNameMarksEnabled: boolean;
    videoFavoriteRatingEnabled: boolean;
    wantSyncEnabled: boolean;
    autoMarkWatchedAfter115Enabled: boolean;
    listEnhancementEnabled: boolean;
    listVideoPreviewEnabled: boolean;
    scrollPagingEnabled: boolean;
    actorWatermarkEnabled: boolean;
    listStatusQuickActionEnabled: boolean;
    listFavoriteQuickActionEnabled: boolean;
    actorEnhancementEnabled: boolean;
    embyEnabled: boolean;
    embyRecognitionEnabled: boolean;
    embyLibraryStatusEnabled: boolean;
    embyRealtimeCheckEnabled: boolean;
    privacyScreenshotModeEnabled: boolean;
    privacyPrivateModeEnabled: boolean;
    contentFilterEnabled: boolean;
    anchorOptimizationEnabled: boolean;
    passwordHelperEnabled: boolean;
    superRankingEnabled: boolean;
    insightsAutoMonthlyEnabled: boolean;
    githubProxyEnabled: boolean;
  };
  metrics: {                                          // 各类资源数量（分桶脱敏）
    viewedCountBucket: TelemetryCountBucket;
    actorCountBucket: TelemetryCountBucket;
    newWorksSubscriptionCountBucket: TelemetryCountBucket;
    enabledSearchEngineCountBucket: TelemetryCountBucket;
    enabledExternalSearchEngineCountBucket: TelemetryCountBucket;
    enabledSubtitleSearchEngineCountBucket: TelemetryCountBucket;
    enabledOnlineAvailabilitySiteCountBucket: TelemetryCountBucket;
    enabledMagnetSourceCountBucket: TelemetryCountBucket;
  };
  error?: TelemetryErrorPayload;
  sentAt: string;
}

/** 上报结果 */
export interface TelemetryReportResult {
  sent: boolean;
  reason?: 'disabled' | 'missing-endpoint' | 'throttled' | 'network-error' | 'http-error';
  status?: number;                                    // HTTP 状态码
}
