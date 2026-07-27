/**
 * @file SettingsSectionNav.test.tsx
 * @description Shared React settings section navigation render contract
 * @module apps/dashboard/pages/settings/shared
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  SettingsSectionNav,
  getVisibleSectionNavItems,
  resolveInitialActiveSectionId,
  type SettingsSectionNavItem,
} from './SettingsSectionNav';

const here = dirname(fileURLToPath(import.meta.url));
const sectionNavCss = readFileSync(join(here, 'settingsSectionNav.css'), 'utf8').replace(/\r\n/g, '\n');

const items: SettingsSectionNavItem[] = [
  { id: 'section-general', label: '常规设置', shortLabel: '常规' },
  { id: 'section-hidden', label: '隐藏项', hidden: true },
  { id: 'section-advanced', label: '高级设置', shortLabel: '高级', badge: 'Beta' },
];

describe('SettingsSectionNav', () => {
  it('filters hidden items through the shared model helper', () => {
    expect(getVisibleSectionNavItems(items).map((item) => item.id)).toEqual([
      'section-general',
      'section-advanced',
    ]);
  });

  it('uses the first visible section as the initial active item', () => {
    expect(resolveInitialActiveSectionId(items)).toBe('section-general');
    expect(resolveInitialActiveSectionId([{ id: 'x', label: 'X', hidden: true }])).toBeNull();
  });

  it('renders desktop navigation and mobile chips from the same item list', () => {
    const html = renderToStaticMarkup(
      createElement(SettingsSectionNav, {
        items,
        activeId: 'section-advanced',
      }),
    );

    expect(html).toContain('aria-label="设置页分组导航"');
    expect(html).toContain('settings-section-nav__desktop');
    expect(html).toContain('settings-section-nav__mobile');
    expect(html).toContain('常规设置');
    expect(html).toContain('高级设置');
    expect(html).toContain('Beta');
    expect(html).not.toContain('隐藏项');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('data-section-nav-target="section-advanced"');
    expect(html).toContain('type="button"');
  });

  it('uses short labels for mobile chips when available', () => {
    const html = renderToStaticMarkup(createElement(SettingsSectionNav, { items }));

    expect(html).toContain('settings-section-nav__chip-label');
    expect(html).toContain('>常规</span>');
  });

  it('keeps the desktop navigation fixed on the right viewport edge and vertically centered', () => {
    const layoutRule = ['.settings-section-nav-layout {', '  width: 100%;', '}'].join('\n');
    const contentRule = [
      '.settings-section-nav-content {',
      '  min-width: 0;',
      '  width: 100%;',
      '}',
    ].join('\n');

    expect(sectionNavCss).toContain(layoutRule);
    expect(sectionNavCss).toContain(contentRule);
    expect(sectionNavCss).toContain('position: fixed;');
    expect(sectionNavCss).toContain('top: 50%;');
    expect(sectionNavCss).toContain('right: max(var(--settings-section-nav-floating-edge, 50px), env(safe-area-inset-right, 0px));');
    expect(sectionNavCss).toContain('left: auto;');
    expect(sectionNavCss).toContain('transform: translateY(-50%);');
    expect(sectionNavCss).toContain('max-height: calc(100vh - 100px);');
    expect(sectionNavCss).not.toContain('grid-template-columns: minmax(0, 1fr) minmax(148px, 180px);');
  });

  it('allows callers to control active state as null', () => {
    const html = renderToStaticMarkup(
      createElement(SettingsSectionNav, {
        items,
        activeId: null,
      }),
    );

    expect(html).not.toContain('aria-current="true"');
  });
});
