// @vitest-environment jsdom
/**
 * @file mediaLibraryHiding.test.ts
 * @description 媒体库隐藏来源标记单测（09-30-media-library-hide-filter）：
 * 同步侧 Emby/JF 判定五形态、115 异步侧命中/失配/读取失败、注册表重算合并回写。
 * 模块级状态口径同 itemProcessorMediaLibrary.test.ts 的 loadFreshModules：
 * 每用例 vi.resetModules + 动态 import 拿全新模块图，避免模块级 115 单飞缓存
 * /卡片注册表/storage 监听标志跨用例串扰。
 * lookupByCode mock 与产品实现同口径（store.ts L228：两侧 trim+toUpperCase 忽略大小写）。
 * @module features/list-hiding
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loadDrive115LibraryStateMock } = vi.hoisted(() => ({
  loadDrive115LibraryStateMock: vi.fn(),
}));

vi.mock('../drive115/mediaLibrary', () => ({
  loadDrive115LibraryState: loadDrive115LibraryStateMock,
  lookupByCode: (state: any, code: string) => {
    const target = String(code || '').trim().toUpperCase();
    if (!target || !state?.entries?.length) return [];
    return state.entries.filter((e: any) => e.code && e.code.toUpperCase() === target);
  },
}));

import type { EmbyLibraryIndexEntry } from '../embyLibrary/types';

type FreshModules = {
  computeEmbyHidingHit: typeof import('./mediaLibraryHiding')['computeEmbyHidingHit'];
  hasDrive115Hit: typeof import('./mediaLibraryHiding')['hasDrive115Hit'];
  markMediaLibraryHiding: typeof import('./mediaLibraryHiding')['markMediaLibraryHiding'];
  markDrive115LibraryHiding: typeof import('./mediaLibraryHiding')['markDrive115LibraryHiding'];
  refreshRegisteredMediaLibraryHiding: typeof import('./mediaLibraryHiding')['refreshRegisteredMediaLibraryHiding'];
  STATE: typeof import('../contentState')['STATE'];
};

/** 每用例拿一份全新模块图（mediaLibraryHiding 与 contentState/listHiding 同图） */
async function loadFreshModules(): Promise<FreshModules> {
  vi.resetModules();
  const [mlh, cs] = await Promise.all([import('./mediaLibraryHiding'), import('../contentState')]);
  return {
    computeEmbyHidingHit: mlh.computeEmbyHidingHit,
    hasDrive115Hit: mlh.hasDrive115Hit,
    markMediaLibraryHiding: mlh.markMediaLibraryHiding,
    markDrive115LibraryHiding: mlh.markDrive115LibraryHiding,
    refreshRegisteredMediaLibraryHiding: mlh.refreshRegisteredMediaLibraryHiding,
    STATE: cs.STATE,
  };
}

const SERVERS = [
  { id: 's1', type: 'emby', name: 'Home', url: 'http://emby.local:8096', enabled: true, apiKey: 'k' },
];

const mkEntry = (overrides: Partial<EmbyLibraryIndexEntry> = {}): EmbyLibraryIndexEntry => ({
  serverType: 'emby',
  serverName: 'Home',
  serverUrl: 'http://emby.local:8096',
  itemId: 'item-1',
  itemName: 'AAA-001',
  updatedAt: 1,
  ...overrides,
});

const mkIndex = (entries: Record<string, EmbyLibraryIndexEntry[]>) => ({
  entries,
  updatedAt: 1,
} as any);

const mkItem = (): HTMLElement => {
  const item = document.createElement('div');
  item.className = 'item';
  document.body.appendChild(item);
  return item;
};

const flush = (ms = 10): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const baseSettings = (display: Record<string, boolean>) => ({
  display,
  emby: { mediaServers: SERVERS },
});

