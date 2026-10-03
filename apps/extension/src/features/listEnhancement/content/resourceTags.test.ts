// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

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

  it('recognizes English-locale native tags (site UI i18n: CnSub DL / DL / Today)', () => {
    document.body.innerHTML = `
      <div class="item">
        <div class="tags has-addons">
          <span class="tag is-warning">CnSub DL</span>
        </div>
      </div>
      <div class="item" id="dl-only">
        <div class="tags has-addons">
          <span class="tag is-success">DL</span>
        </div>
      </div>
      <div class="item" id="today-only">
        <div class="tags has-addons">
          <span class="tag is-info">Today</span>
        </div>
      </div>`;

    const cnsub = document.querySelector<HTMLElement>('.item');
    const dl = document.querySelector<HTMLElement>('#dl-only');
    const today = document.querySelector<HTMLElement>('#today-only');
    if (!cnsub || !dl || !today) throw new Error('test fixture items are missing');

    // CnSub DL = 含中字磁鏈：同时具备字幕与磁链证据
    expect(parseNativeResourceTags(cnsub)).toEqual({
      hasSubtitle: true,
      hasMagnet: true,
      hasNewMagnet: false,
    });
    // DL = 含磁鏈
    expect(parseNativeResourceTags(dl)).toEqual({
      hasSubtitle: false,
      hasMagnet: true,
      hasNewMagnet: false,
    });
    // Today = 今日新種
    expect(parseNativeResourceTags(today)).toEqual({
      hasSubtitle: false,
      hasMagnet: false,
      hasNewMagnet: true,
    });

    renderResourceTags(cnsub, true, null, Date.now());
    expect(cnsub.querySelector('.jdb-resource-tag')?.textContent).toBe('中字');
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
      path.join(__dirname, '../../../../../../tests/fixtures/offline-pages/01.html'),
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
