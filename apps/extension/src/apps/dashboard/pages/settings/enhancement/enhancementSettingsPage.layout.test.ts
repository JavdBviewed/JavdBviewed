/**
 * @file enhancementSettingsPage.layout.test.ts
 * @description 功能增强设置页布局回归测试
 * @module apps/dashboard/pages/settings/enhancement
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const pageSource = [
  readFileSync(join(here, 'EnhancementSettingsPage.tsx'), 'utf8'),
  readFileSync(join(here, 'ListTab.tsx'), 'utf8'),
  readFileSync(join(here, 'VideoTab.tsx'), 'utf8'),
  readFileSync(join(here, 'ActorTab.tsx'), 'utf8'),
  readFileSync(join(here, 'OtherTab.tsx'), 'utf8'),
  readFileSync(join(here, '_shared.tsx'), 'utf8'),
].join('\n');
const cardSource = readFileSync(join(here, 'EnhancementFeatureCard.tsx'), 'utf8');
const pageStyleSource = readFileSync(join(here, 'enhancementSettingsPage.css'), 'utf8');
const reactFullPageIdsSource = readFileSync(join(here, '..', 'shared', 'reactFullPageIds.ts'), 'utf8');
const settingsMountSource = readFileSync(
  join(here, '..', '..', '..', '..', '..', 'dashboard', 'tabs', 'mount.ts'),
  'utf8',
);
const legacySettingsSource = readFileSync(
  join(here, '..', '..', '..', '..', '..', 'dashboard', 'tabs', 'settings', 'index.ts'),
  'utf8',
);

describe('EnhancementSettingsPage layout', () => {
  it('routes the enhancement settings page to the React implementation', () => {
    expect(reactFullPageIdsSource).toContain("'enhancement-settings'");
    expect(settingsMountSource).toContain('mountEnhancementSettingsPage');
    expect(legacySettingsSource).toContain('isReactFullSettingsPage');
    for (const pageId of ['cloud-settings', 'drive115-settings', 'emby-settings', 'enhancement-settings']) {
      expect(reactFullPageIdsSource).toContain(`'${pageId}'`);
    }
  });

  it('uses the legacy enhancement notice hierarchy for the beta warning', () => {
    expect(pageSource).toContain('className="enhancement-notice"');
    expect(pageSource).toContain('fas fa-info-circle');
    expect(pageSource).toContain('GitHub Issues');
    expect(pageSource).toContain('https://github.com/JavdBviewed/JavdBviewed/issues');
  });

  it('keeps the shared highlighted beta notice alongside the legacy warning strip', () => {
    expect(pageSource).toContain("import { SettingsHighlightNotice }");
    expect(pageSource).toContain('<SettingsHighlightNotice');
    expect(pageSource).toContain('功能增强仍在测试中');
  });

  it('keeps scheduling as a top-level two-option slider without diagnostics controls', () => {
    expect(pageSource).toContain('id="enhancementSubTabs"');
    expect(pageSource).toContain('data-scheduling-mode-control');
    expect(pageSource).toContain('role="radiogroup"');
    expect(pageSource).toContain('id="videoEnhancementSchedulingModeSmart"');
    expect(pageSource).toContain('id="videoEnhancementSchedulingModeImmediate"');
    expect(pageSource).toContain('智能调度');
    expect(pageSource).toContain('立即增强');
    expect(pageSource).not.toContain('showAlarmDiagnosticsBtn');
    expect(pageSource).not.toContain('导出诊断包');
    expect(pageSource).not.toContain('增强任务调度方式');
  });

  it('keeps the legacy Google translation API field hidden from the React page', () => {
    expect(pageSource).not.toContain('id="traditionalApiKey"');
    expect(pageSource).not.toContain('API 密钥（可选）');
  });

  it('restores the orchestration entry and collapsible configuration cards', () => {
    expect(pageSource).toContain('openEnhancementOrchestrator');
    expect(pageSource).toContain('id="showOrchestratorBtn"');
    expect(pageSource).toContain('调度中心');
    expect(pageStyleSource).toContain("[id$='Config']");
    expect(pageStyleSource).toContain('max-height: 0');
    expect(pageStyleSource).toContain('max-height: 10000px');
    expect(pageStyleSource).toContain(':focus-within');
  });

  it('uses the legacy feature-card hierarchy inside the React settings page', () => {
    expect(pageSource).toContain("from './EnhancementFeatureCard'");
    expect(pageSource).toContain('EnhancementFeatureCard');

    expect(cardSource).toContain('enhancement-feature-status');
    expect(cardSource).toContain('enhancement-risk-notice');
    expect(pageStyleSource).toContain('.enhancement-feature-card__master');
    expect(pageStyleSource).toContain('.enhancement-feature-card__details');
  });

  it('keeps master-toggle hover feedback and readable input carets', () => {
    expect(pageStyleSource).toContain(".enhancement-feature-card__master [data-ui-pattern='setting-toggle-row']");
    expect(pageStyleSource).not.toContain(".enhancement-feature-card__master [data-ui-pattern='setting-toggle-row'] {\n  padding: 0;\n  background: transparent;");
    expect(pageStyleSource).toContain('caret-color: currentColor');
  });

  it('keeps the site appearance package in other enhancements with independent fallbacks', () => {
    expect(pageSource).toContain('JavDB 页面外观包');
    expect(pageSource).toContain('enableSiteAppearance');
    expect(pageSource).toContain('siteAppearanceListCards');
    expect(pageSource).toContain('siteAppearanceDetailAndRelated');
    expect(pageSource).toContain('siteAppearanceMagnetList');
    expect(pageSource).toContain('siteAppearancePreviewImages');
    expect(pageSource).toContain('siteAppearanceAutoExpandReplaceTip');
  });

  it('keeps the site ad removal section in the other-enhancements tab (position lock)', () => {
    const videoTabSource = readFileSync(join(here, 'VideoTab.tsx'), 'utf8');
    const otherTabSource = readFileSync(join(here, 'OtherTab.tsx'), 'utf8');
    expect(otherTabSource).toContain('title="去除原站广告"');
    expect(otherTabSource).toContain('id="siteAdRemovalEnabled"');
    expect(otherTabSource).toContain('id="siteAdRemovalRemovePromoButtons"');
    expect(otherTabSource).toContain('id="siteAdRemovalRemoveExtraAds"');
    expect(videoTabSource).not.toContain('title="去除原站广告"');
    expect(videoTabSource).not.toContain('id="siteAdRemovalEnabled"');
    expect(videoTabSource).not.toContain('id="siteAdRemovalRemovePromoButtons"');
    expect(videoTabSource).not.toContain('id="siteAdRemovalRemoveExtraAds"');
    expect(pageSource).not.toContain('magnetBlockMojContent');
  });

  it('keeps the loaded-content limit warning on list sorting', () => {
    expect(pageSource).toContain('list-sorting-warning');
    expect(pageSource).toContain('只包含当前页面已显示的影片');
  });

  it('places local media-library matching in other enhancements with its 115 guidance', () => {
    expect(pageSource).toContain('title="本地媒体库匹配"');
    expect(pageSource).toContain('enableLibraryMatchStatus');
    expect(cardSource).toContain('enhancement-usage-help');
    expect(cardSource).toContain('usageHelp');
    expect(cardSource).toContain('enhancement-feature-card__header-actions');
    expect(cardSource).toContain('fa-question-circle');
    expect(pageSource).toContain('先在 115 设置中配置媒体库根目录并完成一次索引');
  });

  it('keeps list quick-action capabilities under the merged 快捷操作 card', () => {
    expect(pageSource).toContain('title="快捷操作"');
    expect(pageSource).toContain('id="showStatusBadge"');
    expect(pageSource).toContain('id="enableStatusQuickAction"');
    expect(pageSource).toContain('id="enableListFavoriteQuickAction"');
  });

  it('does not merge independent legacy video and other feature cards', () => {
    for (const title of [
      '相关清单解锁',
      '源站存入清单集成 Jav助手清单',
      '演员标记增强',
      '破解FC2拦截',
      '锚点优化',
      '排序增强',
      '影片热度特效',
      '启用滚动翻页',
      '超级排行榜',
      '显示加载指示器',
    ]) {
      expect(pageSource).toContain(`title="${title}"`);
    }
  });

  it('keeps metadata for every rendered feature card so titles never fall back to a generic icon', () => {
    for (const title of [
      '内容过滤',
      '点击增强',
      '视频预览',
      '高清封面',
      '演员水印',
      '列表显示控制',
      '快捷操作',
      '本地媒体库匹配',
      '详情页增强',
      '演员名称标识',
      '智能标题翻译',
      '状态标记/数据行为',
      '影片页收藏与评分',
      '外部入口面板',
      '相关清单解锁',
      '源站存入清单集成 Jav助手清单',
      '演员标记增强',
      '演员备注',
      '评论区增强',
      '破解FC2拦截',
      '锚点优化',
      '磁力资源搜索',
      '演员操作按钮',
      '影片类别过滤',
      '影片分段显示',
      'JavDB 页面外观包',
      '排序增强',
      '影片热度特效',
      '启用滚动翻页',
      '超级排行榜',
      '显示加载指示器',
      '密码显示助手',
    ]) {
      expect(pageSource).toContain(`'${title}': {`);
    }
  });

  it('keeps legacy usage explanations for external, review, anchor, magnet, and actor features', () => {
    for (const text of [
      '检测 FANZA、Jable、MISSAV、Supjav、JavBus、123AV、NETFLAV',
      '评论区突破显示限制',
      '按钮顺序（从上到下）',
      '搜索源说明',
      '智能兼容',
    ]) {
      expect(pageSource).toContain(text);
    }
  });

  it('keeps the merged content filter card as a default-collapsed hover drawer with grouped rows', () => {
    // 09-29 裁决：内容过滤卡恢复默认收拢 + hover 展开 + 离开收拢（与其他卡一致）；
    // alwaysExpanded 机制整体移除（无使用点）；键命名空间不变（display.*/listEnhancement.*），控件 id 与原页一致（设置搜索锚点）。
    const listTabSource = readFileSync(join(here, 'ListTab.tsx'), 'utf8');

    // 两个独立 section 消失（不再以 section 形态存在）
    expect(listTabSource).not.toContain('title="番号过滤"');
    expect(listTabSource).not.toContain('title="演员过滤（列表）"');
    expect(listTabSource).not.toContain('PlainSettingSection');

    // 合并卡 + alwaysExpanded 机制从机制源与全部使用点消失（默认收拢由 EFC data-expanded 初值 0 保证）
    expect(cardSource).not.toContain('alwaysExpanded');
    expect(pageSource).not.toContain('alwaysExpanded');
    expect(listTabSource).toContain('title="内容过滤"');
    expect(listTabSource).toContain('content-filter-group__label');
    expect(listTabSource).toContain('>番号 / 状态</div>');
    expect(listTabSource).toContain('>演员（列表）</div>');
    expect(listTabSource).toContain("from './listFilterFields'");

    // 位置锁定：内容过滤卡 → 卡头主开关 → 番号 / 状态组 → 演员（列表）组 → 规则块（enableContentFilter 门控，组后）→ 点击增强
    const order = [
      'title="内容过滤"',
      'id="enableContentFilter"',
      '番号 / 状态',
      '演员（列表）',
      'id="contentFilterConfig"',
      'title="点击增强"',
    ];
    let cursor = -1;
    for (const marker of order) {
      const at = listTabSource.indexOf(marker, cursor + 1);
      expect(at, `marker ${marker} after previous`).toBeGreaterThan(cursor);
      cursor = at;
    }

    // 稳定控件 id（与原「显示设置」页一致，设置搜索锚点不漂移）；
    // id 字面量集中定义在 listFilterFields.ts，ListTab 通过 field.id 渲染
    const fieldsSource = readFileSync(join(here, 'listFilterFields.ts'), 'utf8');
    for (const id of [
      'hideViewed',
      'hideBrowsed',
      'hideVR',
      'hideWant',
      'hideInMediaLibrary',
      'hideRealWatched',
      'hideBlacklistedActorsInList',
      'hideNonFavoritedActorsInList',
      'hideUnrecognizedActorsInList',
    ]) {
      expect(fieldsSource).toContain(`id: '${id}'`);
    }
  });

  it('renders the category filter as a switch + per-category checkboxes inside the 4-tab card (09-29-cftabs)', () => {
    const listTabSource = readFileSync(join(here, 'ListTab.tsx'), 'utf8');
    const legacySource = readFileSync(
      join(here, '..', '..', '..', '..', '..', 'dashboard', 'partials', 'tabs', 'settings-enhancement.html'),
      'utf8',
    );

    // 卡内 4-tab（番号过滤 / 演员过滤 / 影片类别过滤 / 内容过滤）；三态 SettingCycleRow 已删除
    expect(listTabSource).toContain("from '../../../../../ui/patterns/SettingTabs/SettingTabs'");
    expect(listTabSource).not.toContain('SettingCycleRow');
    for (const pane of [
      "id: 'numeric'",
      "label: '番号过滤'",
      "id: 'actor'",
      "label: '演员过滤'",
      "id: 'category'",
      "label: '影片类别过滤'",
      "id: 'rules'",
      "label: '内容过滤'",
    ]) {
      expect(listTabSource).toContain(pane);
    }
    expect(listTabSource).not.toContain('id="categoryFilterMode"');
    expect(listTabSource).not.toContain('影片类别过滤（黑名单）');

    // 类别过滤行=普通总开关（旧三态 id 消失）+ 门控确认块/未生效提示/选择区；通用 Checkbox 勾选类别
    expect(listTabSource).toContain('id="enableCategoryFilter"');
    expect(listTabSource).toContain('label="启用影片类别过滤"');
    expect(listTabSource).toContain('id="categoryFilterEnabledConfirm"');
    expect(listTabSource).toContain('id="categoryFilterEnabledConfirmApply"');
    expect(listTabSource).toContain('id="categoryFilterEnabledConfirmCancel"');
    expect(listTabSource).toContain("from '../../../../../ui/primitives/Checkbox/Checkbox'");

    // 子序：演员（列表）组 → 类别总开关 → 确认块/未生效提示/选择区 → 关键词规则块
    const order = [
      '>演员（列表）</div>',
      'id="enableCategoryFilter"',
      'id="categoryFilterEnabledConfirm"',
      'id="categoryFilterConfig"',
      'id="contentFilterConfig"',
    ];
    let cursor = -1;
    for (const marker of order) {
      const at = listTabSource.indexOf(marker, cursor + 1);
      expect(at, `marker ${marker} after previous`).toBeGreaterThan(cursor);
      cursor = at;
    }

    // 门控确认块必含句 + 两路按钮 + 未生效提示 + 选择区语义
    expect(listTabSource).toContain('此功能会增加性能开销与源站的请求量');
    expect(listTabSource).toContain('类别数据来自穿透详情请求，不另起请求');
    expect(listTabSource).toContain('启用演员穿透并开启');
    expect(listTabSource).toContain('未生效');
    expect(listTabSource).toContain('从列表隐藏该类别的影片');
    expect(listTabSource).not.toContain('勾选要保留的影片类别');

    // 搜索索引：内容过滤 h4 块=checkbox#enableCategoryFilter（三态 button 条目消失）；
    // 演员页旧条目（L1218 块）保留不动
    expect(legacySource).toContain('<input type="checkbox" id="enableCategoryFilter">');
    expect(legacySource).toContain('<label for="enableCategoryFilter">影片类别过滤</label>');
    expect(legacySource).not.toContain('id="categoryFilterMode"');
    expect(legacySource).toContain('<h6 class="enhancement-feature-name">🎯 影片类别过滤</h6>');
  });

  it('keeps the hideNonFavoritedActorsInList label aligned with the popup short copy', () => {
    // label 不变（与 popup 既有短文案逐字一致）；描述 2026-09-28 actor-favorited-field 换真白名单口径：
    // 收藏 = ActorRecord.favorited（缺省 = 已收藏），拉黑与收藏正交，旧止血口径（收藏≈未拉黑）作废。
    const expectedLabel = '隐藏未收藏演员的作品';
    const expectedDescription =
      '隐藏匹配演员全部未收藏的列表页作品。演员库内演员默认为已收藏，可在演员页将个别演员设为未收藏。无法匹配到演员的作品不受影响；演员库为空时本开关不生效。';
    const fieldsSource = readFileSync(join(here, 'listFilterFields.ts'), 'utf8');
    expect(fieldsSource).toContain(`label: '${expectedLabel}'`);
    expect(fieldsSource).toContain(`description: '${expectedDescription}'`);
    expect(fieldsSource).not.toContain('隐藏匹配演员全在黑名单中的作品');
    // legacy 静态设置页同文案同步（搜索锚点 label 不漂移）
    const legacySource = readFileSync(
      join(here, '..', '..', '..', '..', '..', 'dashboard', 'partials', 'tabs', 'settings-enhancement.html'),
      'utf8',
    );
    expect(legacySource).toContain(`<label for="hideNonFavoritedActorsInList">${expectedLabel}</label>`);
    expect(legacySource).toContain(`<p class="input-description">${expectedDescription}</p>`);
    expect(legacySource).not.toContain('隐藏匹配演员全在黑名单中的作品');
    // popup 既有短文案逐字一致（popup 侧零改动，这里锁一致性）
    const popupSource = readFileSync(
      join(here, '..', '..', '..', '..', '..', 'apps', 'popup', 'bootstrap.ts'),
      'utf8',
    );
    expect(popupSource).toContain(`'${expectedLabel}'`);
  });
});
