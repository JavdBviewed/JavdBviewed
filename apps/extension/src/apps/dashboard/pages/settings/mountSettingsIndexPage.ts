/**
 * @file mountSettingsIndexPage.ts
 * @description 将设置中心 React 入口页挂到 #tab-settings
 * @module apps/dashboard/pages/settings
 */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { SettingsIndexPage } from './SettingsIndexPage';
import {
  clearSettingsReactRoot,
  getSettingsReactRoot,
  setSettingsReactRoot,
} from './settingsReactRoots';
import '../../../../ui/styles/globals.css';

/**
 * 挂载设置索引页（会先卸掉同宿主上的子页/旧索引 root）
 */
export function mountSettingsIndexPage(hostSelector = '#tab-settings'): void {
  const host = document.querySelector(hostSelector);
  if (!host) {
    throw new Error(`[SettingsIndex] missing host ${hostSelector}`);
  }

  const existing = getSettingsReactRoot(host);
  if (existing?.kind === 'index' && existing.mountEl.matches('[data-settings-react-root="1"]')) {
    return;
  }

  clearSettingsReactRoot(host);
  host.innerHTML = '';

  const mount = document.createElement('div');
  mount.dataset.settingsReactRoot = '1';
  mount.className = 'settings-index';
  host.appendChild(mount);

  const root = createRoot(mount);
  setSettingsReactRoot(host, 'index', root, mount);

  flushSync(() => {
    root.render(createElement(SettingsIndexPage));
  });
}

/**
 * 卸载设置索引 React 树
 */
export function unmountSettingsIndexPage(hostSelector = '#tab-settings'): void {
  const host = document.querySelector(hostSelector);
  if (!host) return;
  clearSettingsReactRoot(host);
}
