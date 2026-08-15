/**
 * @file statusBadges.ts
 * @description 列表/详情页 Emby·JF 入库与真实观看徽章
 * @module features/embyLibrary
 */
import { STATE } from '../../contentState';
import {
  buildMediaItemUrl,
  findLibraryMatches,
  normalizeServerUrl,
} from '../domain/libraryIndex';
import {
  computeWatchState,
  formatWatchPercent,
  watchStateLabel,
  type MediaWatchState,
} from '../domain/watchState';
import type { EmbyLibraryIndexEntry } from '../types';

type BadgeContext = 'list' | 'detail';

function isLibraryStatusEnabled(context: BadgeContext): boolean {
  const aggregate = (STATE.settings as any)?.libraryMatchStatus || (STATE.settings as any)?.listEnhancement?.libraryMatchStatus;
  if (aggregate?.enabled === true && aggregate?.sources?.emby !== false) return true;
  const config = (STATE.settings as any)?.emby?.libraryStatus;
  if (config?.enabled !== true) return false;
  if (context === 'list') return config.showOnList !== false;
  return config.showOnDetail !== false;
}

/** 入库来源标签（Emby/JF） */
function getSourceLabel(entry: EmbyLibraryIndexEntry): string {
  return entry.serverType === 'jellyfin' ? 'Jellyfin已入库' : 'Emby已入库';
}

function getSourceClassName(entry: EmbyLibraryIndexEntry): string {
  const style = entry.serverType === 'jellyfin' ? 'is-link' : 'is-success';
  return `tag ${style} is-light emby-library-status-tag emby-library-status-${entry.serverType}`;
}

/** 真实观看态徽章 class */
function getWatchClassName(state: MediaWatchState): string {
  if (state === 'watched') return 'tag is-success is-light emby-library-status-tag emby-library-watch-watched';
  if (state === 'in_progress') return 'tag is-warning is-light emby-library-status-tag emby-library-watch-progress';
  return 'tag is-info is-light emby-library-status-tag emby-library-watch-library';
}

function getWatchBadgeText(entry: EmbyLibraryIndexEntry): string | null {
  const state = computeWatchState(entry.userData);
  if (state === 'in_library' || state === 'none') return null;
  const label = watchStateLabel(state);
  if (state === 'in_progress') {
    const p = formatWatchPercent(entry.userData);
    return p ? `${label} ${p}` : label;
  }
  return label;
}

function hasLibraryIndex(): boolean {
  const state = STATE.embyLibraryState;
  if (!state) return false;
  if (Number(state.updatedAt || 0) > 0) return true;
  return Object.keys(state.entries || {}).length > 0;
}

function getConfiguredServerKeys(): Set<string> {
  const servers = (STATE.settings as any)?.emby?.mediaServers;
  if (!Array.isArray(servers)) return new Set();

  return new Set(servers
    .filter((server) => server && server.enabled !== false && server.url)
    .map((server) => `${server.type === 'jellyfin' ? 'jellyfin' : 'emby'}:${normalizeServerUrl(String(server.url || ''))}`));
}

function getConfiguredMatches(videoId: string): EmbyLibraryIndexEntry[] {
  const configuredServerKeys = getConfiguredServerKeys();
  if (configuredServerKeys.size === 0) return [];

  return findLibraryMatches(STATE.embyLibraryState, videoId).filter((entry) => {
    const entryKey = `${entry.serverType}:${normalizeServerUrl(entry.serverUrl)}`;
    return configuredServerKeys.has(entryKey);
  });
}

/**
 * 为容器追加入库 + 真实观看徽章（可点击跳转服务器）
 */
