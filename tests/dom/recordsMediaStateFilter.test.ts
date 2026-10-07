/**
 * @file recordsMediaStateFilter.test.ts
 * @description records 媒体库状态筛选 chip（10-24）：默认关 / toggle / server 模式降级禁用
 * @module tests/dom
 */
import { describe, expect, it, vi } from 'vitest';
import { createRecordsViewToolbarController } from '../../apps/extension/src/dashboard/tabs/records/viewToolbarController';

function setupDom() {
  document.body.innerHTML = `
    <button id="toggleCoversBtn"></button>
    <button id="toggleViewModeBtn"><i class="view-icon"></i><span class="view-text"></span></button>
    <button id="myFavoritesBtn"></button>
    <button id="mediaLibraryFilterBtn"><i class="fas fa-database"></i> 已入库</button>
    <button id="realWatchedFilterBtn"><i class="fas fa-check-double"></i> 真实已看</button>
    <ul id="videoList"></ul>
  `;

  return {
    toggleCoversBtn: document.getElementById('toggleCoversBtn') as HTMLButtonElement,
    toggleViewModeBtn: document.getElementById('toggleViewModeBtn') as HTMLButtonElement,
    favoritesButton: document.getElementById('myFavoritesBtn') as HTMLButtonElement,
    mediaLibraryButton: document.getElementById('mediaLibraryFilterBtn') as HTMLButtonElement,
    realWatchedButton: document.getElementById('realWatchedFilterBtn') as HTMLButtonElement,
    videoList: document.getElementById('videoList') as HTMLUListElement,
  };
}

function makeController(overrides: Record<string, unknown> = {}) {
  const elements = setupDom();
  const state = {
    inLibraryActive: false,
    realWatchedActive: false,
    enabled: true,
  };
  const controller = createRecordsViewToolbarController({
    ...elements,
    getCoversEnabled: () => false,
    setCoversEnabled: vi.fn(),
    getViewMode: () => 'list',
    setViewMode: vi.fn(),
    getFavoritesActive: () => false,
    setFavoritesActive: vi.fn(),
    persistSettings: vi.fn(),
    onFilterChanged: vi.fn(),
    onRender: vi.fn(),
    mediaLibraryButton: elements.mediaLibraryButton,
    realWatchedButton: elements.realWatchedButton,
    getInLibraryActive: () => state.inLibraryActive,
    setInLibraryActive: (active: boolean) => { state.inLibraryActive = active; },
    getRealWatchedActive: () => state.realWatchedActive,
    setRealWatchedActive: (active: boolean) => { state.realWatchedActive = active; },
    getMediaStateFilterEnabled: () => state.enabled,
    onMediaStateFilterToggled: vi.fn(),
    ...overrides,
  } as never);
  return { controller, elements, state, options: (controller as never as Record<string, unknown>) };
}

