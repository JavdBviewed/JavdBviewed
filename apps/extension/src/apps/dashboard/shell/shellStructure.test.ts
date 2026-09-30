/**
 * @file shellStructure.test.ts
 * @description 外壳结构契约单测
 * @module apps/dashboard/shell
 */
import { describe, expect, it } from 'vitest';
import { assertShellHostsPresent, getDashboardShellStructure } from './shellStructure';
import { DASHBOARD_TAB_CONTENT_IDS } from '../../../dashboard/tabs/tabContentIds';

describe('dashboard shell structure contract', () => {
  it('exposes stable nav and tab host ids required by initTabs', () => {
    const s = getDashboardShellStructure();
    expect(s.mainTabsId).toBe('dashboard-main-tabs');
    expect(s.sectionNavId).toBe('dashboard-section-nav');
    expect(s.userMenuRootId).toBe('dashboard-user-menu-root');
    expect(s.starBtnId).toBe('topbar-star-btn');
    expect(s.tabContentIds).toEqual([...DASHBOARD_TAB_CONTENT_IDS]);
    expect(s.tabContentIds).toContain('tab-media');
    expect(s.tabContentIds).toContain('tab-settings');
  });

  it('detects missing hosts', () => {
    const fake = {
      querySelector: (sel: string) => (sel === '#dashboard-main-tabs' ? {} : null),
    } as unknown as ParentNode;
    const missing = assertShellHostsPresent(fake);
    expect(missing).toContain('dashboard-section-nav');
    expect(missing).not.toContain('dashboard-main-tabs');
  });
});
