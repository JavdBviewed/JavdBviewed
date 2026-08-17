/**
 * @file enhancementSettingsModel.ts
 * @description 功能增强设置纯数据模型：默认值、映射、合并保存
 * @module apps/dashboard/pages/settings/enhancement
 */
import type { ExtensionSettings, KeywordFilterRule } from '../../../../../types';
import { getDefaultTags, ACTOR_FILTER_TAGS } from '../../../../../dashboard/config/actorFilterTags';
import { normalizeMagnetSortMode } from '../../../../../features/magnets/application/resultSort';
import type { MagnetSortMode } from '../../../../../features/magnets/domain/types';
import { DEFAULT_ONLINE_AVAILABILITY_SITES } from '../../../../../features/onlineAvailability';
import {
  normalizeVideoEnhancementSchedulingMode,
  type VideoEnhancementSchedulingMode,
} from '../../../../../features/videoDetail/schedulingMode';

export type EnhancementSubtab = 'list' | 'video' | 'actor' | 'other';

export type PreviewSource = 'auto' | 'javdb' | 'javspyl' | 'avpreview' | 'vbgfl';
export type WatermarkPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type ListSortingAppendStrategy = 'prompt' | 'auto-resort';
export type ListSortingPosition = 'preserve' | 'top';
export type ActorRemarksMode = 'panel' | 'inline';
export type TranslationProvider = 'traditional' | 'ai';
export type TranslationDisplayMode = 'append' | 'replace';
export type AnchorButtonPosition = 'right-center' | 'right-bottom';

export type OnlineAvailabilitySitesMap = Record<string, boolean>;

export type EnhancementSettingsFormState = {
  // —— 子标签（仅 UI）——
  // 列表页
  enableContentFilter: boolean;
  filterRules: KeywordFilterRule[];
  enableClickEnhancement: boolean;
  enableClickEnhancementList: boolean;
  enableClickEnhancementDetail: boolean;
  enableVideoPreview: boolean;
  enableVideoPreviewList: boolean;
  enableVideoPreviewDetail: boolean;
  previewDelay: number;
  previewVolume: number;
  preferredPreviewSource: PreviewSource;
  enableActorWatermark: boolean;
  actorWatermarkPosition: WatermarkPosition;
  actorWatermarkOpacity: number;
  listColumnCount: number;
  listContainerWidth: number;
  enableContainerExpansion: boolean;
  showStatusBadge: boolean;
  enableStatusQuickAction: boolean;
  enableListFavoriteQuickAction: boolean;
  enableResourceTags: boolean;
  enableListSorting: boolean;
  listSortingAppendStrategy: ListSortingAppendStrategy;
  listSortingAutoResortPosition: ListSortingPosition;
  enablePopularityEffects: boolean;
  popularityMinRating: number;
  popularityMinRatingCount: number;
  enableScrollPaging: boolean;

  // 影片页
  videoEnhancementSchedulingMode: VideoEnhancementSchedulingMode;
  enableTranslation: boolean;
  translationProvider: TranslationProvider;
  traditionalApiKey: string;
  translateCurrentTitle: boolean;
  translationDisplayMode: TranslationDisplayMode;
  enableVideoEnhancement: boolean;
  veEnableWantSync: boolean;
  veAutoMarkWatchedAfter115: boolean;
  veAutoMarkWatchedStars: number;
  enableVideoFavoriteRating: boolean;
  veEnableExternalEntryPanel: boolean;
  veEnableOnlineAvailability: boolean;
  veShowOnlineAvailabilityFailures: boolean;
  onlineAvailabilitySites: OnlineAvailabilitySitesMap;
  veEnableExternalSearch: boolean;
  veEnableSubtitleSearch: boolean;
  veEnableRelatedLists: boolean;
  veEnableLocalListInSourceModal: boolean;
  enableActorQuickActions: boolean;
  veEnableActorNameMarks: boolean;
  veEnableActorRemarks: boolean;
  veActorRemarksMode: ActorRemarksMode;
  veActorRemarksTTLDays: number;
  veActorRemarksTaskTimeoutSeconds: number;
  veEnableReviewEnhancement: boolean;
  veEnableReviewBreaker: boolean;
  veEnableReviewMagnetLinkify: boolean;
  veEnableReviewPush115: boolean;
  veEnableFC2Breaker: boolean;
  enableAnchorOptimization: boolean;
  anchorButtonPosition: AnchorButtonPosition;
  showPreviewButton: boolean;
  enableMagnetSearch: boolean;
  magnetSourceSukebei: boolean;
  magnetSourceBtdig: boolean;
  magnetSourceBtsow: boolean;
  magnetSourceTorrentz2: boolean;
  magnetSourceJavbus: boolean;
  magnetBlockMojContent: boolean;
  magnetAutoSearch: boolean;
  magnetSortMode: MagnetSortMode;
  magnetPageMaxConcurrentRequests: number;
  magnetBgGlobalMaxConcurrent: number;
  magnetBgPerHostMaxConcurrent: number;
  magnetBgPerHostRateLimitPerMin: number;
  magnetMaxResults: number;
  magnetTimeoutMs: number;

  // 演员页
  enableActorEnhancement: boolean;
  enableAutoApplyTags: boolean;
  actorDefaultTags: string[];
  aeEnableActionButtons: boolean;
  aeEnableTimeSegmentationDivider: boolean;
  aeTimeSegmentationMonths: number;

  // 其他
  enableSuperRanking: boolean;
  veShowLoadingIndicator: boolean;
  enablePasswordHelper: boolean;
  passwordShowMethod: number;
  passwordWaitTime: number;
  enableSiteAppearance: boolean;
  siteAppearanceListCards: boolean;
  siteAppearanceDetailAndRelated: boolean;
  siteAppearanceMagnetList: boolean;
  siteAppearancePreviewImages: boolean;
  siteAppearanceAutoExpandReplaceTip: boolean;

  // 内部保留（无独立 UI 时保持兼容）
  enableListEnhancement: boolean;
  veEnableCoverImage: boolean;
};

