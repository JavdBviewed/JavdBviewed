import type { VideoRecord } from '../../../types';
import type { ViewedQueryParams } from '../../dbClient';
import type { MediaStateHit } from './mediaStateFilterModel';
import type { RecordsAdvancedCondition } from './advancedConditionModel';
import type { RecordsExportController } from './exportController';
import {
  createRecordsExportRuntime,
  type RecordsExportRuntime,
} from './exportRuntime';
import {
  createRecordsListViewController,
  type RecordsListViewActionCallbacks,
  type RecordsListViewController,
  type RecordsListViewCoverRuntime,
} from './listViewController';
import {
  createRecordsPaginationRuntime,
  type RecordsPaginationRuntime,
} from './paginationRuntime';
import type { RecordsSort } from './queryModel';

export interface CreateRecordsViewRuntimeOptions {
  videoList: HTMLUListElement;
  paginationContainer: HTMLElement;
  getSourceRecords: () => VideoRecord[];
  isServerModeActive: () => boolean;
  getServerTotal: () => number;
  getFilteredCount: () => number;
  getCurrentPage: () => number;
  setCurrentPage: (page: number) => void;
  getRecordsPerPage: () => number;
  getViewMode: () => 'list' | 'card';
  getCoversEnabled: () => boolean;
  coverRuntime: RecordsListViewCoverRuntime;
  updateSearchResultCount: () => void;
  ensureListMetaLoaded: () => void;
  selectedRecordIds: Set<string>;
  selectedTags: Set<string>;
  selectedListIds: Set<string>;
  listNameById: Map<string, string>;
  getSearchEngines: () => unknown;
  fallbackIconUrl: string;
  escapeHtml?: (value: string) => string;
  onToggleRecordSelection: (recordId: string, selected: boolean) => void;
  /** 10-24 state-dict：per-record 媒体库状态命中（未注入=不渲染派生 chip）。 */
  getMediaStateHit?: (record: VideoRecord) => MediaStateHit | null;
  onFilterChanged: () => void;
  refreshTags: () => void;
  refreshLists: () => void;
  actionCallbacks: RecordsListViewActionCallbacks;
  onRenderRecordError?: (error: unknown, record: VideoRecord) => void;
  getFilteredRecords: () => VideoRecord[];
  getSearchText: () => string;
  getStatus: () => VideoRecord['status'] | 'all';
  getSort: () => RecordsSort | null;
  getAdvancedConditions: () => RecordsAdvancedCondition[];
  queryRecords: (params: ViewedQueryParams) => Promise<{ items?: VideoRecord[]; total?: number }>;
  showProgress: (title: string, total: number) => HTMLElement | null;
  hideProgress: (modal: HTMLElement | null) => void;
  exportController: RecordsExportController;
  renderPage: () => void;
  createListViewController?: typeof createRecordsListViewController;
  createPaginationRuntime?: typeof createRecordsPaginationRuntime;
  createExportRuntime?: typeof createRecordsExportRuntime;
}

export interface RecordsViewRuntime {
  listViewController: RecordsListViewController;
  paginationRuntime: RecordsPaginationRuntime;
  exportRuntime: RecordsExportRuntime;
  renderVideoList: () => void;
  renderPagination: () => void;
  handleExportRecords: () => Promise<void>;
  getRecordsForExport: () => Promise<VideoRecord[]>;
}

export function createRecordsViewRuntime(options: CreateRecordsViewRuntimeOptions): RecordsViewRuntime {
  const createListView = options.createListViewController || createRecordsListViewController;
  const createPagination = options.createPaginationRuntime || createRecordsPaginationRuntime;
  const createExport = options.createExportRuntime || createRecordsExportRuntime;

  const listViewController = createListView({
    videoList: options.videoList,
    getSourceRecords: options.getSourceRecords,
    isServerModeActive: options.isServerModeActive,
    getCurrentPage: options.getCurrentPage,
    getRecordsPerPage: options.getRecordsPerPage,
    getViewMode: options.getViewMode,
    getCoversEnabled: options.getCoversEnabled,
    coverRuntime: options.coverRuntime,
    updateSearchResultCount: options.updateSearchResultCount,
    ensureListMetaLoaded: options.ensureListMetaLoaded,
    selectedRecordIds: options.selectedRecordIds,
    selectedTags: options.selectedTags,
    selectedListIds: options.selectedListIds,
    listNameById: options.listNameById,
    getSearchEngines: options.getSearchEngines,
    fallbackIconUrl: options.fallbackIconUrl,
    escapeHtml: options.escapeHtml,
    onToggleRecordSelection: options.onToggleRecordSelection,
    getMediaStateHit: options.getMediaStateHit,
    onFilterChanged: options.onFilterChanged,
    refreshTags: options.refreshTags,
    refreshLists: options.refreshLists,
    actionCallbacks: options.actionCallbacks,
    onRenderRecordError: options.onRenderRecordError,
  });

  const paginationRuntime = createPagination({
    container: options.paginationContainer,
    isServerModeActive: options.isServerModeActive,
    getServerTotal: options.getServerTotal,
    getFilteredCount: options.getFilteredCount,
    getRecordsPerPage: options.getRecordsPerPage,
    getCurrentPage: options.getCurrentPage,
    setCurrentPage: options.setCurrentPage,
    renderPage: options.renderPage,
  });

  const exportRuntime = createExport({
    isServerModeActive: options.isServerModeActive,
    getFilteredRecords: options.getFilteredRecords,
    getSearchText: options.getSearchText,
    getStatus: options.getStatus,
    getSort: options.getSort,
    selectedRecordIds: options.selectedRecordIds,
    selectedTags: options.selectedTags,
    selectedListIds: options.selectedListIds,
    listNameById: options.listNameById,
    getAdvancedConditions: options.getAdvancedConditions,
    queryRecords: options.queryRecords,
    showProgress: options.showProgress,
    hideProgress: options.hideProgress,
    exportController: options.exportController,
  });

  return {
    listViewController,
    paginationRuntime,
    exportRuntime,
    renderVideoList: () => listViewController.render(),
    renderPagination: () => paginationRuntime.render(),
    handleExportRecords: () => exportRuntime.handleExportRecords(),
    getRecordsForExport: () => exportRuntime.getRecordsForExport(),
  };
}
