import type { ExtensionSettings } from '../../../../../types';
import { collectOnlineAvailabilitySiteStates } from './onlineAvailabilitySites';

type EnhancementSaveHost = {
  enableSuperRanking?: HTMLInputElement;
  enableListEnhancement?: HTMLInputElement;
  enableClickEnhancement?: HTMLInputElement;
  enableClickEnhancementList?: HTMLInputElement;
  enableClickEnhancementDetail?: HTMLInputElement;
  enableListVideoPreview?: HTMLInputElement;
  enableVideoPreviewList?: HTMLInputElement;
  enableVideoPreviewDetail?: HTMLInputElement;
  enableScrollPaging?: HTMLInputElement;
  previewDelay?: HTMLInputElement;
  previewVolume?: HTMLInputElement;
  enableActorWatermark?: HTMLInputElement;
  actorWatermarkPosition?: HTMLSelectElement;
  actorWatermarkOpacity?: HTMLInputElement;
  listColumnCount?: HTMLInputElement;
  listContainerWidth?: HTMLInputElement;
  enableContainerExpansion?: HTMLInputElement;
  showStatusBadge?: HTMLInputElement;
  enableLibraryMatchStatus?: HTMLInputElement;
  enableStatusQuickAction?: HTMLInputElement;
  enableListFavoriteQuickAction?: HTMLInputElement;
  enablePopularityEffects?: HTMLInputElement;
  popularityMinRating?: HTMLInputElement;
  popularityMinRatingCount?: HTMLInputElement;
  enableListSorting?: HTMLInputElement;
  listSortingAppendStrategy?: HTMLSelectElement;
  listSortingAutoResortPosition?: HTMLSelectElement;
  veEnableRelatedLists?: HTMLInputElement;
  veEnableLocalListInSourceModal?: HTMLInputElement;
  veEnableExternalEntryPanel?: HTMLInputElement;
  veEnableExternalSearch?: HTMLInputElement;
  veEnableOnlineAvailability?: HTMLInputElement;
  veShowOnlineAvailabilityFailures?: HTMLInputElement;
  veEnableSubtitleSearch?: HTMLInputElement;
  onlineAvailabilitySiteInputs?: ArrayLike<HTMLInputElement>;
  getPreferredPreviewSource?: () => 'auto' | 'javdb' | 'javspyl' | 'avpreview' | 'vbgfl';
  getVideoEnhancementSchedulingMode?: () => 'smart' | 'immediate';
};

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeListSortingAppendStrategy(value: string | undefined, fallback: string): 'prompt' | 'auto-resort' {
  return value === 'auto-resort' || value === 'prompt'
    ? value
    : (fallback === 'auto-resort' ? 'auto-resort' : 'prompt');
}

function normalizeListSortingPosition(value: string | undefined, fallback: string): 'preserve' | 'top' {
  return value === 'top' || value === 'preserve'
    ? value
    : (fallback === 'top' ? 'top' : 'preserve');
}

