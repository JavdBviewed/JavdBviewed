/**
 * @file src/types/index.ts
 * @description 全局类型定义入口，汇集项目核心数据模型
 * @module types（全局公共契约，被所有层引用，修改需谨慎）
 */

// ============================================================
// 演员相关类型
// ============================================================

/** 演员记录 —— IndexedDB `actors` 表的完整数据结构 */
export interface ActorRecord {
  id: string;
  name: string;
  aliases: string[];                                  // 搜索匹配用的别名
  gender: 'male' | 'female' | 'unknown';
  category: 'unknown' | string;                       // 演员分类标签
  avatarUrl?: string;
  profileUrl: string;
  createdAt: number;                                  // Unix 时间戳（毫秒）
  updatedAt: number;
  deletedAt?: number;                                 // 软删除时间戳，null/undefined = 正常
  syncInfo?: {                                        // 演员同步功能维护
    source: string;
    lastSyncAt: number;
    syncStatus: 'success' | 'error' | 'pending';
  };
  worksUrl?: string;
  details?: {
    worksCount?: number;
  };
  blacklisted?: boolean;                              // 黑名单演员不显示增强信息
  manuallyEditedFields?: string[];                    // 同步时不会覆盖这些字段
  wikiData?: {                                        // 演员元数据刷新功能获取
    age?: number;
    heightCm?: number;
    cup?: string;
    retired?: boolean;
    ig?: string;                                      // Instagram
    tw?: string;                                      // Twitter / X
    wikiUrl?: string;
    xslistUrl?: string;
    source?: 'wikipedia' | 'xslist';
    fetchedAt?: number;
  };
}

/** 演员搜索结果 —— 比 ActorRecord 精简，仅含列表展示字段 */
export interface ActorSearchResult {
  id: string;
  name: string;
  aliases: string[];
  avatarUrl?: string;
  profileUrl: string;
}

/** 演员分页搜索结果 */
export interface ActorPagedSearchResult {
  actors: ActorRecord[];
  total: number;
  page: number;                                       // 从 1 开始
  pageSize: number;
  hasMore: boolean;
}

/** 演员同步配置 —— 控制从 JavDB 同步演员数据的行为 */
export interface ActorSyncConfig {
  enabled?: boolean;
  autoSync?: boolean;
  syncInterval?: number;                              // 自动同步间隔（毫秒）
  batchSize?: number;                                 // 每批处理演员数
  maxRetries?: number;
  requestInterval?: number;                           // 请求间隔（毫秒），用于限速
  urls?: {
    collectionActors?: string;                        // 演员收藏列表页 URL
    actorDetail?: string;                             // 详情页模板，{id} 为占位符
  };
  forceUpdate?: boolean;                              // 强制全量更新，忽略上次同步时间
  onProgress?: (progress: ActorSyncProgress) => void;
}

/** 演员同步进度 —— 通过 ActorSyncConfig.onProgress 回调传递 */
export interface ActorSyncProgress {
  stage: 'init' | 'pages' | 'details' | 'syncing' | 'complete' | 'error';
  current: number;
  total: number;
  percentage: number;
  message: string;                                    // UI 展示用的描述文本
  stats?: {
    currentPage: number;
    totalProcessed: number;
    newActors: number;
    updatedActors: number;
    skippedActors: number;
    currentPageActors?: number;
    currentPageProgress?: number;
    currentPageTotal?: number;
  };
  errors?: string[];
}

/** 演员同步结果 —— 同步完成后的汇总 */
export interface ActorSyncResult {
  success: boolean;
  syncedCount: number;
  newActors: number;
  updatedActors: number;
  skippedCount: number;
  errorCount?: number;
  errors: string[];
  duration: number;                                   // 同步耗时（毫秒）
}

// ============================================================
// 清单相关类型
// ============================================================

/** 清单记录 */
export interface ListRecord {
  id: string;
  name: string;
  type: 'mine' | 'favorite' | 'local' | 'series' | 'label';
  source: 'javdb' | 'local';                          // 'javdb'=JavDB同步, 'local'=扩展内手动创建
  externalId?: string;                                // 同步后的真实 JavDB 标识
  moviesCount?: number;
  clickedCount?: number;
  url?: string;
  createdAt: number;
  updatedAt: number;
}

// ============================================================
// 视频记录相关类型
// ============================================================

export type LogLevel = 'OFF' | 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

export interface LogEntry {
  timestamp: string;
  level: Exclude<LogLevel, 'OFF'>;
  message: string;
  data?: any;
}

/** 视频状态类型 */
export type VideoStatus = 'viewed' | 'browsed' | 'want' | 'untracked';

/** 视频记录 —— IndexedDB `videos` 表的核心数据结构 */
export interface VideoRecord {
  id: string;
  title: string;
  status: VideoStatus;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;                                 // 软删除时间戳，null/undefined = 正常
  releaseDate?: string;
  javdbUrl?: string;
  javdbImage?: string;
  coverImage?: string;
  actors?: string[];                                  // 演员名称列表（非 ID）
  genres?: string[];
  rating?: number;                                    // JavDB 评分
  notes?: string;
  manuallyEditedFields?: string[];                    // 同步时保护的字段
  // --- 扩展字段（从详情页抓取） ---
  videoCode?: string;                                 // 番号
  duration?: number;                                  // 时长（分钟）
  director?: string;
  directorUrl?: string;
  maker?: string;
  makerUrl?: string;
  publisher?: string;
  publisherUrl?: string;
  series?: string;
  seriesUrl?: string;
  ratingCount?: number;
  wantToWatchCount?: number;
  watchedCount?: number;
  categories?: string[];
  userRating?: number;                                // 用户自定义评分
  userNotes?: string;
  userTags?: string[];                                // 扩展内用户自定义标签
  isFavorite?: boolean;
  favoriteIndexed?: number;
  listIds?: string[];                                 // 所属清单 ID 列表
  favoritedAt?: number;                               // 收藏时间戳
  enhancedData?: { coverImage?: string; [key: string]: any };
}