export const ENHANCEMENT_SUBTABS: { id: EnhancementSubtab; label: string }[] = [
  { id: 'list', label: '列表页增强' },
  { id: 'video', label: '影片页增强' },
  { id: 'actor', label: '演员页增强' },
  { id: 'other', label: '其他增强' },
];

export const PREVIEW_SOURCE_OPTIONS: { value: PreviewSource; label: string }[] = [
  { value: 'auto', label: '自动（推荐）' },
  { value: 'javdb', label: 'JavDB' },
  { value: 'javspyl', label: 'JavSpyl' },
  { value: 'avpreview', label: 'AVPreview' },
  { value: 'vbgfl', label: '厂牌规则（VBGFL）' },
];

export const WATERMARK_POSITION_OPTIONS: { value: WatermarkPosition; label: string }[] = [
  { value: 'top-left', label: '左上' },
  { value: 'top-right', label: '右上' },
  { value: 'bottom-left', label: '左下' },
  { value: 'bottom-right', label: '右下' },
];

export const LIST_SORTING_APPEND_OPTIONS: { value: ListSortingAppendStrategy; label: string }[] = [
  { value: 'prompt', label: '询问后重排' },
  { value: 'auto-resort', label: '自动重排' },
];

export const LIST_SORTING_POSITION_OPTIONS: { value: ListSortingPosition; label: string }[] = [
  { value: 'preserve', label: '保持当前位置' },
  { value: 'top', label: '回到顶部' },
];

export const ACTOR_REMARKS_MODE_OPTIONS: { value: ActorRemarksMode; label: string }[] = [
  { value: 'panel', label: '侧栏面板' },
  { value: 'inline', label: '行内展示' },
];

export const TRANSLATION_PROVIDER_OPTIONS: { value: TranslationProvider; label: string }[] = [
  { value: 'traditional', label: 'Google 翻译' },
  { value: 'ai', label: 'AI 翻译' },
];

export const TRANSLATION_DISPLAY_MODE_OPTIONS: {
  value: TranslationDisplayMode;
  label: string;
}[] = [
  { value: 'append', label: '保留原始（追加显示）' },
  { value: 'replace', label: '替换原始标题' },
];

export const ANCHOR_POSITION_OPTIONS: { value: AnchorButtonPosition; label: string }[] = [
  { value: 'right-center', label: '右侧中央' },
  { value: 'right-bottom', label: '右下角' },
];

export const VIDEO_ENHANCEMENT_SCHEDULING_MODE_OPTIONS: {
  value: VideoEnhancementSchedulingMode;
  label: string;
}[] = [
  { value: 'smart', label: '智能调度（推荐）' },
  { value: 'immediate', label: '打开后立即增强' },
];

export const MAGNET_SORT_OPTIONS: { value: MagnetSortMode; label: string }[] = [
  { value: 'default', label: '默认排序' },
  { value: 'quality', label: '质量优先' },
  { value: 'seeders', label: '做种优先' },
  { value: 'size', label: '文件大小优先' },
  { value: 'date', label: '日期优先' },
  { value: 'subtitle', label: '字幕优先' },
];

export const PASSWORD_SHOW_METHOD_OPTIONS = [
  { value: '0', label: '鼠标悬浮在密码框上时' },
  { value: '1', label: '双击密码框时' },
  { value: '2', label: '单击密码框时' },
  { value: '3', label: '按下Ctrl并单击密码框时' },
] as const;

export const AUTO_MARK_STARS_OPTIONS = [
  { value: '3', label: '3 星' },
  { value: '4', label: '4 星' },
  { value: '5', label: '5 星' },
] as const;

export const ACTOR_DEFAULT_TAG_OPTIONS = ACTOR_FILTER_TAGS.map((t) => ({
  value: t.value,
  label: t.label,
}));

export const ONLINE_AVAILABILITY_SITE_OPTIONS = DEFAULT_ONLINE_AVAILABILITY_SITES.map((s) => ({
  key: s.key,
  name: s.name,
  enabled: s.enabled,
}));

