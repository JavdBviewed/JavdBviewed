/**
 * @file statusQuickActions.ts
 * @description statusQuickActions
 * @module features/listEnhancement
 */
import type { ExtensionSettings, VideoRecord, VideoStatus } from '../../../types';
import { dbViewedGet, dbViewedPut } from '../../../platform/storage/dbRuntimeClient';
import { showToast } from '../../../platform/browser/toast';
import { VIDEO_STATUS } from '../../../utils/config';
import { STATE, getContentRecord, setContentRecord, log } from '../../contentState';

type TrackedStatus = typeof VIDEO_STATUS.BROWSED | typeof VIDEO_STATUS.WANT | typeof VIDEO_STATUS.VIEWED;

interface StatusQuickAction {
  status: TrackedStatus;
  label: string;
  title: string;
  tagText: string;
  tagClass: string;
}

const STATUS_QUICK_ACTIONS: StatusQuickAction[] = [
  {
    status: VIDEO_STATUS.BROWSED,
    label: '已阅',
    title: '标记为已浏览',
    tagText: '已浏览',
    tagClass: 'is-warning',
  },
  {
    status: VIDEO_STATUS.WANT,
    label: '想看',
    title: '标记为我想看',
    tagText: '我想看',
    tagClass: 'is-info',
  },
  {
    status: VIDEO_STATUS.VIEWED,
    label: '已看',
    title: '标记为已观看',
    tagText: '已观看',
    tagClass: 'is-success',
  },
];

export function renderListStatusQuickActions(
  item: HTMLElement,
  videoId: string,
  settings: ExtensionSettings | null = STATE.settings,
): void {
  const existing = item.querySelector('.jdb-list-status-actions');
  if ((settings as any)?.listEnhancement?.enableStatusQuickAction !== true) {
    existing?.remove();
    return;
  }

  const link = item.querySelector<HTMLAnchorElement>('a.box[href*="/v/"], a[href*="/v/"].box, a.box');
  if (!link) {
    existing?.remove();
    return;
  }

  existing?.remove();
  ensureListStatusQuickActionStyles();
  link.classList.add('jdb-list-status-action-anchor');

  const actions = document.createElement('div');
  actions.className = 'jdb-list-status-actions pos-bottom-right';
  actions.setAttribute('role', 'group');
  actions.setAttribute('aria-label', '影片状态快捷标记');

  const currentStatus = getContentRecord(videoId)?.status;
  STATUS_QUICK_ACTIONS.forEach((action) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `jdb-list-status-action status-${action.status}`;
    button.dataset.status = action.status;
    button.textContent = action.label;
    button.title = action.title;
    button.setAttribute('aria-label', action.title);
    if (currentStatus === action.status) {
      button.classList.add('is-active');
    }

    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void updateListItemStatus(item, videoId, action.status, settings);
    });

    actions.appendChild(button);
  });

  link.appendChild(actions);
}

async function updateListItemStatus(
  item: HTMLElement,
  videoId: string,
  status: TrackedStatus,
  settings: ExtensionSettings | null,
): Promise<void> {
  const previous = getContentRecord(videoId) || await dbViewedGet(videoId);
  const now = Date.now();
  const record: VideoRecord = {
    ...(previous || {}),
    id: videoId,
    title: previous?.title || extractListItemTitle(item, videoId),
    status: status as VideoStatus,
    tags: previous?.tags || [],
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  };

  const link = item.querySelector<HTMLAnchorElement>('a[href*="/v/"]');
  const cover = item.querySelector<HTMLImageElement>('.cover img, img');
  if (!record.javdbUrl && link?.href) record.javdbUrl = link.href;
  if (!record.coverImage && cover?.src) record.coverImage = cover.src;
  if (!record.javdbImage && cover?.src) record.javdbImage = cover.src;

  try {
    const result = await dbViewedPut(record);
    if (result.skipped) {
      showToast(`${videoId} 在回收站中，跳过更新`, 'warning');
      return;
    }
    setContentRecord(record);
    syncQuickActionActiveState(item, status);
    syncStatusBadge(item, status, settings);
    showToast(`${videoId} 已更新状态`, 'success');
  } catch (error) {
    log('Failed to update list status quick action:', error);
    showToast('状态更新失败', 'error');
  }
}

function syncQuickActionActiveState(item: HTMLElement, status: TrackedStatus): void {
  item.querySelectorAll<HTMLElement>('.jdb-list-status-action').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.status === status);
  });
}

function syncStatusBadge(
  item: HTMLElement,
  status: TrackedStatus,
  settings: ExtensionSettings | null,
): void {
  item.querySelectorAll('.custom-status-tag').forEach(tag => tag.remove());
  if ((settings as any)?.listEnhancement?.showStatusBadge === false) {
    return;
  }

  const tagContainer = findOrCreateTagContainer(item);
  if (!tagContainer) return;

  const action = STATUS_QUICK_ACTIONS.find(entry => entry.status === status);
  if (!action) return;

  const tag = document.createElement('span');
  tag.className = `tag ${action.tagClass} is-light custom-status-tag`;
  tag.textContent = action.tagText;
  tagContainer.appendChild(tag);
}

function findOrCreateTagContainer(item: HTMLElement): HTMLElement | null {
  let tagContainer = item.querySelector<HTMLElement>('.tags.has-addons, .tags');
  if (tagContainer) return tagContainer;

  const videoTitle = item.querySelector('.video-title');
  if (!videoTitle) return null;

  tagContainer = document.createElement('div');
  tagContainer.className = 'tags has-addons';
  videoTitle.appendChild(tagContainer);
  return tagContainer;
}

function extractListItemTitle(item: HTMLElement, videoId: string): string {
  const dataTitle = item.querySelector<HTMLElement>('.x-btn')?.dataset.title?.trim();
  if (dataTitle) return dataTitle;

  const titleText = item.querySelector('.video-title')?.textContent?.trim() || '';
  return titleText.replace(videoId, '').trim();
}

function ensureListStatusQuickActionStyles(): void {
  const styleId = 'jdb-list-status-actions-style';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .movie-list .item a.box.jdb-list-status-action-anchor,
    .movie-list .item a[href*="/v/"].jdb-list-status-action-anchor {
      position: relative;
    }

    .jdb-list-status-actions {
      position: absolute;
      right: 8px;
      bottom: 8px;
      z-index: 16;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 3px;
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.72);
      box-shadow: 0 8px 18px rgba(15, 23, 42, 0.22);
      backdrop-filter: blur(6px);
      opacity: 0.92;
      transition: opacity 0.16s ease, transform 0.16s ease;
    }

    .jdb-list-status-actions.pos-bottom-right {
      right: 8px;
      bottom: 8px;
    }

    .jdb-list-status-action {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 34px;
      height: 24px;
      padding: 0 8px;
      border: 0;
      border-radius: 999px;
      color: #e5e7eb;
      background: transparent;
      font-size: 12px;
      font-weight: 800;
      line-height: 1;
      cursor: pointer;
    }

    .jdb-list-status-actions:hover,
    .jdb-list-status-actions:focus-within {
      opacity: 0.98;
      transform: translateY(0);
    }

    .jdb-list-status-action:hover,
    .jdb-list-status-action.is-active {
      color: #0f172a;
      background: #f8fafc;
    }

    .jdb-list-status-action.status-viewed.is-active {
      background: #bbf7d0;
      color: #166534;
    }

    .jdb-list-status-action.status-want.is-active {
      background: #bae6fd;
      color: #075985;
    }

    .jdb-list-status-action.status-browsed.is-active {
      background: #fde68a;
      color: #92400e;
    }
  `;
  document.head.appendChild(style);
}
