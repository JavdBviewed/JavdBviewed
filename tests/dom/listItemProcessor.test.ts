/**
 * @file listItemProcessor.test.ts
 * @description list item processor 测试
 * @module tests/dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STATE } from '../../apps/extension/src/features/contentState';
import { VIDEO_STATUS } from '../../apps/extension/src/utils/config';
import type { VideoRecord } from '../../apps/extension/src/types';
import { processVisibleItems } from '../../apps/extension/src/features/listEnhancement/content/itemProcessor';

vi.mock('../../apps/extension/src/features/videoDetail', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/extension/src/features/videoDetail')>();
  return {
    ...actual,
    isPageProperlyLoaded: vi.fn(() => true),
  };
});

function createRecord(id: string, status: VideoRecord['status']): VideoRecord {
  return {
    id,
    title: `Title ${id}`,
    status,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function renderListItem(videoId: string, extraTitle = ''): HTMLElement {
  const item = document.createElement('div');
  item.className = 'item';
  item.innerHTML = `
    <div class="video-title">
      <strong>${videoId}</strong>
      <span>${extraTitle}</span>
    </div>
    <div class="tags has-addons"></div>
  `;
  document.body.appendChild(item);
  return item;
}

async function waitForListItemProcessing(item: HTMLElement): Promise<void> {
  await vi.waitFor(() => {
    expect(item.getAttribute('data-processed')).toBe('true');
  });
}

describe('list item processor', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div class="movie-list"></div>';
    STATE.settings = {
      display: {
        hideViewed: false,
        hideBrowsed: false,
        hideWant: false,
        hideVR: false,
      },
      listEnhancement: {
        showStatusBadge: true,
      },
    } as any;
    STATE.records = {};
    STATE.isSearchPage = false;
    STATE.observer?.disconnect();
    STATE.observer = null;
    if (STATE.debounceTimer) {
      window.clearTimeout(STATE.debounceTimer);
      STATE.debounceTimer = null;
    }
  });

  afterEach(() => {
    STATE.observer?.disconnect();
    STATE.observer = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('adds a viewed status badge for known records', async () => {
    const list = document.querySelector('.movie-list')!;
    list.appendChild(renderListItem('ABC-001'));
    STATE.records = {
      'ABC-001': createRecord('ABC-001', VIDEO_STATUS.VIEWED),
    };

    processVisibleItems();

    const tag = document.querySelector('.custom-status-tag');
    expect(tag?.textContent).toBe('已观看');
    expect(tag?.className).toContain('is-success');
  });

  it('hides VR list items when the display setting is enabled', async () => {
    const list = document.querySelector('.movie-list')!;
    const item = renderListItem('ABC-002', 'Sample 【VR】');
    list.appendChild(item);
    (STATE.settings as any).display.hideVR = true;

    processVisibleItems();
    await waitForListItemProcessing(item);

    expect(item.style.display).toBe('none');
    expect(item.getAttribute('data-hidden-by-default')).toBe('true');
    expect(item.getAttribute('data-hide-reason')).toBe('VR');
  });

  it('hides records by status according to display settings', async () => {
    const list = document.querySelector('.movie-list')!;
    const item = renderListItem('ABC-003');
    list.appendChild(item);
    STATE.records = {
      'ABC-003': createRecord('ABC-003', VIDEO_STATUS.BROWSED),
    };
    (STATE.settings as any).display.hideBrowsed = true;

    processVisibleItems();

    expect(item.style.display).toBe('none');
    expect(item.getAttribute('data-hidden-by-default')).toBe('true');
    expect(item.getAttribute('data-hide-reason')).toBe('BROWSED');
  });

  it('adds Emby and Jellyfin library badges for indexed list items', async () => {
    const list = document.querySelector('.movie-list')!;
    const item = renderListItem('ABC-004');
    list.appendChild(item);
    (STATE.settings as any).libraryMatchStatus = {
      enabled: true,
      sources: { drive115: true, emby: true },
    };
    (STATE.settings as any).emby = {
      mediaServers: [
        {
          id: 'emby-main',
          type: 'emby',
          name: 'Main Emby',
          url: 'http://emby.local:8096',
          apiKey: 'secret',
          enabled: true,
        },
        {
          id: 'jf-main',
          type: 'jellyfin',
          name: 'Main Jellyfin',
          url: 'http://jf.local:8096',
          apiKey: 'secret',
          enabled: true,
        },
      ],
      libraryStatus: {
        enabled: false,
        showOnList: true,
      },
    };
    (STATE as any).embyLibraryState = {
      entries: {
        'ABC-004': [
          {
            serverType: 'emby',
            serverName: 'Main Emby',
            serverUrl: 'http://emby.local:8096',
            itemId: 'emby-item',
            serverId: 'emby-server',
            itemName: 'ABC-004',
            updatedAt: 100,
          },
          {
            serverType: 'jellyfin',
            serverName: 'Main Jellyfin',
            serverUrl: 'http://jf.local:8096',
            itemId: 'jf-item',
            serverId: 'jf-server',
            itemName: 'ABC-004',
            updatedAt: 100,
          },
        ],
      },
      updatedAt: 100,
    };

    processVisibleItems();
    await waitForListItemProcessing(item);

    const badges = Array.from(document.querySelectorAll<HTMLAnchorElement>('.emby-library-status-tag'));
    expect(badges.map((badge) => badge.textContent)).toEqual(['Emby已入库', 'Jellyfin已入库']);
    expect(badges[0].href).toBe('http://emby.local:8096/web/index.html#!/item?id=emby-item&serverId=emby-server');
    expect(badges[1].href).toBe('http://jf.local:8096/web/index.html#!/details?id=jf-item&serverId=jf-server');
  });

  it('skips library badges when library status is disabled', async () => {
    const list = document.querySelector('.movie-list')!;
    list.appendChild(renderListItem('ABC-005'));
    (STATE.settings as any).emby = {
      libraryStatus: {
        enabled: false,
        showOnList: true,
      },
    };
    (STATE as any).embyLibraryState = {
      entries: {
        'ABC-005': [
          {
            serverType: 'emby',
            serverName: 'Main Emby',
            serverUrl: 'http://emby.local:8096',
            itemId: 'emby-item',
            itemName: 'ABC-005',
            updatedAt: 100,
          },
        ],
      },
      updatedAt: 100,
    };

    processVisibleItems();

    expect(document.querySelector('.emby-library-status-tag')).toBeNull();
  });

  it('skips list status quick actions when the switch is disabled', () => {
    const list = document.querySelector('.movie-list')!;
    list.appendChild(renderBoxListItem('ABC-006'));
    (STATE.settings as any).listEnhancement.enableStatusQuickAction = false;

    processVisibleItems();

    expect(document.querySelector('.jdb-list-status-actions')).toBeNull();
  });

  it('renders visible list status quick actions in the bottom-right of the card link', () => {
    const list = document.querySelector('.movie-list')!;
    const item = renderBoxListItem('ABC-007');
    list.appendChild(item);
    (STATE.settings as any).listEnhancement.enableStatusQuickAction = true;
    STATE.records = {
      'ABC-007': createRecord('ABC-007', VIDEO_STATUS.WANT),
    };

    processVisibleItems();

    const link = item.querySelector('a.box')!;
    const actions = item.querySelector('.jdb-list-status-actions') as HTMLElement | null;
    const style = document.getElementById('jdb-list-status-actions-style')?.textContent || '';
    expect(actions?.parentElement).toBe(link);
    expect(actions?.classList.contains('pos-bottom-right')).toBe(true);
    expect(Array.from(actions?.querySelectorAll('button') || []).map(button => button.textContent)).toEqual(['已阅', '想看', '已看']);
    expect(style).toContain('right: 8px');
    expect(style).toContain('opacity: 0.92');
    expect(style).not.toContain('opacity: 0;');
    expect(style).not.toContain('outline:');
    expect(actions?.querySelector('[data-status="want"]')?.classList.contains('is-active')).toBe(true);
  });

  it('updates the local record when a list status quick action is clicked', async () => {
    const list = document.querySelector('.movie-list')!;
    const item = renderBoxListItem('ABC-008');
    list.appendChild(item);
    (STATE.settings as any).listEnhancement.enableStatusQuickAction = true;

    processVisibleItems();
    await waitForListItemProcessing(item);

    const button = item.querySelector<HTMLButtonElement>('.jdb-list-status-action[data-status="viewed"]')!;
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    button.dispatchEvent(clickEvent);
    await Promise.resolve();
    await Promise.resolve();

    expect(clickEvent.defaultPrevented).toBe(true);
    expect(STATE.records['ABC-008']?.status).toBe(VIDEO_STATUS.VIEWED);
    expect(button.classList.contains('is-active')).toBe(true);
    expect(document.querySelector('.custom-status-tag')?.textContent).toBe('已观看');
    expect((chrome.runtime.sendMessage as any).mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'DB:VIEWED_PUT',
      payload: {
        record: {
          id: 'ABC-008',
          status: VIDEO_STATUS.VIEWED,
        },
      },
    });
  });

  it('skips list favorite quick action when the switch is disabled', () => {
    const list = document.querySelector('.movie-list')!;
    list.appendChild(renderBoxListItem('ABC-009'));
    (STATE.settings as any).listEnhancement.enableListFavoriteQuickAction = false;

    processVisibleItems();

    expect(document.querySelector('.jdb-list-favorite-actions')).toBeNull();
    expect(document.querySelector('.jdb-list-favorite-action')).toBeNull();
  });

  it('renders list favorite quick action when the switch is enabled', async () => {
    const list = document.querySelector('.movie-list')!;
    const item = renderBoxListItem('ABC-010');
    list.appendChild(item);
    (STATE.settings as any).listEnhancement.enableListFavoriteQuickAction = true;

    processVisibleItems();
    await waitForListItemProcessing(item);

    const link = item.querySelector('a.box');
    const actions = item.querySelector('.jdb-list-favorite-actions');
    const button = item.querySelector<HTMLButtonElement>('.jdb-list-favorite-action');
    expect(actions?.parentElement).toBe(link);
    expect(actions?.classList.contains('pos-top-right')).toBe(true);
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    expect(button?.textContent).toBe('♡');
    expect(button?.title).toBe('添加到收藏');
  });

  it('writes favorite state and favoritedAt when a list favorite quick action is clicked', async () => {
    const list = document.querySelector('.movie-list')!;
    const item = renderBoxListItem('ABC-011');
    list.appendChild(item);
    (STATE.settings as any).listEnhancement.enableListFavoriteQuickAction = true;

    processVisibleItems();
    await waitForListItemProcessing(item);

    const button = item.querySelector<HTMLButtonElement>('.jdb-list-favorite-action')!;
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    button.dispatchEvent(clickEvent);
    await Promise.resolve();
    await Promise.resolve();

    const record = STATE.records['ABC-011'];
    expect(clickEvent.defaultPrevented).toBe(true);
    expect(record?.isFavorite).toBe(true);
    expect(record?.favoritedAt).toEqual(expect.any(Number));
    expect(record?.status).toBe(VIDEO_STATUS.BROWSED);
    expect(button.classList.contains('is-active')).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.textContent).toBe('♥');
    expect(button.title).toBe('取消收藏');
    expect((chrome.runtime.sendMessage as any).mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'DB:VIEWED_PUT',
      payload: {
        record: {
          id: 'ABC-011',
          isFavorite: true,
          favoritedAt: expect.any(Number),
        },
      },
    });
  });

  it('clears favorite state and favoritedAt when a list favorite quick action is clicked again', async () => {
    const list = document.querySelector('.movie-list')!;
    const item = renderBoxListItem('ABC-012');
    list.appendChild(item);
    (STATE.settings as any).listEnhancement.enableListFavoriteQuickAction = true;
    STATE.records = {
      'ABC-012': {
        ...createRecord('ABC-012', VIDEO_STATUS.WANT),
        isFavorite: true,
        favoritedAt: 12345,
      },
    };

    processVisibleItems();

    const button = item.querySelector<HTMLButtonElement>('.jdb-list-favorite-action')!;
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    button.dispatchEvent(clickEvent);
    await Promise.resolve();
    await Promise.resolve();

    const record = STATE.records['ABC-012'];
    expect(clickEvent.defaultPrevented).toBe(true);
    expect(record?.status).toBe(VIDEO_STATUS.WANT);
    expect(record?.isFavorite).toBe(false);
    expect(record?.favoritedAt).toBeUndefined();
    expect(button.classList.contains('is-active')).toBe(false);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.textContent).toBe('♡');
    expect(button.title).toBe('添加到收藏');
    const savedRecord = (chrome.runtime.sendMessage as any).mock.calls.at(-1)?.[0]?.payload?.record;
    expect(savedRecord).toMatchObject({
      id: 'ABC-012',
      status: VIDEO_STATUS.WANT,
      isFavorite: false,
    });
    expect(savedRecord).not.toHaveProperty('favoritedAt');
  });

  it('keeps favorite and status quick action containers separate when both switches are enabled', async () => {
    const list = document.querySelector('.movie-list')!;
    const item = renderBoxListItem('ABC-013');
    list.appendChild(item);
    (STATE.settings as any).listEnhancement.enableListFavoriteQuickAction = true;
    (STATE.settings as any).listEnhancement.enableStatusQuickAction = true;

    processVisibleItems();
    await waitForListItemProcessing(item);

    const favoriteActions = item.querySelector('.jdb-list-favorite-actions');
    const statusActions = item.querySelector('.jdb-list-status-actions');
    expect(favoriteActions).not.toBeNull();
    expect(statusActions).not.toBeNull();
    expect(favoriteActions).not.toBe(statusActions);
    expect(favoriteActions?.classList.contains('pos-top-right')).toBe(true);
    expect(statusActions?.classList.contains('pos-bottom-right')).toBe(true);
  });
});

function renderBoxListItem(videoId: string): HTMLElement {
  const item = document.createElement('div');
  item.className = 'item';
  item.innerHTML = `
    <a href="/v/${videoId.toLowerCase()}" class="box" title="Title ${videoId}">
      <div class="cover contain x-cover x-preview">
        <img loading="lazy" src="https://example.test/${videoId}.jpg">
      </div>
      <div class="video-title x-ellipsis x-title">
        <span class="x-btn" title="列表功能" data-code="${videoId}" data-title="Title ${videoId}"></span>
        <strong>${videoId}</strong> Title ${videoId}
      </div>
      <div class="tags has-addons"></div>
    </a>
  `;
  return item;
}
