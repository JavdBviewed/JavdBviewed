/**
 * @file enhancementSettingsModel.test.ts
 * @description 功能增强设置模型单测
 * @module apps/dashboard/pages/settings/enhancement
 */
import { describe, expect, it } from 'vitest';
import {
  applyEnhancementFormToSettings,
  AUTO_MARK_STARS_OPTIONS,
  createSimpleFilterRule,
  DEFAULT_ENHANCEMENT_SETTINGS_FORM,
  mapSettingsToEnhancementForm,
  removeFilterRuleAt,
  setFilterRuleEnabled,
  toggleActorDefaultTag,
  toggleOnlineAvailabilitySite,
  validateEnhancementForm,
} from './enhancementSettingsModel';

describe('enhancementSettingsModel', () => {
  it('defaults cover list/video/actor/other keys from HTML', () => {
    const d = DEFAULT_ENHANCEMENT_SETTINGS_FORM;
    expect(d.enableClickEnhancement).toBe(true);
    expect(d.enableVideoPreview).toBe(true);
    expect(d.previewDelay).toBe(1000);
    expect(d.previewVolume).toBe(0.2);
    expect(d.preferredPreviewSource).toBe('auto');
    expect(d.listColumnCount).toBe(4);
    expect(d.showStatusBadge).toBe(true);
    expect(d.enableLibraryMatchStatus).toBe(false);
    expect(d.enableTranslation).toBe(false);
    expect(d.enableVideoEnhancement).toBe(false);
    expect(d.veEnableWantSync).toBe(true);
    expect(d.veEnableExternalEntryPanel).toBe(true);
    expect(d.enableMagnetSearch).toBe(false);
    expect(d.magnetSourceSukebei).toBe(true);
    expect(d.enableActorEnhancement).toBe(true);
    expect(d.aeEnableActionButtons).toBe(true);
    expect(d.enableSuperRanking).toBe(true);
    expect(d.enablePasswordHelper).toBe(false);
    expect(Object.keys(d.onlineAvailabilitySites).length).toBeGreaterThan(0);
  });

  it('keeps all legacy auto-mark star choices, including no rating', () => {
    expect(AUTO_MARK_STARS_OPTIONS.map((option) => option.value)).toEqual(['0', '1', '2', '3', '4', '5']);
    expect(mapSettingsToEnhancementForm({ videoEnhancement: { autoMarkWatchedStars: 0 } } as any).veAutoMarkWatchedStars).toBe(0);
  });

  it('maps empty settings to defaults', () => {
    const form = mapSettingsToEnhancementForm(undefined);
    expect(form.enableClickEnhancement).toBe(true);
    expect(form.enableVideoPreview).toBe(true);
    expect(form.enableContentFilter).toBe(false);
    expect(form.filterRules).toEqual([]);
    expect(form.enableSuperRanking).toBe(true);
    expect(form.magnetSortMode).toBe('default');
    expect(form.translationProvider).toBe('traditional');
  });

  it('defaults the optional site appearance package to disabled with all visual sections ready', () => {
    const form = mapSettingsToEnhancementForm(undefined);

    expect(form.enableSiteAppearance).toBe(false);
    expect(form.siteAppearanceListCards).toBe(true);
    expect(form.siteAppearanceDetailAndRelated).toBe(true);
    expect(form.siteAppearanceMagnetList).toBe(true);
    expect(form.siteAppearancePreviewImages).toBe(true);
    expect(form.siteAppearanceAutoExpandReplaceTip).toBe(false);
  });

  it('round-trips site appearance sections independently from its master switch', () => {
    const form = {
      ...DEFAULT_ENHANCEMENT_SETTINGS_FORM,
      enableSiteAppearance: false,
      siteAppearanceListCards: false,
      siteAppearanceDetailAndRelated: true,
      siteAppearanceMagnetList: false,
      siteAppearancePreviewImages: true,
      siteAppearanceAutoExpandReplaceTip: true,
    };

    const next = applyEnhancementFormToSettings({} as any, form);
    expect(next.siteAppearance).toEqual({
      enabled: false,
      listCards: false,
      detailAndRelated: true,
      magnetList: false,
      previewImages: true,
      autoExpandReplaceTip: true,
    });
    expect(mapSettingsToEnhancementForm(next)).toMatchObject({
      enableSiteAppearance: false,
      siteAppearanceListCards: false,
      siteAppearanceAutoExpandReplaceTip: true,
    });
  });

  it('maps nested listEnhancement / videoEnhancement / magnetSearch', () => {
    const form = mapSettingsToEnhancementForm({
      userExperience: {
        enableContentFilter: true,
        enableMagnetSearch: true,
        enableSuperRanking: false,
        enablePasswordHelper: true,
      },
      listEnhancement: {
        enableClickEnhancement: false,
        enableVideoPreview: false,
        enableScrollPaging: true,
        previewDelay: 500,
        previewVolume: 0.5,
        preferredPreviewSource: 'javdb',
        enableActorWatermark: true,
        actorWatermarkPosition: 'bottom-left',
        actorWatermarkOpacity: 0.4,
        listDisplayControl: {
          columnCount: 6,
          containerWidth: 120,
          enableContainerExpansion: true,
        },
        showStatusBadge: false,
        enableStatusQuickAction: true,
        enableListFavoriteQuickAction: true,
        popularityEffects: { enabled: true, minRating: 4.5, minRatingCount: 100 },
        sorting: {
          enabled: true,
          appendStrategy: 'auto-resort',
          autoResortPosition: 'top',
        },
      },
      videoEnhancement: {
        enabled: true,
        enableWantSync: false,
        enableExternalEntryPanel: false,
        enableOnlineAvailability: false,
        showOnlineAvailabilityFailures: true,
        onlineAvailabilitySites: { fanza: false },
        enableReviewEnhancement: true,
        enableFC2Breaker: true,
        enableActorRemarks: true,
        actorRemarksMode: 'inline',
        actorRemarksTTLDays: 7,
        autoMarkWatchedStars: 5,
        enableVideoFavoriteRating: true,
      },
      dataEnhancement: { enableTranslation: true },
      translation: {
        provider: 'ai',
        displayMode: 'replace',
        targets: { currentTitle: false },
        traditional: { apiKey: 'k' },
      },
      magnetSearch: {
        sources: {
          sukebei: false,
          btdig: true,
          btsow: false,
          torrentz2: true,
          javbus: true,
        },
        blockMojContent: false,
        autoSearch: true,
        sortMode: 'quality',
        concurrency: {
          pageMaxConcurrentRequests: 3,
          bgGlobalMaxConcurrent: 6,
        },
      },
      actorEnhancement: {
        enabled: false,
        autoApplyTags: false,
        defaultTags: ['s', 'c'],
        enableActionButtons: false,
        enableTimeSegmentationDivider: true,
        timeSegmentationMonths: 12,
      },
      passwordHelper: { showMethod: 2, waitTime: 500 },
      anchorOptimization: {
        enabled: true,
        buttonPosition: 'right-bottom',
        showPreviewButton: false,
      },
      contentFilter: {
        enabled: true,
        keywordRules: [
          {
            id: 'r1',
            name: '测试',
            keyword: 'foo',
            isRegex: false,
            caseSensitive: false,
            action: 'hide',
            enabled: true,
            fields: ['title'],
          },
        ],
      },
    } as any);

    expect(form.enableContentFilter).toBe(true);
    expect(form.enableClickEnhancement).toBe(false);
    expect(form.enableVideoPreview).toBe(false);
    expect(form.enableScrollPaging).toBe(true);
    expect(form.enableLibraryMatchStatus).toBe(false);
    expect(form.previewDelay).toBe(500);
    expect(form.previewVolume).toBe(0.5);
    expect(form.preferredPreviewSource).toBe('javdb');
    expect(form.enableActorWatermark).toBe(true);
    expect(form.actorWatermarkPosition).toBe('bottom-left');
    expect(form.listColumnCount).toBe(6);
    expect(form.enableContainerExpansion).toBe(true);
    expect(form.showStatusBadge).toBe(false);
    expect(form.enableListSorting).toBe(true);
    expect(form.listSortingAppendStrategy).toBe('auto-resort');
    expect(form.listSortingAutoResortPosition).toBe('top');
    expect(form.enablePopularityEffects).toBe(true);
    expect(form.popularityMinRating).toBe(4.5);
    expect(form.enableTranslation).toBe(true);
    expect(form.translationProvider).toBe('ai');
    expect(form.translationDisplayMode).toBe('replace');
    expect(form.translateCurrentTitle).toBe(false);
    expect(form.enableVideoEnhancement).toBe(true);
    expect(form.veEnableWantSync).toBe(false);
    expect(form.veEnableExternalEntryPanel).toBe(false);
    expect(form.veShowOnlineAvailabilityFailures).toBe(true);
    expect(form.onlineAvailabilitySites.fanza).toBe(false);
    expect(form.veEnableReviewEnhancement).toBe(true);
    expect(form.veEnableFC2Breaker).toBe(true);
    expect(form.veActorRemarksMode).toBe('inline');
    expect(form.veAutoMarkWatchedStars).toBe(5);
    expect(form.enableMagnetSearch).toBe(true);
    expect(form.magnetSourceSukebei).toBe(false);
    expect(form.magnetSourceTorrentz2).toBe(true);
    expect(form.magnetAutoSearch).toBe(true);
    expect(form.magnetSortMode).toBe('quality');
    expect(form.magnetPageMaxConcurrentRequests).toBe(3);
    expect(form.enableActorEnhancement).toBe(false);
    expect(form.actorDefaultTags).toEqual(['s', 'c']);
    expect(form.aeEnableTimeSegmentationDivider).toBe(true);
    expect(form.aeTimeSegmentationMonths).toBe(12);
    expect(form.enableSuperRanking).toBe(false);
    expect(form.enablePasswordHelper).toBe(true);
    expect(form.passwordShowMethod).toBe(2);
    expect(form.enableAnchorOptimization).toBe(true);
    expect(form.anchorButtonPosition).toBe('right-bottom');
    expect(form.showPreviewButton).toBe(false);
    expect(form.filterRules).toHaveLength(1);
    expect(form.filterRules[0].keyword).toBe('foo');
  });

  it('applyEnhancementFormToSettings round-trips core fields', () => {
    const form = {
      ...DEFAULT_ENHANCEMENT_SETTINGS_FORM,
      enableContentFilter: true,
      enableTranslation: true,
      enableVideoEnhancement: true,
      enableMagnetSearch: true,
      enableScrollPaging: true,
      enableLibraryMatchStatus: true,
      previewDelay: 800,
      listColumnCount: 5,
      enableListSorting: true,
      listSortingAppendStrategy: 'auto-resort' as const,
      veEnableReviewEnhancement: true,
      magnetSourceJavbus: true,
      magnetSortMode: 'seeders' as const,
      enableActorEnhancement: true,
      actorDefaultTags: ['s', 'd'],
      enablePasswordHelper: true,
      passwordShowMethod: 1,
      passwordWaitTime: 400,
      filterRules: [createSimpleFilterRule('test', '规则A')],
    };
    const next = applyEnhancementFormToSettings({} as any, form);
    expect(next.userExperience.enableContentFilter).toBe(true);
    expect(next.userExperience.enableMagnetSearch).toBe(true);
    expect(next.dataEnhancement.enableTranslation).toBe(true);
    expect(next.videoEnhancement.enabled).toBe(true);
    expect(next.videoEnhancement.enableReviewEnhancement).toBe(true);
    expect(next.listEnhancement.enableScrollPaging).toBe(true);
    expect(next.libraryMatchStatus).toEqual({
      enabled: true,
      sources: { drive115: true, emby: true },
    });
    expect(next.listEnhancement.previewDelay).toBe(800);
    expect(next.listEnhancement.listDisplayControl.columnCount).toBe(5);
    expect(next.listEnhancement.sorting.enabled).toBe(true);
    expect(next.listEnhancement.sorting.appendStrategy).toBe('auto-resort');
    expect(next.magnetSearch.sources.javbus).toBe(true);
    expect(next.magnetSearch.sortMode).toBe('seeders');
    expect(next.actorEnhancement.defaultTags).toEqual(['s', 'd']);
    expect(next.passwordHelper.showMethod).toBe(1);
    expect(next.contentFilter.keywordRules).toHaveLength(1);
    expect(next.contentFilter.enabled).toBe(true);

    const remapped = mapSettingsToEnhancementForm(next);
    expect(remapped.enableContentFilter).toBe(true);
    expect(remapped.enableTranslation).toBe(true);
    expect(remapped.previewDelay).toBe(800);
    expect(remapped.listColumnCount).toBe(5);
    expect(remapped.enableLibraryMatchStatus).toBe(true);
    expect(remapped.magnetSortMode).toBe('seeders');
    expect(remapped.actorDefaultTags).toEqual(['s', 'd']);
  });

  it('round-trips enableActorPenetration (default OFF)', () => {
    // default is off
    const defaultForm = mapSettingsToEnhancementForm({} as any);
    expect(defaultForm.enableActorPenetration).toBe(false);

    // persist as off
    const off = applyEnhancementFormToSettings({} as any, { ...DEFAULT_ENHANCEMENT_SETTINGS_FORM, enableActorPenetration: false });
    expect(off.listEnhancement.enableActorPenetration).toBe(false);

    // persist as on
    const on = applyEnhancementFormToSettings({} as any, { ...DEFAULT_ENHANCEMENT_SETTINGS_FORM, enableActorPenetration: true });
    expect(on.listEnhancement.enableActorPenetration).toBe(true);

    // re-read from settings back into form
    const remapped = mapSettingsToEnhancementForm(on);
    expect(remapped.enableActorPenetration).toBe(true);
  });

  it('validates ranges', () => {
    expect(validateEnhancementForm(DEFAULT_ENHANCEMENT_SETTINGS_FORM).isValid).toBe(true);
    const bad = {
      ...DEFAULT_ENHANCEMENT_SETTINGS_FORM,
      previewDelay: 10,
      listColumnCount: 99,
    };
    const v = validateEnhancementForm(bad);
    expect(v.isValid).toBe(false);
    expect(v.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('helpers: filter rules / tags / sites', () => {
    const rule = createSimpleFilterRule('  abc  ', '  name  ');
    expect(rule.keyword).toBe('abc');
    expect(rule.name).toBe('name');
    expect(rule.enabled).toBe(true);

    let rules = [rule];
    rules = setFilterRuleEnabled(rules, 0, false);
    expect(rules[0].enabled).toBe(false);
    rules = removeFilterRuleAt(rules, 0);
    expect(rules).toHaveLength(0);

    expect(toggleActorDefaultTag(['s'], 'c', true)).toEqual(['s', 'c']);
    expect(toggleActorDefaultTag(['s', 'c'], 's', false)).toEqual(['c']);

    const sites = toggleOnlineAvailabilitySite({ fanza: true }, 'fanza', false);
    expect(sites.fanza).toBe(false);
  });
});
