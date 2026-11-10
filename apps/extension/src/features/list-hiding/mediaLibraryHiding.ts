import { projectWatchedKeys } from '../media/watchProjection';
import { evidenceFromDeletionHistory, mergeWatchEvidenceStates } from '../media/watchHistory';
/**
 * @file mediaLibraryHiding.ts
 * @description 媒体库隐藏来源标记（display.hideInMediaLibrary / display.hideRealWatched，
 * 09-30-media-library-hide-filter）
 * @module features/list-hiding
 *
 * 当前入库状态与列表卡徽章共用索引；真实已看另消费持久观看历史：
 * - Emby/Jellyfin 同步索引（STATE.embyLibraryState，bootstrap 载入；
 *   EMBY_LIBRARY_STATE_UPDATED 消息触发 processVisibleItems({force:true}) 全量重标）；
 * - 115 网盘扫描索引、观看证据和可靠删除历史（storage 批量异步读）。
 *
 * 同步侧（Emby/JF）在 itemProcessor.processItem 同步段直接调用 markMediaLibraryHiding；
 * 115 异步侧复用 drive115/content/libraryStatusBadges.ts 的
 * 模块级单飞缓存 + 已渲染卡片注册表 + storage.onChanged 失效模式：
 * resolve 后打标记 + recomputeListHiding，不阻塞首屏；索引变化时重算已渲染卡片。
 *
 * 当前索引为空不会误报入库；有可靠播放历史时仍可标记真实已看。
 * 页面豁免与状态来源一致：搜索页、状态聚合页（想看/已看列表）不打标记。
 */
import { STORAGE_KEYS } from '../../utils/config';
import { STATE, getContentRecord } from '../contentState';
import { findConfiguredLibraryMatches } from '../embyLibrary/domain/configuredMatches';
import { computeWatchState } from '../embyLibrary/domain/watchState';
import type { EmbyLibraryIndex } from '../embyLibrary/types';
import {
  loadDrive115LibraryState,
  lookupByCode,
  type Drive115LibraryIndexState,
} from '../drive115/mediaLibrary';
import {
  isStatusAggregatePage,
  readListHidingEnablement,
  recomputeListHiding,
  setHidingSource,
} from './listHiding';

/** Emby/JF 同步命中判定（纯函数）：索引条目 ∩ 已配置启用服务器（口径与徽章共用）。 */
export function computeEmbyHidingHit(
  index: EmbyLibraryIndex | null | undefined,
  videoCode: string,
  servers: unknown,
): { inLibrary: boolean; realWatched: boolean } {
  const matches = findConfiguredLibraryMatches(index, videoCode, servers);
  if (matches.length === 0) return { inLibrary: false, realWatched: false };
  const realWatched = matches.some((entry) => computeWatchState(entry.userData) === 'watched');
  return { inLibrary: true, realWatched };
}

/** 115 网盘索引命中（纯函数）：code 为空（未识别番号）的条目不参与命中（lookupByCode 内置）。 */
export function hasDrive115Hit(
  state: Drive115LibraryIndexState | null | undefined,
  videoCode: string,
): boolean {
  return lookupByCode(state, videoCode).length > 0;
}

/** 当前页是否豁免资料库来源标记（搜索页 / 状态聚合页；jsdom 无 location 时按豁免处理）。 */
function isMediaLibraryHidingExempt(): boolean {
  try {
    return STATE.isSearchPage === true || isStatusAggregatePage(window.location.pathname);
  } catch {
    return true;
  }
}

/**
 * 同步侧：Emby/JF 命中 → 打 mediaLibrary / realWatched 来源标记（纯本地计算）。
 * 门控：两开关全关 = 直接返回（零成本，存量行为零变化）；页面豁免返回。
 * 真正的显隐由调用方既有的 recomputeListHiding 统一裁定。
 */
export function markMediaLibraryHiding(item: HTMLElement, videoId: string, settings: unknown): void {
  const enablement = readListHidingEnablement(settings);
  if (!enablement.mediaLibrary && !enablement.realWatched) return;
  if (isMediaLibraryHidingExempt()) return;

  const hit = computeEmbyHidingHit(STATE.embyLibraryState, videoId, (settings as any)?.emby?.mediaServers);
  const pinned = getContentRecord(videoId)?.mediaStateOverrides;
  setHidingSource(item, 'mediaLibrary', pinned?.inLibrary ?? hit.inLibrary);
  setHidingSource(item, 'realWatched', pinned?.realWatched ?? hit.realWatched);
  pruneDisconnectedItems();
  registeredItems.set(item, videoId);
  attachStorageListener();
  if (typeof chrome !== 'undefined' && chrome.storage?.local) void refreshRegisteredMediaLibraryHiding();
}

// ---------------------------------------------------------------------------
// 115 网盘异步侧：单飞缓存 + 已渲染卡片注册表 + storage.onChanged 失效
// （模式同 drive115/content/libraryStatusBadges.ts；独立注册表，徽章互不干扰）
// ---------------------------------------------------------------------------

let cached115State: Drive115LibraryIndexState | null = null;
let pending115State: Promise<Drive115LibraryIndexState> | null = null;

function get115LibraryState(): Promise<Drive115LibraryIndexState> {
  if (cached115State) return Promise.resolve(cached115State);
  if (!pending115State) {
    pending115State = loadDrive115LibraryState()
      .then((state) => {
        cached115State = state;
        pending115State = null;
        return state;
      })
      .catch((error) => {
        pending115State = null;
        throw error;
      });
  }
  return pending115State;
}

const registeredItems = new Map<HTMLElement, string>();
let refreshInFlight: Promise<void> | null = null;
let storageListenerAttached = false;
let refreshRevision = 0;

