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
      '演员名称标识',
      '智能标题翻译',
      '状态标记增强',
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
});
