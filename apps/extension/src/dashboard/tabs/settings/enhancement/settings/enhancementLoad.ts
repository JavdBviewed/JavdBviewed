import { STATE } from '../../../../state';
import { getDefaultTags } from '../../../../config/actorFilterTags';
import { applyOnlineAvailabilitySiteStates } from './onlineAvailabilitySites';
import { normalizeMagnetSortMode } from '../../../../../features/magnets';

export type EnhancementLoadHost = any;

export async function doLoadSettings(host: EnhancementLoadHost): Promise<void> {
  const settings = STATE.settings;
  const dataEnhancement = settings?.dataEnhancement || {};
  const userExperience = settings?.userExperience || {};
  const anchorOptimization = settings?.anchorOptimization || {};
  const listEnhancement = settings?.listEnhancement || {};

  host.enableTranslation.checked = dataEnhancement?.enableTranslation || false;
  host.enableContentFilter.checked = userExperience?.enableContentFilter || false;
  host.enableMagnetSearch.checked = userExperience?.enableMagnetSearch || false;
  host.enableAnchorOptimization.checked = userExperience?.enableAnchorOptimization || false;
  if (userExperience.enableListEnhancement !== undefined) host.enableListEnhancement.checked = userExperience.enableListEnhancement;
  if (userExperience.enableActorEnhancement !== undefined) host.enableActorEnhancement.checked = userExperience.enableActorEnhancement;
  if (userExperience.enablePasswordHelper !== undefined) host.enablePasswordHelper.checked = userExperience.enablePasswordHelper;
  if (host.enableSuperRanking) host.enableSuperRanking.checked = userExperience.enableSuperRanking !== false;

  const passwordHelper = (settings as any).passwordHelper || { showMethod: 0, waitTime: 300 };
  if (host.passwordShowMethod) host.passwordShowMethod.value = String(passwordHelper.showMethod || 0);
  if (host.passwordWaitTime) host.passwordWaitTime.value = String(passwordHelper.waitTime || 300);

  const magnetSearch = (settings as any).magnetSearch || {};
  const msSources = magnetSearch.sources || {};
  host.magnetSourceSukebei.checked = msSources.sukebei !== false;
  host.magnetSourceBtdig.checked = msSources.btdig !== false;
  host.magnetSourceBtsow.checked = msSources.btsow !== false;
  host.magnetSourceTorrentz2.checked = !!msSources.torrentz2;
  if (host.magnetSourceJavbus) host.magnetSourceJavbus.checked = !!msSources.javbus;
  if (host.magnetBlockMojContent) host.magnetBlockMojContent.checked = magnetSearch.blockMojContent !== false;
  if (host.magnetAutoSearch) host.magnetAutoSearch.checked = magnetSearch.autoSearch === true;
  if (host.magnetSortMode) host.magnetSortMode.value = normalizeMagnetSortMode(magnetSearch.sortMode);

  const cc = (magnetSearch.concurrency || {}) as any;
  if (host.magnetPageMaxConcurrentRequests) host.magnetPageMaxConcurrentRequests.value = String(typeof cc.pageMaxConcurrentRequests === 'number' ? cc.pageMaxConcurrentRequests : 2);
  if (host.magnetBgGlobalMaxConcurrent) host.magnetBgGlobalMaxConcurrent.value = String(typeof cc.bgGlobalMaxConcurrent === 'number' ? cc.bgGlobalMaxConcurrent : 4);
  if (host.magnetBgPerHostMaxConcurrent) host.magnetBgPerHostMaxConcurrent.value = String(typeof cc.bgPerHostMaxConcurrent === 'number' ? cc.bgPerHostMaxConcurrent : 1);
  if (host.magnetBgPerHostRateLimitPerMin) host.magnetBgPerHostRateLimitPerMin.value = String(typeof cc.bgPerHostRateLimitPerMin === 'number' ? cc.bgPerHostRateLimitPerMin : 12);

  if (anchorOptimization) {
    if (anchorOptimization.buttonPosition && host.anchorButtonPosition) host.anchorButtonPosition.value = anchorOptimization.buttonPosition;
    if (anchorOptimization.showPreviewButton !== undefined && host.showPreviewButton) host.showPreviewButton.checked = anchorOptimization.showPreviewButton;
  }

  if (host.enableClickEnhancement) host.enableClickEnhancement.checked = listEnhancement.enableClickEnhancement !== false;
  if (host.enableClickEnhancementList) host.enableClickEnhancementList.checked = (listEnhancement as any).enableClickEnhancementList !== false;
  if (host.enableClickEnhancementDetail) host.enableClickEnhancementDetail.checked = (listEnhancement as any).enableClickEnhancementDetail !== false;
  if (host.enableListVideoPreview) host.enableListVideoPreview.checked = listEnhancement.enableVideoPreview !== false;
  if (host.enableVideoPreviewList) host.enableVideoPreviewList.checked = (listEnhancement as any).enableVideoPreviewList !== false;
  if (host.enableVideoPreviewDetail) host.enableVideoPreviewDetail.checked = (listEnhancement as any).enableVideoPreviewDetail !== false;
  if (host.enableScrollPaging) host.enableScrollPaging.checked = listEnhancement.enableScrollPaging || false;
  if (host.enableActorWatermark) host.enableActorWatermark.checked = (listEnhancement as any).enableActorWatermark === true;
  if (host.showStatusBadge) host.showStatusBadge.checked = (listEnhancement as any).showStatusBadge !== false;
  if (host.enableStatusQuickAction) host.enableStatusQuickAction.checked = (listEnhancement as any).enableStatusQuickAction === true;
  if (host.enableListFavoriteQuickAction) host.enableListFavoriteQuickAction.checked = (listEnhancement as any).enableListFavoriteQuickAction === true;
  if (host.enablePopularityEffects) host.enablePopularityEffects.checked = (listEnhancement as any).popularityEffects?.enabled === true;
  if (host.popularityMinRating) host.popularityMinRating.value = String((listEnhancement as any).popularityEffects?.minRating ?? 4);
  if (host.popularityMinRatingCount) host.popularityMinRatingCount.value = String((listEnhancement as any).popularityEffects?.minRatingCount ?? 350);
  if (host.enableListSorting) host.enableListSorting.checked = (listEnhancement as any).sorting?.enabled === true;
  if (host.listSortingAppendStrategy) host.listSortingAppendStrategy.value = (listEnhancement as any).sorting?.appendStrategy === 'auto-resort' ? 'auto-resort' : 'prompt';
  if (host.listSortingAutoResortPosition) host.listSortingAutoResortPosition.value = (listEnhancement as any).sorting?.autoResortPosition === 'top' ? 'top' : 'preserve';

  const preferred = (listEnhancement as any).preferredPreviewSource || 'auto';
  if (host.previewSourceAuto) host.previewSourceAuto.checked = preferred === 'auto';
  if (host.previewSourceJavDB) host.previewSourceJavDB.checked = preferred === 'javdb';
  if (host.previewSourceJavSpyl) host.previewSourceJavSpyl.checked = preferred === 'javspyl';
  if (host.previewSourceAVPreview) host.previewSourceAVPreview.checked = preferred === 'avpreview';
  if (host.previewSourceVBGFL) host.previewSourceVBGFL.checked = preferred === 'vbgfl';

  const actorEnhancement = settings.actorEnhancement || { enabled: true, autoApplyTags: true, defaultTags: getDefaultTags(), defaultSortType: 0 };
  if (host.enableAutoApplyTags) host.enableAutoApplyTags.checked = (actorEnhancement as any).autoApplyTags !== false;
  if (host.aeEnableActionButtons) host.aeEnableActionButtons.checked = (actorEnhancement as any).enableActionButtons !== false;
  if (host.aeEnableTimeSegmentationDivider) host.aeEnableTimeSegmentationDivider.checked = (actorEnhancement as any).enableTimeSegmentationDivider === true;
  if (host.aeTimeSegmentationMonths) host.aeTimeSegmentationMonths.value = String((actorEnhancement as any).timeSegmentationMonths ?? 6);
  const savedDefaultTags: string[] = Array.isArray((actorEnhancement as any).defaultTags) ? (actorEnhancement as any).defaultTags : getDefaultTags();
  if (host.actorDefaultTagInputs && host.actorDefaultTagInputs.length > 0) {
    (host.actorDefaultTagInputs as NodeListOf<HTMLInputElement>).forEach((input: HTMLInputElement) => {
      input.checked = savedDefaultTags.includes(input.value);
    });
  }

  const ve = settings?.videoEnhancement || {};
  const schedulingMode = (ve as any).schedulingMode === 'immediate' ? 'immediate' : 'smart';
  const schedulingModeInput = document.querySelector<HTMLInputElement>(
    `input[name="videoEnhancementSchedulingMode"][value="${schedulingMode}"]`,
  );
  if (schedulingModeInput) schedulingModeInput.checked = true;
  if (host.enableVideoEnhancement) host.enableVideoEnhancement.checked = !!(ve as any).enabled;
  if (host.veEnableCoverImage) host.veEnableCoverImage.checked = (ve as any).enableCoverImage !== false;
  if (host.veShowLoadingIndicator) host.veShowLoadingIndicator.checked = (ve as any).showLoadingIndicator !== false;
  if (host.veEnableReviewEnhancement) host.veEnableReviewEnhancement.checked = (ve as any).enableReviewEnhancement === true;
  if (host.veEnableReviewBreaker) host.veEnableReviewBreaker.checked = (ve as any).enableReviewBreaker === true;
  if (host.veEnableFC2Breaker) host.veEnableFC2Breaker.checked = (ve as any).enableFC2Breaker === true;
  if (host.veEnableReviewMagnetLinkify) host.veEnableReviewMagnetLinkify.checked = (ve as any).enableReviewMagnetLinkify !== false;
  if (host.veEnableReviewPush115) host.veEnableReviewPush115.checked = (ve as any).enableReviewPush115 !== false;
  if (host.veEnableWantSync) host.veEnableWantSync.checked = (ve as any).enableWantSync !== false;
  if (host.veAutoMarkWatchedAfter115) host.veAutoMarkWatchedAfter115.checked = (ve as any).autoMarkWatchedAfter115 !== false;
  if (host.veAutoMarkWatchedStars) host.veAutoMarkWatchedStars.value = String((ve as any).autoMarkWatchedStars ?? 4);
  if (host.veEnableActorRemarks) host.veEnableActorRemarks.checked = (ve as any).enableActorRemarks === true;
  if (host.veEnableActorNameMarks) host.veEnableActorNameMarks.checked = (ve as any).enableActorNameMarks !== false;
  if (host.veEnableRelatedLists) host.veEnableRelatedLists.checked = (ve as any).enableRelatedLists !== false;
  if (host.veEnableLocalListInSourceModal) host.veEnableLocalListInSourceModal.checked = (ve as any).enableLocalListInSourceModal !== false;
  if (host.veEnableExternalEntryPanel) host.veEnableExternalEntryPanel.checked = (ve as any).enableExternalEntryPanel !== false;
  if (host.veEnableExternalSearch) host.veEnableExternalSearch.checked = (ve as any).enableExternalSearch !== false;
  if (host.veEnableOnlineAvailability) host.veEnableOnlineAvailability.checked = (ve as any).enableOnlineAvailability !== false;
  if (host.veShowOnlineAvailabilityFailures) host.veShowOnlineAvailabilityFailures.checked = (ve as any).showOnlineAvailabilityFailures === true;
  applyOnlineAvailabilitySiteStates(host.onlineAvailabilitySiteInputs, (ve as any).onlineAvailabilitySites);
  if (host.veEnableSubtitleSearch) host.veEnableSubtitleSearch.checked = (ve as any).enableSubtitleSearch !== false;
  if (host.translateCurrentTitleChk) host.translateCurrentTitleChk.checked = settings?.translation?.targets ? settings.translation.targets.currentTitle !== false : true;
  if (host.veActorRemarksMode) host.veActorRemarksMode.value = ((ve as any).actorRemarksMode === 'inline') ? 'inline' : 'panel';
  if (host.veActorRemarksTTL) host.veActorRemarksTTL.value = String((ve as any).actorRemarksTTLDays ?? 0);
  if (host.veActorRemarksTaskTimeout) host.veActorRemarksTaskTimeout.value = String((ve as any).actorRemarksTaskTimeoutSeconds ?? 10);
  if (host.veEnableVideoFavoriteRating) host.veEnableVideoFavoriteRating.checked = (ve as any).enableVideoFavoriteRating !== false;
  if (host.enableActorQuickActions) host.enableActorQuickActions.checked = (ve as any).enableActorQuickActions !== false;

  if (host.previewVolume && typeof listEnhancement.previewVolume === 'number') host.previewVolume.value = String(listEnhancement.previewVolume);
  if (host.previewVolumeValue && typeof listEnhancement.previewVolume === 'number') host.previewVolumeValue.textContent = `${Math.round(listEnhancement.previewVolume * 100)}%`;
  if (host.enableClickEnhancement && typeof listEnhancement.enableClickEnhancement === 'boolean') host.enableClickEnhancement.checked = listEnhancement.enableClickEnhancement;
  if (host.enableClickEnhancementList && typeof (listEnhancement as any).enableClickEnhancementList === 'boolean') host.enableClickEnhancementList.checked = (listEnhancement as any).enableClickEnhancementList;
  if (host.enableClickEnhancementDetail && typeof (listEnhancement as any).enableClickEnhancementDetail === 'boolean') host.enableClickEnhancementDetail.checked = (listEnhancement as any).enableClickEnhancementDetail;
  if (host.enableListVideoPreview && typeof listEnhancement.enableVideoPreview === 'boolean') host.enableListVideoPreview.checked = listEnhancement.enableVideoPreview;
  if (host.enableVideoPreviewList && typeof (listEnhancement as any).enableVideoPreviewList === 'boolean') host.enableVideoPreviewList.checked = (listEnhancement as any).enableVideoPreviewList;
  if (host.enableVideoPreviewDetail && typeof (listEnhancement as any).enableVideoPreviewDetail === 'boolean') host.enableVideoPreviewDetail.checked = (listEnhancement as any).enableVideoPreviewDetail;
  if (host.enableScrollPaging && typeof listEnhancement.enableScrollPaging === 'boolean') host.enableScrollPaging.checked = listEnhancement.enableScrollPaging;
  if (host.enableActorWatermark && typeof (listEnhancement as any).enableActorWatermark === 'boolean') host.enableActorWatermark.checked = (listEnhancement as any).enableActorWatermark;
  if (host.actorWatermarkPosition && (listEnhancement as any).actorWatermarkPosition) host.actorWatermarkPosition.value = (listEnhancement as any).actorWatermarkPosition;
  if (host.actorWatermarkOpacity && typeof (listEnhancement as any).actorWatermarkOpacity === 'number') host.actorWatermarkOpacity.value = String((listEnhancement as any).actorWatermarkOpacity);
  if (host.listColumnCount && typeof (listEnhancement as any).listDisplayControl?.columnCount === 'number') host.listColumnCount.value = String((listEnhancement as any).listDisplayControl.columnCount);
  if (host.listContainerWidth && typeof (listEnhancement as any).listDisplayControl?.containerWidth === 'number') host.listContainerWidth.value = String((listEnhancement as any).listDisplayControl.containerWidth);
  if (host.enableContainerExpansion && typeof (listEnhancement as any).listDisplayControl?.enableContainerExpansion === 'boolean') host.enableContainerExpansion.checked = (listEnhancement as any).listDisplayControl.enableContainerExpansion;
  if (host.showStatusBadge && typeof (listEnhancement as any).showStatusBadge === 'boolean') host.showStatusBadge.checked = (listEnhancement as any).showStatusBadge;
  if (host.enableStatusQuickAction && typeof (listEnhancement as any).enableStatusQuickAction === 'boolean') host.enableStatusQuickAction.checked = (listEnhancement as any).enableStatusQuickAction;
  if (host.enableListFavoriteQuickAction && typeof (listEnhancement as any).enableListFavoriteQuickAction === 'boolean') host.enableListFavoriteQuickAction.checked = (listEnhancement as any).enableListFavoriteQuickAction;
  if (host.enablePopularityEffects && typeof (listEnhancement as any).popularityEffects?.enabled === 'boolean') host.enablePopularityEffects.checked = (listEnhancement as any).popularityEffects.enabled;
  if (host.popularityMinRating && typeof (listEnhancement as any).popularityEffects?.minRating === 'number') host.popularityMinRating.value = String((listEnhancement as any).popularityEffects.minRating);
  if (host.popularityMinRatingCount && typeof (listEnhancement as any).popularityEffects?.minRatingCount === 'number') host.popularityMinRatingCount.value = String((listEnhancement as any).popularityEffects.minRatingCount);
  if (host.enableListSorting && typeof (listEnhancement as any).sorting?.enabled === 'boolean') host.enableListSorting.checked = (listEnhancement as any).sorting.enabled;
  if (host.listSortingAppendStrategy && typeof (listEnhancement as any).sorting?.appendStrategy === 'string') host.listSortingAppendStrategy.value = (listEnhancement as any).sorting.appendStrategy === 'auto-resort' ? 'auto-resort' : 'prompt';
  if (host.listSortingAutoResortPosition && typeof (listEnhancement as any).sorting?.autoResortPosition === 'string') host.listSortingAutoResortPosition.value = (listEnhancement as any).sorting.autoResortPosition === 'top' ? 'top' : 'preserve';

  const contentFilter = settings?.contentFilter || {};
  host.currentFilterRules = contentFilter?.keywordRules || [];
  host.renderFilterRules();

  host.mountTranslationConfigIntoVideoBlock();
  host.toggleConfigSections();
  host.injectMagnetConcurrencyControls();
  host.initEnhancementToggles();
  host.updateAllToggleStates();
  host.bindSubtabLinks();
  host.bindOrchestratorControls();
  try {
    const last = localStorage.getItem('enhancementSubtab') as 'list' | 'video' | 'actor' | 'other' | null;
    host.switchSubtab(last || 'list');
  } catch {
    host.switchSubtab('list');
  }
}
