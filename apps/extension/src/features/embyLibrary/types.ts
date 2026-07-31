/** @description Emby/Jellyfin 媒体库类型定义 */

/** 媒体服务器类型 */
export type EmbyServerType = 'emby' | 'jellyfin';

/** 媒体服务器连接配置 */
export interface EmbyMediaServer {
  id: string;
  type: EmbyServerType;
  name: string;                                       // 用户自定义服务器名称
  url: string;                                        // 服务器地址（含端口）
  apiKey: string;                                     // API 密钥（扫库/只读）
  enabled: boolean;
  /**
   * 参与同步的媒体库 Id 列表（Emby/JF 顶层 Library / MediaFolder Id）。
   * 空数组或未设置 = 兼容旧行为，同步整库（Recursive 全量 Movie）。
   * 有值时仅同步选中库（可多选）。
   */
  libraryIds?: string[];
  /** 最近一次拉取到的媒体库目录缓存（供设置页多选展示） */
  libraryOptions?: EmbyLibraryFolderOption[];
  /** 用户登录会话：写 UserData / 按用户进度（与 apiKey 并存） */
  username?: string;
  /** 用户登录密码（随来源设置持久化；禁止写入日志或诊断响应） */
  password?: string;
  /** 用户 AccessToken（AuthenticateByName 返回，勿日志输出） */
  accessToken?: string;
  userId?: string;
  /** 展示用，登录成功后的用户名 */
  userDisplayName?: string;
  /** 令牌获取时间 ms */
  tokenObtainedAt?: number;
}

/** 服务器上的一个媒体库/媒体文件夹选项 */
export interface EmbyLibraryFolderOption {
  id: string;
  name: string;
  /** CollectionType：movies/tvshows/music 等，仅展示 */
  collectionType?: string;
}

/** 媒体库状态显示设置 */
export interface EmbyLibraryStatusSettings {
  enabled: boolean;
  showOnList: boolean;                                // 列表页显示状态徽章
  showOnDetail: boolean;                              // 详情页显示状态
}

/** 实时检查设置 */
export interface EmbyRealtimeCheckSettings {
  enabled: boolean;
  concurrency: number;                                // 并发检查数
  batchSize: number;                                  // 每批检查的视频数
  cacheTtlMinutes: number;                            // 缓存有效期（分钟）
}

/** Emby 人员（演职员） */
export interface EmbyPersonRef {
  Id?: string;
  Name?: string;
  Role?: string;
  Type?: string; // Actor / Director / ...
  PrimaryImageTag?: string;
}

/** Emby 命名条目（类型/片商等） */
export interface EmbyNamedRef {
  Id?: string;
  Name?: string;
}

/** Emby Chapter 字段（Items.Fields=Chapters） */
export interface EmbyChapterInfo {
  StartPositionTicks?: number;
  Name?: string;
  ImageTag?: string;
  MarkerType?: string;
  ChapterIndex?: number;
}

/** Emby/Jellyfin API 返回的媒体条目 */
export interface EmbyMediaItem {
  Id?: string;
  Name?: string;
  Path?: string;
  ServerId?: string;
  Type?: string;
  Overview?: string;
  Taglines?: string[];
  CommunityRating?: number;
  CriticRating?: number;
  OfficialRating?: string;
  Genres?: string[];
  Studios?: EmbyNamedRef[];
  Tags?: string[];
  People?: EmbyPersonRef[];
  ImageTags?: Record<string, string>;
  PrimaryImageTag?: string;
  BackdropImageTags?: string[];
  ParentThumbImageTag?: string;
  /** 父级略缩图所属条目 Id（与 ParentThumbImageTag 成对） */
  ParentThumbItemId?: string;
  ParentPrimaryImageItemId?: string;
  SeriesPrimaryImageTag?: string;
  RunTimeTicks?: number;
  UserData?: EmbyUserDataPayload;
  DateCreated?: string;
  PremiereDate?: string;
  ProductionYear?: number;
  Chapters?: EmbyChapterInfo[];
  MediaSources?: Array<{
    Id?: string;
    Path?: string;
    Container?: string;
    Size?: number;
    Bitrate?: number;
    MediaStreams?: Array<{
      Type?: string;
      Codec?: string;
      Language?: string;
      DisplayTitle?: string;
      Height?: number;
      Width?: number;
      BitRate?: number;
      Channels?: number;
      IsDefault?: boolean;
      Index?: number;
    }>;
  }>;
}