/** 内容脚本按当前页面读取的轻量记录摘要。 */
export interface ViewedStatusSummary {
  id: string;
  status: VideoStatus;
  isFavorite?: boolean;
}

/** 旧版视频记录格式（兼容迁移用） */
export interface OldVideoRecord extends Partial<VideoRecord> {
  id?: string;
  code?: string;
  [key: string]: any;
}

// ============================================================
// 扩展设置相关类型
// ============================================================

/** 扩展设置（占位类型，实际定义在各个模块中） */
export interface ExtensionSettings {
  [key: string]: any;
}

export type {
  WebDAVClientProfile,
  WebDAVConfig,
  WebDAVKnownDevice,
  WebDAVKnownDeviceSource,
  WebDAVKnownDeviceView,
  WebDAVUploadIndex,
  WebDAVUploadIndexItem,
} from '../features/webdavSync/domain/types';

// ============================================================
// 内容过滤相关类型
// ============================================================

/** 关键字过滤规则 —— 用于页面内容的自动过滤/高亮/模糊 */
export interface KeywordFilterRule {
  id: string;
  name: string;
  keyword: string;
  isRegex: boolean;
  caseSensitive: boolean;
  action: 'hide' | 'highlight' | 'blur' | 'mark';
  enabled: boolean;
  fields: ('title' | 'actor' | 'studio' | 'genre' | 'tag' | 'video-id' | 'release-date')[];
  style?: {
    backgroundColor?: string;
    color?: string;
    border?: string;
    opacity?: number;
    filter?: string;
  };
  message?: string;
  releaseDateRange?: {                                // 发行日期范围过滤
    enabled: boolean;
    comparison?: 'between' | 'before' | 'after' | 'exact';
    startDate?: string;                               // YYYY-MM-DD，between/after 用
    endDate?: string;                                 // YYYY-MM-DD，between/before 用
    exactDate?: string;                               // YYYY-MM-DD，exact 用
  };
}

/** 内容过滤配置 */
export interface ContentFilterConfig {
  enabled: boolean;
  showFilteredCount: boolean;
  keywordRules: KeywordFilterRule[];
}

// ============================================================
// 用户资料相关类型
// ============================================================

/** 用户资料 —— 从 JavDB 页面解析的登录用户信息 */
export interface UserProfile {
  email: string;
  username: string;
  userType: string;
  isLoggedIn: boolean;
  lastUpdated: number;
  serverStats?: {
    wantCount: number;
    watchedCount: number;
    lastSyncTime: number;
  };
}

// ============================================================
// 新作品相关类型（演员新作监控功能）
// ============================================================

/** 演员订阅 —— 关注某演员以监控其新作品 */
export interface ActorSubscription {
  actorId: string;
  actorName: string;
  avatarUrl?: string;
  subscribedAt: number;
  lastCheckTime?: number;
  enabled: boolean;
}

/** 新作品监控全局配置 */
export interface NewWorksGlobalConfig {
  checkInterval: number;                              // 检查间隔（毫秒）
  requestInterval: number;                            // 请求间隔（毫秒），用于限速
  autoCheckEnabled?: boolean;
  concurrency?: number;                               // 并发请求数
  showActorPageScanButton?: boolean;
  filters: {
    excludeViewed: boolean;
    excludeBrowsed: boolean;
    excludeWant: boolean;
    dateRange: number;                                // 筛选最近 N 天内的作品
    categoryFilters?: string[];
    excludeAR?: boolean;                              // 排除 VR/AR 类
    applyContentFilter?: boolean;                     // 是否应用内容过滤规则
  };
  maxWorksPerCheck: number;
  autoCleanup: boolean;
  cleanupDays: number;                                // 自动清理 N 天前的记录
  lastGlobalCheck?: number;
}

/** 新作品记录 */
export interface NewWorkRecord {
  id: string;
  actorId: string;
  actorName: string;
  title: string;
  releaseDate?: string;
  javdbUrl: string;
  coverImage?: string;
  tags: string[];
  discoveredAt: number;                               // 发现时间戳
  isRead: boolean;
  status?: 'new' | 'viewed' | 'browsed' | 'want';
}

/** 新作品统计摘要 */
export interface NewWorksStats {
  totalSubscriptions: number;
  activeSubscriptions: number;
  totalNewWorks: number;
  unreadWorks: number;
  todayDiscovered: number;
  lastCheckTime?: number;
}

/** 新作品搜索结果（分页） */
export interface NewWorksSearchResult {
  works: NewWorkRecord[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  stats: NewWorksStats;
}

/** 采集结果 */
export interface CollectionResult {
  discovered: number;
  errors: string[];
}

/** 手动检查结果 */
export interface ManualCheckResult {
  discovered: number;
  errors: string[];
}

// ============================================================
// 导出其他类型模块
// ============================================================

export * from './ai';
export * from './insights';
export * from './privacy';