describe('records 媒体库状态筛选 chip（viewToolbarController）', () => {
  it('两 chip 在位、默认关、本地模式可点', () => {
    const { controller, elements } = makeController();
    controller.bind();
    controller.update();

    for (const [btn, title] of [[elements.mediaLibraryButton, '仅看媒体库已入库'], [elements.realWatchedButton, '仅看媒体库真实已看']] as const) {
      expect(btn).not.toBeNull();
      expect(btn.disabled).toBe(false);
      expect(btn.classList.contains('active')).toBe(false);
      expect(btn.getAttribute('aria-pressed')).toBe('false');
      expect(btn.title).toBe(title);
    }
  });

  it('点击 toggle → 激活态 + onFilterChanged/onMediaStateFilterToggled', () => {
    const elements = setupDom();
    const onFilterChanged = vi.fn();
    const onMediaStateFilterToggled = vi.fn();
    const state = { inLibraryActive: false, realWatchedActive: false };
    const controller = createRecordsViewToolbarController({
      toggleCoversBtn: null,
      toggleViewModeBtn: null,
      favoritesButton: null,
      videoList: elements.videoList,
      getCoversEnabled: () => false,
      setCoversEnabled: vi.fn(),
      getViewMode: () => 'list',
      setViewMode: vi.fn(),
      getFavoritesActive: () => false,
      setFavoritesActive: vi.fn(),
      persistSettings: vi.fn(),
      onFilterChanged,
      onRender: vi.fn(),
      mediaLibraryButton: elements.mediaLibraryButton,
      realWatchedButton: elements.realWatchedButton,
      getInLibraryActive: () => state.inLibraryActive,
      setInLibraryActive: (active: boolean) => { state.inLibraryActive = active; },
      getRealWatchedActive: () => state.realWatchedActive,
      setRealWatchedActive: (active: boolean) => { state.realWatchedActive = active; },
      getMediaStateFilterEnabled: () => true,
      onMediaStateFilterToggled,
    } as never);
    controller.bind();

    elements.mediaLibraryButton.click();

    expect(state.inLibraryActive).toBe(true);
    expect(elements.mediaLibraryButton.getAttribute('aria-pressed')).toBe('true');
    expect(elements.mediaLibraryButton.classList.contains('active')).toBe(true);
    expect(elements.mediaLibraryButton.title).toBe('取消「已入库」筛选');
    expect(onFilterChanged).toHaveBeenCalledTimes(1);
    expect(onMediaStateFilterToggled).toHaveBeenCalledTimes(1);
    // 另一 chip 不受影响
    expect(state.realWatchedActive).toBe(false);
    expect(elements.realWatchedButton.getAttribute('aria-pressed')).toBe('false');

    elements.realWatchedButton.click();
    expect(state.realWatchedActive).toBe(true);
    expect(onFilterChanged).toHaveBeenCalledTimes(2);

    // 再点取消
    elements.mediaLibraryButton.click();
    expect(state.inLibraryActive).toBe(false);
    expect(elements.mediaLibraryButton.getAttribute('aria-pressed')).toBe('false');
  });

  it('server 模式 → disabled + 降级 tooltip + 非激活渲染', () => {
    const elements = setupDom();
    const state = { inLibraryActive: true, realWatchedActive: false };
    const controller = createRecordsViewToolbarController({
      toggleCoversBtn: null,
      toggleViewModeBtn: null,
      favoritesButton: null,
      videoList: elements.videoList,
      getCoversEnabled: () => false,
      setCoversEnabled: vi.fn(),
      getViewMode: () => 'list',
      setViewMode: vi.fn(),
      getFavoritesActive: () => false,
      setFavoritesActive: vi.fn(),
      persistSettings: vi.fn(),
      onFilterChanged: vi.fn(),
      onRender: vi.fn(),
      mediaLibraryButton: elements.mediaLibraryButton,
      realWatchedButton: elements.realWatchedButton,
      getInLibraryActive: () => state.inLibraryActive,
      setInLibraryActive: vi.fn(),
      getRealWatchedActive: () => state.realWatchedActive,
      setRealWatchedActive: vi.fn(),
      getMediaStateFilterEnabled: () => false,
      onMediaStateFilterToggled: vi.fn(),
    } as never);
    controller.bind();
    controller.update();

    for (const btn of [elements.mediaLibraryButton, elements.realWatchedButton]) {
      expect(btn.disabled).toBe(true);
      expect(btn.title).toBe('媒体库状态筛选仅本地模式可用');
      expect(btn.getAttribute('aria-pressed')).toBe('false');
      expect(btn.classList.contains('active')).toBe(false);
    }
    // 降级态即使状态为激活也不渲染 active（防御：激活态应已被上层清除）
    expect(elements.mediaLibraryButton.classList.contains('active')).toBe(false);
  });

  it('server 模式（disabled）点击不触发状态变更', () => {
    const elements = setupDom();
    const state = { inLibraryActive: false };
    const setInLibraryActive = vi.fn();
    const onFilterChanged = vi.fn();
    const controller = createRecordsViewToolbarController({
      toggleCoversBtn: null,
      toggleViewModeBtn: null,
      favoritesButton: null,
      videoList: elements.videoList,
      getCoversEnabled: () => false,
      setCoversEnabled: vi.fn(),
      getViewMode: () => 'list',
      setViewMode: vi.fn(),
      getFavoritesActive: () => false,
      setFavoritesActive: vi.fn(),
      persistSettings: vi.fn(),
      onFilterChanged,
      onRender: vi.fn(),
      mediaLibraryButton: elements.mediaLibraryButton,
      realWatchedButton: elements.realWatchedButton,
      getInLibraryActive: () => state.inLibraryActive,
      setInLibraryActive,
      getRealWatchedActive: () => false,
      setRealWatchedActive: vi.fn(),
      getMediaStateFilterEnabled: () => false,
      onMediaStateFilterToggled: vi.fn(),
    } as never);
    controller.bind();
    controller.update();

    expect(elements.mediaLibraryButton.disabled).toBe(true);
    elements.mediaLibraryButton.click(); // disabled：jsdom 不派发 click

    expect(setInLibraryActive).not.toHaveBeenCalled();
    expect(onFilterChanged).not.toHaveBeenCalled();
    expect(state.inLibraryActive).toBe(false);
  });
});
