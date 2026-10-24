/**
 * @file recordsItemMediaStateChip.test.ts
 * @description 10-24-records-state-dict：卡片/列表视图状态徽章中文化 + 派生态 chip
 * （realWatched 优先 / 未命中不渲染），DOM 面（itemController）。
 * @module tests/dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecordsItemElement, type CreateRecordsItemElementOptions } from '../../apps/extension/src/dashboard/tabs/records/itemController';
import type { MediaStateHit } from '../../apps/extension/src/dashboard/tabs/records/mediaStateFilterModel';
import type { VideoRecord } from '../../apps/extension/src/types';

function createRecord(status: VideoRecord['status']): VideoRecord {
  return {
    id: 'B1XX-0004',
    title: '测试标题',
    status,
    tags: [],
    userTags: [],
    createdAt: 1,
    updatedAt: 2,
  };
}

function makeOptions(overrides: Partial<CreateRecordsItemElementOptions> = {}): CreateRecordsItemElementOptions {
  const noop = () => undefined;
  return {
    record: createRecord('viewed'),
    viewMode: 'list',
    coversEnabled: false,
    selectedRecordIds: new Set(),
    selectedTags: new Set(),
    selectedListIds: new Set(),
    listNameById: new Map(),
    searchEngines: [],
    fallbackIconUrl: 'about:blank',
    imageTooltipElement: null,
    coverObserver: null,
    onToggleRecordSelection: noop,
    onToggleTagFilter: noop,
    onToggleListFilter: noop,
    actionCallbacks: {
      onToggleFavorite: noop,
      onEdit: noop,
      onRefresh: noop,
      onDelete: noop,
      onOpenListPicker: noop,
    },
    ...overrides,
  };
}

function renderItem(overrides: Partial<CreateRecordsItemElementOptions> = {}): HTMLElement {
  const li = createRecordsItemElement(makeOptions(overrides));
  document.body.innerHTML = '';
  document.body.appendChild(li);
  return li;
}

describe('records item media state chip (card + list views)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders chinese stored-status badge text with unchanged status-* class (card)', () => {
    const li = renderItem({ viewMode: 'card' });
    const badge = li.querySelector('.video-status');
    expect(badge).toBeTruthy();
    expect(badge?.className).toContain('status-viewed');
    expect(badge?.textContent).toBe('已观看');
    expect(li.querySelector('.media-state-chip')).toBeNull();
  });

  it('renders realWatched chip with priority over inLibrary (card)', () => {
    const li = renderItem({
      viewMode: 'card',
      mediaStateHit: { inLibrary: true, realWatched: true } as MediaStateHit,
    });
    const chips = li.querySelectorAll('.media-state-chip-realwatched, .media-state-chip-inlibrary');
    expect(chips).toHaveLength(1);
    expect(chips[0].className).toContain('media-state-chip-realwatched');
    expect(chips[0].textContent).toBe('真实已看');
    expect(chips[0].title).toBeTruthy();
  });

  it('renders inLibrary chip when only inLibrary is hit (card)', () => {
    const li = renderItem({
      viewMode: 'card',
      mediaStateHit: { inLibrary: true, realWatched: false } as MediaStateHit,
    });
    const chip = li.querySelector('.media-state-chip-inlibrary');
    expect(chip).toBeTruthy();
    expect(chip?.textContent).toBe('已入库');
    expect(li.querySelector('.media-state-chip-realwatched')).toBeNull();
  });

  it('renders derived chip in list view through base html', () => {
    const li = renderItem({
      viewMode: 'list',
      mediaStateHit: { inLibrary: true, realWatched: true } as MediaStateHit,
    });
    const badge = li.querySelector('.video-status');
    expect(badge?.textContent).toBe('已观看');
    const chip = li.querySelector('.media-state-chip-realwatched');
    expect(chip).toBeTruthy();
    expect(chip?.textContent).toBe('真实已看');
    expect(li.querySelector('.media-state-chip-inlibrary')).toBeNull();
  });

  it('renders nothing derived when no hit is passed (list)', () => {
    const li = renderItem({ viewMode: 'list' });
    expect(li.querySelector('.media-state-chip')).toBeNull();
  });
});
