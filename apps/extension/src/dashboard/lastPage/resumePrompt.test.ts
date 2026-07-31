/**
 * @file resumePrompt.test.ts
 * @description 恢复上次页面气泡：自动隐藏
 * @module dashboard/lastPage
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LAST_PAGE_RESUME_AUTO_HIDE_MS,
  mountLastPageResumePrompt,
  unmountLastPageResumePrompt,
} from './resumePrompt';
import type { DashboardLastPageRecord } from './types';

const record: DashboardLastPageRecord = {
  hash: '#tab-new-works',
  title: '资料库 · 新作品',
  updatedAt: 1,
};

describe('mountLastPageResumePrompt auto hide', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="dashboard-user-menu-root"></div>';
    vi.useFakeTimers();
  });

  afterEach(() => {
    unmountLastPageResumePrompt(document);
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('auto-dismisses after default 5s and clears record', async () => {
    const clearRecord = vi.fn(async () => undefined);
    const onResolved = vi.fn();

    const el = mountLastPageResumePrompt(record, {
      doc: document,
      win: window,
      clearRecord,
      onResolved,
    });

    expect(el).toBeTruthy();
    expect(document.getElementById('dashboard-last-page-resume')).toBeTruthy();

    await vi.advanceTimersByTimeAsync(LAST_PAGE_RESUME_AUTO_HIDE_MS - 1);
    expect(document.getElementById('dashboard-last-page-resume')).toBeTruthy();
    expect(clearRecord).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(document.getElementById('dashboard-last-page-resume')).toBeNull();
    expect(clearRecord).toHaveBeenCalledTimes(1);
    expect(onResolved).toHaveBeenCalledTimes(1);
  });

  it('cancels auto-hide when user dismisses early', async () => {
    const clearRecord = vi.fn(async () => undefined);
    const onResolved = vi.fn();

    const el = mountLastPageResumePrompt(record, {
      doc: document,
      win: window,
      clearRecord,
      onResolved,
      autoHideMs: 5000,
    });
    expect(el).toBeTruthy();

    el!.querySelector<HTMLButtonElement>('[data-action="dismiss"]')?.click();
    await Promise.resolve();

    expect(document.getElementById('dashboard-last-page-resume')).toBeNull();
    expect(clearRecord).toHaveBeenCalledTimes(1);
    expect(onResolved).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(clearRecord).toHaveBeenCalledTimes(1);
    expect(onResolved).toHaveBeenCalledTimes(1);
  });

  it('autoHideMs=0 disables auto hide', async () => {
    const clearRecord = vi.fn(async () => undefined);

    mountLastPageResumePrompt(record, {
      doc: document,
      win: window,
      clearRecord,
      autoHideMs: 0,
    });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(document.getElementById('dashboard-last-page-resume')).toBeTruthy();
    expect(clearRecord).not.toHaveBeenCalled();
  });
});
