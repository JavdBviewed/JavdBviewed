/**
 * @file enhancementSaveToast.test.tsx
 * @description 功能增强设置页纯自动保存 toast（09-30-enhancement-autosave-toast）：
 *   自动保存（1s 防抖）完成后的唯一反馈是右下角 toast——
 *   成功弹「已保存」success toast；失败弹含错误信息的 error toast，
 *   且 saveError 横幅与失败 toast 并存（同一 persist 回调汇聚全部保存路径）。
 *   共享 hook useDebouncedSettingsSave 零改动；其余 9 个设置页不受影响。
 * @module tests/dom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_ENHANCEMENT_SETTINGS_FORM,
  type EnhancementSettingsFormState,
} from '../../apps/extension/src/apps/dashboard/pages/settings/enhancement/enhancementSettingsModel';
import {
  loadEnhancementSettingsForm,
  loadLastAppliedActorTags,
  persistEnhancementForm,
  readAiSelectedModelLabel,
} from '../../apps/extension/src/apps/dashboard/pages/settings/enhancement/enhancementSettingsActions';
import { EnhancementSettingsPage } from '../../apps/extension/src/apps/dashboard/pages/settings/enhancement/EnhancementSettingsPage';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 预热 toast 的动态 import 链（actions 层真实 toast 内为动态 import，
// 预载后测试内首次调用按微任务决议，避免跨测试时序漂移）
await import('../../apps/extension/src/dashboard/ui/toast');

/**
 * 部分 mock 动作层：仅替换页面加载/持久化缝，
 * 保留真实 toast（dashboard/ui/toast 的 showMessage → #messageContainer）。
 */
vi.mock(
  '../../apps/extension/src/apps/dashboard/pages/settings/enhancement/enhancementSettingsActions',
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import('../../apps/extension/src/apps/dashboard/pages/settings/enhancement/enhancementSettingsActions')
    >();
    return {
      ...actual,
      loadEnhancementSettingsForm: vi.fn(),
      loadLastAppliedActorTags: vi.fn(),
      readAiSelectedModelLabel: vi.fn(),
      persistEnhancementForm: vi.fn(),
    };
  },
);

let host: HTMLDivElement;
let root: Root;

/** 挂载页面并在单个 act 内让「加载表单→子状态→loading=false」异步链 settle（假计时器下仅微任务）。 */
async function mountPageLoaded(): Promise<void> {
  await act(async () => {
    root.render(createElement(EnhancementSettingsPage));
    for (let i = 0; i < 40; i++) {
      await Promise.resolve();
    }
  });
}

/** 推进 1s 防抖到期并让 persist 异步链（mock 决议 + setState + toast 建 DOM）在单个 act 内 settle。 */
async function flushAutoSave(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(1100);
    for (let i = 0; i < 24; i++) {
      await Promise.resolve();
    }
  });
}

function toastOf(type: 'success' | 'error'): HTMLDivElement | null {
  return document.querySelector(`#messageContainer .toast-${type}`);
}

beforeEach(() => {
  document.body.innerHTML = '<div id="messageContainer"></div>';
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  loadEnhancementSettingsForm.mockResolvedValue(structuredClone(DEFAULT_ENHANCEMENT_SETTINGS_FORM));
  loadLastAppliedActorTags.mockResolvedValue([]);
  readAiSelectedModelLabel.mockResolvedValue('');
  persistEnhancementForm.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  // React 19：unmount 本身是一次更新，需包进 act
  act(() => {
    root.unmount();
  });
  host.remove();
  document.body.innerHTML = '';
});

describe('功能增强设置页自动保存 toast', () => {
  it('成功：防抖到期保存成功 → 右下角 success toast「已保存」', async () => {
    vi.useFakeTimers();
    persistEnhancementForm.mockResolvedValue({ ok: true });

    await mountPageLoaded();
    const settingsRoot = document.getElementById('enhancement-settings');
    expect(settingsRoot).not.toBeNull();

    const toggle = document.getElementById('hideViewed') as HTMLInputElement;
    expect(toggle).not.toBeNull();
    expect(toggle.checked).toBe(false);

    await act(async () => {
      toggle.click();
    });
    // 防抖未到期：尚未持久化
    expect(persistEnhancementForm).not.toHaveBeenCalled();

    await flushAutoSave();

    expect(persistEnhancementForm).toHaveBeenCalledTimes(1);
    const savedForm = persistEnhancementForm.mock.calls[0][0] as EnhancementSettingsFormState;
    expect(savedForm.hideViewed).toBe(true);

    // toast「show」类在 10ms 后追加，再推进一小段
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    const okToast = toastOf('success');
    expect(okToast).not.toBeNull();
    expect(okToast!.textContent).toContain('已保存');
    expect(okToast!.classList.contains('show')).toBe(true);
  });

  it('失败：持久化失败 → error toast 含错误信息 + saveError 横幅在位', async () => {
    vi.useFakeTimers();
    const errorMessage = '预览延迟须在 100–5000 ms';
    persistEnhancementForm.mockResolvedValue({ ok: false, error: errorMessage });

    await mountPageLoaded();
    const settingsRoot = document.getElementById('enhancement-settings');
    expect(settingsRoot).not.toBeNull();

    const toggle = document.getElementById('hideViewed') as HTMLInputElement;
    expect(toggle).not.toBeNull();

    await act(async () => {
      toggle.click();
    });
    await flushAutoSave();
    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    const errToast = toastOf('error');
    expect(errToast).not.toBeNull();
    expect(errToast!.textContent).toContain(errorMessage);
    expect(toastOf('success')).toBeNull();

    // saveError 横幅（持久错误态）与失败 toast 并存
    const banner = Array.from(document.querySelectorAll('#enhancement-settings p'))
      .find((p) => p.textContent === errorMessage);
    expect(banner).toBeTruthy();
    expect(banner!.className).toContain('danger');
  });
});
