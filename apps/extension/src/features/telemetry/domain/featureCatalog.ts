/**
 * @file featureCatalog.ts
 * @description featureCatalog
 * @module features/telemetry
 */
import type { TelemetryPayload } from './types';

export type TelemetryFeatureKey = keyof TelemetryPayload['features'];
export type TelemetryFeatureCategory =
  | 'sync'
  | 'ai'
  | 'resource'
  | 'video'
  | 'list'
  | 'actor'
  | 'media'
  | 'privacy'
  | 'ux'
  | 'report'
  | 'network'
  | 'newWorks';
type MissingTelemetryFeatureKeys = Exclude<TelemetryFeatureKey, typeof TELEMETRY_FEATURE_CATALOG[number]['key']>;

export interface TelemetryFeatureContext {
  newWorksConfig?: any;
}

export interface TelemetryFeatureCatalogItem {
  key: TelemetryFeatureKey;
  label: string;
  category: TelemetryFeatureCategory;
  order: number;
  select: (settings: any, context?: TelemetryFeatureContext) => boolean;
}

function isExternalEntryPanelActive(settings: any): boolean {
  return settings?.videoEnhancement?.enableExternalEntryPanel !== false;
}

function isVideoEnhancementEnabled(settings: any): boolean {
  return settings?.videoEnhancement?.enabled === true;
}

function isListEnhancementEnabled(settings: any): boolean {
  return settings?.userExperience?.enableListEnhancement !== false && settings?.listEnhancement?.enabled !== false;
}

