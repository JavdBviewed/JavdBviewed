/**
 * @file mountReactSettingsPage.ts
 * @description 通用设置 React 页挂载（flushSync + settingsReactRoots）
 * @module apps/dashboard/pages/settings/shared
 */
import { createElement, type ComponentType, type ReactElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import {
  clearSettingsReactRoot,
  getSettingsReactRoot,
  setSettingsReactRoot,
  type SettingsReactKind,
} from '../settingsReactRoots';
import '../settingsSubpageShell.css';
import '../../../../../ui/styles/globals.css';

export type MountReactSettingsPageOptions = {
  hostSelector?: string;
  kind?: SettingsReactKind;
  /** React 组件 或 已构造的 element */
  element: ComponentType | ReactElement | (() => ReactNode);
  /** 挂载节点额外 data 属性（不含 data- 前缀也可，键名原样写入 dataset） */
  markerAttr?: string;
  markerValue?: string;
  mountDataset?: Record<string, string>;
};

/**
 * 在指定宿主挂载设置 React 页
 */
export function mountReactSettingsPage(options: MountReactSettingsPageOptions): void {
  const hostSelector = options.hostSelector || '#tab-settings';
  const kind = options.kind || 'subpage';
  const host = document.querySelector(hostSelector);
  if (!host) {
    throw new Error(`[mountReactSettingsPage] missing host ${hostSelector}`);
  }

  const existing = getSettingsReactRoot(host);
  const existingMount = existing?.mountEl;
  const sameMarker = !options.markerAttr
    || existingMount?.getAttribute(options.markerAttr) === (options.markerValue ?? '1');
  if (existing?.kind === kind && existingMount && sameMarker) {
    return;
  }

  clearSettingsReactRoot(host);
  host.innerHTML = '';

  const mount = document.createElement('div');
  mount.dataset.settingsSubpageRoot = '1';
  if (options.markerAttr) {
    mount.setAttribute(options.markerAttr, options.markerValue ?? '1');
  }
  if (options.mountDataset) {
    for (const [k, v] of Object.entries(options.mountDataset)) {
      mount.dataset[k] = v;
    }
  }
  host.appendChild(mount);

  const root = createRoot(mount);
  setSettingsReactRoot(host, kind, root, mount);

  const el = options.element;
  let node: ReactElement;
  if (typeof el === 'function') {
    // ComponentType 或 render fn
    node = createElement(el as ComponentType);
  } else {
    node = el as ReactElement;
  }

  flushSync(() => {
    root.render(node);
  });
}

/**
 * 卸载设置 React 页
 */
export function unmountReactSettingsPage(hostSelector = '#tab-settings'): void {
  const host = document.querySelector(hostSelector);
  if (!host) return;
  clearSettingsReactRoot(host);
}
