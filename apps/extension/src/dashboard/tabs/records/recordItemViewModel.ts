import type { VideoRecord } from '../../../types';

export interface RecordsItemTimeDisplay {
  createdDateText: string;
  updatedDateText: string;
  titleText: string;
  visibleDateText: string;
}

export interface RecordsItemBaseHtmlOptions {
  viewMode: 'list' | 'card';
  selectedTags: Set<string>;
  selectedListIds: Set<string>;
  listNameById: Map<string, string>;
  escapeHtml?: (value: string) => string;
}

export interface RecordsItemListBadgesOptions {
  selectedListIds: Set<string>;
  listNameById: Map<string, string>;
  escapeHtml?: (value: string) => string;
}

const defaultEscapeHtml = (value: string): string =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function formatRecordsItemDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function buildRecordsItemTimeDisplay(record: VideoRecord): RecordsItemTimeDisplay {
  const createdDateText = formatRecordsItemDate(record.createdAt);
  const updatedDateText = formatRecordsItemDate(record.updatedAt);
  const hasSameTime = record.createdAt === record.updatedAt;
  const titleText = hasSameTime
    ? `创建: ${createdDateText}`
    : `创建: ${createdDateText} | 更新: ${updatedDateText}`;

  return {
    createdDateText,
    updatedDateText,
    titleText,
    visibleDateText: hasSameTime ? createdDateText : updatedDateText,
  };
}

export function buildRecordsItemVideoIdHtml(record: VideoRecord, escapeHtml = defaultEscapeHtml): string {
  const id = escapeHtml(record.id);
  const url = String(record.javdbUrl || '').trim();
  if (url && url !== '#') {
    return `<a href="${escapeHtml(url)}" target="_blank" class="video-id-link">${id}</a>`;
  }
  return `<span class="video-id-text">${id}</span>`;
}

function buildStars(count: number, half: boolean): string {
  const empty = 5 - count - (half ? 1 : 0);
  return [
    ...Array.from({ length: count }, () => '<i class="fas fa-star"></i>'),
    ...(half ? ['<i class="fas fa-star-half-alt"></i>'] : []),
    ...Array.from({ length: empty }, () => '<i class="far fa-star"></i>'),
  ].join('');
}

export function buildRecordsItemStarsHtml(record: Pick<VideoRecord, 'rating' | 'userRating'>): string {
  let html = '';

  if (record.rating && record.rating > 0) {
    const fullStars = Math.floor(record.rating);
    const hasHalfStar = record.rating % 1 >= 0.5;
    html += `<span class="rating-stars official" title="官方评分: ${record.rating.toFixed(2)}">${buildStars(fullStars, hasHalfStar)}</span>`;
  }

  if (record.userRating && record.userRating > 0) {
    const fullStars = Math.floor(record.userRating);
    const hasHalfStar = record.userRating % 1 >= 0.5;
    html += `<span class="rating-stars user" title="我的评分: ${record.userRating.toFixed(1)}">${buildStars(fullStars, hasHalfStar)}</span>`;
  }

  return html;
}

export function buildRecordsItemTagsHtml(record: Pick<VideoRecord, 'tags'>, selectedTags: Set<string>, escapeHtml = defaultEscapeHtml): string {
  if (!record.tags || record.tags.length === 0) return '';

  const selectedTokensLower = Array.from(selectedTags).map((tag) => String(tag).toLowerCase());
  const tagsHtml = record.tags.map((tag) => {
    const tagText = String(tag);
    const tagLower = tagText.toLowerCase();
    const isSelected = selectedTokensLower.length > 0 && selectedTokensLower.some((token) => tagLower.includes(token));
    const safeTag = escapeHtml(tagText);
    return `<span class="video-tag ${isSelected ? 'selected' : ''}" data-tag="${safeTag}" title="点击筛选此标签">${safeTag}</span>`;
  }).join('');

  return `<div class="video-tags">${tagsHtml}</div>`;
}