describe('computeEmbyHidingHit（纯函数五形态）', () => {
  const settings = baseSettings({});

  it('A 真实已看（percent>=90）→ inLibrary+realWatched', async () => {
    const { computeEmbyHidingHit } = await loadFreshModules();
    const hit = computeEmbyHidingHit(
      mkIndex({ 'AAA-001': [mkEntry({ userData: { played: false, positionTicks: 0, runtimeTicks: 0, percent: 95, lastPlayedAt: 1 } })] }),
      'AAA-001',
      (settings as any).emby.mediaServers,
    );
    expect(hit).toEqual({ inLibrary: true, realWatched: true });
  });

  it('A 真实已看（Played=true 低进度）→ realWatched', async () => {
    const { computeEmbyHidingHit } = await loadFreshModules();
    const hit = computeEmbyHidingHit(
      mkIndex({ 'AAA-001': [mkEntry({ userData: { played: true, positionTicks: 0, runtimeTicks: 0, percent: 5, lastPlayedAt: 1 } })] }),
      'AAA-001',
      (settings as any).emby.mediaServers,
    );
    expect(hit).toEqual({ inLibrary: true, realWatched: true });
  });

  it('B 仅入库（无 userData）→ inLibrary 且非 realWatched', async () => {
    const { computeEmbyHidingHit } = await loadFreshModules();
    const hit = computeEmbyHidingHit(
      mkIndex({ 'AAA-001': [mkEntry()] }),
      'AAA-001',
      (settings as any).emby.mediaServers,
    );
    expect(hit).toEqual({ inLibrary: true, realWatched: false });
  });

  it('C 在看（percent 10-89）→ inLibrary 且非 realWatched', async () => {
    const { computeEmbyHidingHit } = await loadFreshModules();
    const hit = computeEmbyHidingHit(
      mkIndex({ 'AAA-001': [mkEntry({ userData: { played: false, positionTicks: 1, runtimeTicks: 0, percent: 50, lastPlayedAt: 1 } })] }),
      'AAA-001',
      (settings as any).emby.mediaServers,
    );
    expect(hit).toEqual({ inLibrary: true, realWatched: false });
  });

  it('未配置服务器条目 / 无条目 → 零命中（零误隐）', async () => {
    const { computeEmbyHidingHit } = await loadFreshModules();
    expect(
      computeEmbyHidingHit(
        mkIndex({ 'AAA-001': [mkEntry({ serverUrl: 'http://other.local:9999' })] }),
        'AAA-001',
        (settings as any).emby.mediaServers,
      ),
    ).toEqual({ inLibrary: false, realWatched: false });
    expect(
      computeEmbyHidingHit(mkIndex({}), 'AAA-001', (settings as any).emby.mediaServers),
    ).toEqual({ inLibrary: false, realWatched: false });
  });
});

describe('hasDrive115Hit（纯函数）', () => {
  // CCC-003 大写条目：小写查询 ccc-003 须命中（与产品 lookupByCode 忽略大小写同口径）
  const state = {
    entries: [{ code: 'BBB-002' }, { code: 'CCC-003' }, { code: '' }],
    updatedAt: 1,
  } as any;

  it('按番号命中；未识别（code 空）条目不参与', async () => {
    const { hasDrive115Hit } = await loadFreshModules();
    expect(hasDrive115Hit(state, 'BBB-002')).toBe(true);
    expect(hasDrive115Hit(state, 'ccc-003')).toBe(true);
    expect(hasDrive115Hit(state, 'DDD-004')).toBe(false);
    expect(hasDrive115Hit(null, 'BBB-002')).toBe(false);
  });
});

describe('markMediaLibraryHiding（同步侧门控）', () => {
  it('两开关全关 → 不打标记（存量行为零变化）', async () => {
    const { markMediaLibraryHiding, STATE } = await loadFreshModules();
    const item = mkItem();
    STATE.isSearchPage = false;
    STATE.embyLibraryState = mkIndex({});
    STATE.settings = baseSettings({});
    markMediaLibraryHiding(item, 'AAA-001', STATE.settings);
    expect(item.hasAttribute('data-hide-src-mediaLibrary')).toBe(false);
    expect(item.hasAttribute('data-hide-src-realWatched')).toBe(false);
    document.body.innerHTML = '';
  });

  it('命中 + 开关开 → 打 mediaLibrary/realWatched 标记', async () => {
    const { markMediaLibraryHiding, STATE } = await loadFreshModules();
    const item = mkItem();
    STATE.isSearchPage = false;
    STATE.embyLibraryState = mkIndex({
      'AAA-001': [mkEntry({ userData: { played: true, positionTicks: 0, runtimeTicks: 0, percent: 100, lastPlayedAt: 1 } })],
    });
    STATE.settings = baseSettings({ hideInMediaLibrary: true, hideRealWatched: true });
    markMediaLibraryHiding(item, 'AAA-001', STATE.settings);
    expect(item.hasAttribute('data-hide-src-mediaLibrary')).toBe(true);
    expect(item.hasAttribute('data-hide-src-realWatched')).toBe(true);
    document.body.innerHTML = '';
  });

  it('未命中 → 不打标记', async () => {
    const { markMediaLibraryHiding, STATE } = await loadFreshModules();
    const item = mkItem();
    STATE.isSearchPage = false;
    STATE.embyLibraryState = mkIndex({
      'AAA-001': [mkEntry({ userData: { played: true, positionTicks: 0, runtimeTicks: 0, percent: 100, lastPlayedAt: 1 } })],
    });
    STATE.settings = baseSettings({ hideInMediaLibrary: true });
    markMediaLibraryHiding(item, 'ZZZ-999', STATE.settings);
    expect(item.hasAttribute('data-hide-src-mediaLibrary')).toBe(false);
    document.body.innerHTML = '';
  });

  it('搜索页 → 豁免不打标记', async () => {
    const { markMediaLibraryHiding, STATE } = await loadFreshModules();
    const item = mkItem();
    STATE.isSearchPage = true;
    STATE.embyLibraryState = mkIndex({
      'AAA-001': [mkEntry({ userData: { played: true, positionTicks: 0, runtimeTicks: 0, percent: 100, lastPlayedAt: 1 } })],
    });
    STATE.settings = baseSettings({ hideInMediaLibrary: true });
    markMediaLibraryHiding(item, 'AAA-001', STATE.settings);
    expect(item.hasAttribute('data-hide-src-mediaLibrary')).toBe(false);
    document.body.innerHTML = '';
  });
});

