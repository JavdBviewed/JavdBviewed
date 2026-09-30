// @vitest-environment jsdom
/**
 * @file itemProcessorMediaLibrary.test.ts
 * @description itemProcessor 媒体库隐藏来源集成单测（09-30-media-library-hide-filter）：
 * 同步侧 Emby/JF 标记 + recompute 显隐、115 异步侧标记、搜索页豁免、开关全关零行为变化。
 * 夹具口径同 itemProcessorChunking.test.ts（直接注入 STATE，真实 processListItems 链路）；
 * 模块级状态口径同 libraryStatusBadges.test.ts 的 loadFreshBadgesModule：
 * 每用例 vi.resetModules + 动态 import 拿全新模块图（itemProcessor 与 contentState 同图），
 * 避免 mediaLibraryHiding 模块级 115 单飞缓存/卡片注册表跨用例串扰。
 * @module features/listEnhancement/content
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loadDrive115LibraryStateMock } = vi.hoisted(() => ({
  loadDrive115LibraryStateMock: vi.fn(),
}));

vi.mock('../../drive115/mediaLibrary', () => ({
  loadDrive115LibraryState: loadDrive115LibraryStateMock,
  lookupByCode: (state: any, code: string) => {
    const target = String(code || '').trim().toUpperCase();
    if (!target || !state?.entries?.length) return [];
    return state.entries.filter((e: any) => e.code && e.code.toUpperCase() === target);
  },
}));

import { VIDEO_STATUS } from '../../../utils/config';
import type { EmbyLibraryIndexEntry } from '../../embyLibrary/types';

type FreshModules = {
  processListItems: typeof import('./itemProcessor')['processListItems'];
  STATE: typeof import('../../contentState')['STATE'];
};

/** 每用例拿一份全新模块图（itemProcessor 与 contentState 来自同一新图） */
async function loadFreshModules(): Promise<FreshModules> {
  vi.resetModules();
  const [ip, cs] = await Promise.all([import('./itemProcessor'), import('../../contentState')]);
  return { processListItems: ip.processListItems, STATE: cs.STATE };
}

const SERVERS = [
  { id: 's1', type: 'emby', name: 'Home', url: 'http://emby.local:8096', enabled: true, apiKey: 'k' },
];

const mkEntry = (code: string, overrides: Partial<EmbyLibraryIndexEntry> = {}): EmbyLibraryIndexEntry => ({
  serverType: 'emby',
  serverName: 'Home',
  serverUrl: 'http://emby.local:8096',
  itemId: `${code}-item`,
  itemName: code,
  updatedAt: 1,
  ...overrides,
});

const buildItem = (code: string): HTMLElement => {
  const item = document.createElement('div');
  item.className = 'item';
  item.innerHTML = `
    <a href="/v/${code}" class="box" title="${code} test title">
      <div class="video-title x-ellipsis x-title"><strong>${code}</strong> <span>test title</span></div>
      <div class="tags has-addons"></div>
    </a>
  `;
  return item;
};

const flushAsync = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const watchedUser = { played: true, positionTicks: 0, runtimeTicks: 0, percent: 100, lastPlayedAt: 1 };
const inProgressUser = { played: false, positionTicks: 1, runtimeTicks: 0, percent: 50, lastPlayedAt: 1 };