export function buildRecordsItemUserTagsHtml(
  record: Pick<VideoRecord, 'userTags'>,
  selectedTags: Set<string>,
  escapeHtml = defaultEscapeHtml,
): string {
  if (!record.userTags || record.userTags.length === 0) return '';

  const selectedTokensLower = Array.from(selectedTags).map((tag) => String(tag).toLowerCase());
  const tagsHtml = record.userTags.map((tag) => {
    const tagText = String(tag);
    const tagLower = tagText.toLowerCase();
    const isSelected = selectedTokensLower.length > 0 && selectedTokensLower.some((token) => tagLower.includes(token));
    const safeTag = escapeHtml(tagText);
    return `<span class="video-user-tag ${isSelected ? 'selected' : ''}" data-user-tag="${safeTag}" title="点击筛选此用户标签">${safeTag}</span>`;
  }).join('');

  return `<div class="video-user-tags" title="我的标签">${tagsHtml}</div>`;
}

export function buildRecordsItemListBadgesHtml(record: Pick<VideoRecord, 'listIds'>, options: RecordsItemListBadgesOptions): string {
  const escapeHtml = options.escapeHtml || defaultEscapeHtml;
  const listIds = Array.isArray(record.listIds) ? record.listIds.map((id) => String(id)) : [];
  const listNamesSafe = listIds.map((id) => escapeHtml(options.listNameById.get(id) || id));
  const listTitle = listNamesSafe.join('、');
  const listPreview = listNamesSafe.slice(0, 3);
  const listPreviewIds = listIds.slice(0, 3);
  const moreCount = Math.max(0, listNamesSafe.length - listPreview.length);

  if (listPreview.length === 0) return '';

  const badges = listPreview.map((name, index) => {
    const listId = listPreviewIds[index];
    const isSelected = options.selectedListIds.has(String(listId));
    return `<span class="video-list-tag ${isSelected ? 'selected' : ''}" data-list-id="${escapeHtml(listId)}" title="点击筛选此清单">${name}</span>`;
  }).join('');

  return `<div class="video-lists" title="${listTitle}">${badges}${moreCount > 0 ? `<span class="video-list-more">另有 ${moreCount} 个清单</span>` : ''}</div>`;
}

export function buildRecordsItemBaseHtml(record: VideoRecord, options: RecordsItemBaseHtmlOptions): string {
  const escapeHtml = options.escapeHtml || defaultEscapeHtml;
  const videoIdHtml = buildRecordsItemVideoIdHtml(record, escapeHtml);
  const starsHtml = buildRecordsItemStarsHtml(record);
  const tagsHtml = buildRecordsItemTagsHtml(record, options.selectedTags, escapeHtml);
  const userTagsHtml = buildRecordsItemUserTagsHtml(record, options.selectedTags, escapeHtml);
  const listsHtml = buildRecordsItemListBadgesHtml(record, {
    selectedListIds: options.selectedListIds,
    listNameById: options.listNameById,
    escapeHtml,
  });
  const titleHtml = `<span class="video-title">${escapeHtml(String(record.title || ''))}</span>`;

  if (options.viewMode === 'card') {
    return `
      <div class="video-content-wrapper">
        <div class="video-id-container">
          ${videoIdHtml}
          ${starsHtml}
        </div>
        ${tagsHtml}
        ${userTagsHtml}
        ${listsHtml}
        ${titleHtml}
      </div>
    `;
  }

  const timeDisplay = buildRecordsItemTimeDisplay(record);
  return `
    <div class="video-content-wrapper">
      <div class="video-id-container">
        ${videoIdHtml}
        ${starsHtml}
      </div>
      ${tagsHtml}
      ${userTagsHtml}
      ${listsHtml}
      ${titleHtml}
    </div>
    <span class="video-date" title="${escapeHtml(timeDisplay.titleText)}">${timeDisplay.visibleDateText}</span>
    <span class="video-status status-${escapeHtml(String(record.status))}">${escapeHtml(String(record.status))}</span>
  `;
}
