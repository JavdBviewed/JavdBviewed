/**
 * @file settingsPageFrame.test.tsx
 * @description ????????????????
 * @module apps/dashboard/pages/settings/shared
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SettingsPageFrame } from './settingsPageFrame';
import type { SettingsSectionNavItem } from './SettingsSectionNav';

const navItems: SettingsSectionNavItem[] = [
  { id: 'frame-section-basic', label: '????', shortLabel: '??' },
  { id: 'frame-section-advanced', label: '????', shortLabel: '??' },
  { id: 'frame-section-logs', label: '????', shortLabel: '??' },
];

describe('SettingsPageFrame', () => {
  it('wraps children with the shared section nav layout when section items are provided', () => {
    const html = renderToStaticMarkup(
      createElement(
        SettingsPageFrame,
        {
          title: '????',
          description: '????',
          sectionNavItems: navItems,
        },
        createElement('section', { className: 'settings-card' }, '????'),
      ),
    );

    expect(html).toContain('settings-section-nav-layout');
    expect(html).toContain('settings-section-nav-aside');
    expect(html).toContain('settings-section-nav-content');
    expect(html).toContain('settings-section-nav__desktop');
    expect(html).toContain('data-section-nav-target="frame-section-basic"');
    expect(html).toContain('????');
  });

  it('renders at most one section nav layout when the page has no section items', () => {
    const html = renderToStaticMarkup(
      createElement(
        SettingsPageFrame,
        {
          title: '????',
          pageId: 'frame-no-items',
        },
        createElement('div', { className: 'settings-page-body' },
          createElement('section', { className: 'settings-card' }, '????'),
          createElement('section', { className: 'settings-card' }, '????'),
          createElement('section', { className: 'settings-card' }, '????'),
        ),
      ),
    );

    // 外框最多渲染一层导航布局；不得再嵌套第二层 .settings-section-nav-layout。
    expect(html.split('settings-section-nav-layout').length - 1).toBeLessThanOrEqual(1);
  });
});