function defaultOnlineAvailabilitySites(): OnlineAvailabilitySitesMap {
  const map: OnlineAvailabilitySitesMap = {};
  for (const s of DEFAULT_ONLINE_AVAILABILITY_SITES) {
    map[s.key] = s.enabled !== false;
  }
  return map;
}

export const DEFAULT_ENHANCEMENT_SETTINGS_FORM: EnhancementSettingsFormState = {
  enableContentFilter: false,
  filterRules: [],
  enableClickEnhancement: true,
  enableClickEnhancementList: true,
  enableClickEnhancementDetail: true,
  enableVideoPreview: true,
  enableVideoPreviewList: true,
  enableVideoPreviewDetail: true,
  previewDelay: 1000,
  previewVolume: 0.2,
  preferredPreviewSource: 'auto',
  enableActorWatermark: false,
  actorWatermarkPosition: 'top-right',
  actorWatermarkOpacity: 0.8,
  listColumnCount: 4,
  listContainerWidth: 100,
  enableContainerExpansion: false,
  showStatusBadge: true,
  enableStatusQuickAction: false,
  enableListFavoriteQuickAction: false,
  enableResourceTags: false,
  enableListSorting: false,
  listSortingAppendStrategy: 'prompt',
  listSortingAutoResortPosition: 'preserve',
  enablePopularityEffects: false,
  popularityMinRating: 4,
  popularityMinRatingCount: 350,
  enableScrollPaging: false,

  videoEnhancementSchedulingMode: 'smart',
  enableTranslation: false,
  translationProvider: 'traditional',
  traditionalApiKey: '',
  translateCurrentTitle: true,
  translationDisplayMode: 'append',
  enableVideoEnhancement: false,
  veEnableWantSync: true,
  veAutoMarkWatchedAfter115: true,
  veAutoMarkWatchedStars: 4,
  enableVideoFavoriteRating: false,
  veEnableExternalEntryPanel: true,
  veEnableOnlineAvailability: true,
  veShowOnlineAvailabilityFailures: false,
  onlineAvailabilitySites: defaultOnlineAvailabilitySites(),
  veEnableExternalSearch: true,
  veEnableSubtitleSearch: true,
  veEnableRelatedLists: true,
  veEnableLocalListInSourceModal: true,
  enableActorQuickActions: true,
  veEnableActorNameMarks: true,
  veEnableActorRemarks: false,
  veActorRemarksMode: 'panel',
  veActorRemarksTTLDays: 0,
  veActorRemarksTaskTimeoutSeconds: 10,
  veEnableReviewEnhancement: false,
  veEnableReviewBreaker: false,
  veEnableReviewMagnetLinkify: true,
  veEnableReviewPush115: true,
  veEnableFC2Breaker: false,
  enableAnchorOptimization: false,
  anchorButtonPosition: 'right-center',
  showPreviewButton: true,
  enableMagnetSearch: false,
  magnetSourceSukebei: true,
  magnetSourceBtdig: true,
  magnetSourceBtsow: true,
  magnetSourceTorrentz2: false,
  magnetSourceJavbus: false,
  magnetBlockMojContent: true,
  magnetAutoSearch: false,
  magnetSortMode: 'default',
  magnetPageMaxConcurrentRequests: 2,
  magnetBgGlobalMaxConcurrent: 4,
  magnetBgPerHostMaxConcurrent: 1,
  magnetBgPerHostRateLimitPerMin: 12,
  magnetMaxResults: 15,
  magnetTimeoutMs: 6000,

  enableActorEnhancement: true,
  enableAutoApplyTags: true,
  actorDefaultTags: getDefaultTags(),
  aeEnableActionButtons: true,
  aeEnableTimeSegmentationDivider: false,
  aeTimeSegmentationMonths: 6,

  enableSuperRanking: true,
  veShowLoadingIndicator: true,
  enablePasswordHelper: false,
  passwordShowMethod: 0,
  passwordWaitTime: 300,
  enableSiteAppearance: false,
  siteAppearanceListCards: true,
  siteAppearanceDetailAndRelated: true,
  siteAppearanceMagnetList: true,
  siteAppearancePreviewImages: true,
  siteAppearanceAutoExpandReplaceTip: false,

  enableListEnhancement: true,
  veEnableCoverImage: true,
};

function parseNumber(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').trim());
  return Number.isFinite(n) ? n : fallback;
}

