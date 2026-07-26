/**
 * @file mediaLibraryPage.layout.test.ts
 * @description 媒体库页布局/行为回归：索引变更实时刷新
 * @module apps/dashboard/pages/media
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'MediaLibraryPage.tsx'), 'utf-8');

describe('MediaLibraryPage 实时刷新', () => {
  it('订阅 chrome.storage.onChanged 以在索引写入后刷新目录', () => {
    expect(source).toContain('chrome.storage.onChanged.addListener');
    expect(source).toContain('chrome.storage.onChanged.removeListener');
  });

  it('监听 115 与 Emby 本地库状态键', () => {
    expect(source).toContain('STORAGE_KEYS.DRIVE115_LIBRARY_STATE');
    expect(source).toContain('STORAGE_KEYS.EMBY_LIBRARY_STATE');
  });

  it('变更回调走防抖后调用目录刷新', () => {
    // 防抖 setTimeout + 复用既有 reloadCatalogFromStorage
    expect(source).toMatch(/setTimeout\([\s\S]*reloadCatalogFromStorage/);
    expect(source).toContain('clearTimeout');
  });

  it('仅响应 local 区且命中监听键', () => {
    expect(source).toContain("areaName !== 'local'");
    expect(source).toContain('watchedKeys.some');
  });
});
