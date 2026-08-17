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
const pageSource = readFileSync(join(here, 'EnhancementSettingsPage.tsx'), 'utf8');
const sharedStyleSource = readFileSync(
  join(here, '..', 'shared', 'settingsHighlightNotice.css'),
  'utf8',
);
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
    expect(legacySettingsSource).toContain("'cloud-settings', 'drive115-settings', 'emby-settings', 'enhancement-settings'");
  });

  it('uses the shared highlight notice style for the beta warning', () => {
    expect(pageSource).toContain('SettingsHighlightNotice');
    expect(pageSource).toContain('功能增强仍在测试中');
    expect(pageSource).toContain('GitHub Issues');
    expect(pageSource).toContain('https://github.com/JavdBviewed/JavdBviewed/issues');
    expect(sharedStyleSource).toContain('.settings-highlight-notice');
  });

  it('keeps scheduling as a top-level two-option slider without diagnostics controls', () => {
    expect(pageSource).toContain('data-scheduling-mode-control');
    expect(pageSource).toContain('role="radiogroup"');
    expect(pageSource).toContain('智能调度');
    expect(pageSource).toContain('立即增强');
    expect(pageSource).not.toContain('showAlarmDiagnosticsBtn');
    expect(pageSource).not.toContain('导出诊断包');
    expect(pageSource).not.toContain('增强任务调度方式');
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
});