function parseIntSafe(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? Math.trunc(v) : parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function normalizePreviewSource(v: unknown): PreviewSource {
  const s = String(v || '');
  if (s === 'javdb' || s === 'javspyl' || s === 'avpreview' || s === 'vbgfl' || s === 'auto') {
    return s;
  }
  return 'auto';
}

function normalizeWatermarkPosition(v: unknown): WatermarkPosition {
  const s = String(v || '');
  if (
    s === 'top-left' ||
    s === 'top-right' ||
    s === 'bottom-left' ||
    s === 'bottom-right'
  ) {
    return s;
  }
  return 'top-right';
}

function normalizeAppendStrategy(v: unknown): ListSortingAppendStrategy {
  return v === 'auto-resort' ? 'auto-resort' : 'prompt';
}

function normalizeSortPosition(v: unknown): ListSortingPosition {
  return v === 'top' ? 'top' : 'preserve';
}

function normalizeRemarksMode(v: unknown): ActorRemarksMode {
  return v === 'inline' ? 'inline' : 'panel';
}

function normalizeProvider(v: unknown): TranslationProvider {
  return v === 'ai' ? 'ai' : 'traditional';
}

function normalizeDisplayMode(v: unknown): TranslationDisplayMode {
  return v === 'replace' ? 'replace' : 'append';
}

function normalizeAnchorPos(v: unknown): AnchorButtonPosition {
  return v === 'right-bottom' ? 'right-bottom' : 'right-center';
}

function mapOnlineSites(raw: unknown): OnlineAvailabilitySitesMap {
  const base = defaultOnlineAvailabilitySites();
  if (!raw || typeof raw !== 'object') return base;
  const src = raw as Record<string, unknown>;
  const next = { ...base };
  for (const key of Object.keys(base)) {
    if (typeof src[key] === 'boolean') next[key] = src[key] as boolean;
  }
  // 保留未知 key
  for (const [k, v] of Object.entries(src)) {
    if (typeof v === 'boolean') next[k] = v;
  }
  return next;
}

function mapFilterRules(raw: unknown): KeywordFilterRule[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is KeywordFilterRule => !!r && typeof r === 'object')
    .map((r, i) => ({
      id: String((r as KeywordFilterRule).id || `rule-${i}`),
      name: String((r as KeywordFilterRule).name || `规则 ${i + 1}`),
      keyword: String((r as KeywordFilterRule).keyword || ''),
      isRegex: !!(r as KeywordFilterRule).isRegex,
      caseSensitive: !!(r as KeywordFilterRule).caseSensitive,
      action: (r as KeywordFilterRule).action || 'hide',
      enabled: (r as KeywordFilterRule).enabled !== false,
      fields: Array.isArray((r as KeywordFilterRule).fields)
        ? (r as KeywordFilterRule).fields
        : (['title'] as KeywordFilterRule['fields']),
      style: (r as KeywordFilterRule).style,
      message: (r as KeywordFilterRule).message,
      releaseDateRange: (r as KeywordFilterRule).releaseDateRange,
    }));
}

/**
 * 从完整设置映射为增强设置表单
 */
