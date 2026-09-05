/**
 * @file settingsDashboardReactivation.dom.test.tsx
 * @description 设置子页 / 索引页「重复激活」防回归：
 * 1. BaseSettingsPanel 在 DOM 被重建（子页壳卸载再挂）后再次 init()，
 *    必须把事件重绑到新元素、旧元素绑定失效且新元素不重复绑定；
 * 2. mountSettingsIndexPage 同一宿主重复挂载不产生双 React 树，
 *    模拟 tab 隐藏清理后再激活可重新渲染。
 * @module tests/dom
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STATE } from '../../apps/extension/src/dashboard/state';
import { BaseSettingsPanel } from '../../apps/extension/src/dashboard/tabs/settings/base/BaseSettingsPanel';
import type {
  SettingsSaveResult,
  SettingsValidationResult,
} from '../../apps/extension/src/dashboard/tabs/settings/types';

vi.mock('../../apps/extension/src/utils/storage', () => ({
  getSettings: vi.fn(async () => STATE.settings),
  saveSettings: vi.fn(async () => undefined),
}));

import {
  clearSettingsReactRoot,
  getSettingsReactRoot,
} from '../../apps/extension/src/apps/dashboard/pages/settings/settingsReactRoots';
import { mountSettingsIndexPage } from '../../apps/extension/src/apps/dashboard/pages/settings/mountSettingsIndexPage';

describe('BaseSettingsPanel 子页重复激活（DOM 重建后重绑事件）', () => {
  let changeCount = 0;

  class ReinitTestPanel extends BaseSettingsPanel {
    private el: HTMLInputElement | null = null;

    constructor() {
      super({
        panelId: 'reinit-test-settings',
        panelName: '重入测试设置',
        autoSave: false,
        saveDelay: 0,
        requireValidation: false,
      });
    }

    protected initializeElements(): void {
      const el = document.getElementById('reinit-test-toggle') as HTMLInputElement | null;
      if (!el) throw new Error('reinit-test-toggle 元素未找到');
      this.el = el;
    }

    protected bindEvents(): void {
      const signal = this.createEventBindingSignal();
      this.el!.addEventListener('change', () => { changeCount += 1; }, { signal });
    }

    protected unbindEvents(): void {
      this.unbindManagedEvents();
    }

    protected async doLoadSettings(): Promise<void> {
      this.el!.checked = Boolean((STATE.settings as Record<string, unknown>).reinitFlag);
    }

    protected async doSaveSettings(): Promise<SettingsSaveResult> {
      return { success: true };
    }

    protected doValidateSettings(): SettingsValidationResult {
      return { isValid: true };
    }

    protected doGetSettings(): Record<string, unknown> {
      return { reinitFlag: this.el?.checked ?? false };
    }

    protected doSetSettings(settings: Record<string, unknown>): void {
      if (typeof settings.reinitFlag === 'boolean') this.el!.checked = settings.reinitFlag;
    }
  }

  function mountPanelDom(v: number): HTMLInputElement {
    const host = document.createElement('div');
    host.id = 'reinit-test-settings';
    host.dataset.domVersion = String(v);
    document.body.appendChild(host);
    const input = document.createElement('input');
    input.id = 'reinit-test-toggle';
    input.type = 'checkbox';
    host.appendChild(input);
    return input;
  }

  beforeEach(() => {
    changeCount = 0;
    document.body.innerHTML = '';
    STATE.settings = { reinitFlag: true } as typeof STATE.settings;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('DOM 重建后再次 init：新元素同步值且恰好绑定一次，旧元素绑定失效', async () => {
    const firstEl = mountPanelDom(1);
    const panel = new ReinitTestPanel();
    await panel.init();

    // 首次挂载：值同步（loadSettings 为异步，等待完成）+ 事件生效
    await vi.waitFor(() => expect(firstEl.checked).toBe(true));
    firstEl.dispatchEvent(new Event('change'));
    expect(changeCount).toBe(1);

    // 模拟设置子页壳卸载（lifecycle onHidden：clearRoot + replaceChildren）后 partial 重新注入
    const host = document.getElementById('reinit-test-settings')!;
    host.replaceChildren();
    const secondEl = (() => {
      const input = document.createElement('input');
      input.id = 'reinit-test-toggle';
      input.type = 'checkbox';
      host.appendChild(input);
      return input;
    })();
    expect(secondEl).not.toBe(firstEl);

    // registry 每次激活都会再调一次 init
    await panel.init();

    // 新元素：值重新同步、事件恰好绑定一次（无重复、无遗漏）
    await vi.waitFor(() => expect(secondEl.checked).toBe(true));
    secondEl.dispatchEvent(new Event('change'));
    expect(changeCount).toBe(2);

    // 旧（已脱离文档的）元素：绑定已随 signal abort 失效
    firstEl.dispatchEvent(new Event('change'));
    expect(changeCount).toBe(2);
  });
});

describe('mountSettingsIndexPage 索引页挂载防重', () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'tab-settings';
    document.body.appendChild(host);
  });

  afterEach(() => {
    clearSettingsReactRoot(host);
    host.remove();
  });

  it('同一宿主重复挂载不产生双 React 树', () => {
    act(() => { mountSettingsIndexPage('#tab-settings'); });
    const firstMount = host.querySelector('[data-settings-react-root="1"]')!;
    const firstNavCount = host.querySelectorAll('.si-page').length;
    expect(firstNavCount).toBe(1);

    act(() => { mountSettingsIndexPage('#tab-settings'); });

    // 仍是同一挂载节点、同一棵页面树
    expect(host.querySelector('[data-settings-react-root="1"]')).toBe(firstMount);
    expect(host.querySelectorAll('.si-page').length).toBe(1);
    expect(getSettingsReactRoot(host)?.kind).toBe('index');
  });

  it('模拟 tab 隐藏清理后再激活可重新渲染索引页', () => {
    act(() => { mountSettingsIndexPage('#tab-settings'); });
    expect(host.querySelector('.si-page')).not.toBeNull();

    // settings lifecycle onHidden 行为：清 React root + 清空宿主
    clearSettingsReactRoot(host);
    host.replaceChildren();
    expect(host.querySelector('[data-settings-react-root="1"]')).toBeNull();
    expect(getSettingsReactRoot(host)).toBeUndefined();

    // 再次激活：重新挂载成功（不 early-return 到旧节点）
    act(() => { mountSettingsIndexPage('#tab-settings'); });
    expect(host.querySelector('.si-page')).not.toBeNull();
    expect(host.querySelectorAll('[data-settings-react-root="1"]').length).toBe(1);
  });
});
