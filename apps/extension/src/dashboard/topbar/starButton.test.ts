/**
 * @vitest-environment jsdom
 * @file starButton.test.ts
 * @description topbar 星星按钮共享模块：window.open 目标参数 / legacy 绑定幂等 / 按钮缺失 no-op
 * @module dashboard/topbar
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bindTopbarStarButton,
  openProjectStarPage,
  PROJECT_GITHUB_URL,
  TOPBAR_STAR_BTN_ID,
} from './starButton';

describe('starButton', () => {
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    document.body.innerHTML = '';
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  it('opens the project GitHub repo in a new tab with noopener', () => {
    expect(PROJECT_GITHUB_URL).toBe('https://github.com/JavdBviewed/JavdBviewed');
    openProjectStarPage();
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(PROJECT_GITHUB_URL, '_blank', 'noopener');
  });

  it('binds a working click handler on the legacy button', () => {
    const btn = document.createElement('button');
    btn.id = TOPBAR_STAR_BTN_ID;
    document.body.appendChild(btn);

    bindTopbarStarButton();
    btn.click();
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(PROJECT_GITHUB_URL, '_blank', 'noopener');
  });

  it('binds only once (idempotent)', () => {
    const btn = document.createElement('button');
    btn.id = TOPBAR_STAR_BTN_ID;
    document.body.appendChild(btn);

    bindTopbarStarButton();
    bindTopbarStarButton();
    btn.click();
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the button is absent', () => {
    expect(() => bindTopbarStarButton()).not.toThrow();
    expect(openSpy).not.toHaveBeenCalled();
  });
});