export function mapSettingsToEnhancementForm(
  settings: Partial<ExtensionSettings> | null | undefined,
): EnhancementSettingsFormState {
  const s = (settings || {}) as any;
  const ux = s.userExperience || {};
  const le = s.listEnhancement || {};
  const ldc = le.listDisplayControl || {};
  const pop = le.popularityEffects || {};
  const sorting = le.sorting || {};
  const ve = s.videoEnhancement || {};
  const de = s.dataEnhancement || {};
  const tr = s.translation || {};
  const ae = s.actorEnhancement || {};
  const ms = s.magnetSearch || {};
  const msSources = ms.sources || {};
  const cc = ms.concurrency || {};
  const ao = s.anchorOptimization || {};
  const ph = s.passwordHelper || {};
  const cf = s.contentFilter || {};
  const siteAppearance = s.siteAppearance || {};

  return {
    enableContentFilter: !!(ux.enableContentFilter ?? cf.enabled),
    filterRules: mapFilterRules(cf.keywordRules),
    enableClickEnhancement: le.enableClickEnhancement !== false,
    enableClickEnhancementList: le.enableClickEnhancementList !== false,
    enableClickEnhancementDetail: le.enableClickEnhancementDetail !== false,
    enableVideoPreview: le.enableVideoPreview !== false,
    enableVideoPreviewList: le.enableVideoPreviewList !== false,
    enableVideoPreviewDetail: le.enableVideoPreviewDetail !== false,
    previewDelay: parseIntSafe(le.previewDelay, DEFAULT_ENHANCEMENT_SETTINGS_FORM.previewDelay),
    previewVolume: clamp(
      parseNumber(le.previewVolume, DEFAULT_ENHANCEMENT_SETTINGS_FORM.previewVolume),
      0,
      1,
    ),
    preferredPreviewSource: normalizePreviewSource(le.preferredPreviewSource),
    enableActorWatermark: le.enableActorWatermark === true,
    actorWatermarkPosition: normalizeWatermarkPosition(le.actorWatermarkPosition),
    actorWatermarkOpacity: clamp(
      parseNumber(
        le.actorWatermarkOpacity,
        DEFAULT_ENHANCEMENT_SETTINGS_FORM.actorWatermarkOpacity,
      ),
      0,
      1,
    ),
    listColumnCount: clamp(
      parseIntSafe(ldc.columnCount, DEFAULT_ENHANCEMENT_SETTINGS_FORM.listColumnCount),
      1,
      8,
    ),
    listContainerWidth: clamp(
      parseIntSafe(ldc.containerWidth, DEFAULT_ENHANCEMENT_SETTINGS_FORM.listContainerWidth),
      50,
      200,
    ),
    enableContainerExpansion: ldc.enableContainerExpansion === true,
    showStatusBadge: le.showStatusBadge !== false,
    enableStatusQuickAction: le.enableStatusQuickAction === true,
    enableListFavoriteQuickAction: le.enableListFavoriteQuickAction === true,
    enableResourceTags: le.resourceTags === true,
    enableListSorting: sorting.enabled === true,
    listSortingAppendStrategy: normalizeAppendStrategy(sorting.appendStrategy),
    listSortingAutoResortPosition: normalizeSortPosition(sorting.autoResortPosition),
    enablePopularityEffects: pop.enabled === true,
    popularityMinRating: clamp(
      parseNumber(pop.minRating, DEFAULT_ENHANCEMENT_SETTINGS_FORM.popularityMinRating),
      0,
      5,
    ),
    popularityMinRatingCount: Math.max(
      0,
      Math.round(
        parseNumber(
          pop.minRatingCount,
          DEFAULT_ENHANCEMENT_SETTINGS_FORM.popularityMinRatingCount,
        ),
      ),
    ),
    enableScrollPaging: le.enableScrollPaging === true,

    videoEnhancementSchedulingMode: normalizeVideoEnhancementSchedulingMode(ve.schedulingMode),
    enableTranslation: !!(de.enableTranslation ?? ve.enableTranslation),
    translationProvider: normalizeProvider(tr.provider),
    traditionalApiKey: String(tr.traditional?.apiKey ?? ''),
    translateCurrentTitle: tr.targets ? tr.targets.currentTitle !== false : true,
    translationDisplayMode: normalizeDisplayMode(tr.displayMode),
    enableVideoEnhancement: !!ve.enabled,
    veEnableWantSync: ve.enableWantSync !== false,
    veAutoMarkWatchedAfter115: ve.autoMarkWatchedAfter115 !== false,
    veAutoMarkWatchedStars: clamp(
      parseIntSafe(ve.autoMarkWatchedStars, DEFAULT_ENHANCEMENT_SETTINGS_FORM.veAutoMarkWatchedStars),
      1,
      5,
    ),
    enableVideoFavoriteRating: ve.enableVideoFavoriteRating === true,
    veEnableExternalEntryPanel: ve.enableExternalEntryPanel !== false,
    veEnableOnlineAvailability: ve.enableOnlineAvailability !== false,
    veShowOnlineAvailabilityFailures: ve.showOnlineAvailabilityFailures === true,
    onlineAvailabilitySites: mapOnlineSites(ve.onlineAvailabilitySites),
    veEnableExternalSearch: ve.enableExternalSearch !== false,
    veEnableSubtitleSearch: ve.enableSubtitleSearch !== false,
    veEnableRelatedLists: ve.enableRelatedLists !== false,
    veEnableLocalListInSourceModal: ve.enableLocalListInSourceModal !== false,
    enableActorQuickActions: ve.enableActorQuickActions !== false,
    veEnableActorNameMarks: ve.enableActorNameMarks !== false,
    veEnableActorRemarks: ve.enableActorRemarks === true,
    veActorRemarksMode: normalizeRemarksMode(ve.actorRemarksMode),
    veActorRemarksTTLDays: Math.max(
      0,
      parseIntSafe(ve.actorRemarksTTLDays, DEFAULT_ENHANCEMENT_SETTINGS_FORM.veActorRemarksTTLDays),
    ),
    veActorRemarksTaskTimeoutSeconds: Math.max(
      10,
      parseIntSafe(
        ve.actorRemarksTaskTimeoutSeconds,
        DEFAULT_ENHANCEMENT_SETTINGS_FORM.veActorRemarksTaskTimeoutSeconds,
      ),
    ),
    veEnableReviewEnhancement: ve.enableReviewEnhancement === true,
    veEnableReviewBreaker: ve.enableReviewBreaker === true,
    veEnableReviewMagnetLinkify: ve.enableReviewMagnetLinkify !== false,
    veEnableReviewPush115: ve.enableReviewPush115 !== false,
    veEnableFC2Breaker: ve.enableFC2Breaker === true,
    enableAnchorOptimization: !!(ux.enableAnchorOptimization ?? ao.enabled),
    anchorButtonPosition: normalizeAnchorPos(ao.buttonPosition),
    showPreviewButton: ao.showPreviewButton !== false,
    enableMagnetSearch: !!ux.enableMagnetSearch,
    magnetSourceSukebei: msSources.sukebei !== false,
    magnetSourceBtdig: msSources.btdig !== false,
    magnetSourceBtsow: msSources.btsow !== false,
    magnetSourceTorrentz2: !!msSources.torrentz2,
    magnetSourceJavbus: !!msSources.javbus,
    magnetBlockMojContent: ms.blockMojContent !== false,
    magnetAutoSearch: ms.autoSearch === true,
    magnetSortMode: normalizeMagnetSortMode(ms.sortMode),
    magnetPageMaxConcurrentRequests: parseIntSafe(
      cc.pageMaxConcurrentRequests,
      DEFAULT_ENHANCEMENT_SETTINGS_FORM.magnetPageMaxConcurrentRequests,
    ),
    magnetBgGlobalMaxConcurrent: parseIntSafe(
      cc.bgGlobalMaxConcurrent,
      DEFAULT_ENHANCEMENT_SETTINGS_FORM.magnetBgGlobalMaxConcurrent,
    ),
    magnetBgPerHostMaxConcurrent: parseIntSafe(
      cc.bgPerHostMaxConcurrent,
      DEFAULT_ENHANCEMENT_SETTINGS_FORM.magnetBgPerHostMaxConcurrent,
    ),
    magnetBgPerHostRateLimitPerMin: parseIntSafe(
      cc.bgPerHostRateLimitPerMin,
      DEFAULT_ENHANCEMENT_SETTINGS_FORM.magnetBgPerHostRateLimitPerMin,
    ),
    magnetMaxResults: parseIntSafe(ms.maxResults, DEFAULT_ENHANCEMENT_SETTINGS_FORM.magnetMaxResults),
    magnetTimeoutMs: parseIntSafe(ms.timeoutMs, DEFAULT_ENHANCEMENT_SETTINGS_FORM.magnetTimeoutMs),

    enableActorEnhancement:
      ux.enableActorEnhancement !== undefined
        ? !!ux.enableActorEnhancement
        : ae.enabled !== false,
    enableAutoApplyTags: ae.autoApplyTags !== false,
    actorDefaultTags: Array.isArray(ae.defaultTags) ? [...ae.defaultTags] : getDefaultTags(),
    aeEnableActionButtons: ae.enableActionButtons !== false,
    aeEnableTimeSegmentationDivider: ae.enableTimeSegmentationDivider === true,
    aeTimeSegmentationMonths: clamp(
      parseIntSafe(
        ae.timeSegmentationMonths,
        DEFAULT_ENHANCEMENT_SETTINGS_FORM.aeTimeSegmentationMonths,
      ),
      1,
      24,
    ),

    enableSuperRanking: ux.enableSuperRanking !== false,
    veShowLoadingIndicator: ve.showLoadingIndicator !== false,
    enablePasswordHelper: !!ux.enablePasswordHelper,
    passwordShowMethod: parseIntSafe(
      ph.showMethod,
      DEFAULT_ENHANCEMENT_SETTINGS_FORM.passwordShowMethod,
    ),
    passwordWaitTime: parseIntSafe(
      ph.waitTime,
      DEFAULT_ENHANCEMENT_SETTINGS_FORM.passwordWaitTime,
    ),
    enableSiteAppearance: siteAppearance.enabled === true,
    siteAppearanceListCards: siteAppearance.listCards !== false,
    siteAppearanceDetailAndRelated: siteAppearance.detailAndRelated !== false,
    siteAppearanceMagnetList: siteAppearance.magnetList !== false,
    siteAppearancePreviewImages: siteAppearance.previewImages !== false,
    siteAppearanceAutoExpandReplaceTip: siteAppearance.autoExpandReplaceTip === true,

    enableListEnhancement:
      ux.enableListEnhancement !== undefined
        ? !!ux.enableListEnhancement
        : le.enabled !== false,
    veEnableCoverImage: ve.enableCoverImage !== false,
  };
}

