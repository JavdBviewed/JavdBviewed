import type { VideoRecord } from '../../../types';
import type { BindRecordsImageTooltipOptions } from './imageTooltipController';
import type { MediaStateHit } from './mediaStateFilterModel';
import { bindRecordsImageTooltip } from './imageTooltipController';
import {
  createRecordsItemElement,
  type CreateRecordsItemElementOptions,
} from './itemController';
import {
  renderRecordsList,
  type RenderRecordsListOptions,
} from './listRenderer';

export interface RecordsListViewCoverRuntime {
  setupObserver: () => IntersectionObserver | null;
  teardownObserver: () => void;
  getTooltipElement: () => HTMLDivElement | null;
  getObserver: () => IntersectionObserver | null;
}

export interface RecordsListViewActionCallbacks {
  onToggleFavorite: CreateRecordsItemElementOptions['actionCallbacks']['onToggleFavorite'];
  onEdit: CreateRecordsItemElementOptions['actionCallbacks']['onEdit'];
  onRefresh: CreateRecordsItemElementOptions['actionCallbacks']['onRefresh'];
  onDelete: CreateRecordsItemElementOptions['actionCallbacks']['onDelete'];
  onOpenListPicker: CreateRecordsItemElementOptions['actionCallbacks']['onOpenListPicker'];
}

export interface CreateRecordsListViewControllerOptions {
  videoList: HTMLUListElement;
  getSourceRecords: () => VideoRecord[];
  isServerModeActive: () => boolean;
  getCurrentPage: () => number;
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
  bindImageTooltip?: (options: BindRecordsImageTooltipOptions) => void;
  /** 10-24 state-dict：per-record 媒体库状态命中（未注入=不渲染派生 chip）。 */
  getMediaStateHit?: (record: VideoRecord) => MediaStateHit | null;
  onToggleRecordSelection: (recordId: string, selected: boolean) => void;
  onFilterChanged: () => void;
  refreshTags: () => void;
  refreshLists: () => void;
  actionCallbacks: RecordsListViewActionCallbacks;
  onRenderRecordError?: (error: unknown, record: VideoRecord) => void;
  renderList?: (options: RenderRecordsListOptions) => void;
  createItemElement?: (options: CreateRecordsItemElementOptions) => HTMLLIElement;
}

export interface RecordsListViewController {
  render: () => void;
}

function toggleSetValue(values: Set<string>, value: string): void {
  if (values.has(value)) {
    values.delete(value);
    return;
  }
  values.add(value);
}

export function createRecordsListViewController(
  options: CreateRecordsListViewControllerOptions,
): RecordsListViewController {
  const renderList = options.renderList || renderRecordsList;
  const createItemElement = options.createItemElement || createRecordsItemElement;
  const bindTooltip = options.bindImageTooltip || bindRecordsImageTooltip;

  const render = () => {
    const viewMode = options.getViewMode();
    const coversEnabled = options.getCoversEnabled();
    renderList({
      videoList: options.videoList,
      sourceRecords: options.getSourceRecords(),
      serverModeActive: options.isServerModeActive(),
      currentPage: options.getCurrentPage(),
      recordsPerPage: options.getRecordsPerPage(),
      viewMode,
      coversEnabled,
      setupCoverObserver: () => options.coverRuntime.setupObserver(),
      teardownCoverObserver: () => options.coverRuntime.teardownObserver(),
      updateSearchResultCount: options.updateSearchResultCount,
      ensureListMetaLoaded: options.ensureListMetaLoaded,
      createItemElement: (record) => createItemElement({
        record,
        viewMode,
        coversEnabled,
        selectedRecordIds: options.selectedRecordIds,
        selectedTags: options.selectedTags,
        selectedListIds: options.selectedListIds,
        listNameById: options.listNameById,
        searchEngines: options.getSearchEngines(),
        fallbackIconUrl: options.fallbackIconUrl,
        imageTooltipElement: options.coverRuntime.getTooltipElement(),
        coverObserver: options.coverRuntime.getObserver(),
        escapeHtml: options.escapeHtml,
        bindImageTooltip: bindTooltip,
        mediaStateHit: options.getMediaStateHit?.(record) ?? null,
        onToggleRecordSelection: options.onToggleRecordSelection,
        onToggleTagFilter: (tag) => {
          toggleSetValue(options.selectedTags, tag);
          options.onFilterChanged();
          options.refreshTags();
        },
        onToggleListFilter: (listId) => {
          toggleSetValue(options.selectedListIds, listId);
          options.onFilterChanged();
          options.refreshLists();
        },
        actionCallbacks: options.actionCallbacks,
      }),
      onRenderRecordError: options.onRenderRecordError,
    });
  };

  return { render };
}
