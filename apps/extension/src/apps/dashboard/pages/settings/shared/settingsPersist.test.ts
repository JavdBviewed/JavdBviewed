/**
 * @vitest-environment jsdom
 * @file settingsPersist.test.ts
 * @description React 设置页公共持久化 Hook 回归测试
 * @module apps/dashboard/pages/settings/shared
 */
import { act, createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedSettingsSave } from './settingsPersist';

type SaveHarnessProps = {
  value: string;
  persist: (value: string) => Promise<void>;
};

function SaveHarness({ value, persist }: SaveHarnessProps) {
  const { scheduleSave } = useDebouncedSettingsSave({
    delayMs: 1000,
    persist,
  });

  useEffect(() => {
    scheduleSave(value);
  }, [scheduleSave, value]);

  return null;
}

describe('useDebouncedSettingsSave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('页面在防抖期内卸载时仍会写入最后一次设置', async () => {
    const persist = vi.fn(async () => undefined);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(SaveHarness, { value: 'latest', persist }));
    });
    expect(persist).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });

    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith('latest');
  });

  it('连续修改时只保存防抖窗口内的最新值', async () => {
    const persist = vi.fn(async () => undefined);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(SaveHarness, { value: 'first', persist }));
    });
    await act(async () => {
      root.render(createElement(SaveHarness, { value: 'latest', persist }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith('latest');

    await act(async () => {
      root.unmount();
    });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('前一次异步写入未完成时会串行保存新值', async () => {
    let resolveFirst: (() => void) | undefined;
    const persist = vi.fn((value: string): Promise<void> => {
      if (value !== 'first') return Promise.resolve();
      return new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });
    });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(SaveHarness, { value: 'first', persist }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(persist).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(createElement(SaveHarness, { value: 'latest', persist }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(persist).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst?.();
      await Promise.resolve();
    });
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenLastCalledWith('latest');

    await act(async () => {
      root.unmount();
    });
  });
});