/**
 * 合并表单回完整设置（对齐遗留 doSaveSettings）
 */
export function applyEnhancementFormToSettings(
  current: ExtensionSettings,
  form: EnhancementSettingsFormState,
): ExtensionSettings {
  const existingList = (current as any).listEnhancement || {};
  const existingLdc = existingList.listDisplayControl || {};
  const existingPop = existingList.popularityEffects || {};
  const existingSorting = existingList.sorting || {};
  const existingMs = (current as any).magnetSearch || {};

  return {
    ...current,
    magnetSearch: {
      ...existingMs,
      sources: {
        sukebei: form.magnetSourceSukebei,
        btdig: form.magnetSourceBtdig,
        btsow: form.magnetSourceBtsow,
        torrentz2: form.magnetSourceTorrentz2,
        javbus: form.magnetSourceJavbus,
        custom: Array.isArray(existingMs.sources?.custom) ? existingMs.sources.custom : [],
      },
      blockMojContent: form.magnetBlockMojContent,
      autoSearch: form.magnetAutoSearch,
      sortMode: normalizeMagnetSortMode(form.magnetSortMode),
      maxResults: form.magnetMaxResults,
      timeoutMs: form.magnetTimeoutMs,
      concurrency: {
        ...(existingMs.concurrency || {}),
        pageMaxConcurrentRequests: form.magnetPageMaxConcurrentRequests,
        bgGlobalMaxConcurrent: form.magnetBgGlobalMaxConcurrent,
        bgPerHostMaxConcurrent: form.magnetBgPerHostMaxConcurrent,
        bgPerHostRateLimitPerMin: form.magnetBgPerHostRateLimitPerMin,
      },
    },
    dataEnhancement: {
      ...((current as any).dataEnhancement || {}),
      enableMultiSource: false,
      enableVideoPreview: form.enableVideoPreview,
      enableTranslation: form.enableTranslation,
    },
    videoEnhancement: {
      ...((current as any).videoEnhancement || {}),
      enabled: form.enableVideoEnhancement,
      schedulingMode: form.videoEnhancementSchedulingMode,
      enableCoverImage: form.veEnableCoverImage,
      enableTranslation: form.enableTranslation,
      showLoadingIndicator: form.veShowLoadingIndicator,
      enableReviewEnhancement: form.veEnableReviewEnhancement,
      enableReviewBreaker: form.veEnableReviewBreaker,
      enableFC2Breaker: form.veEnableFC2Breaker,
      enableReviewMagnetLinkify: form.veEnableReviewMagnetLinkify,
      enableReviewPush115: form.veEnableReviewPush115,
      enableWantSync: form.veEnableWantSync,
      autoMarkWatchedAfter115: form.veAutoMarkWatchedAfter115,
      autoMarkWatchedStars: form.veAutoMarkWatchedStars,
      enableActorRemarks: form.veEnableActorRemarks,
      enableActorNameMarks: form.veEnableActorNameMarks,
      enableRelatedLists: form.veEnableRelatedLists,
      enableLocalListInSourceModal: form.veEnableLocalListInSourceModal,
      enableExternalEntryPanel: form.veEnableExternalEntryPanel,
      enableExternalSearch: form.veEnableExternalSearch,
      enableOnlineAvailability: form.veEnableOnlineAvailability,
      showOnlineAvailabilityFailures: form.veShowOnlineAvailabilityFailures,
      onlineAvailabilitySites: { ...form.onlineAvailabilitySites },
      enableSubtitleSearch: form.veEnableSubtitleSearch,
      actorRemarksMode: form.veActorRemarksMode,
      actorRemarksTTLDays: form.veActorRemarksTTLDays,
      actorRemarksTaskTimeoutSeconds: form.veActorRemarksTaskTimeoutSeconds,
      enableVideoFavoriteRating: form.enableVideoFavoriteRating,
      enableActorQuickActions: form.enableActorQuickActions,
    },
    translation: {
      ...((current as any).translation || {}),
      provider: form.translationProvider,
      traditional: {
        service: 'google',
        apiKey: form.traditionalApiKey.trim() || undefined,
        sourceLanguage: 'ja',
        targetLanguage: 'zh-CN',
      },
      ai: {
        useGlobalModel: true,
      },
      displayMode: form.translationDisplayMode,
      targets: {
        currentTitle: form.translateCurrentTitle,
      },
    },
    userExperience: {
      ...((current as any).userExperience || {}),
      enableContentFilter: form.enableContentFilter,
      enableKeyboardShortcuts: false,
      enableMagnetSearch: form.enableMagnetSearch,
      enableAnchorOptimization: form.enableAnchorOptimization,
      enableListEnhancement: form.enableListEnhancement,
      enableActorEnhancement: form.enableActorEnhancement,
      showEnhancedTooltips: false,
      enablePasswordHelper: form.enablePasswordHelper,
      enableSuperRanking: form.enableSuperRanking,
    },
    passwordHelper: {
      ...((current as any).passwordHelper || {}),
      showMethod: form.passwordShowMethod,
      waitTime: form.passwordWaitTime,
    },
    siteAppearance: {
      enabled: form.enableSiteAppearance,
      listCards: form.siteAppearanceListCards,
      detailAndRelated: form.siteAppearanceDetailAndRelated,
      magnetList: form.siteAppearanceMagnetList,
      previewImages: form.siteAppearancePreviewImages,
      autoExpandReplaceTip: form.siteAppearanceAutoExpandReplaceTip,
    },
    anchorOptimization: {
      ...((current as any).anchorOptimization || {}),
      enabled: form.enableAnchorOptimization,
      showPreviewButton: form.showPreviewButton,
      buttonPosition: form.anchorButtonPosition,
    },
    listEnhancement: {
      ...existingList,
      enabled: form.enableListEnhancement,
      enableClickEnhancement: form.enableClickEnhancement,
      enableClickEnhancementList: form.enableClickEnhancementList,
      enableClickEnhancementDetail: form.enableClickEnhancementDetail,
      enableVideoPreview: form.enableVideoPreview,
      enableVideoPreviewList: form.enableVideoPreviewList,
      enableVideoPreviewDetail: form.enableVideoPreviewDetail,
      enableScrollPaging: form.enableScrollPaging,
      enableListOptimization: true,
      previewDelay: form.previewDelay,
      previewVolume: form.previewVolume,
      enableRightClickBackground: true,
      preferredPreviewSource: form.preferredPreviewSource,
      enableActorWatermark: form.enableActorWatermark,
      actorWatermarkPosition: form.actorWatermarkPosition,
      actorWatermarkOpacity: form.actorWatermarkOpacity,
      listDisplayControl: {
        ...existingLdc,
        enabled: true,
        columnCount: form.listColumnCount,
        containerWidth: form.listContainerWidth,
        enableContainerExpansion: form.enableContainerExpansion,
      },
      showStatusBadge: form.showStatusBadge,
      enableStatusQuickAction: form.enableStatusQuickAction,
      enableListFavoriteQuickAction: form.enableListFavoriteQuickAction,
      resourceTags: form.enableResourceTags,
      popularityEffects: {
        ...existingPop,
        enabled: form.enablePopularityEffects,
        minRating: clamp(form.popularityMinRating, 0, 5),
        minRatingCount: Math.max(0, Math.round(form.popularityMinRatingCount)),
      },
      sorting: {
        ...existingSorting,
        enabled: form.enableListSorting,
        appendStrategy: form.listSortingAppendStrategy,
        autoResortPosition: form.listSortingAutoResortPosition,
      },
    },
    actorEnhancement: {
      ...((current as any).actorEnhancement || {}),
      enabled: form.enableActorEnhancement,
      autoApplyTags: form.enableAutoApplyTags,
      defaultTags: [...form.actorDefaultTags],
      defaultSortType: 0,
      enableActionButtons: form.aeEnableActionButtons,
      enableTimeSegmentationDivider: form.aeEnableTimeSegmentationDivider,
      timeSegmentationMonths: form.aeTimeSegmentationMonths,
    },
    contentFilter: {
      ...((current as any).contentFilter || {}),
      enabled: form.enableContentFilter,
      keywordRules: form.filterRules.map((r) => ({ ...r })),
    },
  };
}