export function mergeEnhancementSettingsForSave(
  current: ExtensionSettings,
  host: EnhancementSaveHost
): ExtensionSettings {
  const existingListEnhancement = current.listEnhancement || {};
  const { libraryMatchStatus: legacyLibraryMatchStatus, ...listEnhancementWithoutLibraryMatchStatus } = existingListEnhancement as any;
  const existingListDisplayControl = (existingListEnhancement as any).listDisplayControl || {};
  const existingPopularityEffects = (existingListEnhancement as any).popularityEffects || {};
  const existingListSorting = (existingListEnhancement as any).sorting || {};
  const existingVideoEnhancement = (current as any).videoEnhancement || {};
  const existingUserExperience = (current as any).userExperience || {};
  const existingLibraryMatchStatus = (current as any).libraryMatchStatus ?? legacyLibraryMatchStatus ?? {};
  const onlineAvailabilitySites = collectOnlineAvailabilitySiteStates(host.onlineAvailabilitySiteInputs);

  return {
    ...current,
    userExperience: {
      ...existingUserExperience,
      enableSuperRanking: host.enableSuperRanking?.checked ?? existingUserExperience.enableSuperRanking ?? true,
    },
    videoEnhancement: {
      ...existingVideoEnhancement,
      schedulingMode: host.getVideoEnhancementSchedulingMode?.()
        ?? (existingVideoEnhancement.schedulingMode === 'immediate' ? 'immediate' : 'smart'),
      enableRelatedLists: host.veEnableRelatedLists?.checked ?? existingVideoEnhancement.enableRelatedLists ?? true,
      enableLocalListInSourceModal: host.veEnableLocalListInSourceModal?.checked ?? existingVideoEnhancement.enableLocalListInSourceModal ?? true,
      enableExternalEntryPanel: host.veEnableExternalEntryPanel?.checked ?? existingVideoEnhancement.enableExternalEntryPanel ?? true,
      enableExternalSearch: host.veEnableExternalSearch?.checked ?? existingVideoEnhancement.enableExternalSearch ?? true,
      enableOnlineAvailability: host.veEnableOnlineAvailability?.checked ?? existingVideoEnhancement.enableOnlineAvailability ?? true,
      showOnlineAvailabilityFailures: host.veShowOnlineAvailabilityFailures?.checked ?? existingVideoEnhancement.showOnlineAvailabilityFailures ?? false,
      onlineAvailabilitySites: onlineAvailabilitySites ?? existingVideoEnhancement.onlineAvailabilitySites ?? {},
      enableSubtitleSearch: host.veEnableSubtitleSearch?.checked ?? existingVideoEnhancement.enableSubtitleSearch ?? true,
    },
    libraryMatchStatus: {
      enabled: host.enableLibraryMatchStatus?.checked ?? existingLibraryMatchStatus.enabled ?? false,
      sources: { drive115: true, emby: true, ...(existingLibraryMatchStatus.sources || {}) },
    },
    listEnhancement: {
      ...listEnhancementWithoutLibraryMatchStatus,
      enabled: host.enableListEnhancement?.checked ?? existingListEnhancement.enabled,
      enableClickEnhancement: host.enableClickEnhancement?.checked ?? existingListEnhancement.enableClickEnhancement,
      enableClickEnhancementList: host.enableClickEnhancementList?.checked ?? (existingListEnhancement as any).enableClickEnhancementList,
      enableClickEnhancementDetail: host.enableClickEnhancementDetail?.checked ?? (existingListEnhancement as any).enableClickEnhancementDetail,
      enableVideoPreview: host.enableListVideoPreview?.checked ?? existingListEnhancement.enableVideoPreview,
      enableVideoPreviewList: host.enableVideoPreviewList?.checked ?? (existingListEnhancement as any).enableVideoPreviewList,
      enableVideoPreviewDetail: host.enableVideoPreviewDetail?.checked ?? (existingListEnhancement as any).enableVideoPreviewDetail,
      enableScrollPaging: host.enableScrollPaging?.checked ?? existingListEnhancement.enableScrollPaging,
      enableListOptimization: true,
      previewDelay: parseNumber(host.previewDelay?.value, existingListEnhancement.previewDelay ?? 1000),
      previewVolume: parseNumber(host.previewVolume?.value, existingListEnhancement.previewVolume ?? 0.2),
      enableRightClickBackground: true,
      preferredPreviewSource: host.getPreferredPreviewSource?.() ?? (existingListEnhancement as any).preferredPreviewSource ?? 'auto',
      enableActorWatermark: host.enableActorWatermark?.checked ?? (existingListEnhancement as any).enableActorWatermark,
      actorWatermarkPosition: host.actorWatermarkPosition?.value || (existingListEnhancement as any).actorWatermarkPosition || 'top-right',
      actorWatermarkOpacity: parseNumber(host.actorWatermarkOpacity?.value, (existingListEnhancement as any).actorWatermarkOpacity ?? 0.8),
      listDisplayControl: {
        ...existingListDisplayControl,
        enabled: true,
        columnCount: parseNumber(host.listColumnCount?.value, existingListDisplayControl.columnCount ?? 4),
        containerWidth: parseNumber(host.listContainerWidth?.value, existingListDisplayControl.containerWidth ?? 100),
        enableContainerExpansion: host.enableContainerExpansion?.checked ?? existingListDisplayControl.enableContainerExpansion ?? false,
      },
      showStatusBadge: host.showStatusBadge?.checked ?? (existingListEnhancement as any).showStatusBadge ?? true,
      enableStatusQuickAction: host.enableStatusQuickAction?.checked ?? (existingListEnhancement as any).enableStatusQuickAction ?? false,
      enableListFavoriteQuickAction: host.enableListFavoriteQuickAction?.checked ?? (existingListEnhancement as any).enableListFavoriteQuickAction ?? false,
      popularityEffects: {
        ...existingPopularityEffects,
        enabled: host.enablePopularityEffects?.checked ?? existingPopularityEffects.enabled ?? false,
        minRating: Math.max(0, Math.min(5, parseNumber(host.popularityMinRating?.value, existingPopularityEffects.minRating ?? 4))),
        minRatingCount: Math.max(0, Math.round(parseNumber(host.popularityMinRatingCount?.value, existingPopularityEffects.minRatingCount ?? 350))),
      },
      sorting: {
        ...existingListSorting,
        enabled: host.enableListSorting?.checked ?? existingListSorting.enabled ?? false,
        appendStrategy: normalizeListSortingAppendStrategy(
          host.listSortingAppendStrategy?.value,
          existingListSorting.appendStrategy ?? 'prompt',
        ),
        autoResortPosition: normalizeListSortingPosition(
          host.listSortingAutoResortPosition?.value,
          existingListSorting.autoResortPosition ?? 'preserve',
        ),
      },
    },
  };
}