export const TELEMETRY_FEATURE_CATALOG = [
  {
    key: 'webdavEnabled',
    label: 'WebDAV 同步',
    category: 'sync',
    order: 10,
    select: (settings) => settings?.webdav?.enabled === true,
  },
  {
    key: 'drive115Enabled',
    label: '115 网盘',
    category: 'sync',
    order: 20,
    select: (settings) => settings?.drive115?.enabled === true,
  },
  {
    key: 'actorSyncEnabled',
    label: '演员同步',
    category: 'sync',
    order: 30,
    select: (settings) => settings?.actorSync?.enabled !== false,
  },
  {
    key: 'actorAutoSyncEnabled',
    label: '演员自动同步',
    category: 'sync',
    order: 40,
    select: (settings) => settings?.actorSync?.enabled !== false && settings?.actorSync?.autoSync === true,
  },
  {
    key: 'aiEnabled',
    label: 'AI 功能',
    category: 'ai',
    order: 50,
    select: (settings) => settings?.ai?.enabled === true,
  },
  {
    key: 'magnetSearchEnabled',
    label: '磁力搜索',
    category: 'resource',
    order: 60,
    select: (settings) => settings?.userExperience?.enableMagnetSearch === true,
  },
  {
    key: 'magnetAutoSearchEnabled',
    label: '磁力自动搜索',
    category: 'resource',
    order: 70,
    select: (settings) => settings?.userExperience?.enableMagnetSearch === true && settings?.magnetSearch?.autoSearch === true,
  },
  {
    key: 'newWorksAutoCheckEnabled',
    label: '新作品自动检查',
    category: 'newWorks',
    order: 80,
    select: (settings, context) => {
      const config = context?.newWorksConfig || settings?.newWorks || {};
      return config?.autoCheckEnabled === true || config?.enabled === true;
    },
  },
  {
    key: 'videoEnhancementEnabled',
    label: '影片增强',
    category: 'video',
    order: 90,
    select: (settings) => isVideoEnhancementEnabled(settings),
  },
  {
    key: 'titleTranslationEnabled',
    label: '标题翻译',
    category: 'video',
    order: 100,
    select: (settings) => settings?.dataEnhancement?.enableTranslation === true
      && (settings?.translation?.targets ? settings.translation.targets.currentTitle !== false : true),
  },
  {
    key: 'externalSearchEnabled',
    label: '外部搜索入口',
    category: 'video',
    order: 110,
    select: (settings) => isExternalEntryPanelActive(settings) && settings?.videoEnhancement?.enableExternalSearch !== false,
  },
  {
    key: 'onlineAvailabilityEnabled',
    label: '在线可看检测',
    category: 'video',
    order: 120,
    select: (settings) => isExternalEntryPanelActive(settings) && settings?.videoEnhancement?.enableOnlineAvailability !== false,
  },
  {
    key: 'subtitleSearchEnabled',
    label: '字幕搜索',
    category: 'video',
    order: 130,
    select: (settings) => isExternalEntryPanelActive(settings) && settings?.videoEnhancement?.enableSubtitleSearch !== false,
  },
  {
    key: 'fc2BreakerEnabled',
    label: 'FC2 增强',
    category: 'video',
    order: 140,
    select: (settings) => settings?.videoEnhancement?.enableFC2Breaker !== false,
  },
  {
    key: 'reviewBreakerEnabled',
    label: '评论解锁',
    category: 'video',
    order: 150,
    select: (settings) => isVideoEnhancementEnabled(settings) && settings?.videoEnhancement?.enableReviewBreaker === true,
  },
  {
    key: 'relatedListsEnabled',
    label: '相关清单',
    category: 'video',
    order: 160,
    select: (settings) => isVideoEnhancementEnabled(settings) && settings?.videoEnhancement?.enableRelatedLists !== false,
  },
  {
    key: 'actorRemarksEnabled',
    label: '演员备注',
    category: 'actor',
    order: 170,
    select: (settings) => isVideoEnhancementEnabled(settings) && settings?.videoEnhancement?.enableActorRemarks === true,
  },
  {
    key: 'actorNameMarksEnabled',
    label: '演员名称标识',
    category: 'actor',
    order: 180,
    select: (settings) => settings?.videoEnhancement?.enableActorNameMarks !== false,
  },
  {
    key: 'videoFavoriteRatingEnabled',
    label: '影片收藏评分',
    category: 'video',
    order: 190,
    select: (settings) => isVideoEnhancementEnabled(settings) && settings?.videoEnhancement?.enableVideoFavoriteRating === true,
  },
  {
    key: 'wantSyncEnabled',
    label: '想看同步',
    category: 'video',
    order: 200,
    select: (settings) => settings?.videoEnhancement?.enableWantSync !== false,
  },
  {
    key: 'autoMarkWatchedAfter115Enabled',
    label: '115 推送后自动已看',
    category: 'video',
    order: 210,
    select: (settings) => settings?.videoEnhancement?.autoMarkWatchedAfter115 !== false,
  },
  {
    key: 'listEnhancementEnabled',
    label: '列表增强',
    category: 'list',
    order: 220,
    select: (settings) => isListEnhancementEnabled(settings),
  },
  {
    key: 'listVideoPreviewEnabled',
    label: '列表视频预览',
    category: 'list',
    order: 230,
    select: (settings) => isListEnhancementEnabled(settings) && settings?.listEnhancement?.enableVideoPreview !== false,
  },
  {
    key: 'scrollPagingEnabled',
    label: '滚动翻页',
    category: 'list',
    order: 240,
    select: (settings) => isListEnhancementEnabled(settings) && settings?.listEnhancement?.enableScrollPaging === true,
  },
  {
    key: 'actorWatermarkEnabled',
    label: '演员水印',
    category: 'list',
    order: 250,
    select: (settings) => isListEnhancementEnabled(settings) && settings?.listEnhancement?.enableActorWatermark === true,
  },
  {
    key: 'listStatusQuickActionEnabled',
    label: '列表状态快捷标识',
    category: 'list',
    order: 255,
    select: (settings) => isListEnhancementEnabled(settings) && settings?.listEnhancement?.enableStatusQuickAction === true,
  },
  {
    key: 'listFavoriteQuickActionEnabled',
    label: '列表收藏快捷按钮',
    category: 'list',
    order: 256,
    select: (settings) => isListEnhancementEnabled(settings) && settings?.listEnhancement?.enableListFavoriteQuickAction === true,
  },
  {
    key: 'actorEnhancementEnabled',
    label: '演员页增强',
    category: 'actor',
    order: 260,
    select: (settings) => settings?.userExperience?.enableActorEnhancement !== false && settings?.actorEnhancement?.enabled !== false,
  },
  {
    key: 'embyEnabled',
    label: 'Emby/Jellyfin 增强',
    category: 'media',
    order: 270,
    // 兼容/迁移载体：任一能力开关为真即视为增强开启（OR 派生）。
    select: (settings) =>
      settings?.emby?.enabled === true
      || settings?.emby?.recognitionEnabled === true
      || settings?.emby?.libraryEnabled === true,
  },
  {
    key: 'embyRecognitionEnabled',
    label: 'Emby/Jellyfin 番号识别',
    category: 'media',
    order: 275,
    select: (settings) => {
      const emby = settings?.emby;
      if (!emby) return false;
      if ('recognitionEnabled' in emby) return emby.recognitionEnabled === true;
      return emby.enabled === true;
    },
  },
  {
    key: 'embyLibraryStatusEnabled',
    label: 'Emby/Jellyfin 入库状态',
    category: 'media',
    order: 280,
    select: (settings) => {
      const emby = settings?.emby;
      if (!emby) return false;
      if ('libraryEnabled' in emby) return emby.libraryEnabled === true;
      return emby.enabled === true && emby.libraryStatus?.enabled === true;
    },
  },
  {
    key: 'embyRealtimeCheckEnabled',
    label: 'Emby/Jellyfin 实时校验',
    category: 'media',
    order: 290,
    select: (settings) => settings?.emby?.libraryStatus?.enabled === true
      && settings?.emby?.realtimeCheck?.enabled === true,
  },
  {
    key: 'privacyScreenshotModeEnabled',
    label: '截图模式',
    category: 'privacy',
    order: 300,
    select: (settings) => settings?.privacy?.screenshotMode?.enabled === true,
  },
  {
    key: 'privacyPrivateModeEnabled',
    label: '私密模式',
    category: 'privacy',
    order: 310,
    select: (settings) => settings?.privacy?.privateMode?.enabled === true,
  },
  {
    key: 'contentFilterEnabled',
    label: '内容过滤',
    category: 'ux',
    order: 320,
    select: (settings) => settings?.userExperience?.enableContentFilter === true
      || settings?.contentFilter?.enabled === true,
  },
  {
    key: 'anchorOptimizationEnabled',
    label: '锚点优化',
    category: 'ux',
    order: 330,
    select: (settings) => settings?.userExperience?.enableAnchorOptimization === true
      || settings?.anchorOptimization?.enabled === true,
  },
  {
    key: 'passwordHelperEnabled',
    label: '密码助手',
    category: 'ux',
    order: 340,
    select: (settings) => settings?.userExperience?.enablePasswordHelper === true,
  },
  {
    key: 'superRankingEnabled',
    label: '超级排行导航',
    category: 'ux',
    order: 350,
    select: (settings) => settings?.userExperience?.enableSuperRanking !== false,
  },
  {
    key: 'insightsAutoMonthlyEnabled',
    label: '自动月报',
    category: 'report',
    order: 360,
    select: (settings) => settings?.insights?.autoMonthlyEnabled === true,
  },
  {
    key: 'githubProxyEnabled',
    label: 'GitHub 文件加速',
    category: 'network',
    order: 370,
    select: (settings) => settings?.networkAcceleration?.github?.enabled === true,
  },
] as const satisfies readonly TelemetryFeatureCatalogItem[];

export function buildTelemetryFeatures(settings: any, context?: TelemetryFeatureContext): TelemetryPayload['features'] {
  const _catalogCoversAllFeatureKeys: MissingTelemetryFeatureKeys extends never ? true : never = true;
  void _catalogCoversAllFeatureKeys;
  const features = {} as Record<TelemetryFeatureKey, boolean>;

  for (const feature of TELEMETRY_FEATURE_CATALOG) {
    features[feature.key] = feature.select(settings, context);
  }

  return features as TelemetryPayload['features'];
}
