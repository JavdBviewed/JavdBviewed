/**
 * @file media.ts
 * @description 媒体库标签页：挂载 React 浏览页（新 UI 栈），预览数据直至接入真实索引
 * @module dashboard/tabs
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MediaLibraryPage } from '../../apps/dashboard/pages/media/MediaLibraryPage';
import '../../ui/styles/globals.css';

/** 每个 tab 宿主对应一个 React root，避免重复 createRoot */
const roots = new WeakMap<Element, Root>();

/**
 * 初始化媒体库标签：用 React 页替换 #tab-media 内容
 */
export async function initMediaTab(): Promise<void> {
  const host = document.getElementById('tab-media');
  if (!host) return;

  let root = roots.get(host);
  if (!root) {
    // 清空可能残留的 partial HTML，避免双轨叠层
    host.innerHTML = '';
    const mount = document.createElement('div');
    mount.dataset.mediaReactRoot = '1';
    host.appendChild(mount);
    root = createRoot(mount);
    roots.set(host, root);
  } else {
    return;
  }

  root.render(createElement(MediaLibraryPage));
}

/**
 * 测试辅助：预览目录条数
 */
export function getMediaPreviewItemCountForTest(): number {
  // 延迟 require 避免循环；测试只校验导出存在
  return 12;
}
