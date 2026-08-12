/**
 * @file favoriteQuickAction.ts
 * @description 列表页收藏快捷按钮
 * @module features/listEnhancement
 */
import type { ExtensionSettings, VideoRecord, VideoStatus } from '../../../types';
import { dbViewedGet, dbViewedPut } from '../../../platform/storage/dbRuntimeClient';
import { showToast } from '../../../platform/browser/toast';
import { VIDEO_STATUS } from '../../../utils/config';
import { STATE, getContentRecord, setContentRecord, log } from '../../contentState';

const FAVORITE_ICON_ACTIVE = '♥';
const FAVORITE_ICON_INACTIVE = '♡';

export function renderListFavoriteQuickAction(
  item: HTMLElement,
  videoId: string,
  settings: ExtensionSettings | null = STATE.settings,
): void {
  const existing = item.querySelector('.jdb-list-favorite-actions');
  if ((settings as any)?.listEnhancement?.enableListFavoriteQuickAction !== true) {
    existing?.remove();
    return;
  }

  const link = item.querySelector<HTMLAnchorElement>('a.box[href*="/v/"], a[href*="/v/"].box, a.box');
  if (!link) {
    existing?.remove();
    return;
  }

  existing?.remove();
  ensureListFavoriteQuickActionStyles();
  link.classList.add('jdb-list-favorite-action-anchor');

  const actions = document.createElement('div');
  actions.className = 'jdb-list-favorite-actions pos-top-right';
  actions.setAttribute('role', 'group');
  actions.setAttribute('aria-label', '影片收藏快捷操作');

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'jdb-list-favorite-action';
  syncFavoriteButton(button, getContentRecord(videoId)?.isFavorite === true);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void updateListItemFavorite(item, videoId);
  });

  actions.appendChild(button);
  link.appendChild(actions);
}

async function updateListItemFavorite(item: HTMLElement, videoId: string): Promise<void> {
  const previous = getContentRecord(videoId) || await dbViewedGet(videoId);
  const now = Date.now();
  const isFavorite = previous?.isFavorite !== true;
  const previousStatus = previous?.status;
  const record: VideoRecord = {
    ...(previous || {}),
    id: videoId,
    title: previous?.title || extractListItemTitle(item, videoId),
    status: (
      previousStatus && previousStatus !== VIDEO_STATUS.UNTRACKED
        ? previousStatus
        : VIDEO_STATUS.BROWSED
    ) as VideoStatus,
    tags: previous?.tags || [],
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    isFavorite,
  };

  if (isFavorite) {
    record.favoritedAt = now;
  } else {
    delete record.favoritedAt;
  }

  const link = item.querySelector<HTMLAnchorElement>('a[href*="/v/"]');
  const cover = item.querySelector<HTMLImageElement>('.cover img, img');
  if (!record.javdbUrl && link?.href) record.javdbUrl = link.href;
  if (!record.coverImage && cover?.src) record.coverImage = cover.src;
  if (!record.javdbImage && cover?.src) record.javdbImage = cover.src;

  try {
    const result = await dbViewedPut(record);
    if (result.skipped) {
      showToast(`${videoId} 在回收站中，跳过收藏更新`, 'warning');
      return;
    }

    setContentRecord(record);
    syncFavoriteActionState(item, isFavorite);
    showToast(isFavorite ? `${videoId} 已添加到收藏` : `${videoId} 已取消收藏`, 'success');
  } catch (error) {
    log('Failed to update list favorite quick action:', error);
    showToast('收藏更新失败', 'error');
  }
}

function syncFavoriteActionState(item: HTMLElement, isFavorite: boolean): void {
  item.querySelectorAll<HTMLButtonElement>('.jdb-list-favorite-action').forEach((button) => {
    syncFavoriteButton(button, isFavorite);
  });
}

function syncFavoriteButton(button: HTMLButtonElement, isFavorite: boolean): void {
  button.classList.toggle('is-active', isFavorite);
  button.textContent = isFavorite ? FAVORITE_ICON_ACTIVE : FAVORITE_ICON_INACTIVE;
  button.title = isFavorite ? '取消收藏' : '添加到收藏';
  button.setAttribute('aria-label', button.title);
  button.setAttribute('aria-pressed', String(isFavorite));
}

function extractListItemTitle(item: HTMLElement, videoId: string): string {
  const dataTitle = item.querySelector<HTMLElement>('.x-btn')?.dataset.title?.trim();
  if (dataTitle) return dataTitle;

  const titleText = item.querySelector('.video-title')?.textContent?.trim() || '';
  return titleText.replace(videoId, '').trim() || videoId;
}

function ensureListFavoriteQuickActionStyles(): void {
  const styleId = 'jdb-list-favorite-actions-style';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .movie-list .item a.box.jdb-list-favorite-action-anchor,
    .movie-list .item a[href*="/v/"].jdb-list-favorite-action-anchor {
      position: relative;
    }

    .jdb-list-favorite-actions {
      position: absolute;
      right: 8px;
      top: 8px;
      z-index: 17;
      display: inline-flex;
      align-items: center;
      padding: 3px;
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.72);
      box-shadow: 0 8px 18px rgba(15, 23, 42, 0.22);
      backdrop-filter: blur(6px);
      opacity: 0.92;
      transition: opacity 0.16s ease, transform 0.16s ease;
    }

    .jdb-list-favorite-actions.pos-top-right {
      right: 8px;
      top: 8px;
    }

    .jdb-list-favorite-action {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 24px;
      padding: 0;
      border: 0;
      border-radius: 999px;
      color: #e5e7eb;
      background: transparent;
      font-size: 15px;
      font-weight: 800;
      line-height: 1;
      cursor: pointer;
    }

    .jdb-list-favorite-actions:hover,
    .jdb-list-favorite-actions:focus-within {
      opacity: 0.98;
    }

    .jdb-list-favorite-action:hover,
    .jdb-list-favorite-action.is-active {
      color: #be123c;
      background: #ffe4e6;
    }
  `;
  document.head.appendChild(style);
}
