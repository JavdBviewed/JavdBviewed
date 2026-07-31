/**
 * @file dashboardUserMenu.test.ts
 * @description Dashboard 右上角账号菜单 DOM 行为测试
 * @module tests/dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const userProfileMocks = vi.hoisted(() => ({
  initUserProfileSection: vi.fn(() => {
    const section = document.getElementById('user-profile-section');
    if (section) {
      section.innerHTML = '<div data-testid="profile-mounted">profile mounted</div>';
    }
  }),
}));

vi.mock('../../apps/extension/src/dashboard/userProfile', () => ({
  initUserProfileSection: userProfileMocks.initUserProfileSection,
}));

describe('Dashboard user menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="dashboard-user-menu-root"></div><button id="outside">outside</button>';
    window.history.replaceState({}, '', '/dashboard/dashboard.html');
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/dashboard/dashboard.html');
  });

  it('renders the trigger, popover and reused user profile section', async () => {
    const { initDashboardUserMenu } = await import('../../apps/extension/src/dashboard/userMenu');

    initDashboardUserMenu();

    expect(document.getElementById('dashboard-user-menu-trigger')).toBeTruthy();
    expect(document.getElementById('dashboard-user-menu-popover')).toBeTruthy();
    expect(document.getElementById('user-profile-section')).toBeTruthy();
    expect(document.querySelector('[data-testid="profile-mounted"]')).toBeTruthy();
    expect(userProfileMocks.initUserProfileSection).toHaveBeenCalledTimes(1);
  });

  it('toggles the popover from the avatar trigger and closes with Escape', async () => {
    const { initDashboardUserMenu } = await import('../../apps/extension/src/dashboard/userMenu');
    initDashboardUserMenu();

    const trigger = document.getElementById('dashboard-user-menu-trigger') as HTMLButtonElement;
    const popover = document.getElementById('dashboard-user-menu-popover') as HTMLElement;

    expect(popover.hidden).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    trigger.click();
    expect(popover.hidden).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(popover.hidden).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('navigates to about settings and closes the menu', async () => {
    const { initDashboardUserMenu } = await import('../../apps/extension/src/dashboard/userMenu');
    initDashboardUserMenu();

    const trigger = document.getElementById('dashboard-user-menu-trigger') as HTMLButtonElement;
    const popover = document.getElementById('dashboard-user-menu-popover') as HTMLElement;
    const aboutButton = document.querySelector('[data-user-menu-action="about"]') as HTMLButtonElement;

    trigger.click();
    aboutButton.click();

    // 「版本与关于」统一入口为 update-settings（about-settings 兼容旧路由）
    expect(window.location.hash).toBe('#tab-settings/update-settings');
    expect(popover.hidden).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps the menu open when an internal profile action updates its own DOM', async () => {
    const { initDashboardUserMenu } = await import('../../apps/extension/src/dashboard/userMenu');
    initDashboardUserMenu();

    const trigger = document.getElementById('dashboard-user-menu-trigger') as HTMLButtonElement;
    const popover = document.getElementById('dashboard-user-menu-popover') as HTMLElement;
    const profileSection = document.getElementById('user-profile-section') as HTMLElement;
    const internalButton = document.createElement('button');
    internalButton.type = 'button';
    internalButton.textContent = '刷新账号';
    internalButton.addEventListener('click', () => {
      internalButton.remove();
    });
    profileSection.appendChild(internalButton);

    trigger.click();
    internalButton.click();

    expect(popover.hidden).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('opens external help and project links in a new tab', async () => {
    const { initDashboardUserMenu } = await import('../../apps/extension/src/dashboard/userMenu');
    initDashboardUserMenu();

    (document.querySelector('[data-user-menu-action="help"]') as HTMLButtonElement).click();
    (document.querySelector('[data-user-menu-action="github"]') as HTMLButtonElement).click();
    (document.querySelector('[data-user-menu-action="telegram"]') as HTMLButtonElement).click();

    expect(window.open).toHaveBeenNthCalledWith(1, 'https://jbd.we-together.club/', '_blank', 'noopener,noreferrer');
    expect(window.open).toHaveBeenNthCalledWith(2, 'https://github.com/JavdBviewed/JavdBviewed', '_blank', 'noopener,noreferrer');
    expect(window.open).toHaveBeenNthCalledWith(3, 'https://t.me/javdbviewed', '_blank', 'noopener,noreferrer');
  });
});
