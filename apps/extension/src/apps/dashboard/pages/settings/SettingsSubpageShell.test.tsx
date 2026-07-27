/**
 * @file SettingsSubpageShell.test.tsx
 * @description 设置子页壳：partial HTML 经 React 注入后控件 id 可见
 * @module apps/dashboard/pages/settings
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SettingsSubpageShell } from './SettingsSubpageShell';
import type { SettingsSectionNavItem } from './shared/SettingsSectionNav';

const sectionNavItems: SettingsSectionNavItem[] = [
  { id: 'legacy-section-basic', label: '????' },
  { id: 'legacy-section-advanced', label: '????' },
  { id: 'legacy-section-log', label: '????' },
];

const PANEL_HTML = `
<div class="settings-page" id="enhancement-settings">
  <div class="settings-page-header">
    <button class="settings-back-btn" data-action="back-to-settings">返回</button>
    <h2>功能增强</h2>
  </div>
  <div class="settings-page-body">
    <input type="checkbox" id="hideViewed" />
  </div>
</div>
`;

describe('SettingsSubpageShell', () => {
  it('embeds panel HTML and exposes host + panel ids', () => {
    const html = renderToStaticMarkup(
      createElement(SettingsSubpageShell, {
        title: '功能增强',
        description: 'desc',
        panelHtml: PANEL_HTML,
        bodyHostId: 'settings-panel-body-host',
        sectionNavItems,
      }),
    );
    expect(html).toContain('id="settings-panel-body-host"');
    expect(html).toContain('id="enhancement-settings"');
    expect(html).toContain('id="hideViewed"');
    expect(html).toContain('data-action="back-to-settings"');
    expect(html).toContain('ssp-back-bar');
    expect(html).toContain('settings-section-nav-layout');
    expect(html).toContain('data-section-nav-target="legacy-section-basic"');
    // 原 partial 标题保留在正文里（不再被壳替换）
    expect(html).toContain('功能增强');
  });
});
