export type EnhancementBindEventsHost = any;

export function bindEvents(host: EnhancementBindEventsHost): void {
  document.querySelectorAll<HTMLInputElement>('input[name="videoEnhancementSchedulingMode"]')
    .forEach((input) => input.addEventListener('change', host.handleSettingChange.bind(host)));
  host.magnetSourceSukebei?.addEventListener('change', host.handleSettingChange.bind(host));
  host.magnetSourceBtdig?.addEventListener('change', host.handleSettingChange.bind(host));
  host.magnetSourceBtsow?.addEventListener('change', host.handleSettingChange.bind(host));
  host.magnetSourceTorrentz2?.addEventListener('change', host.handleSettingChange.bind(host));
  host.magnetSourceJavbus?.addEventListener('change', host.handleSettingChange.bind(host));
  host.magnetBlockMojContent?.addEventListener('change', host.handleSettingChange.bind(host));
  host.magnetAutoSearch?.addEventListener('change', host.handleSettingChange.bind(host));
  host.magnetSortMode?.addEventListener('change', host.handleSettingChange.bind(host));
  host.magnetPageMaxConcurrentRequests?.addEventListener('change', host.handleSettingChange.bind(host));
  host.magnetBgGlobalMaxConcurrent?.addEventListener('change', host.handleSettingChange.bind(host));
  host.magnetBgPerHostMaxConcurrent?.addEventListener('change', host.handleSettingChange.bind(host));
  host.magnetBgPerHostRateLimitPerMin?.addEventListener('change', host.handleSettingChange.bind(host));
  host.anchorButtonPosition?.addEventListener('change', host.handleSettingChange.bind(host));
  host.showPreviewButton?.addEventListener('change', host.handleSettingChange.bind(host));
  host.translationProviderSel?.addEventListener('change', host.onTranslationProviderChange.bind(host));
  host.traditionalServiceSel?.addEventListener('change', host.onTraditionalServiceChange.bind(host));
  host.traditionalApiKeyInput?.addEventListener('input', host.handleSettingChange.bind(host));
  host.goAiSettingsBtn?.addEventListener('click', host.navigateToAISettings.bind(host));
  host.translateCurrentTitleChk?.addEventListener('change', host.handleSettingChange.bind(host));
  host.translationDisplayModeSel?.addEventListener('change', host.handleSettingChange.bind(host));
  host.enableClickEnhancement?.addEventListener('change', host.handleSettingChange.bind(host));
  host.enableClickEnhancementList?.addEventListener('change', host.handleSettingChange.bind(host));
  host.enableClickEnhancementDetail?.addEventListener('change', host.handleSettingChange.bind(host));
  host.enableListVideoPreview?.addEventListener('change', host.handleSettingChange.bind(host));
  host.enableVideoPreviewList?.addEventListener('change', host.handleSettingChange.bind(host));
  host.enableVideoPreviewDetail?.addEventListener('change', host.handleSettingChange.bind(host));
  host.enableScrollPaging?.addEventListener('change', host.handleSettingChange.bind(host));
  host.enableActorWatermark?.addEventListener('change', host.handleSettingChange.bind(host));
  host.showStatusBadge?.addEventListener('change', host.handleSettingChange.bind(host));
  host.enableStatusQuickAction?.addEventListener('change', host.handleSettingChange.bind(host));
  host.enableListFavoriteQuickAction?.addEventListener('change', host.handleSettingChange.bind(host));
  host.enablePopularityEffects?.addEventListener('change', host.handleSettingChange.bind(host));
  host.popularityMinRating?.addEventListener('change', host.handleSettingChange.bind(host));
  host.popularityMinRatingCount?.addEventListener('change', host.handleSettingChange.bind(host));
  host.listSortingAppendStrategy?.addEventListener('change', host.handleSettingChange.bind(host));
  host.listSortingAutoResortPosition?.addEventListener('change', host.handleSettingChange.bind(host));
  host.enableVideoEnhancement?.addEventListener('change', host.handleSettingChange.bind(host));
  host.enableSuperRanking?.addEventListener('change', host.handleSettingChange.bind(host));
  host.veEnableCoverImage?.addEventListener('change', host.handleSettingChange.bind(host));
  host.veShowLoadingIndicator?.addEventListener('change', host.handleSettingChange.bind(host));
  host.veEnableReviewEnhancement?.addEventListener('change', host.handleSettingChange.bind(host));
  host.veEnableReviewBreaker?.addEventListener('change', host.handleSettingChange.bind(host));
  host.veEnableFC2Breaker?.addEventListener('change', host.handleSettingChange.bind(host));
  host.veEnableReviewMagnetLinkify?.addEventListener('change', host.handleSettingChange.bind(host));
  host.veEnableReviewPush115?.addEventListener('change', host.handleSettingChange.bind(host));
  host.veEnableActorRemarks?.addEventListener('change', host.handleSettingChange.bind(host));
  host.veEnableActorNameMarks?.addEventListener('change', host.handleSettingChange.bind(host));
  host.veEnableRelatedLists?.addEventListener('change', host.handleSettingChange.bind(host));
  host.veEnableLocalListInSourceModal?.addEventListener('change', host.handleSettingChange.bind(host));
  host.veEnableExternalEntryPanel?.addEventListener('change', host.handleSettingChange.bind(host));
  host.veEnableExternalSearch?.addEventListener('change', host.handleSettingChange.bind(host));
  host.veEnableOnlineAvailability?.addEventListener('change', host.handleSettingChange.bind(host));
  host.veShowOnlineAvailabilityFailures?.addEventListener('change', host.handleSettingChange.bind(host));
  host.veEnableSubtitleSearch?.addEventListener('change', host.handleSettingChange.bind(host));
  host.onlineAvailabilitySiteInputs?.forEach((input: HTMLInputElement) => {
    input.addEventListener('change', host.handleSettingChange.bind(host));
  });
  host.veActorRemarksMode?.addEventListener('change', host.handleSettingChange.bind(host));
  host.veActorRemarksTTL?.addEventListener('change', host.handleSettingChange.bind(host));
  host.veActorRemarksTaskTimeout?.addEventListener('change', host.handleSettingChange.bind(host));
  host.actorWatermarkOpacity?.addEventListener('input', () => host.handleActorOpacityChange());
  host.listColumnCount?.addEventListener('input', () => host.handleColumnCountChange());
  host.listContainerWidth?.addEventListener('input', () => host.handleContainerWidthChange());
  host.enableContainerExpansion?.addEventListener('change', () => {
    host.updateContainerWidthMax();
    host.handleSettingChange();
  });
  if (host.addFilterRuleBtn) host.addFilterRuleBtn.addEventListener('click', host.addFilterRule.bind(host));
  const previewSourceRadios = [host.previewSourceAuto, host.previewSourceJavDB, host.previewSourceJavSpyl, host.previewSourceAVPreview, host.previewSourceVBGFL].filter(Boolean) as HTMLInputElement[];
  previewSourceRadios.forEach(r => r.addEventListener('change', host.handleSettingChange.bind(host)));
  host.setupVolumeControlStyles();
  host.setupAnchorConfigStyles();
  host.setupCheckboxGroupStyles();
  host.bindSubtabLinks();
  host.bindOrchestratorControls();
  host.orchFilterStatusSel?.addEventListener('change', () => host.renderOrchestratorTimeline(host.orchestratorTimelineData));
  host.orchFilterPhaseSel?.addEventListener('change', () => host.renderOrchestratorTimeline(host.orchestratorTimelineData));
  host.orchFilterSearchInput?.addEventListener('input', () => host.renderOrchestratorTimeline(host.orchestratorTimelineData));
  host.orchGlobalScopeSel?.addEventListener('change', () => { void host.refreshOrchestratorState(); });
  host.orchGlobalGroupingSel?.addEventListener('change', () => { void host.refreshOrchestratorState(); });
  host.orchViewModeSel?.addEventListener('change', () => { host.unsubscribeOrchestratorEvents(); host.startOrchestratorAutoRefresh(); void host.refreshOrchestratorState(); });
  if (host.showTaskDetailsBtn && host.showTaskDetailsBtn.dataset.taskDetailsBound !== '1') {
    host.showTaskDetailsBtn.dataset.taskDetailsBound = '1';
    host.showTaskDetailsBtn.addEventListener('click', () => host.openTaskDetailsModal());
  }
  if (host.taskDetailsModalClose && host.taskDetailsModalClose.dataset.taskDetailsBound !== '1') {
    host.taskDetailsModalClose.dataset.taskDetailsBound = '1';
    host.taskDetailsModalClose.addEventListener('click', () => host.closeTaskDetailsModal());
  }
  if (host.taskDetailsCloseBtn && host.taskDetailsCloseBtn.dataset.taskDetailsBound !== '1') {
    host.taskDetailsCloseBtn.dataset.taskDetailsBound = '1';
    host.taskDetailsCloseBtn.addEventListener('click', () => host.closeTaskDetailsModal());
  }
  if (host.taskDetailsRefreshBtn && host.taskDetailsRefreshBtn.dataset.taskDetailsBound !== '1') {
    host.taskDetailsRefreshBtn.dataset.taskDetailsBound = '1';
    host.taskDetailsRefreshBtn.addEventListener('click', () => host.refreshTaskDetails());
  }
  if (host.taskDetailsStopAllBtn && host.taskDetailsStopAllBtn.dataset.taskDetailsBound !== '1') {
    host.taskDetailsStopAllBtn.dataset.taskDetailsBound = '1';
    host.taskDetailsStopAllBtn.addEventListener('click', () => host.stopAllTaskDetails());
  }
  if (host.taskDetailsClearBtn && host.taskDetailsClearBtn.dataset.taskDetailsBound !== '1') {
    host.taskDetailsClearBtn.dataset.taskDetailsBound = '1';
    host.taskDetailsClearBtn.addEventListener('click', () => host.clearTaskDetails());
  }
  if (host.taskDetailsCopyCurrentPageBtn && host.taskDetailsCopyCurrentPageBtn.dataset.taskDetailsBound !== '1') {
    host.taskDetailsCopyCurrentPageBtn.dataset.taskDetailsBound = '1';
    host.taskDetailsCopyCurrentPageBtn.addEventListener('click', () => host.copyCurrentPageTaskDiagnostics());
  }
  if (host.taskDetailsCopyDiagnosticsBtn && host.taskDetailsCopyDiagnosticsBtn.dataset.taskDetailsBound !== '1') {
    host.taskDetailsCopyDiagnosticsBtn.dataset.taskDetailsBound = '1';
    host.taskDetailsCopyDiagnosticsBtn.addEventListener('click', () => host.copyOrchestrationDiagnosticsBundle());
  }
  if (host.taskDetailsPrevPage && host.taskDetailsPrevPage.dataset.taskDetailsBound !== '1') {
    host.taskDetailsPrevPage.dataset.taskDetailsBound = '1';
    host.taskDetailsPrevPage.addEventListener('click', () => host.taskDetailsPrevPageHandler());
  }
  if (host.taskDetailsNextPage && host.taskDetailsNextPage.dataset.taskDetailsBound !== '1') {
    host.taskDetailsNextPage.dataset.taskDetailsBound = '1';
    host.taskDetailsNextPage.addEventListener('click', () => host.taskDetailsNextPageHandler());
  }
  if (host.taskDetailsTableBody && host.taskDetailsTableBody.dataset.expandBound !== '1') {
    host.taskDetailsTableBody.dataset.expandBound = '1';
    host.taskDetailsTableBody.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;
      if (!target) return;
      const togglePageSummary = target.closest('[data-page-summary-toggle]') as HTMLElement | null;
      if (togglePageSummary) {
        e.preventDefault();
        e.stopPropagation();
        const pageKey = togglePageSummary.getAttribute('data-page-summary-toggle') || '';
        if (!pageKey) return;
        if (host.taskDetailsExpandedPageSummaries.has(pageKey)) host.taskDetailsExpandedPageSummaries.delete(pageKey);
        else host.taskDetailsExpandedPageSummaries.add(pageKey);
        host.renderTaskDetailsTable();
        return;
      }
      const toggleParent = target.closest('[data-task-parent-toggle]') as HTMLElement | null;
      if (toggleParent) {
        e.preventDefault();
        e.stopPropagation();
        const parentKey = toggleParent.getAttribute('data-task-parent-toggle') || '';
        if (!parentKey) return;
        if (host.taskDetailsExpandedParents.has(parentKey)) host.taskDetailsExpandedParents.delete(parentKey);
        else host.taskDetailsExpandedParents.add(parentKey);
        host.renderTaskDetailsTable();
      }
    });
  }
  if (host.taskDetailsViewTasks && host.taskDetailsViewTasks.dataset.taskDetailsBound !== '1') {
    const switchView = (view: 'tasks' | 'pages') => {
      host.taskDetailsView = view;
      host.taskDetailsCurrentPage = 1;
      host.taskDetailsExpandedParents.clear();
      host.taskDetailsExpandedPageSummaries.clear();
      const isPages = view === 'pages';
      if (host.taskDetailsViewTasks) {
        host.taskDetailsViewTasks.classList.toggle('td-view-btn--active', !isPages);
      }
      if (host.taskDetailsViewPages) {
        host.taskDetailsViewPages.classList.toggle('td-view-btn--active', isPages);
      }
      if (host.taskDetailsSearchQuery) host.taskDetailsSearchHandler();
      else {
        host.renderTaskDetailsTable();
        const total = host.getRenderedTaskDetailsCount();
        const totalPages = Math.max(1, Math.ceil(total / host.taskDetailsPageSize));
        host.updateTaskDetailsPagination(total, totalPages);
      }
    };
    host.taskDetailsViewTasks.dataset.taskDetailsBound = '1';
    host.taskDetailsViewTasks.addEventListener('click', () => switchView('tasks'));
    if (host.taskDetailsViewPages) {
      host.taskDetailsViewPages.dataset.taskDetailsBound = '1';
      host.taskDetailsViewPages.addEventListener('click', () => switchView('pages'));
    }
  }
  if (host.taskDetailsSearch && host.taskDetailsSearch.dataset.taskDetailsBound !== '1') {
    host.taskDetailsSearch.dataset.taskDetailsBound = '1';
    host.taskDetailsSearch.addEventListener('input', () => host.taskDetailsSearchHandler());
  }
  if (host.taskDetailsTable && host.taskDetailsTable.dataset.sortBound !== '1') {
    host.taskDetailsTable.dataset.sortBound = '1';
    const headers = host.taskDetailsTable.querySelectorAll('thead th[data-sort]');
    headers.forEach((header: Element) => {
      (header as HTMLElement).style.cursor = 'pointer';
      header.addEventListener('click', () => {
        const sortField = header.getAttribute('data-sort');
        if (sortField) host.taskDetailsSortHandler(sortField);
      });
    });
  }
  host.initializeActorEnhancementEvents();
  host.setupSubSettingsHoverBehavior();
}
