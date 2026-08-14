export type EnhancementBindHost = any;

export function bindSubtabLinks(host: EnhancementBindHost): void {
  const links = document.querySelectorAll('#enhancement-settings .subtab-link');
  links.forEach((link) => {
    if ((link as HTMLElement).dataset.bound === '1') return;
    (link as HTMLElement).dataset.bound = '1';
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const sub = (link as HTMLElement).dataset.subtab as 'list' | 'video' | 'actor' | 'other';
      host.switchSubtab(sub);
    });
  });
}

export function bindOrchestratorControls(host: EnhancementBindHost): void {

  if (host.showOrchestratorBtn && host.showOrchestratorBtn.dataset.orchestratorBound !== '1') {
    host.showOrchestratorBtn.dataset.orchestratorBound = '1';
    host.showOrchestratorBtn.addEventListener('click', () => host.openOrchestratorModal());
  }

  if (host.orchestratorModalClose && host.orchestratorModalClose.dataset.orchestratorBound !== '1') {
    host.orchestratorModalClose.dataset.orchestratorBound = '1';
    host.orchestratorModalClose.addEventListener('click', () => host.closeOrchestratorModal());
  }

  if (host.orchestratorCloseBtn && host.orchestratorCloseBtn.dataset.orchestratorBound !== '1') {
    host.orchestratorCloseBtn.dataset.orchestratorBound = '1';
    host.orchestratorCloseBtn.addEventListener('click', () => host.closeOrchestratorModal());
  }

  if (host.orchestratorRefreshBtn && host.orchestratorRefreshBtn.dataset.orchestratorBound !== '1') {
    host.orchestratorRefreshBtn.dataset.orchestratorBound = '1';
    host.orchestratorRefreshBtn.addEventListener('click', () => host.refreshOrchestratorState());
  }

  if (host.orchestratorStopAllBtn && host.orchestratorStopAllBtn.dataset.orchestratorBound !== '1') {
    host.orchestratorStopAllBtn.dataset.orchestratorBound = '1';
    host.orchestratorStopAllBtn.addEventListener('click', () => host.stopAllTaskDetails());
  }

  if (host.orchestratorClearGlobalBtn && host.orchestratorClearGlobalBtn.dataset.orchestratorBound !== '1') {
    host.orchestratorClearGlobalBtn.dataset.orchestratorBound = '1';
    host.orchestratorClearGlobalBtn.addEventListener('click', () => host.clearGlobalTaskState());
  }

  if (host.orchestratorCopyPhasesBtn && host.orchestratorCopyPhasesBtn.dataset.orchestratorBound !== '1') {
    host.orchestratorCopyPhasesBtn.dataset.orchestratorBound = '1';
    host.orchestratorCopyPhasesBtn.addEventListener('click', () => host.copyPhasesText());
  }

  if (host.orchestratorCopyTimelineBtn && host.orchestratorCopyTimelineBtn.dataset.orchestratorBound !== '1') {
    host.orchestratorCopyTimelineBtn.dataset.orchestratorBound = '1';
    host.orchestratorCopyTimelineBtn.addEventListener('click', () => host.copyTimelineText());
  }

  if (host.orchestratorFullscreenBtn && host.orchestratorFullscreenBtn.dataset.orchestratorBound !== '1') {
    host.orchestratorFullscreenBtn.dataset.orchestratorBound = '1';
    host.orchestratorFullscreenBtn.addEventListener('click', () => {
      const content = document.getElementById('orchestratorModalContent');
      if (!content) return;
      const isFs = content.classList.toggle('fullscreen');
      host.orchestratorFullscreenBtn!.textContent = isFs ? '退出全屏' : '全屏';
      host.orchestratorTimeline?.scrollTo({ top: host.orchestratorTimeline.scrollHeight });
    });
  }
}

export function mountTranslationConfigIntoVideoBlock(host: EnhancementBindHost): void {
  try {
    const videoTranslationBlock = document.getElementById('videoTranslationBlock');
    if (!videoTranslationBlock || !host.translationConfig) return;
    if (!videoTranslationBlock.contains(host.translationConfig)) {
      videoTranslationBlock.appendChild(host.translationConfig);
    }
    if (!host.translationConfig.classList.contains('sub-settings')) {
      host.translationConfig.classList.add('sub-settings');
    }
    host.updateTranslationConfigVisibility();
  } catch {}
}