/** 详情章节视图 */
export interface EmbyItemChapterView {
  index: number;
  name: string;
  startPositionTicks: number;
  /** 秒，便于播放器 seek */
  startTimeSeconds: number;
  imageUrl?: string;
}

/** 相似 / 合集卡片 */
export interface EmbyRelatedItemView {
  itemId: string;
  name: string;
  year?: number;
  overview?: string;
  primaryImageUrl?: string;
  type?: string;
}

/** 媒体流摘要行 */
export interface EmbyMediaStreamLine {
  type: string;
  title: string;
}

/** 扩展内详情弹窗用的完整条目视图（API 拉取） */
export interface EmbyItemDetailView {
  itemId: string;
  serverUrl: string;
  serverType: EmbyServerType;
  serverId?: string;
  name: string;
  overview?: string;
  tagline?: string;
  year?: number;
  premiereDate?: string;
  runtimeTicks?: number;
  communityRating?: number;
  criticRating?: number;
  officialRating?: string;
  genres: string[];
  studios: string[];
  tags: string[];
  people: Array<{ id?: string; name: string; role?: string; type?: string; imageUrl?: string }>;
  primaryImageUrl?: string;
  backdropImageUrl?: string;
  path?: string;
  container?: string;
  sizeBytes?: number;
  mediaSourceId?: string;
  videoSummary?: string;
  audioSummary?: string;
  /** 全部媒体流（视频/音频/字幕） */
  mediaStreams: EmbyMediaStreamLine[];
  chapters: EmbyItemChapterView[];
  similar: EmbyRelatedItemView[];
  collections: EmbyRelatedItemView[];
  userData?: EmbyWatchUserData;
}

/** Emby/Jellyfin UserData 原始字段（同步时节选） */
export interface EmbyUserDataPayload {
  Played?: boolean;
  PlaybackPositionTicks?: number;
  PlayCount?: number;
  LastPlayedDate?: string;
  PlayedPercentage?: number;
}

/** 写入本地索引的观看摘要（可序列化） */
export interface EmbyWatchUserData {
  /** Emby/JF 标记已播放 */
  played: boolean;
  /** 当前进度 ticks（1 tick = 100ns） */
  positionTicks: number;
  /** 片长 ticks；未知为 0 */
  runtimeTicks: number;
  /** 0–100；优先用服务端百分比，否则由 position/runtime 推算 */
  percent: number;
  /** 上次播放时间 ms；未知为 0 */
  lastPlayedAt: number;
}

/** 媒体库索引条目 —— 记录单个视频在 Emby/Jellyfin 中的位置 */
export interface EmbyLibraryIndexEntry {
  serverType: EmbyServerType;
  serverName: string;
  serverUrl: string;
  itemId: string;                                     // Emby/Jellyfin 中的媒体 ID
  serverId?: string;
  itemName: string;                                   // 媒体名称
  path?: string;                                      // 文件路径
  /** 默认封面（通常 Primary，兼容旧字段） */
  coverImageUrl?: string;
  /**
   * 多视图封面 URL（同步时生成，带 api_key）
   * Primary=海报竖图，Thumb=略缩图横图，Backdrop=背景横图
   */
  imageUrls?: Partial<Record<'Primary' | 'Thumb' | 'Backdrop' | 'Logo' | 'Banner', string>>;
  /** 真实观看摘要（来自 UserData；ApiKey 场景下可能为空） */
  userData?: EmbyWatchUserData;
  updatedAt: number;
}

/** 媒体库索引 —— 所有视频到 Emby/Jellyfin 的映射 */
export interface EmbyLibraryIndex {
  entries: Record<string, EmbyLibraryIndexEntry[]>;   // key 为番号
  updatedAt: number;
}

/** 单服务器检查结果 */
export interface EmbyLibraryServerResult {
  serverId: string;
  serverType: EmbyServerType;
  serverName: string;
  success: boolean;
  itemCount: number;                                  // 服务器总媒体数
  indexedCount: number;                               // 已索引的匹配数
  error?: string;
  checkedAt: number;
}

/** 媒体库状态（索引 + 服务器检查结果） */
export interface EmbyLibraryState extends EmbyLibraryIndex {
  serverResults?: EmbyLibraryServerResult[];
}