/** 清理已从 DOM 移除的卡片注册，避免注册表随翻页无限增长 */
function pruneDisconnectedItems(): void {
  for (const item of registeredItems.keys()) {
    if (!item.isConnected) registeredItems.delete(item);
  }
}

/** 115 命中 → 打 mediaLibrary 标记并重算显隐（仅 hideInMediaLibrary 开启时注册/查询）。 */
export function markDrive115LibraryHiding(
  item: HTMLElement,
  videoId: string,
  settings: unknown = STATE.settings,
): Promise<void> {
  const enablement = readListHidingEnablement(settings);
  if (!enablement.mediaLibrary) return Promise.resolve();
  if (isMediaLibraryHidingExempt()) return Promise.resolve();

  pruneDisconnectedItems();
  registeredItems.set(item, videoId);
  attachStorageListener();

  const applyState = (state: Drive115LibraryIndexState) => {
    if (!item.isConnected) {
      registeredItems.delete(item);
      return;
    }
    if (!hasDrive115Hit(state, videoId) || getContentRecord(videoId)?.mediaStateOverrides?.inLibrary === false) return;
    setHidingSource(item, 'mediaLibrary', true);
    recomputeListHiding(item, readListHidingEnablement(STATE.settings));
  };

  // 10-15 A1-4：瞬态读取失败（如 SW 冷启动期 IDB 争用）→ 有界单次重试
  // （单飞缓存失败即清，重试重读最新索引；仍失败 → 按现状注销不打标记，
  // 零命中零误隐语义不变；单飞/存储失效模式不动）。
  const firstTry: Promise<void> = get115LibraryState().then(applyState);
  return firstTry
    .catch(() => get115LibraryState().then(applyState))
    .catch((error) => {
      registeredItems.delete(item);
      console.warn('[mediaLibraryHiding] 读取 115 网盘索引失败（含一次重试）:', error);
    });
}

/**
 * 115 索引变化后对已渲染卡片重算媒体库隐藏（并发变化合并为一次刷新）。
 * 本函数只由 storage.onChanged（索引变化）触发，入口即失效单飞缓存、强制重读最新索引；
 * 115 标记与 Emby/JF 标记同属 mediaLibrary 来源，按「115 命中 ∨ Emby 命中」合并回写，
 * 避免误清同步侧已打的标记。
 */
export function refreshRegisteredMediaLibraryHiding(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  // 索引变化 ⇒ 缓存必然过期，先失效再重读（单次 storage 读，可接受）
  cached115State = null;
  pending115State = null;
  refreshInFlight = (async () => {
    let readRevision: number;
    do {
    readRevision = refreshRevision;
    try {
      pruneDisconnectedItems();
      if (!registeredItems.size) return;
      const [state, stored] = await Promise.all([
        get115LibraryState(),
        typeof chrome === 'undefined' || !chrome.storage?.local
          ? Promise.resolve({} as Record<string, unknown>)
          : chrome.storage.local.get([STORAGE_KEYS.MEDIA_WATCH_EVIDENCE, STORAGE_KEYS.MEDIA_DELETION_HISTORY, STORAGE_KEYS.EMBY_LIBRARY_STATE]),
      ]);
      if (readRevision !== refreshRevision) { cached115State = null; pending115State = null; continue; }
      const index = (stored[STORAGE_KEYS.EMBY_LIBRARY_STATE] as EmbyLibraryIndex | undefined) ?? STATE.embyLibraryState;
      const evidence = mergeWatchEvidenceStates(stored[STORAGE_KEYS.MEDIA_WATCH_EVIDENCE], evidenceFromDeletionHistory(stored[STORAGE_KEYS.MEDIA_DELETION_HISTORY]));
      const watched = projectWatchedKeys(index, (STATE.settings as any)?.emby?.mediaServers, evidence);
      if (isMediaLibraryHidingExempt()) return;
      for (const [item, videoId] of [...registeredItems]) {
        if (!item.isConnected) {
          registeredItems.delete(item);
          continue;
        }
        const embyHit = computeEmbyHidingHit(
          index,
          videoId,
          (STATE.settings as any)?.emby?.mediaServers,
        );
        const pinned = getContentRecord(videoId)?.mediaStateOverrides;
        setHidingSource(item, 'mediaLibrary', pinned?.inLibrary ?? (hasDrive115Hit(state, videoId) || embyHit.inLibrary));
        setHidingSource(item, 'realWatched', pinned?.realWatched ?? watched.has(videoId.toUpperCase()));
        recomputeListHiding(item, readListHidingEnablement(STATE.settings));
      }
    } catch (error) {
      // 重算失败保留现有显隐，等待下一次变化再试
      console.warn('[mediaLibraryHiding] 媒体库状态变化后重算隐藏失败:', error);
    }
    } while (readRevision !== refreshRevision);
  })();
  void refreshInFlight.finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

function attachStorageListener(): void {
  if (storageListenerAttached) return;
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
  storageListenerAttached = true;

  const handler = (
    changes: { [key: string]: chrome.storage.StorageChange | undefined },
    areaName: string,
  ): void => {
    if (areaName !== 'local') return;
    if (![STORAGE_KEYS.DRIVE115_LIBRARY_STATE, STORAGE_KEYS.EMBY_LIBRARY_STATE, STORAGE_KEYS.MEDIA_WATCH_EVIDENCE, STORAGE_KEYS.MEDIA_DELETION_HISTORY].some(key => changes[key])) return;
    refreshRevision += 1;
    cached115State = null;
    pending115State = null;
    void refreshRegisteredMediaLibraryHiding();
  };

  try {
    chrome.storage.onChanged.addListener(handler);
  } catch {
    storageListenerAttached = false;
  }
}
