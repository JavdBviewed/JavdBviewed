/**
 * @file config.ts
 * @description config
 * @module features/listEnhancement
 */
import type { PreviewSourceName } from '../../previews';
import type { CategoryFilterMode } from '../../list-hiding';

export interface ListDisplayControlConfig {
  enabled: boolean;
  columnCount: number;
  containerWidth: number;
  enableContainerExpansion: boolean;
}

export interface PopularityEffectsConfig {
  enabled: boolean;
  minRating: number;
  minRatingCount: number;
}

export type ListSortMode =
  | 'original'
  | 'rating-desc'
  | 'rating-count-desc';
export type ListSortingAppendStrategy = 'prompt' | 'auto-resort';
export type ListSortingPositionStrategy = 'preserve' | 'top';

export interface ListSortingConfig {
  enabled: boolean;
  appendStrategy: ListSortingAppendStrategy;
  autoResortPosition: ListSortingPositionStrategy;
}

export interface ListEnhancementConfig {
  enabled: boolean;
  enableClickEnhancement: boolean;
  enableClickEnhancementList?: boolean;
  enableClickEnhancementDetail?: boolean;
  enableVideoPreview: boolean;
  enableVideoPreviewList?: boolean;
  enableVideoPreviewDetail?: boolean;
  enableListOptimization: boolean;
  enableScrollPaging: boolean;
  enableHighQualityCover: boolean;
  previewDelay: number;
  previewVolume: number;
  enableRightClickBackground: boolean;
  preferredPreviewSource?: 'auto' | 'javdb' | 'javspyl' | 'avpreview' | 'vbgfl';
  enableActorWatermark?: boolean;
  actorWatermarkPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  actorWatermarkOpacity?: number;
  hideBlacklistedActorsInList?: boolean;
  hideNonFavoritedActorsInList?: boolean;
  hideUnrecognizedActorsInList?: boolean;
  /** 演员穿透：在列表卡片显示女性演员名（默认关闭） */
  enableActorPenetration?: boolean;
  /**
   * 影片类别过滤（旧键，兼容）：09-29 起运行时以 categoryFilter.mode 为准
   * （mode 缺失时按本键迁移：true→blacklist 否则 off）。保留字段供旧数据读取。
   */
  enableCategoryFilter?: boolean;
  /**
   * 类别过滤（09-29 三态）：mode=off/whitelist/blacklist；black='c4=17' 形式 entryKey
   * （whitelist 态=所选保留集合）。依赖演员穿透（复用同一详情请求/缓存）。
   */
  categoryFilter?: { mode?: CategoryFilterMode; black: string[] };
  /** 演员名称标识：对穿透卡片演员名做收藏/订阅/黑名单着色与悬浮提示（默认开） */
  enableActorNameMarks?: boolean;
  listDisplayControl?: ListDisplayControlConfig;
  showStatusBadge?: boolean;
  enableStatusQuickAction?: boolean;
  enableListFavoriteQuickAction?: boolean;
  resourceTags?: boolean;
  popularityEffects?: PopularityEffectsConfig;
  sorting?: ListSortingConfig;
}

export interface VideoPreviewSource {
  url: string;
  type: string;
  source?: PreviewSourceName;
}

export interface VideoPreviewOptions {
  cacheKey: string;
  code: string;
  onCacheError?: () => void;
}

export function createDefaultListEnhancementConfig(): ListEnhancementConfig {
  return {
    enabled: false,
    enableClickEnhancement: true,
    enableClickEnhancementList: true,
    enableClickEnhancementDetail: true,
    enableVideoPreview: true,
    enableVideoPreviewList: true,
    enableVideoPreviewDetail: true,
    enableListOptimization: true,
    enableScrollPaging: false,
    enableHighQualityCover: true,
    previewDelay: 1000,
    previewVolume: 0.2,
    enableRightClickBackground: true,
    enableActorWatermark: false,
    actorWatermarkPosition: 'top-right',
    actorWatermarkOpacity: 0.8,
    hideBlacklistedActorsInList: false,
    hideNonFavoritedActorsInList: false,
    hideUnrecognizedActorsInList: false,
    enableActorPenetration: false,
    enableCategoryFilter: false,
    categoryFilter: { mode: 'off', black: [] },
    enableActorNameMarks: true,
    listDisplayControl: {
      enabled: true,
      columnCount: 4,
      containerWidth: 100,
      enableContainerExpansion: false,
    },
    showStatusBadge: true,
    enableStatusQuickAction: false,
    enableListFavoriteQuickAction: false,
    resourceTags: false,
    popularityEffects: {
      enabled: false,
      minRating: 4,
      minRatingCount: 350,
    },
    sorting: {
      enabled: false,
      appendStrategy: 'prompt',
      autoResortPosition: 'preserve',
    },
  };
}
