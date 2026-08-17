// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  parseNativeResourceTags,
  renderResourceTagsForItems,
  renderResourceTags,
  resolveResourceTags,
} from './resourceTags';

describe('list resource tags', () => {
  const storage = new Map<string, unknown>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get(key: string | string[], callback?: (value: Record<string, unknown>) => void) {
            const storageKey = Array.isArray(key) ? key[0] : key;
            const value = { [storageKey]: storage.get(storageKey) };
            callback?.(value);
            return Promise.resolve(value);
          },
          set(entries: Record<string, unknown>, callback?: () => void) {
            Object.entries(entries).forEach(([key, value]) => storage.set(key, value));
            callback?.();
            return Promise.resolve();
          },
        },
      },
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('uses native list evidence without requiring a detail-page cache', () => {
    document.body.innerHTML = `
      <div class="item">
        <div class="tags has-addons">
          <span class="tag is-success">含磁鏈</span>
          <span class="tag is-info">今日新種</span>
          <span class="tag">含字幕</span>
          <a class="tag emby-library-status-tag">Emby已入库</a>
        </div>
      </div>`;
    const item = document.querySelector<HTMLElement>('.item');
    if (!item) throw new Error('test fixture item is missing');

    expect(parseNativeResourceTags(item)).toEqual({
      hasSubtitle: true,
      hasMagnet: true,
      hasNewMagnet: true,
    });
    expect(resolveResourceTags(parseNativeResourceTags(item), null, Date.now())).toEqual([
      { key: 'subtitle', text: '中字' },
    ]);

    renderResourceTags(item, true, null, Date.now());

    expect(item.querySelectorAll('.jdb-resource-tag')).toHaveLength(1);
    expect(item.querySelector('.jdb-resource-tag')?.textContent).toBe('中字');
    expect(item.querySelector('.emby-library-status-tag')?.textContent).toBe('Emby已入库');
  });

  it('renders cached tags for a card batch with one storage read and removes only its own tags when disabled', async () => {
    document.body.innerHTML = `
      <div class="item" id="first"><div class="tags has-addons"><span class="tag">含字幕</span></div></div>
      <div class="item" id="second"><div class="tags has-addons"><a class="tag emby-library-status-tag">Emby已入库</a></div></div>`;
    storage.set('resourceTagIndex', {
      'ABF-326': { isCracked: true, observedAt: 1000 },
      'IPZZ-999': { hasSubtitle: true, observedAt: 1000 },
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const get = vi.spyOn(chrome.storage.local, 'get');
    const first = document.querySelector<HTMLElement>('#first');
    const second = document.querySelector<HTMLElement>('#second');
    if (!first || !second) throw new Error('test fixture cards are missing');

    await renderResourceTagsForItems([
      { item: first, videoId: 'ABF-326' },
      { item: second, videoId: 'IPZZ-999' },
    ], true, 1000);

    expect(get).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(first.querySelectorAll('.jdb-resource-tag')).toHaveLength(2);
    expect(second.querySelector('.jdb-resource-tag')?.textContent).toBe('中字');

    await renderResourceTagsForItems([{ item: second, videoId: 'IPZZ-999' }], false, 1000);
    expect(second.querySelector('.jdb-resource-tag')).toBeNull();
    expect(second.querySelector('.emby-library-status-tag')?.textContent).toBe('Emby已入库');
  });

  it('keeps native magnet and new-magnet evidence intact in the saved JavDB list fixture', () => {
    document.body.innerHTML = readFileSync(
      'test-results/performance/local-session-capture/pages-offline/01.html',
      'utf8',
    );
    const item = document.querySelector<HTMLElement>('.movie-list .item');
    if (!item) throw new Error('offline JavDB list fixture has no card');

    expect(parseNativeResourceTags(item)).toEqual({
      hasSubtitle: false,
      hasMagnet: true,
      hasNewMagnet: true,
    });

    renderResourceTags(item, true, null, 1000);

    expect(item.textContent).toContain('含磁鏈');
    expect(item.textContent).toContain('今日新種');
    expect(item.querySelector('.jdb-resource-tag')).toBeNull();
  });
});
