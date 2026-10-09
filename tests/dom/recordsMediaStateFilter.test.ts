/**
 * @file recordsMediaStateFilter.test.ts
 * @description records 媒体库状态筛选并入 #filterSelect（10-08，288 拉平修订）：
 * 选项结构源码锁（7 平级 option、optgroup 负锁、all 最前、chip 负锁）/
 * 媒体 option 恒可用（无 disabled 机制，源级负锁）/ 自保链删除负锁 /
 * 工具栏其余按钮零回归。
 * @module tests/dom
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createRecordsViewToolbarController } from '../../apps/extension/src/dashboard/tabs/records/viewToolbarController';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RECORDS_HTML = join(PROJECT_ROOT, 'apps/extension/src/dashboard/partials/tabs/records.html');
const RECORDS_CSS = join(PROJECT_ROOT, 'apps/extension/src/dashboard/styles/05-pages/records.css');
const VIEW_TOOLBAR_TS = join(PROJECT_ROOT, 'apps/extension/src/dashboard/tabs/records/viewToolbarController.ts');
const RECORDS_TS = join(PROJECT_ROOT, 'apps/extension/src/dashboard/tabs/records.ts');

function extractFilterSelectBlock(html: string): string {
  const start = html.indexOf('<select id="filterSelect">');
  expect(start).toBeGreaterThan(-1);
  const end = html.indexOf('</select>', start);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end + '</select>'.length);
}

function optionValuesInBlock(block: string): string[] {
  return Array.from(block.matchAll(/<option[^>]*value="([^"]*)"/g)).map(match => match[1]);
}

function setupDom() {
  document.body.innerHTML = `
    <button id="toggleCoversBtn"></button>
    <button id="toggleViewModeBtn"><i class="view-icon"></i><span class="view-text"></span></button>
    <button id="myFavoritesBtn"></button>
    <select id="filterSelect">
      <option value="all">所有状态</option>
      <option value="untracked">未标记</option>
      <option value="viewed">已观看</option>
      <option value="browsed">已浏览</option>
      <option value="want">我想看</option>
      <option value="inLibrary">已入库</option>
      <option value="realWatched">真实已看</option>
    </select>
    <ul id="videoList"></ul>
  `;

  return {
    toggleCoversBtn: document.getElementById('toggleCoversBtn') as HTMLButtonElement,
    toggleViewModeBtn: document.getElementById('toggleViewModeBtn') as HTMLButtonElement,
    favoritesButton: document.getElementById('myFavoritesBtn') as HTMLButtonElement,
    filterSelect: document.getElementById('filterSelect') as HTMLSelectElement,
    videoList: document.getElementById('videoList') as HTMLUListElement,
  };
}

function mediaOptions(filterSelect: HTMLSelectElement): HTMLOptionElement[] {
  return Array.from(filterSelect.options)
    .filter(option => option.value === 'inLibrary' || option.value === 'realWatched') as HTMLOptionElement[];
}

function makeController(overrides: Record<string, unknown> = {}) {
  const elements = setupDom();
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
    ...overrides,
  } as never);
  return { controller, elements };
}

describe('records 媒体库状态筛选 #filterSelect（10-08，288 拉平修订）', () => {
  it('records.html 源码锁：7 平级 option、all 最前、optgroup 负锁、chip 负锁', () => {
    const html = readFileSync(RECORDS_HTML, 'utf8');

    // chip 负锁：两独立按钮删净（既有断言零删减）
    expect(html).not.toContain('mediaLibraryFilterBtn');
    expect(html).not.toContain('realWatchedFilterBtn');

    const block = extractFilterSelectBlock(html);
    const values = optionValuesInBlock(block);
    expect(values).toHaveLength(7);
    expect(values[0]).toBe('all');
    expect(values).toContain('inLibrary');
    expect(values).toContain('realWatched');
    // 状态五项全保留（既有断言零删减）
    for (const value of ['untracked', 'viewed', 'browsed', 'want']) {
      expect(values).toContain(value);
    }
    // 拉平负锁：无 optgroup 包裹（媒体项与状态项同级）
    expect(block).not.toContain('<optgroup');
    expect(block).not.toContain('</optgroup>');
  });

  it('records.css 源码负锁：chip 专属样式删净', () => {
    const css = readFileSync(RECORDS_CSS, 'utf8');
    expect(css).not.toContain('#mediaLibraryFilterBtn');
    expect(css).not.toContain('#realWatchedFilterBtn');
  });

  it('源码负锁：disabled 机制与 server 自保链删净（viewToolbarController/records 源级）', () => {
    const toolbar = readFileSync(VIEW_TOOLBAR_TS, 'utf8');
    expect(toolbar).not.toContain('applyServerModeMediaStateReset');
    expect(toolbar).not.toContain('getMediaStateFilterEnabled');
    expect(toolbar).not.toContain('updateMediaStateOptions');

    const records = readFileSync(RECORDS_TS, 'utf8');
    expect(records).not.toContain('applyServerModeMediaStateReset');
    expect(records).not.toContain('getMediaStateFilterEnabled');
    expect(records).not.toContain('媒体库状态筛选仅本地模式可用');
  });

  it('默认态（无多选，server 分页路径）：两媒体 option 恒可用、默认选中 all', () => {
    const { controller, elements } = makeController();
    controller.bind();
    controller.update();

    const options = mediaOptions(elements.filterSelect);
    expect(options).toHaveLength(2);
    for (const option of options) {
      expect(option.disabled).toBe(false);
    }
    expect(elements.filterSelect.value).toBe('all');
  });

  it('工具栏其余按钮零回归（covers 切换 / favorites 激活回调）', () => {
    const setCoversEnabled = vi.fn();
    const setFavoritesActive = vi.fn();
    const onFilterChanged = vi.fn();
    const elements = setupDom();
    const state = { covers: false, favorites: false };
    const controller = createRecordsViewToolbarController({
      ...elements,
      getCoversEnabled: () => state.covers,
      setCoversEnabled: (enabled: boolean) => {
        state.covers = enabled;
        setCoversEnabled(enabled);
      },
      getViewMode: () => 'list',
      setViewMode: vi.fn(),
      getFavoritesActive: () => state.favorites,
      setFavoritesActive: (active: boolean) => {
        state.favorites = active;
        setFavoritesActive(active);
      },
      persistSettings: vi.fn(),
      onFilterChanged,
      onRender: vi.fn(),
    } as never);
    controller.bind();
    controller.update();

    elements.toggleCoversBtn.click();
    expect(setCoversEnabled).toHaveBeenCalledWith(true);
    expect(elements.toggleCoversBtn.classList.contains('toggle-on')).toBe(true);

    elements.favoritesButton.click();
    expect(setFavoritesActive).toHaveBeenCalledWith(true);
    expect(onFilterChanged).toHaveBeenCalledTimes(1);
    expect(elements.favoritesButton.getAttribute('aria-pressed')).toBe('true');
  });
});
