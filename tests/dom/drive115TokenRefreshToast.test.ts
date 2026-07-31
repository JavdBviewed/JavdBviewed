/**
 * @file drive115TokenRefreshToast.test.ts
 * @description Dashboard 115 凭证刷新等待态 Toast 测试
 * @module tests/dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DRIVE115_TOKEN_REFRESH_EVENT,
  DRIVE115_TOKEN_REFRESH_RUNTIME_MESSAGE,
} from '../../apps/extension/src/features/drive115/v2/tokenRefreshEvents';

describe('bindUiListeners 115 refresh toast', () => {
  const listeners: Array<(message: unknown) => void> = [];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    document.body.innerHTML = '<div id="messageContainer"></div>';
    delete (window as Window & { __DRIVE115_TOKEN_REFRESH_TOAST_BOUND__?: boolean })
      .__DRIVE115_TOKEN_REFRESH_TOAST_BOUND__;
    Object.defineProperty(globalThis, 'chrome', {
      value: {
        runtime: {
          onMessage: {
            addListener: vi.fn((listener: (message: unknown) => void) => {
              listeners.push(listener);
            }),
            removeListener: vi.fn(),
          },
        },
      },
      configurable: true,
    });
  });

  afterEach(() => {
    listeners.length = 0;
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('监听 115 凭证刷新事件，并在成功前保持等待态 toast', async () => {
    const { bindUiListeners } = await import('../../apps/extension/src/dashboard/listeners/ui');

    bindUiListeners();

    window.dispatchEvent(new CustomEvent(DRIVE115_TOKEN_REFRESH_EVENT, {
      detail: { phase: 'start', at: Date.now(), source: 'auto' },
    }));
    vi.advanceTimersByTime(60_000);

    let toastEl = document.querySelector('.toast');
    expect(toastEl?.textContent).toContain('正在刷新 115 凭证');
    expect(toastEl?.isConnected).toBe(true);

    listeners.forEach((listener) => listener({
      type: DRIVE115_TOKEN_REFRESH_RUNTIME_MESSAGE,
      detail: { phase: 'success', at: Date.now(), source: 'auto', expiresIn: 7200 },
    }));

    toastEl = document.querySelector('.toast');
    expect(toastEl?.textContent).toContain('115 凭证刷新成功');
    expect(toastEl?.classList.contains('toast-success')).toBe(true);
  });

  it('忽略同一刷新结果的短时间重复事件，避免重复成功 toast', async () => {
    const { bindUiListeners } = await import('../../apps/extension/src/dashboard/listeners/ui');

    bindUiListeners();
    window.dispatchEvent(new CustomEvent(DRIVE115_TOKEN_REFRESH_EVENT, {
      detail: { phase: 'start', at: Date.now(), source: 'auto' },
    }));
    window.dispatchEvent(new CustomEvent(DRIVE115_TOKEN_REFRESH_EVENT, {
      detail: { phase: 'success', at: Date.now(), source: 'auto', expiresIn: 7200 },
    }));
    window.dispatchEvent(new CustomEvent(DRIVE115_TOKEN_REFRESH_EVENT, {
      detail: { phase: 'success', at: Date.now(), source: 'auto', expiresIn: 7200 },
    }));

    expect(document.querySelectorAll('.toast')).toHaveLength(1);
  });
});
