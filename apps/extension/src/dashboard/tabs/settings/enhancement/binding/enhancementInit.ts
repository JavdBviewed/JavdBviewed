import { TaskDetailsController } from '../taskDetails/taskDetailsController';
import { renderOnlineAvailabilitySiteOptions } from '../settings/onlineAvailabilitySites';

export type EnhancementInitHost = any;

export function initializeElements(host: EnhancementInitHost): void {
  host.taskDetailsController = new TaskDetailsController(host as any);
  host.renderActorFilterTags();

  const ids: Array<[string, string]> = [
    ['enableTranslation', 'enableTranslation'],
    ['enableContentFilter', 'enableContentFilter'],
    ['enableMagnetSearch', 'enableMagnetSearch'],
    ['enableAnchorOptimization', 'enableAnchorOptimization'],
    ['enableListEnhancement', 'enableListEnhancement'],
    ['enableActorEnhancement', 'enableActorEnhancement'],
    ['enableVideoEnhancement', 'enableVideoEnhancement'],
    ['enablePasswordHelper', 'enablePasswordHelper'],
    ['enableSuperRanking', 'enableSuperRanking'],
    ['passwordShowMethod', 'passwordShowMethod'],
    ['passwordWaitTime', 'passwordWaitTime'],
    ['aeEnableActionButtons', 'aeEnableActionButtons'],
    ['aeEnableTimeSegmentationDivider', 'aeEnableTimeSegmentationDivider'],
    ['aeTimeSegmentationMonths', 'aeTimeSegmentationMonths'],
    ['magnetSourceSukebei', 'magnetSourceSukebei'],
    ['magnetSourceBtdig', 'magnetSourceBtdig'],
    ['magnetSourceBtsow', 'magnetSourceBtsow'],
    ['magnetSourceTorrentz2', 'magnetSourceTorrentz2'],
    ['magnetSourceJavbus', 'magnetSourceJavbus'],
    ['magnetBlockMojContent', 'magnetBlockMojContent'],
    ['magnetAutoSearch', 'magnetAutoSearch'],
    ['magnetSortMode', 'magnetSortMode'],
    ['anchorButtonPosition', 'anchorButtonPosition'],
    ['showPreviewButton', 'showPreviewButton'],
    ['enableClickEnhancement', 'enableClickEnhancement'],
    ['enableClickEnhancementList', 'enableClickEnhancementList'],
    ['enableClickEnhancementDetail', 'enableClickEnhancementDetail'],
    ['enableVideoPreview', 'enableListVideoPreview'],
    ['enableVideoPreviewList', 'enableVideoPreviewList'],
    ['enableVideoPreviewDetail', 'enableVideoPreviewDetail'],
    ['enableScrollPaging', 'enableScrollPaging'],
    ['enableActorWatermark', 'enableActorWatermark'],
    ['previewDelay', 'previewDelay'],
    ['previewVolume', 'previewVolume'],
    ['previewVolumeValue', 'previewVolumeValue'],
    ['veEnableCoverImage', 'veEnableCoverImage'],
    ['veShowLoadingIndicator', 'veShowLoadingIndicator'],
    ['veEnableReviewEnhancement', 'veEnableReviewEnhancement'],
    ['veEnableReviewBreaker', 'veEnableReviewBreaker'],
    ['veEnableFC2Breaker', 'veEnableFC2Breaker'],
    ['veEnableReviewMagnetLinkify', 'veEnableReviewMagnetLinkify'],
    ['veEnableReviewPush115', 'veEnableReviewPush115'],
    ['veEnableActorRemarks', 'veEnableActorRemarks'],
    ['veEnableActorNameMarks', 'veEnableActorNameMarks'],
    ['veEnableRelatedLists', 'veEnableRelatedLists'],
    ['veEnableLocalListInSourceModal', 'veEnableLocalListInSourceModal'],
    ['veEnableExternalEntryPanel', 'veEnableExternalEntryPanel'],
    ['veEnableExternalSearch', 'veEnableExternalSearch'],
    ['veEnableOnlineAvailability', 'veEnableOnlineAvailability'],
    ['veShowOnlineAvailabilityFailures', 'veShowOnlineAvailabilityFailures'],
    ['veEnableSubtitleSearch', 'veEnableSubtitleSearch'],
    ['veActorRemarksMode', 'veActorRemarksMode'],
    ['veActorRemarksTTL', 'veActorRemarksTTL'],
    ['veActorRemarksTaskTimeout', 'veActorRemarksTaskTimeout'],
    ['enableVideoFavoriteRating', 'veEnableVideoFavoriteRating'],
    ['enableActorQuickActions', 'enableActorQuickActions'],
    ['veEnableWantSync', 'veEnableWantSync'],
    ['veAutoMarkWatchedAfter115', 'veAutoMarkWatchedAfter115'],
    ['veAutoMarkWatchedStars', 'veAutoMarkWatchedStars'],
    ['actorWatermarkPosition', 'actorWatermarkPosition'],
    ['actorWatermarkOpacity', 'actorWatermarkOpacity'],
    ['actorWatermarkOpacityValue', 'actorWatermarkOpacityValue'],
    ['listColumnCount', 'listColumnCount'],
    ['listColumnCountValue', 'listColumnCountValue'],
    ['listContainerWidth', 'listContainerWidth'],
    ['listContainerWidthValue', 'listContainerWidthValue'],
    ['enableContainerExpansion', 'enableContainerExpansion'],
    ['showStatusBadge', 'showStatusBadge'],
    ['enableLibraryMatchStatus', 'enableLibraryMatchStatus'],
    ['enableStatusQuickAction', 'enableStatusQuickAction'],
    ['enableListFavoriteQuickAction', 'enableListFavoriteQuickAction'],
    ['enablePopularityEffects', 'enablePopularityEffects'],
    ['popularityMinRating', 'popularityMinRating'],
    ['popularityMinRatingCount', 'popularityMinRatingCount'],
    ['enableListSorting', 'enableListSorting'],
    ['listSortingAppendStrategy', 'listSortingAppendStrategy'],
    ['listSortingAutoResortPosition', 'listSortingAutoResortPosition'],
    ['previewSourceAuto', 'previewSourceAuto'],
    ['previewSourceJavDB', 'previewSourceJavDB'],
    ['previewSourceJavSpyl', 'previewSourceJavSpyl'],
    ['previewSourceAVPreview', 'previewSourceAVPreview'],
    ['previewSourceVBGFL', 'previewSourceVBGFL'],
    ['translationConfig', 'translationConfig'],
    ['translationProvider', 'translationProviderSel'],
    ['traditionalTranslationService', 'traditionalServiceSel'],
    ['traditionalApiKey', 'traditionalApiKeyInput'],
    ['traditionalApiKeyGroup', 'traditionalApiKeyGroup'],
    ['currentTranslationService', 'currentTranslationServiceLabel'],
    ['aiTranslationConfig', 'aiConfigContainer'],
    ['traditionalTranslationConfig', 'traditionalConfigContainer'],
    ['translateCurrentTitle', 'translateCurrentTitleChk'],
    ['translationDisplayMode', 'translationDisplayModeSel'],
    ['aiCurrentModel', 'aiCurrentModelLabel'],
    ['aiModelEmptyTip', 'aiModelEmptyTip'],
    ['goAiSettingsBtn', 'goAiSettingsBtn'],
    ['magnetSourcesConfig', 'magnetSourcesConfig'],
    ['contentFilterConfig', 'contentFilterConfig'],
    ['anchorOptimizationConfig', 'anchorOptimizationConfig'],
    ['listEnhancementConfig', 'listEnhancementConfig'],
    ['videoEnhancementConfig', 'videoEnhancementConfig'],
    ['addFilterRule', 'addFilterRuleBtn'],
    ['filterRulesList', 'filterRulesList'],
    ['orchestratorLegend', 'orchestratorLegend'],
    ['orchestratorConnectionStatus', 'orchestratorConnectionStatus'],
  ];

  ids.forEach(([id, key]) => {
    host[key] = document.getElementById(id) as any;
  });

  host.onlineAvailabilitySiteList = document.getElementById('onlineAvailabilitySiteList') as HTMLElement | null;
  renderOnlineAvailabilitySiteOptions(host.onlineAvailabilitySiteList);
  host.onlineAvailabilitySiteInputs = document.querySelectorAll('.online-availability-site-input') as NodeListOf<HTMLInputElement>;

  host.enableAutoApplyTags = document.getElementById('enableAutoApplyTags') as HTMLInputElement;
  host.actorDefaultTagInputs = document.querySelectorAll('#actorDefaultTagsGroup input[name="actorDefaultTag"]') as NodeListOf<HTMLInputElement>;
  host.actorEnhancementConfig = document.getElementById('actorEnhancementConfig') as HTMLElement;
  host.lastAppliedTagsDisplay = document.getElementById('lastAppliedTagsDisplay') as HTMLElement;
  host.appliedTagsContainer = document.getElementById('appliedTagsContainer') as HTMLElement;
  host.clearLastAppliedTags = document.getElementById('clearLastAppliedTags') as HTMLButtonElement;

  host.injectMagnetConcurrencyControls();
  host.magnetPageMaxConcurrentRequests = document.getElementById('magnetPageMaxConcurrentRequests') as HTMLInputElement;
  host.magnetBgGlobalMaxConcurrent = document.getElementById('magnetBgGlobalMaxConcurrent') as HTMLInputElement;
  host.magnetBgPerHostMaxConcurrent = document.getElementById('magnetBgPerHostMaxConcurrent') as HTMLInputElement;
  host.magnetBgPerHostRateLimitPerMin = document.getElementById('magnetBgPerHostRateLimitPerMin') as HTMLInputElement;

  host.subtabLinks = document.querySelectorAll('#enhancement-settings .subtab-link');
  host.showOrchestratorBtn = document.getElementById('showOrchestratorBtn') as HTMLButtonElement | null;
  host.orchestratorModal = document.getElementById('orchestratorModal') as HTMLElement | null;
  host.orchestratorModalClose = document.getElementById('orchestratorModalClose') as HTMLButtonElement | null;
  host.orchestratorCloseBtn = document.getElementById('orchestratorCloseBtn') as HTMLButtonElement | null;
  host.orchestratorRefreshBtn = document.getElementById('orchestratorRefreshBtn') as HTMLButtonElement | null;
  host.orchestratorStopAllBtn = document.getElementById('orchestratorStopAllBtn') as HTMLButtonElement | null;
  host.orchestratorClearGlobalBtn = document.getElementById('orchestratorClearGlobalBtn') as HTMLButtonElement | null;
    host.orchestratorFullscreenBtn = document.getElementById('orchestratorFullscreenBtn') as HTMLButtonElement | null;
  host.orchestratorCopyPhasesBtn = document.getElementById('orchestratorCopyPhasesBtn') as HTMLButtonElement | null;
  host.orchestratorCopyTimelineBtn = document.getElementById('orchestratorCopyTimelineBtn') as HTMLButtonElement | null;
  host.orchViewModeSel = document.getElementById('orchViewMode') as HTMLSelectElement | null;
  host.orchFilterStatusSel = document.getElementById('orchFilterStatus') as HTMLSelectElement | null;
  host.orchFilterPhaseSel = document.getElementById('orchFilterPhase') as HTMLSelectElement | null;
  host.orchGlobalScopeSel = document.getElementById('orchGlobalScope') as HTMLSelectElement | null;
  host.orchGlobalGroupingSel = document.getElementById('orchGlobalGrouping') as HTMLSelectElement | null;
  host.orchFilterSearchInput = document.getElementById('orchFilterSearch') as HTMLInputElement | null;
  host.taskDetailsCopyCurrentPageBtn = document.getElementById('taskDetailsCopyCurrentPageBtn') as HTMLButtonElement | null;
  host.taskDetailsCopyDiagnosticsBtn = document.getElementById('taskDetailsCopyDiagnosticsBtn') as HTMLButtonElement | null;
  host.orchestratorPhases = document.getElementById('orchestratorPhases') as HTMLElement | null;
  host.orchestratorTimeline = document.getElementById('orchestratorTimeline') as HTMLElement | null;
  host.orchestratorSummary = document.getElementById('orchestratorSummary') as HTMLElement | null;
  host.orchestratorDag = document.getElementById('orchestratorDag') as HTMLElement | null;
  host.orchestratorGrid = document.getElementById('orchestratorGrid') as HTMLElement | null;

  host.showTaskDetailsBtn = document.getElementById('showTaskDetailsBtn') as HTMLButtonElement | null;
  host.taskDetailsModal = document.getElementById('taskDetailsModal') as HTMLElement | null;
  host.taskDetailsModalClose = document.getElementById('taskDetailsModalClose') as HTMLButtonElement | null;
  host.taskDetailsCloseBtn = document.getElementById('taskDetailsCloseBtn') as HTMLButtonElement | null;
  host.taskDetailsRefreshBtn = document.getElementById('taskDetailsRefreshBtn') as HTMLButtonElement | null;
  host.taskDetailsStopAllBtn = document.getElementById('taskDetailsStopAllBtn') as HTMLButtonElement | null;
  host.taskDetailsClearBtn = document.getElementById('taskDetailsClearBtn') as HTMLButtonElement | null;
  host.taskDetailsTable = document.getElementById('taskDetailsTable') as HTMLTableElement | null;
  host.taskDetailsTableBody = document.getElementById('taskDetailsTableBody') as HTMLElement | null;
  host.taskDetailsCount = document.getElementById('taskDetailsCount') as HTMLElement | null;
  host.taskDetailsPrevPage = document.getElementById('taskDetailsPrevPage') as HTMLButtonElement | null;
  host.taskDetailsNextPage = document.getElementById('taskDetailsNextPage') as HTMLButtonElement | null;
  host.taskDetailsPagination = document.getElementById('taskDetailsPagination') as HTMLElement | null;
  host.taskDetailsSearch = document.getElementById('taskDetailsSearch') as HTMLInputElement | null;
  host.taskDetailsViewTasks = document.getElementById('taskDetailsViewTasks') as HTMLButtonElement | null;
  host.taskDetailsViewPages = document.getElementById('taskDetailsViewPages') as HTMLButtonElement | null;
  host.taskDetailsViewMode = null;
  host.taskDetailsPageSummaryHead = document.getElementById('taskDetailsPageSummaryHead') as HTMLElement | null;
}
