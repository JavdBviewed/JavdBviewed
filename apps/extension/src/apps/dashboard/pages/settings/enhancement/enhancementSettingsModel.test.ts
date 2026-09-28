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
    expect(d.enableVideoEnhancement).toBe(true);
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

  it('round-trips site ad removal switches, defaulting on for legacy data without the key', () => {
    // 存量数据无 siteAdRemoval 键 → 默认开（产品意图去广告）
    expect(mapSettingsToEnhancementForm({ magnetSearch: { blockMojContent: true } } as any)).toMatchObject({
      siteAdRemovalEnabled: true,
      siteAdRemovalRemovePromoButtons: true,
      siteAdRemovalRemoveExtraAds: false,
    });

    const form = {
      ...DEFAULT_ENHANCEMENT_SETTINGS_FORM,
      siteAdRemovalEnabled: false,
      siteAdRemovalRemovePromoButtons: true,
      siteAdRemovalRemoveExtraAds: true,
    };
    const next = applyEnhancementFormToSettings({} as any, form);
    expect(next.siteAdRemoval).toEqual({
      enabled: false,
      removePromoButtons: true,
      removeExtraAds: true,
    });
    expect(mapSettingsToEnhancementForm(next)).toMatchObject({
      siteAdRemovalEnabled: false,
      siteAdRemovalRemovePromoButtons: true,
      siteAdRemovalRemoveExtraAds: true,
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
        resourceTags: true,
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
        // P2：旧数组混排（t 码 + 裸类别 id）→ 迁移验证向量
        defaultTags: ['s', 'c', '17'],
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
    expect(form.resourceTags).toBe(true);
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
    // 去广告已与磁力解耦：旧 magnetSearch.blockMojContent 不得影响新开关
    expect(form.siteAdRemovalEnabled).toBe(true);
    expect(form.siteAdRemovalRemovePromoButtons).toBe(true);
    expect(form.siteAdRemovalRemoveExtraAds).toBe(false);
    expect(form.magnetPageMaxConcurrentRequests).toBe(3);
    expect(form.enableActorEnhancement).toBe(false);
    // P2：旧混排数组拆分迁移（'17' → c4=17）
    expect(form.actorDefaultT).toEqual(['s', 'c']);
    expect(form.actorDefaultCategories).toEqual(['c4=17']);
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
      actorDefaultT: ['s', 'd'],
      actorDefaultCategories: ['c4=17'],
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
    expect(next.actorEnhancement.defaultTags).toEqual({ t: ['s', 'd'], categories: ['c4=17'] });
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
    expect(remapped.actorDefaultT).toEqual(['s', 'd']);
    expect(remapped.actorDefaultCategories).toEqual(['c4=17']);
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

  it('round-trips resourceTags (default OFF)', () => {
    const defaultForm = mapSettingsToEnhancementForm({} as any);
    expect(defaultForm.resourceTags).toBe(false);
    expect(DEFAULT_ENHANCEMENT_SETTINGS_FORM.resourceTags).toBe(false);

    const on = applyEnhancementFormToSettings({} as any, { ...DEFAULT_ENHANCEMENT_SETTINGS_FORM, resourceTags: true });
    expect(on.listEnhancement.resourceTags).toBe(true);

    const off = applyEnhancementFormToSettings({} as any, { ...DEFAULT_ENHANCEMENT_SETTINGS_FORM, resourceTags: false });
    expect(off.listEnhancement.resourceTags).toBe(false);

    expect(mapSettingsToEnhancementForm(on).resourceTags).toBe(true);
    expect(mapSettingsToEnhancementForm(off).resourceTags).toBe(false);
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

describe('list filter fields (migrated from display settings)', () => {
  it('defaults the 7 list filter toggles to false', () => {
    const d = DEFAULT_ENHANCEMENT_SETTINGS_FORM;
    expect(d.hideViewed).toBe(false);
    expect(d.hideBrowsed).toBe(false);
    expect(d.hideVR).toBe(false);
    expect(d.hideWant).toBe(false);
    expect(d.hideBlacklistedActorsInList).toBe(false);
    expect(d.hideNonFavoritedActorsInList).toBe(false);
    expect(d.hideUnrecognizedActorsInList).toBe(false);
  });

  it('maps empty settings to list filter defaults (zero backfill)', () => {
    const form = mapSettingsToEnhancementForm(undefined);
    expect(form.hideViewed).toBe(false);
    expect(form.hideBrowsed).toBe(false);
    expect(form.hideVR).toBe(false);
    expect(form.hideWant).toBe(false);
    expect(form.hideBlacklistedActorsInList).toBe(false);
    expect(form.hideNonFavoritedActorsInList).toBe(false);
    expect(form.hideUnrecognizedActorsInList).toBe(false);
  });

  it('reads display.* and listEnhancement.* filter keys without changing namespaces', () => {
    const form = mapSettingsToEnhancementForm({
      display: { hideViewed: true, hideVR: true },
      listEnhancement: {
        hideBlacklistedActorsInList: true,
        hideUnrecognizedActorsInList: true,
      },
    } as any);
    expect(form.hideViewed).toBe(true);
    expect(form.hideBrowsed).toBe(false);
    expect(form.hideVR).toBe(true);
    expect(form.hideWant).toBe(false);
    expect(form.hideBlacklistedActorsInList).toBe(true);
    expect(form.hideNonFavoritedActorsInList).toBe(false);
    expect(form.hideUnrecognizedActorsInList).toBe(true);
  });

  it('writes display.* and listEnhancement.* namespaces and preserves unknown keys', () => {
    const current = {
      display: { hideVR: true, customLegacy: 'keep' },
      listEnhancement: { enableActorPenetration: true, another: 42 },
    } as any;
    const form = {
      ...DEFAULT_ENHANCEMENT_SETTINGS_FORM,
      hideViewed: true,
      hideBrowsed: true,
      hideWant: true,
      enableActorPenetration: true,
      hideNonFavoritedActorsInList: true,
      hideUnrecognizedActorsInList: true,
    };
    const next = applyEnhancementFormToSettings(current, form);
    expect(next.display.hideViewed).toBe(true);
    expect(next.display.hideBrowsed).toBe(true);
    // form 为权威写入：current.display.hideVR=true 被 form 默认 false 覆盖
    expect(next.display.hideVR).toBe(false);
    expect(next.display.hideWant).toBe(true);
    expect(next.display.customLegacy).toBe('keep');
    expect(next.listEnhancement.enableActorPenetration).toBe(true);
    expect(next.listEnhancement.another).toBe(42);
    expect(next.listEnhancement.hideBlacklistedActorsInList).toBe(false);
    expect(next.listEnhancement.hideNonFavoritedActorsInList).toBe(true);
    expect(next.listEnhancement.hideUnrecognizedActorsInList).toBe(true);
  });
});

describe('category filter tri-state mapping (09-29-contentfilter-category-merge)', () => {
  it('defaults: mode off + pending null + black 空（存量用户零变化）', () => {
    expect(DEFAULT_ENHANCEMENT_SETTINGS_FORM.categoryFilterMode).toBe('off');
    expect(DEFAULT_ENHANCEMENT_SETTINGS_FORM.categoryFilterModePending).toBeNull();
    expect(DEFAULT_ENHANCEMENT_SETTINGS_FORM.categoryFilterBlack).toEqual([]);
  });

  it('map: 旧键迁移 enableCategoryFilter=true 且 mode 缺失 → blacklist', () => {
    const form = mapSettingsToEnhancementForm({
      listEnhancement: {
        enableCategoryFilter: true,
        categoryFilter: { black: ['c4=17', 'c7=28'] },
      },
    } as any);
    expect(form.categoryFilterMode).toBe('blacklist');
    expect(form.categoryFilterBlack).toEqual(['c4=17', 'c7=28']);
  });

  it('map: mode 缺失且旧键 false/缺省 → off（零回填）', () => {
    const legacyFalse = mapSettingsToEnhancementForm({
      listEnhancement: { enableCategoryFilter: false, categoryFilter: { black: ['c4=17'] } },
    } as any);
    expect(legacyFalse.categoryFilterMode).toBe('off');
    const absent = mapSettingsToEnhancementForm({ listEnhancement: {} } as any);
    expect(absent.categoryFilterMode).toBe('off');
    expect(absent.categoryFilterBlack).toEqual([]);
    expect(absent.categoryFilterModePending).toBeNull();
  });

  it('map: 显式合法 mode 优先于旧键（whitelist+旧键 true→whitelist；off+旧键 true→off）', () => {
    const w = mapSettingsToEnhancementForm({
      listEnhancement: {
        enableCategoryFilter: true,
        categoryFilter: { mode: 'whitelist', black: ['c1=157'] },
      },
    } as any);
    expect(w.categoryFilterMode).toBe('whitelist');
    const o = mapSettingsToEnhancementForm({
      listEnhancement: {
        enableCategoryFilter: true,
        categoryFilter: { mode: 'off', black: ['c1=157'] },
      },
    } as any);
    expect(o.categoryFilterMode).toBe('off');
  });

  it('map: black 丢弃非字符串脏项（口径不变）', () => {
    const form = mapSettingsToEnhancementForm({
      listEnhancement: {
        categoryFilter: { mode: 'whitelist', black: ['c7=28', 42, 'x'] },
      },
    } as any);
    expect(form.categoryFilterBlack).toEqual(['c7=28', 'x']);
  });

  it('apply: 写 categoryFilter={mode,black}，旧键同步 blacklist→true / whitelist→false；兄弟键与 categoryFilter 内未知键保留', () => {
    const current = {
      listEnhancement: {
        enableActorPenetration: true,
        another: 1,
        categoryFilter: { black: ['c4=17'], legacyUnknown: 'keep' },
      },
    } as any;
    const blackForm = {
      ...DEFAULT_ENHANCEMENT_SETTINGS_FORM,
      categoryFilterMode: 'blacklist',
      categoryFilterBlack: ['c7=28'],
    };
    const blackNext = applyEnhancementFormToSettings(current, blackForm);
    expect(blackNext.listEnhancement.categoryFilter).toEqual({
      legacyUnknown: 'keep',
      mode: 'blacklist',
      black: ['c7=28'],
    });
    expect(blackNext.listEnhancement.enableCategoryFilter).toBe(true);
    expect(blackNext.listEnhancement.another).toBe(1);

    const whiteForm = {
      ...DEFAULT_ENHANCEMENT_SETTINGS_FORM,
      categoryFilterMode: 'whitelist',
      categoryFilterBlack: ['c7=28'],
    };
    const whiteNext = applyEnhancementFormToSettings(current, whiteForm);
    expect(whiteNext.listEnhancement.categoryFilter.mode).toBe('whitelist');
    expect(whiteNext.listEnhancement.enableCategoryFilter).toBe(false);
  });

  it('apply: pending 为 UI 瞬态，不持久化到 settings', () => {
    const form = {
      ...DEFAULT_ENHANCEMENT_SETTINGS_FORM,
      categoryFilterMode: 'off',
      categoryFilterModePending: 'whitelist',
    };
    const next = applyEnhancementFormToSettings({}, form);
    expect(next.listEnhancement).not.toHaveProperty('categoryFilterModePending');
    expect(next.listEnhancement.categoryFilter).toEqual({ mode: 'off', black: [] });
  });

  it('round-trip: whitelist 保存后读回 mode+black 一致（含 c9 时长码）', () => {
    const form = {
      ...DEFAULT_ENHANCEMENT_SETTINGS_FORM,
      categoryFilterMode: 'whitelist',
      categoryFilterBlack: ['c1=157', 'c9=gt-120'],
    };
    const saved = applyEnhancementFormToSettings({}, form);
    const reloaded = mapSettingsToEnhancementForm(saved);
    expect(reloaded.categoryFilterMode).toBe('whitelist');
    expect(reloaded.categoryFilterBlack).toEqual(['c1=157', 'c9=gt-120']);
  });
});
