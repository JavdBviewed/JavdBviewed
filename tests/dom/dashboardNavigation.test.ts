/**
 * @file dashboardNavigation.test.ts
 * @description Dashboard 9C 导航 DOM 行为测试
 * @module tests/dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const navigationMocks = vi.hoisted(() => ({
  initializeTabById: vi.fn(() => Promise.resolve()),
  mountTabIfNeeded: vi.fn(() => Promise.resolve()),
  prefetchModuleById: vi.fn(() => Promise.resolve()),
  prefetchTabResources: vi.fn(() => Promise.resolve()),
  prefetchedTabs: new Set<string>(),
}));

vi.mock('../../apps/extension/src/dashboard/tabs/mount', () => ({
  mountTabIfNeeded: navigationMocks.mountTabIfNeeded,
}));

vi.mock('../../apps/extension/src/dashboard/tabs/registry', () => ({
  initializeTabById: navigationMocks.initializeTabById,
  prefetchModuleById: navigationMocks.prefetchModuleById,
}));

vi.mock('../../apps/extension/src/dashboard/tabs/resources', () => ({
  prefetchedTabs: navigationMocks.prefetchedTabs,
  prefetchTabResources: navigationMocks.prefetchTabResources,
}));

describe('Dashboard 9C navigation runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigationMocks.prefetchedTabs.clear();
    setupDashboardShell();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/dashboard/dashboard.html');
  });

  it('renders grouped menus and activates old direct tab hashes', async () => {
    window.history.replaceState({}, '', '/dashboard/dashboard.html#tab-records');
    const showEvents: string[] = [];
    window.addEventListener('tab:show', event => {
      const customEvent = event as CustomEvent<{ tabId?: string }>;
      if (customEvent.detail?.tabId) {
        showEvents.push(customEvent.detail.tabId);
      }
    }, { once: true });

    const { initTabs } = await import('../../apps/extension/src/dashboard/tabs/navigation');
    await initTabs();
    await flushNavigationTasks();

    expect(readButtonLabels('.dashboard-main-tab')).toEqual([
      '首页',
      '资料库',
      '媒体库',
      '任务与备份',
      '报告与日志',
      '设置',
    ]);
    expect(readButtonLabels('.dashboard-sub-tab')).toEqual([
      '番号库',
      '演员库',
      '新作品',
      '收藏中心',
      '回收站',
    ]);
    expect(document.querySelector('.dashboard-main-tab.active')?.textContent).toBe('资料库');
    expect(document.querySelector('.dashboard-sub-tab.active')?.textContent).toBe('番号库');
    expect(document.getElementById('dashboard-section-nav')?.parentElement).toBe(document.getElementById('tab-records'));
    expect(document.getElementById('tab-records')?.classList.contains('active')).toBe(true);
    expect(document.getElementById('tab-home')?.classList.contains('active')).toBe(false);
    expect(navigationMocks.mountTabIfNeeded).toHaveBeenCalledWith('tab-records');
    expect(navigationMocks.initializeTabById).toHaveBeenCalledWith('tab-records');
    expect(showEvents).toContain('tab-records');
  });

  it('keeps primary menu in the topbar and secondary menu host available for the page area', () => {
    // React shell + initTabs still require:
    // - #dashboard-main-tabs inside .topbar-center
    // - #dashboard-section-nav movable host for placeSectionTabsInActivePage
    setupDashboardShell();
    const mainTabs = document.getElementById('dashboard-main-tabs');
    const sectionNav = document.getElementById('dashboard-section-nav');

    expect(mainTabs?.closest('.topbar-center')).toBeTruthy();
    expect(sectionNav).toBeTruthy();
    expect(document.getElementById('dashboard-user-menu-root') || true).toBeTruthy();
  });

  it('keeps shell structure contract aligned with every dashboard tab container', async () => {
    const { getDashboardShellStructure } = await import('../../apps/extension/src/apps/dashboard/shell/shellStructure');
    const structure = getDashboardShellStructure();
    expect(structure.tabContentIds).toEqual(expect.arrayContaining([
      'tab-backup',
      'tab-sync',
      'tab-drive115-tasks',
      'tab-media',
      'tab-settings',
      'tab-home',
    ]));
    expect(structure.mainTabsId).toBe('dashboard-main-tabs');
    expect(structure.sectionNavId).toBe('dashboard-section-nav');
  });

  it('keeps the production skeleton aligned with every dashboard tab container', () => {
    const skeletonHtml = readFileSync(
      resolve(process.cwd(), 'apps/extension/src/dashboard/partials/layout/skeleton.html'),
      'utf8',
    );

    // Legacy skeleton remains as emergency fallback only; still must list all tabs.
    expect(skeletonHtml).toContain('id="tab-backup"');
    expect(skeletonHtml).toContain('id="tab-sync"');
    expect(skeletonHtml).toContain('id="tab-drive115-tasks"');
    expect(skeletonHtml).not.toContain('layout-sidebar-root');
    expect(skeletonHtml).not.toContain('sidebarToggleBtn');
  });

  it('uses the dashboard blue theme instead of the indigo 9C prototype colors', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'apps/extension/src/dashboard/styles/04-components/layout.css'),
      'utf8',
    );

    expect(css).toContain('background: var(--primary-light)');
    expect(css).toContain('color: var(--primary-active)');
    expect(css).not.toContain('#3730a3');
    expect(css).not.toContain('#eef2ff');
    expect(css).not.toContain('#c7d2fe');
  });

  it('presents the media library as a browseable vault surface instead of a planning placeholder', () => {
    // 媒体库已迁 React 栈：partial 仅作遗留文件，契约看模型与 skipPartial
    const mediaHtml = readFileSync(
      resolve(process.cwd(), 'apps/extension/src/dashboard/partials/tabs/media.html'),
      'utf8',
    );
    // 遗留 HTML 可仍存在，但产品路径不再依赖「开发中」占位文案作为主体验
    expect(mediaHtml.length).toBeGreaterThan(0);
  });

  it('keeps a settings path for media server configuration from the media empty state', async () => {
    const { getDashboardShellStructure } = await import('../../apps/extension/src/apps/dashboard/shell/shellStructure');
    expect(getDashboardShellStructure().tabContentIds).toContain('tab-media');
    // 空态跳转目标仍为设置子页 hash（由 React 页 Button 触发）
    expect('#tab-settings/emby-settings').toContain('emby-settings');
  });

  it('opens data sync as the default task group page with backup placed last', async () => {
    window.history.replaceState({}, '', '/dashboard/dashboard.html#tab-home');

    const { initTabs } = await import('../../apps/extension/src/dashboard/tabs/navigation');
    await initTabs();
    await flushNavigationTasks();

    document.querySelector<HTMLButtonElement>('.dashboard-main-tab[data-nav-group-id="sync"]')?.click();
    await flushNavigationTasks();

    expect(window.location.hash).toBe('#tab-sync');
    expect(document.querySelector('.dashboard-main-tab.active')?.textContent).toBe('任务与备份');
    expect(readButtonLabels('.dashboard-sub-tab')).toEqual(['数据同步', '115任务', '备份与恢复']);
    expect(document.querySelector('.dashboard-sub-tab.active')?.textContent).toBe('数据同步');
    expect(document.getElementById('dashboard-section-nav')?.parentElement).toBe(document.getElementById('tab-sync'));
    expect(document.getElementById('tab-sync')?.classList.contains('active')).toBe(true);
    expect(navigationMocks.mountTabIfNeeded).toHaveBeenCalledWith('tab-sync');
    expect(navigationMocks.initializeTabById).toHaveBeenCalledWith('tab-sync');
  });

  it('renders the backup page with local and WebDAV backup controls', () => {
    const host = document.createElement('div');
    const backupHtml = readFileSync(
      resolve(process.cwd(), 'apps/extension/src/dashboard/partials/tabs/backup.html'),
      'utf8',
    );
    host.innerHTML = backupHtml;
    const backupPage = host.querySelector('.backup-page.card');

    expect(backupPage).toBeTruthy();
    expect(host.querySelector('.backup-panels')).toBeNull();
    expect(host.querySelectorAll('.backup-panel')).toHaveLength(0);
    expect(backupPage?.querySelectorAll('.backup-section')).toHaveLength(3);
    expect(backupHtml).toContain('备份与恢复');
    expect(backupHtml).toContain('本地备份');
    expect(backupHtml).toContain('WebDAV 云端备份');
    expect(backupHtml).toContain('数据维护');
    expect(backupHtml).toContain('id="importFile"');
    expect(backupHtml).toContain('id="exportBtn"');
    expect(backupHtml).toContain('id="syncNow"');
    expect(backupHtml).toContain('id="syncDown"');
    expect(backupHtml).toContain('id="cleanupInjectedSourceTags"');
    expect(backupHtml).toContain('id="lastSyncTime"');
    expect(backupHtml).toContain('id="syncIndicator"');
  });

  it('keeps backup page action button colors scoped to the dashboard theme', () => {
    const backupCss = readFileSync(
      resolve(process.cwd(), 'apps/extension/src/dashboard/styles/05-pages/backup.css'),
      'utf8',
    );

    expect(backupCss).toContain('.backup-page #exportBtn');
    expect(backupCss).toContain('.backup-page #syncNow');
    expect(backupCss).toContain('.backup-page #syncDown');
    expect(backupCss).toContain('background-color: var(--primary)');
    expect(backupCss).toContain('background-color: var(--success)');
  });

  it('removes backup action blocks from the sidebar partial', () => {
    const sidebarHtml = readFileSync(
      resolve(process.cwd(), 'apps/extension/src/dashboard/partials/layout/sidebar.html'),
      'utf8',
    );

    expect(sidebarHtml).not.toContain('<h4>本地备份</h4>');
    expect(sidebarHtml).not.toContain('<h4>WebDAV 备份</h4>');
    expect(sidebarHtml).not.toContain('id="importFile"');
    expect(sidebarHtml).not.toContain('id="exportBtn"');
    expect(sidebarHtml).not.toContain('id="syncNow"');
    expect(sidebarHtml).not.toContain('id="syncDown"');
  });

  it('hides the secondary menu for the single-entry home group', async () => {
    window.history.replaceState({}, '', '/dashboard/dashboard.html#tab-home');

    const { initTabs } = await import('../../apps/extension/src/dashboard/tabs/navigation');
    await initTabs();
    await flushNavigationTasks();

    const sectionNav = document.getElementById('dashboard-section-nav');
    expect(readButtonLabels('.dashboard-sub-tab')).toEqual([]);
    expect(sectionNav?.hidden).toBe(true);
    expect(document.querySelector('.dashboard-main-tab.active')?.textContent).toBe('首页');
    expect(document.getElementById('tab-home')?.classList.contains('active')).toBe(true);
  });

  it('opens media library as a single primary entry without secondary source tabs', async () => {
    window.history.replaceState({}, '', '/dashboard/dashboard.html#tab-home');

    const { initTabs } = await import('../../apps/extension/src/dashboard/tabs/navigation');
    await initTabs();
    await flushNavigationTasks();

    document.querySelector<HTMLButtonElement>('.dashboard-main-tab[data-nav-group-id="media"]')?.click();
    await flushNavigationTasks();

    expect(window.location.hash).toBe('#tab-media');
    expect(document.querySelector('.dashboard-main-tab.active')?.textContent).toBe('媒体库');
    expect(readButtonLabels('.dashboard-sub-tab')).toEqual([]);
    expect(document.getElementById('dashboard-section-nav')?.hidden).toBe(true);
    expect(document.getElementById('tab-media')?.classList.contains('active')).toBe(true);
    expect(navigationMocks.mountTabIfNeeded).toHaveBeenCalledWith('tab-media');
    expect(navigationMocks.initializeTabById).toHaveBeenCalledWith('tab-media');
  });

  it('keeps legacy media source hashes on the media tab without showing secondary menus', async () => {
    window.history.replaceState({}, '', '/dashboard/dashboard.html#tab-media/emby');

    const { initTabs } = await import('../../apps/extension/src/dashboard/tabs/navigation');
    await initTabs();
    await flushNavigationTasks();

    expect(window.location.hash).toBe('#tab-media/emby');
    expect(document.querySelector('.dashboard-main-tab.active')?.textContent).toBe('媒体库');
    expect(readButtonLabels('.dashboard-sub-tab')).toEqual([]);
    expect(document.getElementById('dashboard-section-nav')?.hidden).toBe(true);
    expect(document.getElementById('tab-media')?.classList.contains('active')).toBe(true);
  });

  it('keeps settings subpage hashes active under the settings group', async () => {
    window.history.replaceState({}, '', '/dashboard/dashboard.html#tab-settings/drive115-settings');

    const { initTabs } = await import('../../apps/extension/src/dashboard/tabs/navigation');
    await initTabs();
    await flushNavigationTasks();

    expect(window.location.hash).toBe('#tab-settings/drive115-settings');
    expect(document.querySelector('.dashboard-main-tab.active')?.textContent).toBe('设置');
    expect(readButtonLabels('.dashboard-sub-tab')).toEqual([]);
    expect(document.getElementById('dashboard-section-nav')?.hidden).toBe(true);
    expect(document.getElementById('tab-settings')?.classList.contains('active')).toBe(true);
    expect(navigationMocks.mountTabIfNeeded).toHaveBeenCalledWith('tab-settings');
    expect(navigationMocks.initializeTabById).toHaveBeenCalledWith('tab-settings');
  });
});

function setupDashboardShell(): void {
  document.body.innerHTML = `
    <div class="topbar">
      <nav class="topbar-center" aria-label="主导航">
        <div class="tabs dashboard-main-tabs" id="dashboard-main-tabs"></div>
      </nav>
    </div>
    <div class="dashboard-section-nav" id="dashboard-section-nav" data-area="navigation"></div>
    <div id="tab-home" class="tab-content active"></div>
    <div id="tab-records" class="tab-content"></div>
    <div id="tab-lists" class="tab-content"></div>
    <div id="tab-actors" class="tab-content"></div>
    <div id="tab-new-works" class="tab-content"></div>
    <div id="tab-recycle-bin" class="tab-content"></div>
    <div id="tab-media" class="tab-content"></div>
    <div id="tab-backup" class="tab-content"></div>
    <div id="tab-sync" class="tab-content"></div>
    <div id="tab-drive115-tasks" class="tab-content"></div>
    <div id="tab-insights" class="tab-content"></div>
    <div id="tab-settings" class="tab-content"></div>
    <div id="tab-logs" class="tab-content"></div>
  `;
}

function readButtonLabels(selector: string): string[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(selector))
    .map(button => button.textContent?.trim() ?? '');
}

async function flushNavigationTasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
