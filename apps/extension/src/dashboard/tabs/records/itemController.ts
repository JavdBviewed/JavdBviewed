import type { VideoRecord } from '../../../types';
import type { SearchEngineTemplate } from '../../../features/externalSearch/domain/searchEngines';
import { createRecordsActionButtons, type RecordsActionButtonHandler } from './actionButtonsController';
import { createRecordsCoverElement, observeRecordsCoverImage, insertRecordsCoverElement } from './coverController';
import { bindRecordsImageTooltip, type BindRecordsImageTooltipOptions } from './imageTooltipController';
import { buildRecordsItemBaseHtml } from './recordItemViewModel';
import { createRecordsSearchIconsContainer } from './searchIconsController';

export interface CreateRecordsItemElementOptions {
  record: VideoRecord;
  viewMode: 'list' | 'card';
  coversEnabled: boolean;
  selectedRecordIds: Set<string>;
  selectedTags: Set<string>;
  selectedListIds: Set<string>;
  listNameById: Map<string, string>;
  searchEngines: unknown;
  fallbackIconUrl: string;
  imageTooltipElement: HTMLDivElement | null;
  coverObserver: Pick<IntersectionObserver, 'observe'> | null | undefined;
  escapeHtml?: (value: string) => string;
  bindImageTooltip?: (options: BindRecordsImageTooltipOptions) => void;
  onToggleRecordSelection: (recordId: string, selected: boolean) => void;
  onToggleTagFilter: (tag: string) => void;
  onToggleListFilter: (listId: string) => void;
  actionCallbacks: {
    onToggleFavorite: RecordsActionButtonHandler;
    onEdit: RecordsActionButtonHandler;
    onRefresh: RecordsActionButtonHandler;
    onDelete: RecordsActionButtonHandler;
    onOpenListPicker: RecordsActionButtonHandler;
  };
}

function bindRecordsItemRowSelection(row: HTMLLIElement, options: CreateRecordsItemElementOptions): void {
  row.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('button, a, .video-tag, .video-user-tag, .video-list-tag, .video-list-more')) {
      return;
    }

    const isSelected = options.selectedRecordIds.has(options.record.id);
    options.onToggleRecordSelection(options.record.id, !isSelected);
  });
}

function bindRecordsItemFilterTags(row: HTMLLIElement, options: CreateRecordsItemElementOptions): void {
  row.querySelectorAll('.video-tag, .video-user-tag').forEach((tagElement) => {
    tagElement.addEventListener('click', (event) => {
      event.stopPropagation();
      const tag = tagElement.getAttribute('data-tag') || tagElement.getAttribute('data-user-tag');
      if (tag) options.onToggleTagFilter(tag);
    });
  });

  row.querySelectorAll('.video-list-tag').forEach((listElement) => {
    listElement.addEventListener('click', (event) => {
      event.stopPropagation();
      const listId = listElement.getAttribute('data-list-id');
      if (listId) options.onToggleListFilter(listId);
    });
  });
}

function bindRecordsItemIdTooltip(row: HTMLLIElement, options: CreateRecordsItemElementOptions): void {
  const videoIdLink = row.querySelector('.video-id-link') as HTMLAnchorElement | null;
  if (!videoIdLink || !options.record.javdbImage) return;

  (options.bindImageTooltip || bindRecordsImageTooltip)({
    target: videoIdLink,
    tooltip: options.imageTooltipElement,
    imageUrl: options.record.javdbImage,
    title: String(options.record.title || ''),
  });
}

function createRecordsItemCover(row: HTMLLIElement, options: CreateRecordsItemElementOptions): void {
  const coverUrl = (options.record.enhancedData?.coverImage || options.record.javdbImage || '').trim();
  const bigImageUrl = (options.record.javdbImage || coverUrl || '').trim();
  const cover = createRecordsCoverElement({
    title: String(options.record.title || ''),
    coverUrl,
    tooltipImageUrl: bigImageUrl,
    fallbackUrl: options.fallbackIconUrl,
    tooltip: options.imageTooltipElement,
    bindTooltip: options.bindImageTooltip,
  });
  insertRecordsCoverElement(row, cover);
}

function createRecordsItemControls(
  iconsContainer: HTMLDivElement,
  actionButtonsContainer: HTMLDivElement,
): HTMLDivElement {
  const controlsContainer = document.createElement('div');
  controlsContainer.className = 'video-controls';
  controlsContainer.appendChild(iconsContainer);
  controlsContainer.appendChild(actionButtonsContainer);
  return controlsContainer;
}

export function createRecordsItemElement(options: CreateRecordsItemElementOptions): HTMLLIElement {
  const { record } = options;
  const row = document.createElement('li');
  row.className = 'video-item batch-mode';
  row.dataset.recordId = record.id;

  if (options.selectedRecordIds.has(record.id)) {
    row.classList.add('selected');
  }

  const iconsContainer = createRecordsSearchIconsContainer({
    engines: options.searchEngines,
    videoId: record.id,
    fallbackIconUrl: options.fallbackIconUrl,
  });
  const actionButtonsContainer = createRecordsActionButtons({
    record,
    ...options.actionCallbacks,
  });
  const controlsContainer = createRecordsItemControls(iconsContainer, actionButtonsContainer);

  row.innerHTML = buildRecordsItemBaseHtml(record, {
    viewMode: options.viewMode,
    selectedTags: options.selectedTags,
    selectedListIds: options.selectedListIds,
    listNameById: options.listNameById,
    escapeHtml: options.escapeHtml,
  });

  const shouldShowCover = options.viewMode === 'card' || options.coversEnabled;
  if (shouldShowCover) {
    createRecordsItemCover(row, options);
  }

  bindRecordsItemIdTooltip(row, options);
  bindRecordsItemRowSelection(row, options);
  bindRecordsItemFilterTags(row, options);

  if (options.viewMode === 'card') {
    row.querySelector('.video-content-wrapper')?.appendChild(iconsContainer);

    const statusSpan = document.createElement('span');
    statusSpan.className = `video-status status-${record.status}`;
    statusSpan.textContent = record.status;
    row.appendChild(statusSpan);

    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'video-controls';
    controlsDiv.appendChild(actionButtonsContainer);
    row.appendChild(controlsDiv);
  } else {
    row.appendChild(controlsContainer);
  }

  if (shouldShowCover) {
    observeRecordsCoverImage(row, options.coverObserver);
  }

  return row;
}
