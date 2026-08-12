import type { VideoRecord, VideoStatus } from '../../../types';
import type { ViewedPageParams, ViewedQueryParams } from '../../dbClient';
import type { RecordsAdvancedCondition } from './advancedConditionModel';
import { loadRecordsServerPage, type LoadRecordsServerPageInput } from './serverPageProvider';
import { parseRecordsSortValue, type RecordsSort } from './queryModel';

type ToastType = 'info' | 'warn' | 'warning' | 'error' | 'success';

export interface CreateRecordsQueryRuntimeOptions {
  searchInput: HTMLInputElement;
  filterSelect: HTMLSelectElement;
  sortSelect: HTMLSelectElement;
  videoList: HTMLElement;
  getCurrentPage: () => number;
  getRecordsPerPage: () => number;
  selectedTags: Set<string>;
  selectedListIds: Set<string>;
  selectedSeriesIds: Set<string>;
  selectedLabelIds: Set<string>;
  listNameById: Map<string, string>;
  getAdvancedConditions: () => RecordsAdvancedCondition[];
  isFavoritesFilterActive: () => boolean;
  queryRecords: (params: ViewedQueryParams) => Promise<{ items?: VideoRecord[]; total?: number }>;
  pageRecords: (params: ViewedPageParams) => Promise<{ items?: VideoRecord[]; total?: number }>;
  setServerModeActive: (active: boolean) => void;
  setServerPageItems: (items: VideoRecord[]) => void;
  setServerTotal: (total: number) => void;
  setLastQueryDurationMs: (duration: number | null) => void;
  renderVideoList: () => void;
  renderPagination: () => void;
  updateSearchResultCount: () => void;
  showMessage: (message: string, type?: ToastType, duration?: number) => void;
  isActive?: () => boolean;
  logWarning?: (message: string, error: unknown) => void;
  loadServerPage?: (input: LoadRecordsServerPageInput) => Promise<{
    items: VideoRecord[];
    total: number;
    durationMs: number;
  }>;
}

export interface RecordsQueryRuntime {
  shouldUseIDB: () => boolean;
  parseSort: () => RecordsSort | null;
  renderServerPage: () => Promise<void>;
  invalidate: () => void;
}

export function createRecordsQueryRuntime(options: CreateRecordsQueryRuntimeOptions): RecordsQueryRuntime {
  const loadServerPage = options.loadServerPage || loadRecordsServerPage;
  let requestGeneration = 0;

  const isCurrentRequest = (generation: number): boolean => (
    generation === requestGeneration && (options.isActive?.() ?? true)
  );

  const shouldUseIDB = (): boolean => {
    return options.selectedSeriesIds.size === 0 && options.selectedLabelIds.size === 0;
  };

  const parseSort = (): RecordsSort | null => {
    return parseRecordsSortValue(options.sortSelect?.value || 'updatedAt_desc');
  };

  const renderServerPage = async (): Promise<void> => {
    const generation = ++requestGeneration;
    try {
      options.setServerModeActive(true);
      const sort = parseSort();
      const statusVal = (options.filterSelect?.value || 'all') as 'all' | VideoStatus;

      try { options.videoList.innerHTML = '<li class="empty-list">加载中...</li>'; } catch {}

      const pageResult = await loadServerPage({
        currentPage: options.getCurrentPage(),
        recordsPerPage: options.getRecordsPerPage(),
        searchText: (options.searchInput?.value || '').trim(),
        status: statusVal,
        sort,
        selectedTags: options.selectedTags,
        selectedListIds: options.selectedListIds,
        listNameById: options.listNameById,
        advancedConditions: options.getAdvancedConditions(),
        favoritesFilterActive: options.isFavoritesFilterActive(),
        queryRecords: options.queryRecords,
        pageRecords: options.pageRecords,
      });

      // 页面切走后，旧查询结果不得重新装配列表和图片。
      if (!isCurrentRequest(generation)) return;

      options.setLastQueryDurationMs(pageResult.durationMs);
      options.setServerPageItems(pageResult.items);
      options.setServerTotal(pageResult.total);
      options.renderVideoList();
      options.renderPagination();
      options.updateSearchResultCount();
    } catch (error) {
      if (!isCurrentRequest(generation)) return;
      options.setLastQueryDurationMs(null);
      if (options.logWarning) {
        options.logWarning('[RecordsTab] IDB 查询/分页失败', error);
      } else {
        console.warn('[RecordsTab] IDB 查询/分页失败', error);
      }
      try { options.videoList.innerHTML = '<li class="empty-list">加载失败：IndexedDB 查询异常，请稍后重试</li>'; } catch {}
      options.showMessage('IDB 查询失败，请稍后重试', 'error');
    }
  };

  return {
    shouldUseIDB,
    parseSort,
    renderServerPage,
    invalidate: () => {
      requestGeneration += 1;
    },
  };
}