/**
 * 轻量校验
 */
export function validateEnhancementForm(form: EnhancementSettingsFormState): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (form.previewDelay < 100 || form.previewDelay > 5000) {
    errors.push('预览延迟须在 100–5000 ms');
  }
  if (form.previewVolume < 0 || form.previewVolume > 1) {
    errors.push('预览音量须在 0–1');
  }
  if (form.listColumnCount < 1 || form.listColumnCount > 8) {
    errors.push('列表列数须在 1–8');
  }
  if (form.aeTimeSegmentationMonths < 1 || form.aeTimeSegmentationMonths > 24) {
    errors.push('时间阈值须在 1–24 月');
  }
  if (form.passwordWaitTime < 0 || form.passwordWaitTime > 2000) {
    errors.push('密码等待时间须在 0–2000 ms');
  }
  if (form.enableMagnetSearch) {
    const anySource =
      form.magnetSourceSukebei ||
      form.magnetSourceBtdig ||
      form.magnetSourceBtsow ||
      form.magnetSourceTorrentz2 ||
      form.magnetSourceJavbus;
    if (!anySource) warnings.push('磁力搜索已开启但未选择任何搜索源');
  }
  if (form.enableTranslation && form.translationProvider === 'ai') {
    warnings.push('AI 翻译需先在 AI 设置中配置模型');
  }

  return { isValid: errors.length === 0, errors, warnings };
}

