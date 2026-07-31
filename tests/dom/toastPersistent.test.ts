/**
 * @file toastPersistent.test.ts
 * @description Dashboard Toast 等待态测试
 * @module tests/dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('showPersistentMessage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="messageContainer"></div>';
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('创建等待结果返回的常驻 toast，直到主动更新为结果后才自动消失', async () => {
    const { showPersistentMessage } = await import('../../apps/extension/src/dashboard/ui/toast');

    const handle = showPersistentMessage('正在刷新 115 凭证…', 'info');
    vi.advanceTimersByTime(60_000);

    let toastEl = document.querySelector('.toast');
    expect(toastEl?.textContent).toContain('正在刷新 115 凭证…');
    expect(toastEl?.isConnected).toBe(true);

    handle.update('115 凭证刷新成功', 'success', 3000);
    toastEl = document.querySelector('.toast');
    expect(toastEl?.textContent).toContain('115 凭证刷新成功');
    expect(toastEl?.classList.contains('toast-success')).toBe(true);

    vi.advanceTimersByTime(3000);
    toastEl = document.querySelector('.toast');
    expect(toastEl?.classList.contains('show')).toBe(false);
  });
});