describe('markDrive115LibraryHiding（115 异步侧）', () => {
  beforeEach(() => {
    loadDrive115LibraryStateMock.mockReset();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('hideInMediaLibrary 关 → 直接返回，不读 storage', async () => {
    const { markDrive115LibraryHiding, STATE } = await loadFreshModules();
    const item = mkItem();
    STATE.isSearchPage = false;
    STATE.settings = baseSettings({ hideInMediaLibrary: false });
    await markDrive115LibraryHiding(item, 'BBB-002', STATE.settings);
    expect(loadDrive115LibraryStateMock).not.toHaveBeenCalled();
    expect(item.hasAttribute('data-hide-src-mediaLibrary')).toBe(false);
  });

  it('命中 → 打标记 + recompute 隐藏', async () => {
    const { markDrive115LibraryHiding, STATE } = await loadFreshModules();
    const item = mkItem();
    STATE.isSearchPage = false;
    STATE.settings = baseSettings({ hideInMediaLibrary: true });
    loadDrive115LibraryStateMock.mockResolvedValue({ entries: [{ code: 'BBB-002' }], updatedAt: 1 });
    await markDrive115LibraryHiding(item, 'BBB-002', STATE.settings);
    expect(item.hasAttribute('data-hide-src-mediaLibrary')).toBe(true);
    expect(item.style.display).toBe('none');
    expect(item.getAttribute('data-hide-reason')).toBe('MEDIA_LIBRARY');
  });

  it('失配 → 不打标记（卡片保持可见）', async () => {
    const { markDrive115LibraryHiding, STATE } = await loadFreshModules();
    const item = mkItem();
    STATE.isSearchPage = false;
    STATE.settings = baseSettings({ hideInMediaLibrary: true });
    loadDrive115LibraryStateMock.mockResolvedValue({ entries: [{ code: 'CCC-003' }], updatedAt: 1 });
    await markDrive115LibraryHiding(item, 'BBB-002', STATE.settings);
    expect(item.hasAttribute('data-hide-src-mediaLibrary')).toBe(false);
    expect(item.style.display).not.toBe('none');
  });

  it('读取失败 → 不打标记、不抛错（零命中零误隐）', async () => {
    const { markDrive115LibraryHiding, STATE } = await loadFreshModules();
    const item = mkItem();
    STATE.isSearchPage = false;
    STATE.settings = baseSettings({ hideInMediaLibrary: true });
    loadDrive115LibraryStateMock.mockRejectedValue(new Error('storage down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(markDrive115LibraryHiding(item, 'BBB-002', STATE.settings)).resolves.toBeUndefined();
    expect(item.hasAttribute('data-hide-src-mediaLibrary')).toBe(false);
    warn.mockRestore();
  });
});

describe('refreshRegisteredMediaLibraryHiding（索引变化重算）', () => {
  const embyOnlyIndex = mkIndex({
    'CCC-003': [mkEntry({ itemId: 'emby-only', itemName: 'CCC-003' })],
  });

  beforeEach(() => {
    loadDrive115LibraryStateMock.mockReset();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('115 索引删除条目 → 清 115 来源标记；Emby-only 卡的 mediaLibrary 标记不被误清', async () => {
    const {
      markDrive115LibraryHiding,
      markMediaLibraryHiding,
      refreshRegisteredMediaLibraryHiding,
      STATE,
    } = await loadFreshModules();
    const item115 = mkItem();
    const itemEmby = mkItem();
    STATE.isSearchPage = false;
    STATE.settings = baseSettings({ hideInMediaLibrary: true });
    STATE.embyLibraryState = embyOnlyIndex;
    loadDrive115LibraryStateMock.mockResolvedValue({ entries: [{ code: 'BBB-002' }], updatedAt: 1 });

    // 初始：BBB-002 仅 115 命中；CCC-003 仅 Emby 命中
    await markDrive115LibraryHiding(item115, 'BBB-002', STATE.settings);
    await flush();
    markMediaLibraryHiding(itemEmby, 'CCC-003', STATE.settings);
    expect(item115.hasAttribute('data-hide-src-mediaLibrary')).toBe(true);
    expect(itemEmby.hasAttribute('data-hide-src-mediaLibrary')).toBe(true);

    // 115 索引变化：BBB-002 条目消失（缓存经模块内失效重读，此处直接给新状态）
    loadDrive115LibraryStateMock.mockResolvedValue({ entries: [], updatedAt: 2 });
    await refreshRegisteredMediaLibraryHiding();
    await flush();
    expect(item115.hasAttribute('data-hide-src-mediaLibrary')).toBe(false);
    expect(item115.style.display).not.toBe('none');
    // Emby 命中卡不受 115 变化影响（按 115∨Emby 合并回写）
    expect(itemEmby.hasAttribute('data-hide-src-mediaLibrary')).toBe(true);
  });
});
