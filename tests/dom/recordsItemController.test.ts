/**
 * @file recordsItemController.test.ts
 * @description records item controller 测试
 * @module tests/dom
 */
import { describe, expect, it, vi } from 'vitest';
import { createRecordsItemElement } from '../../apps/extension/src/dashboard/tabs/records/itemController';
import type { VideoRecord } from '../../apps/extension/src/types';

function createRecord(overrides: Partial<VideoRecord> = {}): VideoRecord {
  return {
    id: 'ABC-123',
    title: '测试影片',
    status: 'viewed',
    tags: ['高清', '字幕'],
    listIds: ['list-1'],
    javdbUrl: 'https://javdb.com/v/abc',
    javdbImage: 'https://img.example.com/cover.jpg',
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

function createOptions(overrides: Partial<Parameters<typeof createRecordsItemElement>[0]> = {}) {
  const selectedRecordIds = new Set<string>();
  const selectedTags = new Set<string>();
  const selectedListIds = new Set<string>();
  const listNameById = new Map([['list-1', '默认清单']]);
  const actionCallbacks = {
    onToggleFavorite: vi.fn(),
    onEdit: vi.fn(),
    onRefresh: vi.fn(),
    onDelete: vi.fn(),
    onOpenListPicker: vi.fn(),
  };

  return {
    record: createRecord(),
    viewMode: 'list' as const,
    coversEnabled: false,
    selectedRecordIds,
    selectedTags,
    selectedListIds,
    listNameById,
    searchEngines: [],
    fallbackIconUrl: 'fallback.png',
    imageTooltipElement: document.createElement('div') as HTMLDivElement,
    coverObserver: { observe: vi.fn() },
    bindImageTooltip: vi.fn(),
    onToggleRecordSelection: vi.fn((recordId: string, selected: boolean) => {
      if (selected) selectedRecordIds.add(recordId);
      else selectedRecordIds.delete(recordId);
    }),
    onToggleTagFilter: vi.fn(),
    onToggleListFilter: vi.fn(),
    actionCallbacks,
    ...overrides,
  };
}

describe('records item controller', () => {
  it('renders a list row with controls and delegates row selection', () => {
    const options = createOptions();
    const row = createRecordsItemElement(options);

    expect(row.className).toBe('video-item batch-mode');
    expect(row.dataset.recordId).toBe('ABC-123');
    expect(row.querySelector('.video-controls')).toBeTruthy();
    // 10-24 state-dict：徽章文案中文化（存储态值不变，期望值随契约更新）
    expect(row.querySelector('.video-status')?.textContent).toBe('已观看');

    row.click();

    expect(options.onToggleRecordSelection).toHaveBeenCalledWith('ABC-123', true);
  });

  it('keeps selected row state and ignores clicks from links and controls', () => {
    const selectedRecordIds = new Set(['ABC-123']);
    const options = createOptions({ selectedRecordIds });
    const row = createRecordsItemElement(options);

    expect(row.classList.contains('selected')).toBe(true);

    (row.querySelector('.video-id-link') as HTMLAnchorElement).click();
    (row.querySelector('.favorite-button') as HTMLButtonElement).click();

    expect(options.onToggleRecordSelection).not.toHaveBeenCalled();
    expect(options.actionCallbacks.onToggleFavorite).toHaveBeenCalled();
  });

  it('delegates tag and list filter clicks without selecting the row', () => {
    const options = createOptions();
    const row = createRecordsItemElement(options);

    (row.querySelector('.video-tag') as HTMLElement).click();
    (row.querySelector('.video-list-tag') as HTMLElement).click();

    expect(options.onToggleTagFilter).toHaveBeenCalledWith('高清');
    expect(options.onToggleListFilter).toHaveBeenCalledWith('list-1');
    expect(options.onToggleRecordSelection).not.toHaveBeenCalled();
  });

  it('renders card mode with cover, status overlay, and lazy observer registration', () => {
    const options = createOptions({
      viewMode: 'card',
      coversEnabled: false,
      searchEngines: [{
        id: 'javdb',
        name: 'JavDB',
        urlTemplate: 'https://javdb.com/search?q={{ID}}',
        enabled: true,
      }],
    });
    const row = createRecordsItemElement(options);

    expect(row.querySelector(':scope > .video-cover')).toBeTruthy();
    expect(row.querySelector('.video-content-wrapper > .video-search-icons')).toBeTruthy();
    expect(row.querySelector(':scope > .video-controls .action-buttons-container')).toBeTruthy();
    // 10-24 state-dict：徽章文案中文化（存储态值不变，期望值随契约更新）
    expect(row.querySelector(':scope > .video-status')?.textContent).toBe('已观看');
    expect(options.coverObserver.observe).toHaveBeenCalledWith(row.querySelector('.video-cover-img'));
    expect(options.bindImageTooltip).toHaveBeenCalled();
  });
});
