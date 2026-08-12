/**
 * @vitest-environment jsdom
 * @file MediaItemDetailPanel.test.tsx
 * @description 媒体详情按需请求、关闭和切换条目回归测试
 * @module apps/dashboard/pages/media
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaBrowseItem } from './mediaBrowseModel';

const { sendRuntimeMessage } = vi.hoisted(() => ({
  sendRuntimeMessage: vi.fn(),
}));

vi.mock('../../../../platform/browser/runtimeMessages', () => ({
  sendRuntimeMessage,
}));

vi.mock('../../../../ui/patterns/LazyRemoteImage/LazyRemoteImage', () => ({
  LazyRemoteImage: ({ className, alt, url }: { className?: string; alt?: string; url?: string | null }) => (
    createElement('div', {
      className,
      role: alt ? 'img' : undefined,
      'aria-label': alt,
      'data-image-url': url || '',
    })
  ),
}));

vi.mock('./HorizontalScroller', () => ({
  HorizontalScroller: ({ children, ...props }: { children?: unknown; [key: string]: unknown }) => (
    createElement('div', props, children)
  ),
}));

import { MediaItemDetailPanel } from './MediaItemDetailPanel';
import { clearDrive115CoverCache } from './drive115CoverCache';

type RuntimeMessage = {
  type?: string;
  itemId?: string;
  serverUrl?: string;
  serverId?: string;
  key?: string;
  pickCode?: string;
};

type EmbyDetail = {
  itemId: string;
  serverUrl: string;
  serverType: 'emby' | 'jellyfin';
  serverId?: string;
  name: string;
  overview?: string;
  genres: string[];
  studios: string[];
  tags: string[];
  people: Array<{ id?: string; name: string; role?: string; type?: string }>;
  mediaStreams: [];
  chapters: [];
  similar: [];
  collections: [];
};

function makeItem(overrides: Partial<MediaBrowseItem> = {}): MediaBrowseItem {
  return {
    code: 'MIDA-001',
    title: '列表标题',
    source: 'emby',
    year: '2026',
    hue: 210,
    itemId: 'emby-item-1',
    serverUrl: 'https://emby.example.test',
    serverId: 'emby-server-1',
    ...overrides,
  };
}

function makeDetail(itemId: string, name: string, serverType: 'emby' | 'jellyfin' = 'emby'): EmbyDetail {
  return {
    itemId,
    serverUrl: 'https://emby.example.test',
    serverType,
    serverId: 'emby-server-1',
    name,
    overview: `${name} 简介`,
    genres: ['剧情'],
    studios: ['片商'],
    tags: ['标签'],
    people: [{ id: `${itemId}-actor`, name: `${name} 演员`, type: 'Actor', role: '主演' }],
    mediaStreams: [],
    chapters: [],
    similar: [],
    collections: [],
  };
}

function findButton(host: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll('button')).find((candidate) => (
    candidate.textContent?.includes(label)
  ));
  if (!(button instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return button;
}

function mount(
  item: MediaBrowseItem,
  onClose = vi.fn(),
  extraProps: Record<string, unknown> = {},
): {
  host: HTMLDivElement;
  root: Root;
  rerender: (next: MediaBrowseItem) => Promise<void>;
  unmount: () => Promise<void>;
  onClose: ReturnType<typeof vi.fn>;
} {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const render = async (next: MediaBrowseItem) => {
    await act(async () => {
      root.render(createElement(MediaItemDetailPanel, { item: next, onClose, ...extraProps }));
      await Promise.resolve();
    });
  };
  return {
    host,
    root,
    rerender: render,
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
    onClose,
  };
}

let embyCallbacks: Map<string, (response: unknown) => void>;
let coverResolvers: Map<string, (response: unknown) => void>;

describe('MediaItemDetailPanel runtime behavior', () => {
  beforeEach(() => {
    embyCallbacks = new Map();
    coverResolvers = new Map();
    sendRuntimeMessage.mockReset();
    clearDrive115CoverCache();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        runtime: {
          lastError: null,
          sendMessage: vi.fn((message: RuntimeMessage, callback?: (response: unknown) => void) => {
            if (message.type === 'EMBY_LIBRARY_GET_ITEM_DETAIL' && message.itemId && callback) {
              embyCallbacks.set(message.itemId, callback);
            }
          }),
        },
      },
    });
  });

  afterEach(() => {
    clearDrive115CoverCache();
    document.body.innerHTML = '';
  });

  it('requests Emby/Jellyfin detail on mount and invokes close without coupling it to the request', async () => {
    const item = makeItem({ source: 'jellyfin', itemId: 'jf-item-7', serverUrl: 'https://jf.example.test' });
    const mounted = mount(item);

    await mounted.rerender(item);

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      {
        type: 'EMBY_LIBRARY_GET_ITEM_DETAIL',
        itemId: 'jf-item-7',
        serverUrl: 'https://jf.example.test',
        serverId: 'emby-server-1',
      },
      expect.any(Function),
    );
    expect(embyCallbacks.has('jf-item-7')).toBe(true);

    await act(async () => {
      embyCallbacks.get('jf-item-7')?.({
        success: true,
        detail: makeDetail('jf-item-7', '服务器详情标题', 'jellyfin'),
      });
    });

    expect(mounted.host.textContent).toContain('服务器详情标题');
    expect(mounted.host.textContent).toContain('服务器详情标题 演员');

    await act(async () => {
      findButton(mounted.host, '关闭').click();
    });
    expect(mounted.onClose).toHaveBeenCalledTimes(1);

    await mounted.unmount();
  });

  it('does not let a stale server response overwrite the newly selected item', async () => {
    const first = makeItem({ itemId: 'emby-first', title: '第一个列表标题' });
    const second = makeItem({ itemId: 'emby-second', title: '第二个列表标题' });
    const mounted = mount(first);

    await mounted.rerender(first);
    await mounted.rerender(second);

    await act(async () => {
      embyCallbacks.get('emby-second')?.({
        success: true,
        detail: makeDetail('emby-second', '第二个服务器详情'),
      });
    });
    await act(async () => {
      embyCallbacks.get('emby-first')?.({
        success: true,
        detail: makeDetail('emby-first', '过期服务器详情'),
      });
    });

    expect(mounted.host.textContent).toContain('第二个服务器详情');
    expect(mounted.host.textContent).not.toContain('过期服务器详情');

    await mounted.unmount();
  });

  it('passes the selected source copy to playback and exposes the server external link', async () => {
    const onPlayCopy = vi.fn();
    const item = makeItem({
      copies: [
        {
          copyId: 'emby-copy',
          source: 'emby',
          serverName: 'Emby 主库',
          serverUrl: 'https://emby.example.test',
          serverId: 'emby-server-1',
          itemId: 'emby-item-1',
        },
        {
          copyId: '115-copy',
          source: '115',
          pickCode: 'pick-115',
          fileName: 'MIDA-001.mp4',
        },
      ],
    });
    const mounted = mount(item, vi.fn(), { onPlayCopy });

    await mounted.rerender(item);
    await act(async () => {
      embyCallbacks.get('emby-item-1')?.({
        success: true,
        detail: {
          ...makeDetail('emby-item-1', '来源选择影片'),
          similar: [{ itemId: 'related-1', name: '相关影片', year: 2025 }],
        },
      });
    });

    const externalLink = mounted.host.querySelector('[data-media-external-server-link="1"]');
    expect(externalLink?.getAttribute('href')).toContain('emby-item-1');

    await act(async () => {
      findButton(mounted.host, '选择播放来源').click();
    });
    expect(mounted.host.textContent).toContain('Emby · Emby 主库');
    expect(mounted.host.textContent).toContain('115');

    await act(async () => {
      findButton(mounted.host, '播放此来源').click();
    });
    expect(onPlayCopy).toHaveBeenCalledWith(
      expect.objectContaining({ copyId: 'emby-copy', itemId: 'emby-item-1' }),
      expect.objectContaining({ highlights: [] }),
    );

    await mounted.unmount();
  });

  it('opens a related item through the detail callback and keeps close independent from playback', async () => {
    const onOpenItem = vi.fn();
    const onPlay = vi.fn();
    const mounted = mount(makeItem(), vi.fn(), { onOpenItem, onPlay });

    await mounted.rerender(makeItem());
    await act(async () => {
      embyCallbacks.get('emby-item-1')?.({
        success: true,
        detail: {
          ...makeDetail('emby-item-1', '主影片'),
          chapters: [{
            index: 0,
            name: '开场',
            startPositionTicks: 120_000_000,
            startTimeSeconds: 12,
          }],
          similar: [{ itemId: 'related-2', name: '相关影片', year: 2024 }],
        },
      });
    });

    await act(async () => {
      findButton(mounted.host, '相关影片').click();
    });
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({
      itemId: 'related-2',
      title: '相关影片',
    }));

    await act(async () => {
      findButton(mounted.host, '开场').click();
    });
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ startTimeSeconds: 12 }));

    await mounted.unmount();
  });

  it('loads 115 NFO and cover only for a 115 detail item', async () => {
    const item = makeItem({
      source: '115',
      itemId: undefined,
      serverUrl: undefined,
      libraryKey: 'library-key-115',
      coverPickCode: 'cover-pick-115',
      nfoSummary: { schemaVersion: 0 } as MediaBrowseItem['nfoSummary'],
    });
    sendRuntimeMessage.mockImplementation(async (message: RuntimeMessage) => {
      if (message.type === 'DRIVE115_MEDIA_LIBRARY_RESOLVE_COVER_URL') {
        return { success: true, url: 'https://115.example.test/cover.jpg' };
      }
      if (message.type === 'DRIVE115_MEDIA_LIBRARY_RESOLVE_NFO') {
        return {
          success: true,
          summary: {
            schemaVersion: 1,
            title: '115 NFO 标题',
            plot: '115 NFO 简介',
            actors: ['115 演员'],
            genres: ['剧情'],
          },
        };
      }
      return undefined;
    });
    const mounted = mount(item);

    await mounted.rerender(item);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sendRuntimeMessage).toHaveBeenCalledWith({
      type: 'DRIVE115_MEDIA_LIBRARY_RESOLVE_NFO',
      key: 'library-key-115',
    });
    expect(sendRuntimeMessage).toHaveBeenCalledWith({
      type: 'DRIVE115_MEDIA_LIBRARY_RESOLVE_COVER_URL',
      pickCode: 'cover-pick-115',
    });
    expect(mounted.host.textContent).toContain('115 NFO 标题');
    expect(mounted.host.textContent).toContain('115 演员');
    expect(mounted.host.textContent).toContain('115 NFO 简介');
    expect(mounted.host.querySelector('.ml-detail-cover')?.getAttribute('data-image-url'))
      .toBe('https://115.example.test/cover.jpg');

    await mounted.unmount();
  });

  it('does not let a stale 115 cover response overwrite the newly selected item', async () => {
    sendRuntimeMessage.mockImplementation((message: RuntimeMessage) => {
      if (message.type === 'DRIVE115_MEDIA_LIBRARY_RESOLVE_COVER_URL' && message.pickCode) {
        return new Promise((resolve) => coverResolvers.set(message.pickCode!, resolve));
      }
      return Promise.resolve(undefined);
    });
    const first = makeItem({
      source: '115',
      itemId: undefined,
      serverUrl: undefined,
      libraryKey: 'cover-first-nfo',
      coverPickCode: 'cover-first',
      nfoSummary: { schemaVersion: 4 } as MediaBrowseItem['nfoSummary'],
    });
    const second = makeItem({
      source: '115',
      itemId: undefined,
      serverUrl: undefined,
      libraryKey: 'cover-second-nfo',
      coverPickCode: 'cover-second',
      nfoSummary: { schemaVersion: 4 } as MediaBrowseItem['nfoSummary'],
    });
    const mounted = mount(first);

    await mounted.rerender(first);
    await mounted.rerender(second);
    await act(async () => {
      coverResolvers.get('cover-second')?.({
        success: true,
        url: 'https://115.example.test/second-cover.jpg',
      });
    });
    await act(async () => {
      coverResolvers.get('cover-first')?.({
        success: true,
        url: 'https://115.example.test/first-cover.jpg',
      });
    });

    expect(mounted.host.querySelector('.ml-detail-cover')?.getAttribute('data-image-url'))
      .toBe('https://115.example.test/second-cover.jpg');
    expect(mounted.host.querySelector('.ml-detail-cover')?.getAttribute('data-image-url'))
      .not.toBe('https://115.example.test/first-cover.jpg');

    await mounted.unmount();
  });

  it('does not let a stale 115 NFO response overwrite the newly selected item', async () => {
    const nfoResolvers = new Map<string, (response: unknown) => void>();
    sendRuntimeMessage.mockImplementation((message: RuntimeMessage) => {
      if (message.type === 'DRIVE115_MEDIA_LIBRARY_RESOLVE_NFO' && message.key) {
        return new Promise((resolve) => nfoResolvers.set(message.key!, resolve));
      }
      if (message.type === 'DRIVE115_MEDIA_LIBRARY_RESOLVE_COVER_URL') {
        return Promise.resolve({ success: false });
      }
      return Promise.resolve(undefined);
    });
    const first = makeItem({
      source: '115',
      itemId: undefined,
      serverUrl: undefined,
      libraryKey: 'nfo-first',
      nfoSummary: { schemaVersion: 0 } as MediaBrowseItem['nfoSummary'],
    });
    const second = makeItem({
      source: '115',
      itemId: undefined,
      serverUrl: undefined,
      libraryKey: 'nfo-second',
      nfoSummary: { schemaVersion: 0 } as MediaBrowseItem['nfoSummary'],
    });
    const mounted = mount(first);

    await mounted.rerender(first);
    await mounted.rerender(second);
    await act(async () => {
      nfoResolvers.get('nfo-second')?.({
        success: true,
        summary: { schemaVersion: 1, title: '第二个 NFO 标题' },
      });
    });
    await act(async () => {
      nfoResolvers.get('nfo-first')?.({
        success: true,
        summary: { schemaVersion: 1, title: '过期 NFO 标题' },
      });
    });

    expect(mounted.host.textContent).toContain('第二个 NFO 标题');
    expect(mounted.host.textContent).not.toContain('过期 NFO 标题');

    await mounted.unmount();
  });
});