describe('processListItems 媒体库隐藏来源（09-30-media-library-hide-filter）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    loadDrive115LibraryStateMock.mockReset();
    // 默认 115 索引为空；115 专项用例自行覆盖
    loadDrive115LibraryStateMock.mockResolvedValue({ entries: [], updatedAt: 0 });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const renderList = (state: FreshModules['STATE'], codes: string[]): HTMLElement[] => {
    const list = document.createElement('div');
    list.className = 'movie-list';
    for (const code of codes) {
      // 预置 records：missing=0，绕开 loadContentRecordSummaries 异步路径（jsdom IndexedDB 风险）
      state.records[code] = {
        id: code,
        status: VIDEO_STATUS.VIEWED,
        tags: [],
        createdAt: 1,
        updatedAt: 1,
      };
      list.appendChild(buildItem(code));
    }
    document.body.appendChild(list);
    return Array.from(document.querySelectorAll<HTMLElement>('.movie-list .item'));
  };

  it('双开关开：A 真实已看 / B 仅入库 / C 在看 均被 mediaLibrary 命中隐藏（C 不在 realWatched 源）', async () => {
    const { processListItems, STATE } = await loadFreshModules();
    STATE.settings = {
      display: { hideInMediaLibrary: true, hideRealWatched: true },
      emby: { mediaServers: SERVERS },
    } as any;
    STATE.isSearchPage = false;
    STATE.embyLibraryState = {
      updatedAt: 1,
      entries: {
        'AAA-001': [mkEntry('AAA-001', { userData: watchedUser })],
        'BBB-002': [mkEntry('BBB-002')],
        'CCC-003': [mkEntry('CCC-003', { userData: inProgressUser })],
      },
    } as any;
    const items = renderList(STATE, ['AAA-001', 'BBB-002', 'CCC-003']);
    processListItems(items);

    items.forEach((item, index) => {
      expect(item.hasAttribute('data-hide-src-mediaLibrary')).toBe(true);
      expect(item.style.display).toBe('none');
      const reason = item.getAttribute('data-hide-reason')!;
      expect(reason).toContain('MEDIA_LIBRARY');
      if (index === 0) expect(reason).toContain('REAL_WATCHED');
      else expect(reason).not.toContain('REAL_WATCHED');
    });
  });

  it('仅 hideRealWatched 开：A 隐、B/C 显（真实已看是独立来源）', async () => {
    const { processListItems, STATE } = await loadFreshModules();
    STATE.settings = {
      display: { hideInMediaLibrary: false, hideRealWatched: true },
      emby: { mediaServers: SERVERS },
    } as any;
    STATE.isSearchPage = false;
    STATE.embyLibraryState = {
      updatedAt: 1,
      entries: {
        'AAA-001': [mkEntry('AAA-001', { userData: watchedUser })],
        'BBB-002': [mkEntry('BBB-002')],
        'CCC-003': [mkEntry('CCC-003', { userData: inProgressUser })],
      },
    } as any;
    const items = renderList(STATE, ['AAA-001', 'BBB-002', 'CCC-003']);
    processListItems(items);

    expect(items[0].style.display).toBe('none');
    expect(items[0].getAttribute('data-hide-reason')).toBe('REAL_WATCHED');
    expect(items[1].style.display).not.toBe('none');
    expect(items[2].style.display).not.toBe('none');
    expect(items[2].hasAttribute('data-hide-src-realWatched')).toBe(false);
  });

  it('115 异步：仅 115 索引命中 → resolve 后打标记 + 隐藏（不阻塞首屏：同步段先完成）', async () => {
    const { processListItems, STATE } = await loadFreshModules();
    STATE.settings = {
      display: { hideInMediaLibrary: true, hideRealWatched: false },
      emby: { mediaServers: SERVERS },
    } as any;
    STATE.isSearchPage = false;
    STATE.embyLibraryState = null;
    loadDrive115LibraryStateMock.mockResolvedValue({ entries: [{ code: 'DDD-004' }], updatedAt: 1 });
    const items = renderList(STATE, ['DDD-004']);
    processListItems(items);

    // 同步段完成：Emby 无命中 → 尚未隐藏（首屏不阻塞）
    expect(items[0].hasAttribute('data-processed')).toBe(true);
    expect(items[0].style.display).not.toBe('none');
    await flushAsync();
    expect(items[0].hasAttribute('data-hide-src-mediaLibrary')).toBe(true);
    expect(items[0].style.display).toBe('none');
    expect(items[0].getAttribute('data-hide-reason')).toBe('MEDIA_LIBRARY');
  });

  it('索引为空的全新 profile 开双开关 → 零隐藏（零误伤）', async () => {
    const { processListItems, STATE } = await loadFreshModules();
    STATE.settings = {
      display: { hideInMediaLibrary: true, hideRealWatched: true },
      emby: { mediaServers: SERVERS },
    } as any;
    STATE.isSearchPage = false;
    STATE.embyLibraryState = { updatedAt: 0, entries: {} } as any;
    const items = renderList(STATE, ['EEE-005']);
    processListItems(items);
    await flushAsync();
    expect(items[0].style.display).not.toBe('none');
    expect(items[0].hasAttribute('data-hide-src-mediaLibrary')).toBe(false);
    expect(items[0].hasAttribute('data-hide-src-realWatched')).toBe(false);
  });

  it('搜索页豁免：开关开 + 命中也不打标记', async () => {
    const { processListItems, STATE } = await loadFreshModules();
    STATE.isSearchPage = true;
    STATE.settings = {
      display: { hideInMediaLibrary: true, hideRealWatched: true },
      emby: { mediaServers: SERVERS },
    } as any;
    STATE.embyLibraryState = {
      updatedAt: 1,
      entries: { 'AAA-001': [mkEntry('AAA-001', { userData: watchedUser })] },
    } as any;
    const items = renderList(STATE, ['AAA-001']);
    processListItems(items);
    await flushAsync();
    expect(items[0].hasAttribute('data-hide-src-mediaLibrary')).toBe(false);
    expect(items[0].hasAttribute('data-hide-src-realWatched')).toBe(false);
    expect(items[0].style.display).not.toBe('none');
  });

  it('两开关全关（默认）：不打标记、不读 115 storage（存量行为零变化）', async () => {
    const { processListItems, STATE } = await loadFreshModules();
    STATE.settings = { display: {} } as any;
    STATE.isSearchPage = false;
    STATE.embyLibraryState = {
      updatedAt: 1,
      entries: { 'AAA-001': [mkEntry('AAA-001', { userData: watchedUser })] },
    } as any;
    const items = renderList(STATE, ['AAA-001']);
    processListItems(items);
    await flushAsync();
    expect(items[0].hasAttribute('data-hide-src-mediaLibrary')).toBe(false);
    expect(items[0].hasAttribute('data-hide-src-realWatched')).toBe(false);
    expect(items[0].style.display).not.toBe('none');
    expect(loadDrive115LibraryStateMock).not.toHaveBeenCalled();
  });
});
