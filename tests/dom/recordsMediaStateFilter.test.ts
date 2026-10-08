/**
 * @file recordsMediaStateFilter.test.ts
 * @description records 媒体库状态筛选并入 #filterSelect（10-08）：
 * 选项结构源码锁（7 项+optgroup、all 最前、chip 负锁）/ controller option 禁用面 /
 * server 自保复位 / 工具栏其余按钮零回归。
 * @module tests/dom
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  applyServerModeMediaStateReset,
  createRecordsViewToolbarController,
} from '../../apps/extension/src/dashboard/tabs/records/viewToolbarController';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RECORDS_HTML = join(PROJECT_ROOT, 'apps/extension/src/dashboard/partials/tabs/records.html');
const RECORDS_CSS = join(PROJECT_ROOT, 'apps/extension/src/dashboard/styles/05-pages/records.css');

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
      <optgroup label="媒体库">
        <option value="inLibrary">已入库</option>
        <option value="realWatched">真实已看</option>
      </optgroup>
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
    filterSelect: elements.filterSelect,
    getMediaStateFilterEnabled: () => true,
    ...overrides,
  } as never);
  return { controller, elements };
}

describe('records 媒体库状态筛选 #filterSelect（10-08）', () => {
  it('records.html 源码锁：7 项、all 最前、媒体库 optgroup 两 option 在位、chip 负锁', () => {
    const html = readFileSync(RECORDS_HTML, 'utf8');

    // chip 负锁：两独立按钮删净
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
    // optgroup 包裹两媒体项
    const groupStart = block.indexOf('<optgroup label="媒体库">');
    expect(groupStart).toBeGreaterThan(-1);
    const groupEnd = block.indexOf('</optgroup>');
    expect(groupEnd).toBeGreaterThan(groupStart);
    const group = block.slice(groupStart, groupEnd);
    expect(group).toContain('value="inLibrary"');
    expect(group).toContain('value="realWatched"');
    expect(group).not.toContain('value="all"');
  });

  it('records.css 源码负锁：chip 专属样式删净', () => {
    const css = readFileSync(RECORDS_CSS, 'utf8');
    expect(css).not.toContain('#mediaLibraryFilterBtn');
    expect(css).not.toContain('#realWatchedFilterBtn');
  });

  it('本地模式：两媒体 option 在位且 enabled、默认选中 all', () => {
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

  it('server 模式：两媒体 option disabled（select 结构天然单选互斥）', () => {
    const { controller, elements } = makeController({
      getMediaStateFilterEnabled: () => false,
    });
    controller.bind();
    controller.update();

    const options = mediaOptions(elements.filterSelect);
    expect(options).toHaveLength(2);
    for (const option of options) {
      expect(option.disabled).toBe(true);
    }
    // 非媒体项不受影响
    const viewedOption = Array.from(elements.filterSelect.options)
      .find(option => option.value === 'viewed') as HTMLOptionElement;
    expect(viewedOption.disabled).toBe(false);
  });

  it('server 自保：进入 server 且当前值=媒体项 → 复位 all；状态项不动', () => {
    const { elements } = makeController();

    elements.filterSelect.value = 'inLibrary';
    expect(applyServerModeMediaStateReset(elements.filterSelect, true)).toBe(true);
    expect(elements.filterSelect.value).toBe('all');

    elements.filterSelect.value = 'realWatched';
    expect(applyServerModeMediaStateReset(elements.filterSelect, true)).toBe(true);
    expect(elements.filterSelect.value).toBe('all');

    elements.filterSelect.value = 'viewed';
    expect(applyServerModeMediaStateReset(elements.filterSelect, true)).toBe(false);
    expect(elements.filterSelect.value).toBe('viewed');

    elements.filterSelect.value = 'inLibrary';
    expect(applyServerModeMediaStateReset(elements.filterSelect, false)).toBe(false);
    expect(elements.filterSelect.value).toBe('inLibrary');
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
      filterSelect: elements.filterSelect,
      getMediaStateFilterEnabled: () => true,
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
