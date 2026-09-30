/**
 * @vitest-environment jsdom
 * @file DashboardShell.starBtn.test.tsx
 * @description React 壳 topbar 星星胶囊按钮（09-30-topbar-star-button）：
 *   位于 .topbar-right 且紧邻 user-menu-root 之前（主题切换器运行时 insertBefore 到
 *   user-menu-root 前 → 星星恒在主题切换左侧）/ title 与 aria-label / 图标 /
 *   点击新标签页打开项目 GitHub（_blank + noopener）。
 * @module apps/dashboard/shell
 */
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardShell } from './DashboardShell';
import { PROJECT_GITHUB_URL } from '../../../dashboard/topbar/starButton';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('DashboardShell topbar star button', () => {
  let container: HTMLElement;
  let root: Root;
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(createElement(DashboardShell));
    });
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    act(() => root.unmount());
    openSpy.mockRestore();
  });

  function starBtn(): HTMLButtonElement {
    const el = container.querySelector<HTMLButtonElement>('#topbar-star-btn');
    if (!el) throw new Error('star button not rendered');
    return el;
  }

  it('renders inside .topbar-right, immediately before the user menu root (left of theme switcher)', () => {
    const btn = starBtn();
    expect(btn.closest('.topbar-right')).toBeTruthy();
    const menuRoot = container.querySelector('#dashboard-user-menu-root');
    expect(menuRoot).toBeTruthy();
    // 主题切换器由 mountDashboardThemeSwitcher insertBefore 到 menuRoot 前：
    // 星星的 nextElementSibling 位置即主题切换器落点 → 星星恒在其左侧
    expect(btn.nextElementSibling).toBe(menuRoot);
  });

  it('exposes star icon and 给项目一个 star title/aria-label', () => {
    const btn = starBtn();
    expect(btn.querySelector('.fas.fa-star')).toBeTruthy();
    expect(btn.title).toBe('给项目一个 star');
    expect(btn.getAttribute('aria-label')).toBe('给项目一个 star');
    expect(btn.getAttribute('type')).toBe('button');
  });

  it('opens the project GitHub in a new tab with noopener on click', () => {
    act(() => {
      starBtn().click();
    });
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(PROJECT_GITHUB_URL, '_blank', 'noopener');
  });
});