export function renderLibraryStatusBadges(container: HTMLElement, videoId: string, context: BadgeContext): void {
  container.querySelectorAll('.emby-library-status-tag').forEach((tag) => tag.remove());

  if (!isLibraryStatusEnabled(context)) return;

  const matches = getConfiguredMatches(videoId);
  if (matches.length === 0) return;

  for (const entry of matches) {
    const badge = document.createElement('a');
    badge.className = getSourceClassName(entry);
    badge.textContent = getSourceLabel(entry);
    badge.href = buildMediaItemUrl(entry);
    badge.target = '_blank';
    badge.rel = 'noopener noreferrer';
    badge.title = `${entry.serverName}: ${entry.itemName}`;
    badge.dataset.embyLibraryServerType = entry.serverType;
    badge.dataset.embyLibraryItemId = entry.itemId;
    container.appendChild(badge);

    // 真实观看态（与原站「已看」分离）
    const watchText = getWatchBadgeText(entry);
    if (watchText) {
      const watchBadge = document.createElement('a');
      const state = computeWatchState(entry.userData);
      watchBadge.className = getWatchClassName(state);
      watchBadge.textContent = watchText;
      watchBadge.href = buildMediaItemUrl(entry);
      watchBadge.target = '_blank';
      watchBadge.rel = 'noopener noreferrer';
      watchBadge.title = `${entry.serverName} · ${watchText}（真实观看，非原站已看）`;
      watchBadge.dataset.embyLibraryWatchState = state;
      container.appendChild(watchBadge);

      // 详情页：真实已看可一键加入 115 清理清单
      if (context === 'detail' && state === 'watched') {
        const cleanBtn = document.createElement('button');
        cleanBtn.type = 'button';
        cleanBtn.className = 'tag is-danger is-light emby-library-status-tag emby-library-cleanup-btn';
        cleanBtn.textContent = '加入115清理';
        cleanBtn.title = '将此番号加入扩展内 115 待清理清单（会尝试搜索绑定文件）';
        cleanBtn.style.cursor = 'pointer';
        cleanBtn.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          void enqueueCleanupFromContent(videoId, entry);
        });
        container.appendChild(cleanBtn);
      }
    }
  }
}

async function enqueueCleanupFromContent(videoId: string, entry: EmbyLibraryIndexEntry): Promise<void> {
  try {
    const resp: any = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          {
            type: 'MEDIA_115_CLEANUP_ENQUEUE',
            code: videoId,
            title: entry.itemName || videoId,
            embyItemId: entry.itemId,
            embyServerUrl: entry.serverUrl,
          },
          (r) => resolve(r),
        );
      } catch (e) {
        resolve({ success: false, error: String(e) });
      }
    });
    if (resp?.success) {
      window.alert(
        resp.bound
          ? '已加入 115 清理清单（已尝试绑定文件）'
          : `已加入清理清单${resp.message ? `：${resp.message}` : ''}`,
      );
    } else {
      window.alert(`加入失败：${resp?.error || '未知错误'}`);
    }
  } catch (e) {
    window.alert(`加入失败：${e instanceof Error ? e.message : String(e)}`);
  }
}

export function ensureListTagContainer(item: HTMLElement): HTMLElement | null {
  let tagContainer = item.querySelector<HTMLElement>('.tags.has-addons') || item.querySelector<HTMLElement>('.tags');
  if (tagContainer) return tagContainer;

  const videoTitle = item.querySelector('.video-title');
  if (!videoTitle) return null;

  tagContainer = document.createElement('div');
  tagContainer.className = 'tags has-addons';
  videoTitle.appendChild(tagContainer);
  return tagContainer;
}

export function renderDetailLibraryStatus(videoId: string): void {
  const firstBlock = document.querySelector<HTMLElement>('.movie-panel-info .panel-block.first-block, .panel-block.first-block');
  if (!firstBlock) return;

  const existing = firstBlock.querySelector<HTMLElement>('.emby-library-detail-tags');
  if (existing) existing.remove();

  if (!isLibraryStatusEnabled('detail')) return;
  if (!hasLibraryIndex()) {
    const wrapper = document.createElement('span');
    wrapper.className = 'emby-library-detail-tags tags has-addons';
    wrapper.style.cssText = 'display:inline-flex;gap:4px;margin-left:8px;vertical-align:middle;';

    const hint = document.createElement('span');
    hint.className = 'tag is-warning is-light emby-library-sync-hint';
    hint.textContent = '媒体库未同步';
    hint.title = '请先在设置页同步 Emby/Jellyfin 媒体库';
    wrapper.appendChild(hint);
    firstBlock.appendChild(wrapper);
    return;
  }

  const matches = getConfiguredMatches(videoId);
  if (matches.length === 0) return;

  const wrapper = document.createElement('span');
  wrapper.className = 'emby-library-detail-tags tags has-addons';
  wrapper.style.cssText = 'display:inline-flex;gap:4px;margin-left:8px;vertical-align:middle;';
  renderLibraryStatusBadges(wrapper, videoId, 'detail');
  firstBlock.appendChild(wrapper);
}
