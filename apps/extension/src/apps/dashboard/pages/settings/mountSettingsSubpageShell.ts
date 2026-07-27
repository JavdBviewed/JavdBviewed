/**
 * @file mountSettingsSubpageShell.ts
 * @description 挂载设置子页 React 壳，并以 React 方式注入遗留 HTML
 * @module apps/dashboard/pages/settings
 *
 * 注意：不要在此 import Tailwind globals.css。
 * Preflight 会重置 button/卡片边框与 transform，破坏遗留页面已微调样式。
 */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { SettingsSubpageShell } from './SettingsSubpageShell';
import {
  clearSettingsReactRoot,
  setSettingsReactRoot,
} from './settingsReactRoots';
import { prepareLegacySettingsSectionNav } from './shared/legacySettingsSectionNav';
import './settingsSubpageShell.css';

export type MountSettingsSubpageOptions = {
  title: string;
  description?: string;
  /** partial 原始 HTML */
  panelHtml: string;
  /** 注入后应存在的面板根 id（校验用） */
  panelRootId?: string;
  hostSelector?: string;
};

/**
 * 在 #tab-settings 挂载壳并注入面板 HTML
 *
 * @returns 面板内容宿主元素
 */
export function mountSettingsSubpageShell(options: MountSettingsSubpageOptions): HTMLElement {
  const hostSelector = options.hostSelector || '#tab-settings';
  const host = document.querySelector(hostSelector);
  if (!host) {
    throw new Error(`[SettingsSubpage] missing host ${hostSelector}`);
  }

  // 卸掉索引页或上一个子页
  clearSettingsReactRoot(host);
  host.innerHTML = '';

  const mount = document.createElement('div');
  mount.dataset.settingsSubpageRoot = '1';
  host.appendChild(mount);

  const bodyHostId = 'settings-panel-body-host';
  const prepared = prepareLegacySettingsSectionNav(
    options.panelHtml,
    options.panelRootId || 'settings',
  );
  const root = createRoot(mount);
  setSettingsReactRoot(host, 'subpage', root, mount);

  // 同步提交：partial 走 dangerouslySetInnerHTML，随后 init 能立刻 getElementById
  flushSync(() => {
    root.render(
      createElement(SettingsSubpageShell, {
        title: options.title,
        description: options.description,
        panelHtml: prepared.panelHtml,
        bodyHostId,
        sectionNavItems: prepared.items.length > 0 ? prepared.items : undefined,
      }),
    );
  });

  const body = document.getElementById(bodyHostId);
  if (!body) {
    throw new Error('[SettingsSubpage] body host missing after render');
  }

  // 仅校验面板根节点；具体控件由各 BaseSettingsPanel 自己负责
  if (options.panelRootId && !body.querySelector(`#${options.panelRootId}`)) {
    console.warn('[SettingsSubpage] panel root id not found in HTML:', options.panelRootId);
  }

  return body;
}

/**
 * 卸载子页 React 壳
 */
export function unmountSettingsSubpageShell(hostSelector = '#tab-settings'): void {
  const host = document.querySelector(hostSelector);
  if (!host) return;
  clearSettingsReactRoot(host);
}
