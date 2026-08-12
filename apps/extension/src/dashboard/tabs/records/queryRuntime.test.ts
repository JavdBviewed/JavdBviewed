import { describe, expect, it, vi } from 'vitest';
import { createRecordsQueryRuntime } from './queryRuntime';
import type { VideoRecord } from '../../../types';

function record(id: string): VideoRecord {
  return {
    id,
    title: id,
    status: 'viewed',
    createdAt: 1,
    updatedAt: 2,
  };
}

function createRuntime(overrides: Partial<Parameters<typeof createRecordsQueryRuntime>[0]> = {}) {
  const selectedTags = new Set<string>();
  const selectedListIds = new Set<string>();
  const selectedSeriesIds = new Set<string>();
  const selectedLabelIds = new Set<string>();
  const state = {
    serverModeActive: false,
    serverPageItems: [] as VideoRecord[],
    serverTotal: 0,
    lastQueryDurationMs: null as number | null,
  };

  const options = {
    searchInput: { value: ' MKMP-577 ' } as HTMLInputElement,
    filterSelect: { value: 'viewed' } as HTMLSelectElement,
    sortSelect: { value: 'id_asc' } as HTMLSelectElement,
    videoList: { innerHTML: '' } as HTMLElement,
    getCurrentPage: () => 2,
    getRecordsPerPage: () => 20,
    selectedTags,
    selectedListIds,
    selectedSeriesIds,
    selectedLabelIds,
    listNameById: new Map<string, string>(),
    getAdvancedConditions: () => [],
    isFavoritesFilterActive: () => true,
    queryRecords: vi.fn(),
    pageRecords: vi.fn(),
    loadServerPage: vi.fn(async () => ({
      items: [record('MKMP-577')],
      total: 6,
      durationMs: 12,
    })),
    setServerModeActive: (active: boolean) => {
      state.serverModeActive = active;
    },
    setServerPageItems: (items: VideoRecord[]) => {
      state.serverPageItems = items;
    },
    setServerTotal: (total: number) => {
      state.serverTotal = total;
    },
    setLastQueryDurationMs: (duration: number | null) => {
      state.lastQueryDurationMs = duration;
    },
    renderVideoList: vi.fn(),
    renderPagination: vi.fn(),
    updateSearchResultCount: vi.fn(),
    showMessage: vi.fn(),
    logWarning: vi.fn(),
    ...overrides,
  };

  return {
    runtime: createRecordsQueryRuntime(options),
    options,
    state,
    selectedSeriesIds,
    selectedLabelIds,
  };
}

describe('records query runtime', () => {
  it('uses IDB only when series and label filters are clear', () => {
    const { runtime, selectedSeriesIds, selectedLabelIds } = createRuntime();

    expect(runtime.shouldUseIDB()).toBe(true);

    selectedSeriesIds.add('series-1');
    expect(runtime.shouldUseIDB()).toBe(false);

    selectedSeriesIds.clear();
    selectedLabelIds.add('label-1');
    expect(runtime.shouldUseIDB()).toBe(false);
  });

  it('parses sort value from the current sort select', () => {
    const { runtime, options } = createRuntime();

    expect(runtime.parseSort()).toEqual({ orderBy: 'id', order: 'asc' });

    options.sortSelect.value = 'updatedAt_desc';
    expect(runtime.parseSort()).toEqual({ orderBy: 'updatedAt', order: 'desc' });
  });

  it('loads a server page and updates records page state', async () => {
    const { runtime, options, state } = createRuntime();

    await runtime.renderServerPage();

    expect(state.serverModeActive).toBe(true);
    expect(options.videoList.innerHTML).toBe('<li class="empty-list">加载中...</li>');
    expect(options.loadServerPage).toHaveBeenCalledWith(expect.objectContaining({
      currentPage: 2,
      recordsPerPage: 20,
      searchText: 'MKMP-577',
      status: 'viewed',
      sort: { orderBy: 'id', order: 'asc' },
      selectedTags: options.selectedTags,
      selectedListIds: options.selectedListIds,
      listNameById: options.listNameById,
      advancedConditions: [],
      favoritesFilterActive: true,
      queryRecords: options.queryRecords,
      pageRecords: options.pageRecords,
    }));
    expect(state.serverPageItems.map(item => item.id)).toEqual(['MKMP-577']);
    expect(state.serverTotal).toBe(6);
    expect(state.lastQueryDurationMs).toBe(12);
    expect(options.renderVideoList).toHaveBeenCalledTimes(1);
    expect(options.renderPagination).toHaveBeenCalledTimes(1);
    expect(options.updateSearchResultCount).toHaveBeenCalledTimes(1);
  });

  it('keeps page state visible and reports an IDB failure when loading fails', async () => {
    const { runtime, options, state } = createRuntime({
      loadServerPage: vi.fn(async () => {
        throw new Error('boom');
      }),
    });

    await runtime.renderServerPage();

    expect(state.serverModeActive).toBe(true);
    expect(state.lastQueryDurationMs).toBeNull();
    expect(options.videoList.innerHTML).toBe('<li class="empty-list">加载失败：IndexedDB 查询异常，请稍后重试</li>');
    expect(options.showMessage).toHaveBeenCalledWith('IDB 查询失败，请稍后重试', 'error');
    expect(options.logWarning).toHaveBeenCalledWith('[RecordsTab] IDB 查询/分页失败', expect.any(Error));
    expect(options.renderVideoList).not.toHaveBeenCalled();
    expect(options.renderPagination).not.toHaveBeenCalled();
    expect(options.updateSearchResultCount).not.toHaveBeenCalled();
  });

  it('does not render a pending query after the records tab becomes hidden', async () => {
    let resolvePage: ((value: { items: VideoRecord[]; total: number; durationMs: number }) => void) | null = null;
    let active = true;
    const { runtime, options } = createRuntime({
      isActive: () => active,
      loadServerPage: vi.fn(() => new Promise((resolve) => {
        resolvePage = resolve;
      })),
    });

    const pending = runtime.renderServerPage();
    active = false;
    runtime.invalidate();
    resolvePage?.({ items: [record('stale-record')], total: 1, durationMs: 5 });
    await pending;

    expect(options.renderVideoList).not.toHaveBeenCalled();
    expect(options.renderPagination).not.toHaveBeenCalled();
    expect(options.updateSearchResultCount).not.toHaveBeenCalled();
  });
});