/**
 * 新建一条简单关键词隐藏规则
 */
export function createSimpleFilterRule(keyword: string, name?: string): KeywordFilterRule {
  const kw = keyword.trim();
  const id = `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    name: (name || kw || '新规则').trim() || '新规则',
    keyword: kw,
    isRegex: false,
    caseSensitive: false,
    action: 'hide',
    enabled: true,
    fields: ['title'],
  };
}

/**
 * 切换默认演员标签
 */
export function toggleActorDefaultTag(tags: string[], value: string, enabled: boolean): string[] {
  const set = new Set(tags);
  if (enabled) set.add(value);
  else set.delete(value);
  return Array.from(set);
}

/**
 * 切换在线可用性站点
 */
export function toggleOnlineAvailabilitySite(
  sites: OnlineAvailabilitySitesMap,
  key: string,
  enabled: boolean,
): OnlineAvailabilitySitesMap {
  return { ...sites, [key]: enabled };
}

/**
 * 更新过滤规则 enabled
 */
export function setFilterRuleEnabled(
  rules: KeywordFilterRule[],
  index: number,
  enabled: boolean,
): KeywordFilterRule[] {
  if (index < 0 || index >= rules.length) return rules;
  const next = [...rules];
  next[index] = { ...next[index], enabled };
  return next;
}

/**
 * 删除过滤规则
 */
export function removeFilterRuleAt(
  rules: KeywordFilterRule[],
  index: number,
): KeywordFilterRule[] {
  if (index < 0 || index >= rules.length) return rules;
  const next = [...rules];
  next.splice(index, 1);
  return next;
}

/**
 * 动作文案
 */
export function getFilterActionLabel(action: KeywordFilterRule['action']): string {
  switch (action) {
    case 'hide':
      return '隐藏';
    case 'highlight':
      return '高亮';
    case 'blur':
      return '模糊';
    case 'mark':
      return '标记';
    default:
      return String(action);
  }
}
