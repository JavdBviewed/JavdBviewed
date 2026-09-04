/**
 * @file MediaLibraryPage.tsx
 * @description 媒体库浏览页：筛选 + 堆叠轮播 + 网格；优先展示本地 Emby/Jellyfin 索引
 * @module apps/dashboard/pages/media
 */
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '../../../../ui/primitives/Badge/Badge';
import { Button } from '../../../../ui/primitives/Button/Button';
import { Input } from '../../../../ui/primitives/Input/Input';
import { MediaCover } from '../../../../ui/primitives/MediaCover/MediaCover';
import { EmptyState } from '../../../../ui/patterns/EmptyState/EmptyState';
import { OverlayShell } from '../../../../ui/patterns/OverlayShell/OverlayShell';
import { LazyRemoteImage } from '../../../../ui/patterns/LazyRemoteImage/LazyRemoteImage';
import { useDrive115Cover } from './useDrive115Cover';
import { resolveDashboardNavState } from '../../../../dashboard/tabs/navModel';
import { setMediaPlaybackActive } from '../../../../dashboard/tabs/mediaLifecycleState';
import { scheduleHomeChartRender } from '../../../../dashboard/home/homeRenderScheduler';
import type { EmbyLibraryState } from '../../../../features/embyLibrary/types';
import { STORAGE_KEYS } from '../../../../utils/config';
import { getSettings, getValue } from '../../../../utils/storage';
import { sendRuntimeMessage } from '../../../../platform/browser/runtimeMessages';
import { normalizeVideoCodeCandidate } from '../../../../shared/utils/videoCodeExtractor';
import {
  coverArtStyle,
  buildCarouselWindow,
  buildMediaSyncTargets,
  buildMediaSourceChannels,
  DEFAULT_MEDIA_VIEW_FIELDS,
  DEFAULT_MEDIA_VIEW_SETTINGS,
  formatMediaSourceCopyLabel,
  getMediaSourceCopyPlaybackStatus,
  getMediaSourceLabels,
  heroItems,
  MEDIA_CARD_SIZE_OPTIONS,
  MEDIA_HERO_VISIBLE_RADIUS,
  MEDIA_COVER_VIEW_MODES,
  partitionMediaSyncTargets,
  readMediaViewSettings,
  resolveCoverImage,
  resolveCoverImageUrl,
  mediaCopyToBrowseItem,
  resolvePlaybackChoice,
  type MediaBrowseItem,
  type MediaBrowseSource,
  type MediaSyncTarget,
  type MediaSourceChannel,
  type MediaCoverViewMode,
  type MediaViewSettings,
  type MediaWatchFilter,
  resolveCarouselDotStep,
  sourceLabel,
  subPathToFilter,
  writeMediaViewSettings,
} from './mediaBrowseModel';
import {
  buildMediaCatalogQueryIndex,
  queryMediaCatalogIndex,
} from './mediaCatalogQuery';
import {
  formatWatchPercent,
  mapLibraryStateToBrowseItems,
  mapDrive115LibraryStateToBrowseItems,
  mergeBrowseCatalogs,
  mergeLocalWatchEvidence,
  resolveWatchProgressPercent,
  watchStateLabel,
} from './mediaLibraryIndexAdapter';
import type { Media115ResolvedStream } from './Media115PlayPanel';
import type { MediaItemDetailPanelProps } from './MediaItemDetailPanel';
import { ProgressiveMediaGrid } from './ProgressiveMediaGrid';
import {
  areMediaCardPropsEqual,
  areMediaHeroCardPropsEqual,
  areResumeMediaCardPropsEqual,
  type MediaHeroCardRenderProps,
  type MediaCardRenderProps,
  type ResumeMediaCardRenderProps,
} from './mediaCardRenderPolicy';
import {
  enqueueCompletedPlayback,
  importHistoricalWatchedFromCurrentLibrary,
} from '../../../../features/mediaCleanup/mediaCleanupStorage';
import { loadWatchEvidenceMap } from '../../../../features/media/mediaWatchEvidence';
import {
  readMediaClientPreviewHidden,
  writeMediaClientPreviewHidden,
} from './mediaClientPreview';
import './mediaPage.css';

// 播放、详情和清理只在用户打开对应弹窗时需要，避免媒体库首屏加载完整功能链。
const LazyMedia115PlayPanel = lazy(() => import('./Media115PlayPanel').then(({ Media115PlayPanel }) => ({
  default: Media115PlayPanel,
})));
const LazyMediaCleanupPanel = lazy(() => import('./MediaCleanupPanel').then(({ MediaCleanupPanel }) => ({
  default: MediaCleanupPanel,
})));
const LazyMediaItemDetailPanel = lazy(() => import('./MediaItemDetailPanel').then(({ MediaItemDetailPanel }) => ({
  default: MediaItemDetailPanel,
})));
const LazyMediaPlayer = lazy(() => import('../../../../ui/patterns/MediaPlayer/MediaPlayer').then(({ MediaPlayer }) => ({
  default: MediaPlayer,
})));

function MediaPanelFallback({ label }: { label: string }) {
  return <div className="ml-command-panel-loading" role="status">{label}</div>;
}

const WATCH_FILTERS: { id: MediaWatchFilter; label: string }[] = [
  { id: 'all', label: '全部状态' },
  { id: 'in_progress', label: '在看' },
  { id: 'watched', label: '已看' },
  { id: 'not_watched', label: '未看完' },
];

const EMPTY_STATE: EmbyLibraryState = { entries: {}, updatedAt: 0 };

type MediaLibrarySyncResponse = {
  success?: boolean;
  synced?: number;
  failed?: number;
  error?: string;
  newCleanupItems?: number;
  historicalWatchedCandidates?: number;
  serverResults?: Array<{
    serverName?: string;
    success?: boolean;
    error?: string;
    itemCount?: number;
    indexedCount?: number;
  }>;
};

type Drive115LibrarySyncResponse = {
  success?: boolean;
  message?: string;
  stats?: { indexed?: number; skipped?: number; apiCalls?: number };
};

type Drive115PlayerStream = {
  code: string;
  title: string;
  streamUrl: string;
  streamType?: 'mp4' | 'm3u8' | 'auto';
  pickCode?: string;
  fileId?: string;
  fileName?: string;
  webPlayUrl?: string;
  startTimeSeconds?: number;
  durationSeconds?: number;
};

async function reportDrive115Evidence(payload: Record<string, unknown>): Promise<boolean> {
  try {
    const resp = await sendRuntimeMessage<{ success?: boolean }>({
      type: 'MEDIA_WATCH_EVIDENCE_REPORT',
      ...payload,
    });
    return Boolean(resp?.success);
  } catch {
    return false;
  }
}

async function reportDrive115StreamProgress(
  stream: Drive115PlayerStream,
  opts: { positionSeconds: number; durationSeconds?: number; forceWatched?: boolean },
): Promise<boolean> {
  const duration = Math.max(0, Number(opts.durationSeconds) || Number(stream.durationSeconds) || 0);
  const position = Math.max(0, Number(opts.positionSeconds) || 0);
  if (duration <= 0 && position <= 0 && opts.forceWatched !== true) return false;
  const percent = opts.forceWatched
    ? 100
    : duration > 0
      ? Math.min(100, (position / duration) * 100)
      : 0;
  return await reportDrive115Evidence({
    code: stream.code,
    source: 'drive115',
    percent,
    positionSec: opts.forceWatched && duration > 0 ? duration : position,
    ...(duration > 0 ? { durationSec: duration } : {}),
    pickCode: stream.pickCode,
    fileId: stream.fileId,
    sourceItemId: stream.pickCode || stream.fileId,
    copyId: stream.fileId || stream.pickCode ? `115:${stream.fileId || stream.pickCode}` : undefined,
    fileName: stream.fileName || stream.title,
    forceWatched: Boolean(opts.forceWatched),
  });
}

function normalizeDrive115Lookup(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

function parseDrive115RuntimeSeconds(item: MediaBrowseItem | null | undefined): number {
  const raw = String(item?.nfoSummary?.runtime || '').trim();
  const minutes = Number(raw.match(/\d+(?:\.\d+)?/)?.[0] || 0);
  return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60) : 0;
}

function resolveDrive115PlaybackItem(
  catalog: MediaBrowseItem[],
  stream: Media115ResolvedStream,
): MediaBrowseItem | null {
  const candidate = stream.candidate;
  const aliases = new Set([
    normalizeDrive115Lookup(stream.query),
    normalizeDrive115Lookup(candidate.fileName),
    normalizeDrive115Lookup(candidate.fileName?.replace(/\.(mp4|mkv|avi|mov|wmv|m4v|ts|webm)$/i, '')),
    normalizeDrive115Lookup(candidate.pickCode),
    normalizeDrive115Lookup(candidate.fileId),
  ].filter(Boolean));

  return catalog.find((item) => {
    if (item.source !== '115') return false;
    const itemAliases = [
      item.code,
      item.title,
      item.fileName,
      item.fileName?.replace(/\.(mp4|mkv|avi|mov|wmv|m4v|ts|webm)$/i, ''),
      item.pickCode,
      item.itemId,
      normalizeVideoCodeCandidate(item.fileName || ''),
      normalizeVideoCodeCandidate(item.title || ''),
    ].map(normalizeDrive115Lookup);
    return itemAliases.some((alias) => alias && aliases.has(alias));
  }) || null;
}

/**
 * 同步结果 toast（与设置页 embySettingsActions 同一套 dashboard showMessage）
 */
async function toast(
  message: string,
  type: 'success' | 'info' | 'error' | 'warning' = 'info',
): Promise<void> {
  try {
    const { showMessage } = await import('../../../../dashboard/ui/toast');
    showMessage(message, type);
  } catch {
    /* ignore */
  }
}

type MediaToastHandle = {
  update: (message: string, type?: 'success' | 'info' | 'error' | 'warning', duration?: number) => void;
  close: () => void;
};

async function persistentToast(
  message: string,
  type: 'success' | 'info' | 'error' | 'warning' = 'info',
): Promise<MediaToastHandle> {
  try {
    const { showPersistentMessage } = await import('../../../../dashboard/ui/toast');
    return showPersistentMessage(message, type);
  } catch {
    return {
      update: () => {},
      close: () => {},
    };
  }
}

/**
 * 媒体库主页面
 */
type MediaLibraryPageProps = {
  isActive?: boolean;
};

export function MediaLibraryPage({ isActive = true }: MediaLibraryPageProps) {
  const [filter, setFilter] = useState<MediaBrowseSource>('all');
  const [watchFilter, setWatchFilter] = useState<MediaWatchFilter>('all');
  const [viewSettings, setViewSettings] = useState<MediaViewSettings>(() => readMediaViewSettings());
  const [showViewSettings, setShowViewSettings] = useState(false);
  const [showClientPreview, setShowClientPreview] = useState(() => !readMediaClientPreviewHidden());
  const coverView = viewSettings.coverView;
  const [query, setQuery] = useState('');
  const [catalog, setCatalog] = useState<MediaBrowseItem[]>([]);
  const [usingPreview, setUsingPreview] = useState(true);
  const [indexUpdatedAt, setIndexUpdatedAt] = useState(0);
  const [loadingIndex, setLoadingIndex] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncTargets, setSyncTargets] = useState<MediaSyncTarget[]>([]);
  const [selectedSyncTargetKeys, setSelectedSyncTargetKeys] = useState<Set<string>>(new Set());
  const [sourceChannels, setSourceChannels] = useState<MediaSourceChannel[]>([]);
  const sourceChannelsRef = useRef<MediaSourceChannel[]>([]);
  const [showSyncPanel, setShowSyncPanel] = useState(false);
  const [show115Panel, setShow115Panel] = useState(false);
  const [showToolsPanel, setShowToolsPanel] = useState(false);
  const [play115Query, setPlay115Query] = useState('');
  const [play115PickCode, setPlay115PickCode] = useState('');
  const play115StartTimeRef = useRef(0);
  const [showCleanupPanel, setShowCleanupPanel] = useState(false);
  const [cleanupRefreshKey, setCleanupRefreshKey] = useState(0);
  const initialCatalogLoadStartedRef = useRef(false);
  const catalogLoadTaskRef = useRef<{ cancel: () => void } | null>(null);
  const catalogReloadInFlightRef = useRef(false);
  const catalogReloadPendingRef = useRef(false);
  const catalogReloadTimerRef = useRef<number | null>(null);
  const pendingCatalogReloadRef = useRef(false);
  const drive115IndexRunningRef = useRef(false);
  const pendingDrive115CatalogRefreshRef = useRef(false);
  /** Emby/JF 扩展内播放：用设置里 token 取流，不依赖浏览器网页登录 */
  const [embyStream, setEmbyStream] = useState<{
    code: string;
    title: string;
    streamUrl: string;
    streamType?: 'mp4' | 'm3u8' | 'auto';
    itemId: string;
    serverUrl: string;
    serverId?: string;
    mediaSourceId?: string;
    playSessionId?: string;
    startTimeSeconds?: number;
    highlights?: Array<{ time: number; text: string }>;
    subtitles?: Array<{ label: string; url: string; type?: 'vtt' | 'srt'; default?: boolean; language?: string }>;
    qualities?: Array<{ html: string; url: string; streamType?: 'mp4' | 'm3u8' | 'auto'; default?: boolean }>;
  } | null>(null);
  const embyStreamRef = useRef(embyStream);
  embyStreamRef.current = embyStream;
  const [drive115Stream, setDrive115Stream] = useState<Drive115PlayerStream | null>(null);
  const drive115StreamRef = useRef(drive115Stream);
  drive115StreamRef.current = drive115Stream;
  const lastProgressReportRef = useRef(0);
  const lastProgressPosRef = useRef(0);
  const drive115LastProgressReportRef = useRef(0);
  const drive115LastProgressPosRef = useRef(0);
  const drive115LastProgressDurationRef = useRef(0);
  const [detailItem, setDetailItem] = useState<MediaBrowseItem | null>(null);
  const [playbackChoice, setPlaybackChoice] = useState<{
    title: string;
    items: MediaBrowseItem[];
    startTimeSeconds?: number;
    highlights?: Array<{ time: number; text: string }>;
  } | null>(null);
  const cancelPendingInitialCatalogLoad = useCallback(() => {
    catalogLoadTaskRef.current?.cancel();
    catalogLoadTaskRef.current = null;
  }, []);

  useEffect(() => {
    setMediaPlaybackActive(Boolean(embyStream || drive115Stream));
    return () => setMediaPlaybackActive(false);
  }, [embyStream, drive115Stream]);

  useEffect(() => {
    const onMediaTabVisibility = (event: Event) => {
      const detail = (event as CustomEvent<{ isActive?: boolean }>).detail;
      if (detail?.isActive === false) cancelPendingInitialCatalogLoad();
    };
    window.addEventListener('media-tab-visibility', onMediaTabVisibility);
    return () => window.removeEventListener('media-tab-visibility', onMediaTabVisibility);
  }, [cancelPendingInitialCatalogLoad]);

  // 兼容旧 hash 子路径
  useEffect(() => {
    const apply = () => {
      const state = resolveDashboardNavState(window.location.hash);
      if (state.tabId === 'tab-media') {
        setFilter(subPathToFilter(state.subPath, sourceChannelsRef.current));
      }
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);

  /**
   * 从 storage 读取本地索引并刷新目录
   */
  const reloadCatalogFromStorage = useCallback(async () => {
    if (catalogReloadInFlightRef.current) {
      catalogReloadPendingRef.current = true;
      return;
    }
    catalogReloadInFlightRef.current = true;
    setLoadingIndex(true);
    try {
      const [state, drive115State, evidence] = await Promise.all([
        getValue<EmbyLibraryState>(STORAGE_KEYS.EMBY_LIBRARY_STATE, EMPTY_STATE),
        getValue<{ entries?: unknown[]; updatedAt?: number }>(
          STORAGE_KEYS.DRIVE115_LIBRARY_STATE,
          { entries: [], updatedAt: 0 },
        ),
        loadWatchEvidenceMap().catch(() => ({})),
      ]);
      // 适配器本身会返回空数组；不要先用 has* 再映射一次完整索引。
      const embyItems = mapLibraryStateToBrowseItems(state);
      const drive115Items = mapDrive115LibraryStateToBrowseItems(drive115State as any);
      const merged = mergeBrowseCatalogs(embyItems, drive115Items);
      if (merged.length > 0) {
        setCatalog(mergeLocalWatchEvidence(merged, evidence));
        setUsingPreview(false);
        setIndexUpdatedAt(
          Math.max(Number(state.updatedAt) || 0, Number(drive115State?.updatedAt) || 0),
        );
      } else {
        setCatalog([]);
        setUsingPreview(true);
        setIndexUpdatedAt(0);
      }
    } catch {
      setCatalog([]);
      setUsingPreview(true);
      setIndexUpdatedAt(0);
    } finally {
      setLoadingIndex(false);
      catalogReloadInFlightRef.current = false;
      if (catalogReloadPendingRef.current) {
        catalogReloadPendingRef.current = false;
        window.setTimeout(() => {
          void reloadCatalogFromStorage();
        }, 0);
      }
    }
  }, []);

  const scheduleCatalogReload = useCallback((delayMs = 600) => {
    if (catalogReloadTimerRef.current) {
      clearTimeout(catalogReloadTimerRef.current);
    }
    catalogReloadTimerRef.current = window.setTimeout(() => {
      catalogReloadTimerRef.current = null;
      void reloadCatalogFromStorage();
    }, delayMs);
  }, [reloadCatalogFromStorage]);

  const reloadSyncTargetsFromSettings = useCallback(async () => {
    try {
      // 使用 getSettings（合并 DEFAULT + 主开关拆分迁移），而非裸 getValue，
      // 保证旧数据（仅 emby.enabled=true）也能正确推导 libraryEnabled/recognitionEnabled。
      const settings = await getSettings() as unknown;
      const channels = buildMediaSourceChannels(settings);
      sourceChannelsRef.current = channels;
      setSourceChannels(channels);
      setFilter((current) => {
        const navState = resolveDashboardNavState(window.location.hash);
        if (navState.tabId === 'tab-media' && navState.subPath) {
          return subPathToFilter(navState.subPath, channels);
        }
        if (current === 'all') return current;
        if (current === 'emby' || current === 'jellyfin' || current === '115') {
          return subPathToFilter(current, channels);
        }
        return channels.some((channel) => channel.id === current) ? current : 'all';
      });
      setSyncTargets(buildMediaSyncTargets(settings));
    } catch {
      sourceChannelsRef.current = [];
      setSourceChannels([]);
      setFilter('all');
      setSyncTargets([]);
      setSelectedSyncTargetKeys(new Set());
    }
  }, []);

  // 首次进入读取索引与可同步服务器
  const scheduleInitialCatalogLoad = useCallback(() => {
    if (!isActive || initialCatalogLoadStartedRef.current || catalogLoadTaskRef.current) return;
    catalogLoadTaskRef.current = scheduleHomeChartRender(() => {
      catalogLoadTaskRef.current = null;
      initialCatalogLoadStartedRef.current = true;
      void reloadCatalogFromStorage();
    }, { timeoutMs: 1200 });
  }, [isActive, reloadCatalogFromStorage]);

  useEffect(() => {
    if (!isActive) {
      cancelPendingInitialCatalogLoad();
      return;
    }

    scheduleInitialCatalogLoad();
    void getValue<{ running?: boolean } | null>(
      STORAGE_KEYS.DRIVE115_LIBRARY_INDEX_PROGRESS,
      null,
    ).then((progress) => {
      drive115IndexRunningRef.current = Boolean(progress?.running);
    }).catch(() => {
      drive115IndexRunningRef.current = false;
    });
    void reloadSyncTargetsFromSettings();
    return () => {
      cancelPendingInitialCatalogLoad();
    };
  }, [
    cancelPendingInitialCatalogLoad,
    isActive,
    reloadSyncTargetsFromSettings,
    scheduleInitialCatalogLoad,
  ]);

  // 索引写入后实时刷新目录：115 增量入库 / Emby 同步都会更新本地库，无需重进页面
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
    const watchedKeys = [
      STORAGE_KEYS.DRIVE115_LIBRARY_STATE,
      STORAGE_KEYS.EMBY_LIBRARY_STATE,
      STORAGE_KEYS.MEDIA_WATCH_EVIDENCE,
      STORAGE_KEYS.SETTINGS,
      STORAGE_KEYS.DRIVE115_LIBRARY_INDEX_PROGRESS,
    ];
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'local') return;
      if (!watchedKeys.some((key) => key in changes)) return;

      const settingsChanged = STORAGE_KEYS.SETTINGS in changes;
      const drive115StateChanged = STORAGE_KEYS.DRIVE115_LIBRARY_STATE in changes;
      const progressChanged = STORAGE_KEYS.DRIVE115_LIBRARY_INDEX_PROGRESS in changes;
      const progress = progressChanged
        ? changes[STORAGE_KEYS.DRIVE115_LIBRARY_INDEX_PROGRESS]?.newValue as { running?: boolean } | null
        : null;

      if (progressChanged) {
        drive115IndexRunningRef.current = Boolean(progress?.running);
        if (!drive115IndexRunningRef.current && pendingDrive115CatalogRefreshRef.current) {
          pendingDrive115CatalogRefreshRef.current = false;
          scheduleCatalogReload(0);
        }
      }

      if (drive115StateChanged) {
        if (drive115IndexRunningRef.current) {
          // 索引期间只保留最新的最终刷新请求，避免每个增量快照都重建整目录。
          pendingDrive115CatalogRefreshRef.current = true;
        } else {
          scheduleCatalogReload();
        }
      }

      if (STORAGE_KEYS.EMBY_LIBRARY_STATE in changes || STORAGE_KEYS.MEDIA_WATCH_EVIDENCE in changes) {
        const playbackActive = Boolean(embyStreamRef.current || drive115StreamRef.current);
        const watchEvidenceChanged = STORAGE_KEYS.MEDIA_WATCH_EVIDENCE in changes;
        if (watchEvidenceChanged && playbackActive) {
          // 播放器打开时进度会定期写 storage；关闭播放器前无需反复重建整个目录模型。
          pendingCatalogReloadRef.current = true;
        } else {
          scheduleCatalogReload();
        }
      }

      // 设置变化只需要更新来源摘要/筛选项，不应因索引快照变化反复读取设置。
      if (settingsChanged) {
        void reloadSyncTargetsFromSettings();
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      if (catalogReloadTimerRef.current) {
        clearTimeout(catalogReloadTimerRef.current);
        catalogReloadTimerRef.current = null;
      }
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, [reloadCatalogFromStorage, reloadSyncTargetsFromSettings, scheduleCatalogReload]);

  // 卡片/工具栏打开 115 播放面板
  useEffect(() => {
    const onOpen = (ev: Event) => {
      const detail = (ev as CustomEvent<{ query?: string; pickCode?: string; startTimeSeconds?: number }>).detail;
      setPlay115Query(String(detail?.query || query || '').trim());
      setPlay115PickCode(String(detail?.pickCode || '').trim());
      play115StartTimeRef.current = Math.max(0, Number(detail?.startTimeSeconds) || 0);
      setShow115Panel(true);
    };
    window.addEventListener('media-open-115-play', onOpen as EventListener);
    return () => window.removeEventListener('media-open-115-play', onOpen as EventListener);
  }, [query]);

  const lastProgressDurationRef = useRef(0);

  const reportEmbyProgress = useCallback(async (opts: {
    positionSeconds: number;
    durationSeconds?: number;
    isCompleted?: boolean;
    /** 关闭播放器：清 Emby Now Playing，避免后台仍显示播放中 */
    isStopped?: boolean;
    force?: boolean;
  }) => {
    const cur = embyStreamRef.current;
    if (!cur?.itemId || !cur.serverUrl) return false;
    const pos = Math.max(0, Number(opts.positionSeconds) || 0);
    const duration = Math.max(
      0,
      Number(opts.durationSeconds) || lastProgressDurationRef.current || 0,
    );
    if (duration > 0) lastProgressDurationRef.current = duration;
    const now = Date.now();
    // 节流：默认 8s 或位移 >12s 才上报；force/ended/stop 立即
    if (!opts.force && !opts.isCompleted && !opts.isStopped) {
      if (now - lastProgressReportRef.current < 8000
        && Math.abs(pos - lastProgressPosRef.current) < 12) {
        lastProgressPosRef.current = pos;
        return true;
      }
    }
    lastProgressReportRef.current = now;
    lastProgressPosRef.current = pos;
    try {
      const ok = await new Promise<boolean>((resolve) => {
        try {
          chrome.runtime.sendMessage(
            {
              type: 'EMBY_LIBRARY_REPORT_PROGRESS',
              itemId: cur.itemId,
              serverUrl: cur.serverUrl,
              serverId: cur.serverId,
              positionSeconds: pos,
              durationSeconds: duration > 0 ? duration : undefined,
              isCompleted: Boolean(opts.isCompleted),
              isStopped: Boolean(opts.isStopped),
              mediaSourceId: cur.mediaSourceId,
              playSessionId: cur.playSessionId,
            },
            (resp) => {
              const err = chrome.runtime.lastError;
              if (err) {
                resolve(false);
                return;
              }
              resolve(Boolean(resp?.success));
            },
          );
        } catch {
          resolve(false);
        }
      });
      return ok;
    } catch {
      return false;
    }
  }, []);

  const closeEmbyPlayer = useCallback(() => {
    const pos = lastProgressPosRef.current;
    const duration = lastProgressDurationRef.current;
    // 先快照再清 UI，避免 re-render 清空 ref 后 Stop 发不出去
    const streamSnap = embyStreamRef.current;
    pendingCatalogReloadRef.current = false;
    setEmbyStream(null);
    void (async () => {
      // 即使进度 <1s 也要 Stop，否则会话靠超时才清（常几十秒）
      if (streamSnap?.itemId && streamSnap.serverUrl) {
        try {
          await new Promise<boolean>((resolve) => {
            try {
              chrome.runtime.sendMessage(
                {
                  type: 'EMBY_LIBRARY_REPORT_PROGRESS',
                  itemId: streamSnap.itemId,
                  serverUrl: streamSnap.serverUrl,
                  serverId: streamSnap.serverId,
                  positionSeconds: pos,
                  durationSeconds: duration > 0 ? duration : undefined,
                  isStopped: true,
                  mediaSourceId: streamSnap.mediaSourceId,
                  playSessionId: streamSnap.playSessionId,
                },
                (resp) => {
                  const err = chrome.runtime.lastError;
                  if (err) {
                    resolve(false);
                    return;
                  }
                  resolve(Boolean(resp?.success));
                },
              );
            } catch {
              resolve(false);
            }
          });
        } catch {
          /* ignore */
        }
      }
      await reloadCatalogFromStorage();
    })();
  }, []);

  /**
   * Emby/JF：用设置页 token 解析流并在扩展内播放（不依赖网页登录）
   * opts.startTimeSeconds：章节起播 / 续看 seek
   * opts.highlights：详情章节映射到进度条
   */
  const playEmbyItem = useCallback(async (
    it: {
      code: string;
      title: string;
      itemId?: string;
      serverUrl?: string;
      serverId?: string;
      /** 本地已知进度（秒），用于续看 */
      resumePositionSeconds?: number;
    },
    opts?: {
      startTimeSeconds?: number;
      highlights?: Array<{ time: number; text: string }>;
    },
  ) => {
    if (!it.itemId || !it.serverUrl) return;
    void toast('正在解析播放地址…', 'info');
    try {
      const resp = await new Promise<{
        success?: boolean;
        streamUrl?: string;
        streamType?: 'mp4' | 'm3u8' | 'auto';
        mediaSourceId?: string;
        playSessionId?: string;
        subtitles?: Array<{ label: string; url: string; type?: 'vtt' | 'srt'; default?: boolean; language?: string }>;
        qualities?: Array<{ html: string; url: string; streamType?: 'mp4' | 'm3u8' | 'auto'; default?: boolean }>;
        error?: string;
      }>((resolve, reject) => {
        try {
          chrome.runtime.sendMessage(
            {
              type: 'EMBY_LIBRARY_RESOLVE_STREAM',
              itemId: it.itemId,
              serverUrl: it.serverUrl,
              serverId: it.serverId,
            },
            (r) => {
              const err = chrome.runtime.lastError;
              if (err) {
                reject(new Error(err.message));
                return;
              }
              resolve(r || {});
            },
          );
        } catch (e) {
          reject(e);
        }
      });
      if (!resp.success || !resp.streamUrl) {
        await toast(resp.error || '解析播放地址失败', 'error');
        return;
      }
      // 续看起点：显式 opts > 条目 resumePositionSeconds
      const start = Math.max(
        0,
        Number(opts?.startTimeSeconds)
          || Number(it.resumePositionSeconds)
          || 0,
      );
      lastProgressReportRef.current = 0;
      lastProgressPosRef.current = start;
      lastProgressDurationRef.current = 0;
      const subCount = resp.subtitles?.length || 0;
      const qCount = resp.qualities?.length || 0;
      setEmbyStream({
        code: it.code,
        title: it.title,
        streamUrl: resp.streamUrl,
        streamType: resp.streamType || 'auto',
        itemId: it.itemId,
        serverUrl: it.serverUrl,
        serverId: it.serverId,
        mediaSourceId: resp.mediaSourceId,
        playSessionId: resp.playSessionId,
        ...(start > 0 ? { startTimeSeconds: start } : {}),
        ...(opts?.highlights?.length ? { highlights: opts.highlights } : {}),
        ...(subCount ? { subtitles: resp.subtitles } : {}),
        ...(qCount ? { qualities: resp.qualities } : {}),
      });
      const bits = [
        start > 0 ? `续播 ${Math.floor(start / 60)}:${String(Math.floor(start % 60)).padStart(2, '0')}` : '',
        resp.streamType === 'm3u8' ? 'HLS' : '',
        subCount ? `${subCount} 条字幕` : '',
        qCount > 1 ? `${qCount} 档清晰度` : '',
      ].filter(Boolean);
      if (bits.length) {
        void toast(bits.join(' · '), 'info');
      }
    } catch (e) {
      await toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }, []);

  const playResolvedItem = useCallback((
    item: MediaBrowseItem,
    opts?: {
      startTimeSeconds?: number;
      highlights?: Array<{ time: number; text: string }>;
    },
  ) => {
    const startTimeSeconds = Math.max(
      0,
      Number(opts?.startTimeSeconds)
        || (Number(item.userData?.positionTicks) || 0) / 10_000_000,
    );
    if (item.source === '115') {
      setPlay115Query(item.code || item.title || '');
      setPlay115PickCode(item.pickCode || '');
      play115StartTimeRef.current = startTimeSeconds;
      setShow115Panel(true);
      return;
    }
    void playEmbyItem(
      {
        ...item,
        resumePositionSeconds: startTimeSeconds,
      },
      {
        startTimeSeconds: startTimeSeconds || undefined,
        highlights: opts?.highlights,
      },
    );
  }, [playEmbyItem]);

  const requestPlayback = useCallback((
    item: MediaBrowseItem,
    opts?: {
      startTimeSeconds?: number;
      highlights?: Array<{ time: number; text: string }>;
    },
  ) => {
    if (usingPreview) {
      window.dispatchEvent(new CustomEvent('media-open-115-play', { detail: { query: item.code } }));
      return;
    }
    const choice = resolvePlaybackChoice(item);
    if (choice.kind === 'unavailable') {
      void toast('当前影片没有可用的播放来源', 'warning');
      return;
    }
    if (choice.kind === 'direct') {
      playResolvedItem(choice.items[0], opts);
      return;
    }
    setPlaybackChoice({
      title: `${item.code} · 选择播放来源`,
      items: choice.items,
      startTimeSeconds: opts?.startTimeSeconds,
      highlights: opts?.highlights,
    });
  }, [playResolvedItem, usingPreview]);

  const handleResumePlay = useCallback((resumeItem: MediaBrowseItem, resumeSec: number) => {
    requestPlayback(resumeItem, {
      startTimeSeconds: resumeSec > 2 ? resumeSec : undefined,
    });
  }, [requestPlayback]);

  const handleMediaWatchChanged = useCallback(() => {
    void reloadCatalogFromStorage();
  }, [reloadCatalogFromStorage]);

  const handleMediaEnqueuedCleanup = useCallback(() => {
    setShowCleanupPanel(true);
    setCleanupRefreshKey((current) => current + 1);
  }, []);

  const handleMediaPlayItem = useCallback((item: MediaBrowseItem) => {
    requestPlayback(item);
  }, [requestPlayback]);

  const handleMediaOpenDetail = useCallback((item: MediaBrowseItem) => {
    setDetailItem(item);
  }, []);

  const handleDetailPlay = useCallback<NonNullable<MediaItemDetailPanelProps['onPlay']>>((opts) => {
    const item = detailItem;
    if (!item) return;
    setDetailItem(null);
    requestPlayback(item, {
      startTimeSeconds: opts?.startTimeSeconds,
      highlights: opts?.highlights,
    });
  }, [detailItem, requestPlayback]);

  const handleDetailPlayCopy = useCallback<NonNullable<MediaItemDetailPanelProps['onPlayCopy']>>((copy, opts) => {
    const item = detailItem;
    if (!item) return;
    setDetailItem(null);
    playResolvedItem(mediaCopyToBrowseItem(item, copy), {
      startTimeSeconds: opts?.startTimeSeconds,
      highlights: opts?.highlights,
    });
  }, [detailItem, playResolvedItem]);

  const handleDetailOpenItem = useCallback((next: MediaBrowseItem) => {
    setDetailItem(next);
  }, []);

  const handleDetailClose = useCallback(() => {
    setDetailItem(null);
  }, []);


  const handleDrive115StreamReady = useCallback((stream: Media115ResolvedStream) => {
    const candidate = stream.candidate;
    const matchedItem = resolveDrive115PlaybackItem(catalog, stream);
    const extractedCode = normalizeVideoCodeCandidate(stream.query || candidate.fileName || '');
    const code = matchedItem?.code || extractedCode || stream.query || candidate.fileName || candidate.pickCode;
    const fallbackDuration = parseDrive115RuntimeSeconds(matchedItem);
    const start = Math.max(0, Number(play115StartTimeRef.current) || 0);
    drive115LastProgressReportRef.current = 0;
    drive115LastProgressPosRef.current = start;
    drive115LastProgressDurationRef.current = fallbackDuration;
    setShow115Panel(false);
    setDrive115Stream({
      code,
      title: matchedItem?.title || candidate.fileName || stream.query || candidate.pickCode,
      streamUrl: stream.streamUrl,
      streamType: stream.streamType || 'auto',
      pickCode: candidate.pickCode || matchedItem?.pickCode,
      fileId: candidate.fileId || matchedItem?.itemId,
      fileName: candidate.fileName || matchedItem?.fileName,
      ...(stream.webPlayUrl ? { webPlayUrl: stream.webPlayUrl } : {}),
      ...(start > 2 ? { startTimeSeconds: start } : {}),
      ...(fallbackDuration > 0 ? { durationSeconds: fallbackDuration } : {}),
    });
    play115StartTimeRef.current = 0;
    if (stream.message) {
      void toast(stream.message, 'info');
    }
  }, [catalog]);

  const reportDrive115PlayerProgress = useCallback((info: {
    currentTime: number;
    duration: number;
    ended: boolean;
  }) => {
    const cur = drive115StreamRef.current;
    if (!cur) return;
    const position = Math.max(0, Number(info.currentTime) || 0);
    const duration = Math.max(
      0,
      Number(info.duration) || drive115LastProgressDurationRef.current || 0,
    );
    drive115LastProgressPosRef.current = position;
    if (duration > 0) drive115LastProgressDurationRef.current = duration;

    if (info.ended) {
      if (duration <= 0) return;
      void (async () => {
        await reportDrive115StreamProgress(cur, {
          positionSeconds: duration,
          durationSeconds: duration,
          forceWatched: true,
        });
        await reloadCatalogFromStorage();
      })();
      return;
    }

    const now = Date.now();
    if (now - drive115LastProgressReportRef.current < 8000) return;
    drive115LastProgressReportRef.current = now;
    void reportDrive115StreamProgress(cur, {
      positionSeconds: position,
      durationSeconds: duration,
    });
  }, []);

  const closeDrive115Player = useCallback(() => {
    const streamSnap = drive115StreamRef.current;
    const position = drive115LastProgressPosRef.current;
    const duration = drive115LastProgressDurationRef.current;
    pendingCatalogReloadRef.current = false;
    setDrive115Stream(null);
    void (async () => {
      if (streamSnap && (duration > 0 || position > 0)) {
        await reportDrive115StreamProgress(streamSnap, {
          positionSeconds: position,
          durationSeconds: duration,
        });
      }
      await reloadCatalogFromStorage();
    })();
  }, []);

  /**
   * 触发后台媒体库同步后刷新本地目录
   */
  const runMediaSourceSync = async (selectedKeys: ReadonlySet<string>) => {
    const { serverIds, rootCids } = partitionMediaSyncTargets(syncTargets, selectedKeys);
    const summaries: string[] = [];
    const errors: string[] = [];
    if (serverIds.length > 0) {
      try {
        const response = await sendRuntimeMessage<MediaLibrarySyncResponse>({
          type: 'EMBY_LIBRARY_SYNC',
          manual: true,
          serverIds,
        });
        const synced = Number(response.synced || 0);
        const failed = Number(response.failed || 0);
        summaries.push(`Emby/Jellyfin 成功 ${synced} 个${failed > 0 ? `，失败 ${failed} 个` : ''}`);
        const serverErrors = (response.serverResults || [])
          .filter((result) => !result.success && result.error)
          .map((result) => `${result.serverName || '媒体服务器'}：${result.error}`);
        errors.push(...serverErrors);
        if (!response.success && serverErrors.length === 0) {
          errors.push(response.error || 'Emby/Jellyfin 同步失败');
        }
      } catch (error) {
        errors.push(`Emby/Jellyfin：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (rootCids.length > 0) {
      try {
        const response = await sendRuntimeMessage<Drive115LibrarySyncResponse>({
          type: 'DRIVE115_MEDIA_LIBRARY_INDEX',
          rootCids,
        });
        if (response.success) {
          summaries.push(
            `115 入库 ${Number(response.stats?.indexed || 0)} 条，跳过 ${Number(response.stats?.skipped || 0)} 条`,
          );
        } else {
          errors.push(`115：${response.message || '索引失败'}`);
        }
      } catch (error) {
        errors.push(`115：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    await reloadCatalogFromStorage();
    return { summaries, errors };
  };

  const handleSyncLibrary = async () => {
    if (syncing || selectedSyncTargetKeys.size === 0) return;
    const selectedTargets = syncTargets.filter((target) => selectedSyncTargetKeys.has(target.key));
    setSyncing(true);
    setShowSyncPanel(false);
    const syncToast = await persistentToast(
      `正在同步 ${selectedTargets.length} 个媒体来源…`,
      'info',
    );
    try {
      const { summaries, errors } = await runMediaSourceSync(selectedSyncTargetKeys);
      const summary = summaries.length > 0 ? summaries.join('；') : '没有来源完成同步';
      if (errors.length === 0) {
        syncToast.update(`同步完成：${summary}`, 'success', 5000);
      } else if (summaries.length > 0) {
        syncToast.update(`部分同步完成：${summary}；${errors.slice(0, 2).join('；')}`, 'warning', 7000);
      } else {
        syncToast.update(`同步失败：${errors.slice(0, 3).join('；')}，已显示本地缓存`, 'error', 7000);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const full = `同步失败：${message}`;
      syncToast.update(`${full}，已显示本地缓存`, 'error', 7000);
    } finally {
      setSyncing(false);
    }
  };

  const scanWatchedMedia = async (): Promise<{ enqueuedCount: number; warning?: string; convergedCount: number }> => {
    if (syncing) throw new Error('媒体来源正在更新，请稍后再试');
    // 仅基于本地媒体索引快照与已看记录做对比，不触发任何 115/Emby 网络同步。
    // 需要刷新索引时请单独使用「同步媒体来源」，避免频繁调用 115 接口。
    const result = await importHistoricalWatchedFromCurrentLibrary();
    setCleanupRefreshKey((current) => current + 1);
    return {
      enqueuedCount: result.enqueuedCount,
      convergedCount: result.convergedCount,
      warning: syncTargets.length > 0
        ? undefined
        : '本地尚无媒体索引，已基于历史已看记录查找；如需最新文件请先同步媒体来源',
    };
  };


  const openSyncPanel = () => {
    setSelectedSyncTargetKeys(new Set(syncTargets.map((target) => target.key)));
    setShowSyncPanel(true);
  };

  const allSyncTargetsSelected = syncTargets.length > 0
    && syncTargets.every((target) => selectedSyncTargetKeys.has(target.key));

  const toggleAllSyncTargets = () => {
    setSelectedSyncTargetKeys(
      allSyncTargetsSelected ? new Set() : new Set(syncTargets.map((target) => target.key)),
    );
  };

  const toggleSyncTarget = (key: string) => {
    setSelectedSyncTargetKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const heroes = useMemo(() => heroItems(catalog), [catalog]);
  const catalogQueryIndex = useMemo(
    () => buildMediaCatalogQueryIndex(catalog),
    [catalog],
  );
  const catalogQuerySnapshot = useMemo(
    () => queryMediaCatalogIndex(catalogQueryIndex, {
      filter,
      query,
      watchFilter,
      channels: sourceChannels,
      resumeLimit: 8,
    }),
    [catalogQueryIndex, filter, query, watchFilter, sourceChannels],
  );
  const resumeList = catalogQuerySnapshot.resumeItems;
  const list = catalogQuerySnapshot.items;

  const lastSyncLabel = indexUpdatedAt
    ? `更新于 ${new Date(indexUpdatedAt).toLocaleString()}`
    : usingPreview
      ? '尚未同步'
      : loadingIndex
        ? '读取索引中…'
        : '暂无同步时间';
  const toolbarUpdatedAtLabel = indexUpdatedAt
    ? new Date(indexUpdatedAt).toLocaleString(undefined, {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    : loadingIndex
      ? '读取中'
      : usingPreview
        ? '未同步'
        : '未记录';
  const resetMediaViewSettings = () => {
    const nextSettings: MediaViewSettings = {
      ...DEFAULT_MEDIA_VIEW_SETTINGS,
      visibleFields: { ...DEFAULT_MEDIA_VIEW_SETTINGS.visibleFields },
    };
    setViewSettings(nextSettings);
    writeMediaViewSettings(nextSettings);
  };

  const hideClientPreview = () => {
    setShowClientPreview(false);
    writeMediaClientPreviewHidden(true);
  };

  const restoreClientPreview = () => {
    setShowClientPreview(true);
    writeMediaClientPreviewHidden(false);
  };

  const openDrive115ManualPlay = () => {
    setPlay115Query(query.trim());
    setPlay115PickCode('');
    play115StartTimeRef.current = 0;
    setShow115Panel(true);
    setShowToolsPanel(false);
    setShowSyncPanel(false);
  };

  const toggleCleanupPanel = () => {
    setShowCleanupPanel((v) => !v);
    setShowToolsPanel(false);
    setShowSyncPanel(false);
  };

  return (
    <div
      className="ml-page"
      data-media-page
      data-media-stack="react"
      data-cover-view={coverView}
      data-card-size={viewSettings.cardSize}
    >
      {showClientPreview ? (
        <section className="ml-client-preview" aria-label="客户端预告">
          <div className="ml-client-preview-icon" aria-hidden="true">▦</div>
          <div className="ml-client-preview-body">
            <strong>更多客户端正在准备中</strong>
            <p>同一份媒体库数据，未来也可以在桌面端和 Android 端继续使用。</p>
            <div className="ml-client-preview-chips" aria-label="客户端状态">
              <span><b>桌面端</b><em>开发中</em></span>
              <span><b>Android</b><em>开发中</em></span>
            </div>
          </div>
          <button
            type="button"
            className="ml-client-preview-link"
            onClick={() => { window.location.hash = '#tab-settings/update-settings'; }}
          >
            查看系列产品
          </button>
          <button
            type="button"
            className="ml-client-preview-dismiss"
            aria-label="隐藏客户端预告"
            title="隐藏客户端预告"
            onClick={hideClientPreview}
          >
            ×
          </button>
        </section>
      ) : null}

      {heroes.length > 0 ? (
        <MediaHeroCarousel
          items={heroes}
          coverView={coverView}
          usingPreview={usingPreview}
          onRequestPlayback={requestPlayback}
          onOpenDetail={setDetailItem}
        />
      ) : null}

      <div className="ml-toolbar" role="region" aria-label="媒体库工具栏">
        <div className="ml-view-bar" role="toolbar" aria-label="媒体库控制栏">
          <div className="ml-view-shell">
            <div className="ml-view-summary" aria-live="polite">
              <span className="ml-view-summary-count">{list.length} 项</span>
            <span>{usingPreview ? '尚未同步' : `索引 ${catalog.length}`}</span>
              <span>{toolbarUpdatedAtLabel}</span>
            </div>

            <div className="ml-view-controls" aria-label="筛选与封面">
              <label className="ml-select-wrap">
                <span className="ml-select-label">来源</span>
                <select
                  className="ml-select"
                  value={filter}
                  data-media-filter={filter}
                  aria-label="来源筛选"
                  onChange={(e) => setFilter(e.currentTarget.value as MediaBrowseSource)}
                >
                  <option value="all">全部来源</option>
                  {sourceChannels.map((channel) => (
                    <option key={channel.id} value={channel.id}>{channel.label}</option>
                  ))}
                </select>
              </label>

              <label className="ml-select-wrap">
                <span className="ml-select-label">状态</span>
                <select
                  className="ml-select"
                  value={watchFilter}
                  data-media-watch-filter={watchFilter}
                  aria-label="观看状态筛选"
                  onChange={(e) => setWatchFilter(e.currentTarget.value as MediaWatchFilter)}
                >
                  {WATCH_FILTERS.map((f) => (
                    <option key={f.id} value={f.id}>{f.label}</option>
                  ))}
                </select>
              </label>

              <label className="ml-select-wrap">
                <span className="ml-select-label">封面</span>
                <select
                  className="ml-select"
                  value={coverView}
                  data-media-cover-view={coverView}
                  aria-label="封面视图"
                  title={MEDIA_COVER_VIEW_MODES.find((m) => m.id === coverView)?.hint}
                  onChange={(e) => {
                    const next = e.currentTarget.value as MediaCoverViewMode;
                    const nextSettings = { ...viewSettings, coverView: next };
                    setViewSettings(nextSettings);
                    writeMediaViewSettings(nextSettings);
                  }}
                >
                  {MEDIA_COVER_VIEW_MODES.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="ml-view-command-group" aria-label="媒体库操作">
              <div className="ml-sync-cluster">
                <button
                  type="button"
                  className="ml-view-btn ml-view-btn-primary ml-sync-btn"
                  disabled={syncing}
                  title="同步媒体库与播放状态"
                  onClick={openSyncPanel}
                >
                  {syncing ? '同步中…' : '同步媒体库'}
                </button>
                <span className="ml-sync-meta">{lastSyncLabel}</span>
              </div>
              <button
                type="button"
                className={`ml-view-btn${showToolsPanel ? ' is-active' : ''}`}
                title="媒体库工具"
                aria-label="媒体库工具"
                onClick={() => setShowToolsPanel(true)}
              >
                工具
              </button>
              <button
                type="button"
                className={`ml-view-btn${showViewSettings ? ' is-active' : ''}`}
                title="视图设置"
                onClick={() => setShowViewSettings(true)}
              >
                视图
              </button>
            </div>

            <div className="ml-view-search">
              <Input
                type="search"
                value={query}
                placeholder="搜索番号 / 标题 / 服务器"
                onChange={(e) => setQuery(e.currentTarget.value)}
                aria-label="搜索媒体库"
              />
            </div>
          </div>
        </div>
      </div>

      {!usingPreview && resumeList.length > 0 ? (
        <section className="ml-resume" aria-label="继续观看">
          <div className="ml-section-head">
            <h3>继续观看</h3>
            <span>{resumeList.length} 部 · 扩展内续播</span>
          </div>
          <div className="ml-resume-row">
            {resumeList.map((item) => (
              <ResumeMediaCard
                key={`resume-${item.source}:${item.itemId || item.code}`}
                item={item}
                onPlay={handleResumePlay}
              />
            ))}
          </div>
        </section>
      ) : null}

      <OverlayShell
        open={showSyncPanel}
        title="同步媒体库"
        size="lg"
        onClose={() => setShowSyncPanel(false)}
      >
        <div className="ml-command-panel" data-media-sync-panel="1">
          <div className="ml-command-panel-head">
            <h3>选择同步范围</h3>
            <p>更新所选 Emby、Jellyfin 和 115 片库目录的影片信息与播放状态。打开时默认选择全部来源。</p>
          </div>
          <div className="ml-command-panel-list">
            <label className="ml-sync-target ml-sync-target-all">
              <input
                type="checkbox"
                checked={allSyncTargetsSelected}
                disabled={syncing || syncTargets.length === 0}
                onChange={toggleAllSyncTargets}
              />
              <span>
                <strong>全选</strong>
                <small>已选择 {selectedSyncTargetKeys.size} / {syncTargets.length} 个来源</small>
              </span>
            </label>
            {syncTargets.length === 0 ? (
              <div className="ml-command-panel-empty" role="note">
                还没有可同步的来源。请先配置 Emby/Jellyfin 服务器，或在 115 设置中启用片库并选择目录。
              </div>
            ) : syncTargets.map((target) => (
              <label key={target.key} className="ml-sync-target">
                <input
                  type="checkbox"
                  checked={selectedSyncTargetKeys.has(target.key)}
                  disabled={syncing}
                  onChange={() => toggleSyncTarget(target.key)}
                />
                <span className="ml-command-panel-icon" aria-hidden="true">
                  {target.source === '115' ? '115' : target.source === 'jellyfin' ? 'JF' : 'E'}
                </span>
                <span>
                  <strong>{target.label}</strong>
                  <small>{target.detail}</small>
                </span>
              </label>
            ))}
          </div>
          <p className="ml-command-panel-meta">上次同步：{lastSyncLabel}</p>
          <div className="ml-view-settings-footer">
            <Button variant="secondary" onClick={() => setShowSyncPanel(false)} disabled={syncing}>
              取消
            </Button>
            <Button
              onClick={() => { void handleSyncLibrary(); }}
              disabled={syncing || selectedSyncTargetKeys.size === 0}
            >
              {syncing
                ? '同步中…'
                : allSyncTargetsSelected
                  ? '同步全部来源'
                  : `同步已选来源（${selectedSyncTargetKeys.size}）`}
            </Button>
          </div>
        </div>
      </OverlayShell>

      <OverlayShell
        open={showToolsPanel}
        title="媒体库工具"
        size="lg"
        onClose={() => setShowToolsPanel(false)}
      >
        <div className="ml-command-panel" data-media-tools-panel="1">
          <div className="ml-command-panel-head">
            <h3>媒体库工具</h3>
            <p>需要时可在这里播放 115 文件或整理已看影片；删除前会再次请你确认。</p>
          </div>
          <div className="ml-command-panel-list">
            <button
              type="button"
              className="ml-command-panel-item"
              onClick={openDrive115ManualPlay}
            >
              <span className="ml-command-panel-icon" aria-hidden="true">115</span>
              <span>
                <strong>115 手动播放</strong>
                <small>搜索网盘文件或粘贴 pick_code，临时取流播放。</small>
              </span>
            </button>
            <button
              type="button"
              className={`ml-command-panel-item${showCleanupPanel ? ' is-active' : ''}`}
              onClick={toggleCleanupPanel}
            >
              <span className="ml-command-panel-icon" aria-hidden="true">⌫</span>
              <span>
                <strong>已看影片整理</strong>
                <small>查找已经看完的影片，集中选择并处理各媒体来源中的文件。</small>
              </span>
            </button>
          </div>
        </div>
      </OverlayShell>

      <OverlayShell
        open={show115Panel}
        title="115 播放"
        size="xl"
        windowControls
        onClose={() => setShow115Panel(false)}
      >
        <div data-media-115-play-overlay="1">
          <Suspense fallback={<MediaPanelFallback label="正在准备 115 播放面板…" />}>
            <LazyMedia115PlayPanel
              initialQuery={play115Query}
              initialPickCode={play115PickCode}
              onStreamReady={handleDrive115StreamReady}
              onClose={() => setShow115Panel(false)}
            />
          </Suspense>
        </div>
      </OverlayShell>

      <OverlayShell
        open={Boolean(playbackChoice)}
        title={playbackChoice?.title || '选择播放来源'}
        size="lg"
        onClose={() => setPlaybackChoice(null)}
      >
        <div className="ml-command-panel" data-media-source-choice="1">
          <div className="ml-command-panel-head">
            <h3>选择播放来源</h3>
            <p>请选择本次播放使用的来源。不可播放的副本会保留在列表中，并说明原因。</p>
          </div>
          <div className="ml-command-panel-list">
            {playbackChoice?.items.map((sourceItem) => {
              const copy = sourceItem.copies?.[0];
              const status = getMediaSourceCopyPlaybackStatus(copy);
              const label = formatMediaSourceCopyLabel(copy);
              return (
                <button
                  key={copy?.copyId || `${sourceItem.source}:${sourceItem.itemId || sourceItem.pickCode}`}
                  type="button"
                  className="ml-command-panel-item"
                  disabled={!status.playable}
                  title={status.reason}
                  onClick={() => {
                    if (!status.playable) return;
                    const current = playbackChoice;
                    setPlaybackChoice(null);
                    playResolvedItem(sourceItem, {
                      startTimeSeconds: current?.startTimeSeconds,
                      highlights: current?.highlights,
                    });
                  }}
                >
                  <span className="ml-command-panel-icon" aria-hidden="true">
                    {sourceItem.source === '115' ? '115' : sourceItem.source === 'jellyfin' ? 'JF' : 'E'}
                  </span>
                  <span>
                    <strong>{label}</strong>
                    <small>
                      {status.playable ? '可播放' : status.reason}
                      {formatWatchPercent(sourceItem.userData) ? ` · 已播放 ${formatWatchPercent(sourceItem.userData)}` : ''}
                      {sourceItem.fileName ? ` · ${sourceItem.fileName}` : ''}
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </OverlayShell>

      <OverlayShell
        open={showCleanupPanel}
        title="已看影片整理"
        size="xl"
        windowControls
        onClose={() => setShowCleanupPanel(false)}
      >
        <div data-media-cleanup-overlay="1">
          <Suspense fallback={<MediaPanelFallback label="正在准备已看影片整理…" />}>
            <LazyMediaCleanupPanel refreshKey={cleanupRefreshKey} onScan={scanWatchedMedia} />
          </Suspense>
        </div>
      </OverlayShell>

      <OverlayShell
        open={showViewSettings}
        title="视图设置"
        size="lg"
        windowControls
        onClose={() => setShowViewSettings(false)}
      >
        <div className="ml-view-settings-panel">
          <section className="ml-view-settings-card" aria-labelledby="media-view-appearance-title">
            <div className="ml-view-settings-head">
              <h3 id="media-view-appearance-title">卡片外观</h3>
              <p>调整媒体库卡片的封面比例与网格尺寸。</p>
            </div>
            <label className="ml-view-settings-field">
              <span>封面类型</span>
              <select
                className="ml-select"
                value={viewSettings.coverView}
                aria-label="封面类型"
                onChange={(e) => {
                  const nextSettings = {
                    ...viewSettings,
                    coverView: e.currentTarget.value as MediaCoverViewMode,
                  };
                  setViewSettings(nextSettings);
                  writeMediaViewSettings(nextSettings);
                }}
              >
                {MEDIA_COVER_VIEW_MODES.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
              <span className="ml-view-settings-description">
                缩略图适合浏览，海报适合竖版刮削库，背景图会裁切铺满。
              </span>
            </label>
            <label className="ml-view-settings-field">
              <span>图像大小</span>
              <select
                className="ml-select"
                value={viewSettings.cardSize}
                aria-label="图像大小"
                onChange={(e) => {
                  const nextSettings = {
                    ...viewSettings,
                    cardSize: e.currentTarget.value as MediaViewSettings['cardSize'],
                  };
                  setViewSettings(nextSettings);
                  writeMediaViewSettings(nextSettings);
                }}
              >
                {MEDIA_CARD_SIZE_OPTIONS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
              <span className="ml-view-settings-description">控制网格卡片密度，不影响继续观看和轮播。</span>
            </label>
          </section>
          <section className="ml-view-settings-card" aria-labelledby="media-view-fields-title">
            <div className="ml-view-settings-head">
              <h3 id="media-view-fields-title">显示内容</h3>
              <p>有数据时才会显示；空字段自动隐藏，卡片不会堆“无”。</p>
            </div>
            <div className="ml-view-settings-toggle-grid">
              {DEFAULT_MEDIA_VIEW_FIELDS.map((field) => (
                <label key={field.id} className="ml-view-settings-toggle">
                  <input
                    type="checkbox"
                    checked={viewSettings.visibleFields[field.id]}
                    onChange={(e) => {
                      const nextSettings = {
                        ...viewSettings,
                        visibleFields: {
                          ...viewSettings.visibleFields,
                          [field.id]: e.currentTarget.checked,
                        },
                      };
                      setViewSettings(nextSettings);
                      writeMediaViewSettings(nextSettings);
                    }}
                  />
                  <span>{field.label}</span>
                </label>
              ))}
            </div>
          </section>
          {!showClientPreview ? (
            <section className="ml-view-settings-card" aria-labelledby="media-view-client-preview-title">
              <div className="ml-view-settings-head">
                <h3 id="media-view-client-preview-title">客户端预告</h3>
                <p>重新显示桌面端和 Android 端的产品进展提示。</p>
              </div>
              <button
                type="button"
                className="ml-view-btn ml-view-btn-primary"
                onClick={restoreClientPreview}
              >
                恢复显示预告
              </button>
            </section>
          ) : null}
          <div className="ml-view-settings-footer">
            <button
              type="button"
              className="ml-view-btn"
              onClick={resetMediaViewSettings}
            >
              恢复默认
            </button>
            <button
              type="button"
              className="ml-view-btn ml-view-btn-primary"
              onClick={() => setShowViewSettings(false)}
            >
              完成
            </button>
          </div>
        </div>
      </OverlayShell>


      <OverlayShell
        open={Boolean(embyStream)}
        title={embyStream ? `播放 · ${embyStream.code}` : '播放'}
        size="full"
        hideHeader
        closeOnBackdrop={false}
        onClose={closeEmbyPlayer}
      >
        {embyStream ? (
          <Suspense fallback={<MediaPanelFallback label="正在准备播放器…" />}>
            <LazyMediaPlayer
              title={embyStream.code}
              subtitle={embyStream.title}
              src={embyStream.streamUrl}
              streamType={embyStream.streamType}
              startTimeSeconds={embyStream.startTimeSeconds}
              highlights={embyStream.highlights}
              subtitles={embyStream.subtitles}
              qualities={embyStream.qualities}
              onClose={closeEmbyPlayer}
              onProgress={(info) => {
                lastProgressPosRef.current = info.currentTime || 0;
                if (info.duration > 0) lastProgressDurationRef.current = info.duration;
                if (info.ended) {
                  void reportEmbyProgress({
                    positionSeconds: info.currentTime || 0,
                    durationSeconds: info.duration || lastProgressDurationRef.current,
                    isCompleted: true,
                    isStopped: true,
                    force: true,
                  });
                  return;
                }
                void reportEmbyProgress({
                  positionSeconds: info.currentTime || 0,
                  durationSeconds: info.duration || lastProgressDurationRef.current,
                });
              }}
            />
          </Suspense>
        ) : null}
      </OverlayShell>

      <OverlayShell
        open={Boolean(drive115Stream)}
        title={drive115Stream ? `\u64ad\u653e \u00b7 ${drive115Stream.code}` : '\u64ad\u653e'}
        size="full"
        hideHeader
        closeOnBackdrop={false}
        onClose={closeDrive115Player}
      >
        {drive115Stream ? (
          <Suspense fallback={<MediaPanelFallback label="正在准备播放器…" />}>
            <LazyMediaPlayer
              title={drive115Stream.code}
              subtitle={drive115Stream.title}
              src={drive115Stream.streamUrl}
              streamType={drive115Stream.streamType || 'auto'}
              startTimeSeconds={drive115Stream.startTimeSeconds}
              crossOrigin={null}
              onClose={closeDrive115Player}
              onProgress={reportDrive115PlayerProgress}
            />
          </Suspense>
        ) : null}
      </OverlayShell>

      <OverlayShell
        open={Boolean(detailItem)}
        title={detailItem ? `${detailItem.code} · 详情` : '详情'}
        size="xl"
        windowControls
        onClose={handleDetailClose}
      >
        {detailItem ? (
          <Suspense fallback={<MediaPanelFallback label="正在读取影片详情…" />}>
            <LazyMediaItemDetailPanel
              item={detailItem}
              onPlay={handleDetailPlay}
              onPlayCopy={handleDetailPlayCopy}
              onOpenItem={handleDetailOpenItem}
              onWatchChanged={handleMediaWatchChanged}
              onClose={handleDetailClose}
            />
          </Suspense>
        ) : null}
      </OverlayShell>

      <section className="ml-catalog" aria-label="片库条目">
        <div className="ml-section-head">
          <h3>片库条目</h3>
          <span>
            {list.length} 部 ·{' '}
            {coverView === 'poster'
              ? '海报竖版 · 铺满'
              : coverView === 'backdrop'
                ? '背景横图 · 铺满'
                : '缩略图横版 · 铺满'}
          </span>
        </div>

        {loadingIndex ? (
          <EmptyState
            className="ml-empty"
            id="mediaLibraryLoading"
            title="正在读取媒体库索引"
            description="正在读取本地媒体库数据，请稍候。"
          />
        ) : list.length === 0 ? (
          <EmptyState
            className="ml-empty"
            id="mediaLibraryEmpty"
            title="还没有同步任何媒体库内容"
            description={
              usingPreview
                ? '请先配置一个媒体库来源，再回到这里点击「同步媒体库」。你也可以同时使用 Emby / Jellyfin 和 115。'
                : filter === '115'
                  ? '115 筛选下无条目。请到 115 设置配置片库根目录并点击「立即索引」。'
                  : '当前筛选下无结果，可切换来源或清空搜索。'
            }
            action={
              usingPreview ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      window.location.hash = '#tab-settings/emby-settings';
                    }}
                  >
                    配置 Emby / Jellyfin
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      window.location.hash = '#tab-settings/drive115-settings';
                    }}
                  >
                    配置 115 片库
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  onClick={() => {
                    window.location.hash =
                      filter === '115'
                        ? '#tab-settings/drive115-settings'
                        : '#tab-settings/emby-settings';
                  }}
                >
                  {filter === '115' ? '前往 115 设置' : '前往 Emby / Jellyfin 设置'}
                </Button>
              )
            }
          />
        ) : (
          <ProgressiveMediaGrid
            items={list}
            itemKey={(item) => `${item.source}:${item.itemId || item.code}`}
            priorityItem={(item) => item.watchState === 'in_progress'}
            renderItem={(item) => (
              <MediaCard
                item={item}
                usingPreview={usingPreview}
                coverView={coverView}
                viewSettings={viewSettings}
                onWatchChanged={handleMediaWatchChanged}
                onEnqueuedCleanup={handleMediaEnqueuedCleanup}
                onPlayItem={handleMediaPlayItem}
                onOpenDetail={handleMediaOpenDetail}
              />
            )}
          />
        )}
      </section>

      <div className="ml-note" role="note">
        {usingPreview
          ? '尚未同步媒体库。配置来源后，点击上方「同步媒体库」即可开始建立本地索引。'
          : '当前展示本地媒体库索引。点卡片打开扩展内详情，点播放在弹窗播放器中播放（令牌取流）。'}
      </div>
    </div>
  );
}

function MediaHeroCarousel({
  items,
  coverView,
  usingPreview,
  onRequestPlayback,
  onOpenDetail,
}: {
  items: MediaBrowseItem[];
  coverView: MediaCoverViewMode;
  usingPreview: boolean;
  onRequestPlayback: (item: MediaBrowseItem) => void;
  onOpenDetail: (item: MediaBrowseItem) => void;
}) {
  const [heroStep, setHeroStep] = useState(0);
  const heroWindow = useMemo(
    () => buildCarouselWindow(heroStep, items.length, MEDIA_HERO_VISIBLE_RADIUS + 1),
    [heroStep, items.length],
  );
  const activeHeroIndex = items.length > 0
    ? ((heroStep % items.length) + items.length) % items.length
    : 0;

  useEffect(() => {
    setHeroStep(0);
  }, [items]);

  useEffect(() => {
    if (items.length === 0) return undefined;
    const timer = window.setTimeout(() => {
      setHeroStep((step) => step + 1);
    }, 4500);
    return () => window.clearTimeout(timer);
  }, [heroStep, items.length]);

  const goHero = (targetIndex: number) => {
    if (items.length === 0) return;
    setHeroStep((step) => resolveCarouselDotStep(step, targetIndex, items.length));
  };

  return (
    <section className="ml-hero" aria-label="推荐轮播" data-hero-step={heroStep}>
      <div className="ml-hero-track">
        {heroWindow.map(({ virtualIndex, itemIndex, position }) => {
          const item = items[itemIndex];
          if (!item) return null;
          return (
            <MediaHeroCard
              key={`hero:${virtualIndex}:${item.source}:${item.itemId || item.code}`}
              item={item}
              virtualIndex={virtualIndex}
              itemIndex={itemIndex}
              position={position}
              coverView={coverView}
              usingPreview={usingPreview}
              onSetHeroStep={setHeroStep}
              onRequestPlayback={onRequestPlayback}
              onOpenDetail={onOpenDetail}
            />
          );
        })}
      </div>
      <button type="button" className="ml-hero-nav prev" aria-label="上一张" onClick={() => setHeroStep((step) => step - 1)}>
        ‹
      </button>
      <button type="button" className="ml-hero-nav next" aria-label="下一张" onClick={() => setHeroStep((step) => step + 1)}>
        ›
      </button>
      <div className="ml-hero-dots">
        {items.map((item, index) => (
          <button
            key={`${item.source}:${item.itemId || item.code}`}
            type="button"
            className={`ml-hero-dot${index === activeHeroIndex ? ' is-active' : ''}`}
            aria-label={`第 ${index + 1} 张`}
            onClick={() => goHero(index)}
          />
        ))}
      </div>
    </section>
  );
}

const MediaHeroCard = memo(function MediaHeroCard({
  item,
  virtualIndex,
  itemIndex,
  position,
  coverView,
  usingPreview,
  onSetHeroStep,
  onRequestPlayback,
  onOpenDetail,
}: MediaHeroCardRenderProps) {
  const { ref: d115HeroCoverRef, coverUrl: d115HeroCover } = useDrive115Cover(item);
  const posAttr = Math.abs(position) <= MEDIA_HERO_VISIBLE_RADIUS
    ? String(position)
    : position < 0 ? 'before' : 'after';
  const isActive = position === 0;
  const heroCover = resolveCoverImage(item, coverView);
  const heroImageUrl = item.source === '115' && d115HeroCover
    ? d115HeroCover
    : heroCover.url;
  const canPlay = usingPreview || resolvePlaybackChoice(item).kind !== 'unavailable';

  return (
    <div
      ref={d115HeroCoverRef}
      className="ml-hero-card"
      data-pos={posAttr}
      data-virtual-index={virtualIndex}
      data-item-index={itemIndex}
      data-cover-mode={coverView}
      data-active={isActive ? '1' : '0'}
    >
      <button
        type="button"
        className="ml-hero-hit"
        title={isActive ? `查看详情 · ${item.code}` : `切换到 ${item.code}`}
        onClick={() => {
          if (!isActive) {
            onSetHeroStep(virtualIndex);
            return;
          }
          onOpenDetail(item);
        }}
      >
        <MediaCover
          hoverZoom={false}
          showPlayHint={false}
          fit="cover"
          imageUrl={heroImageUrl}
          fallbackImageUrl={heroCover.fallbackUrl}
          artStyle={coverArtStyle(item, coverView)}
          alt={item.code}
          footer={
            <>
              <span className="ml-code">{item.code}</span>
              <div className="ml-card-title">{item.title}</div>
              {isActive ? (
                <div className="ml-hero-meta-inline">
                  {sourceLabel(item.source)}
                  {item.year ? ` · ${item.year}` : ''}
                  {item.serverName ? ` · ${item.serverName}` : ''}
                  {usingPreview ? ' · 预览' : ''}
                  {heroCover.fellBack && !d115HeroCover && coverView === 'thumb' ? ' · 无缩略图' : ''}
                </div>
              ) : null}
            </>
          }
        />
      </button>
      {isActive ? (
        <div className="ml-hero-actions">
          {canPlay ? (
            <button
              type="button"
              className="ml-hero-play"
              title="使用已登录令牌在扩展内播放"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRequestPlayback(item);
              }}
            >
              <span aria-hidden="true">▶</span>
              <span>播放</span>
            </button>
          ) : null}
          <button
            type="button"
            className="ml-hero-detail"
            title={`查看详情 · ${item.code}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onOpenDetail(item);
            }}
          >
            详情
          </button>
        </div>
      ) : null}
    </div>
  );
}, areMediaHeroCardPropsEqual);

const ResumeMediaCard = memo(function ResumeMediaCard({
  item,
  onPlay,
}: ResumeMediaCardRenderProps) {
  const { ref: d115ResumeCoverRef, coverUrl: d115ResumeCover } = useDrive115Cover(item);
  const pctNum = resolveWatchProgressPercent(item.userData);
  // 在看列表里即便 percent 暂为 0，也给可见进度条（避免“有续看却无条”）
  const barPct = pctNum > 0 ? pctNum : 5;
  const pct = pctNum > 0 ? `${pctNum}%` : '';
  const resumeCover = resolveCoverImageUrl(item, 'thumb') || item.coverImageUrl;
  const coverUrl = item.source === '115' && d115ResumeCover ? d115ResumeCover : resumeCover;
  const canPlay = resolvePlaybackChoice(item).kind !== 'unavailable';

  return (
    <button
      ref={d115ResumeCoverRef}
      type="button"
      className="ml-resume-card"
      title={canPlay ? '扩展内续播' : item.title}
      disabled={!canPlay}
      onClick={() => {
        if (!canPlay) return;
        // 续看：从本地 positionTicks 起播（秒）
        const resumeSec = Math.max(
          0,
          (Number(item.userData?.positionTicks) || 0) / 10_000_000,
        );
        onPlay(item, resumeSec);
      }}
    >
      <div className="ml-resume-cover-wrap">
        <LazyRemoteImage
          className="ml-resume-cover"
          url={coverUrl}
          asBackground
          alt={item.code}
        />
        <div
          className="ml-resume-progress"
          role="progressbar"
          aria-valuenow={barPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={pctNum > 0 ? `已播放 ${pctNum}%` : '继续观看'}
        >
          <span
            className="ml-resume-progress-fill"
            style={{ width: `${barPct}%` }}
          />
        </div>
      </div>
      <div className="ml-resume-body">
        <div className="ml-resume-code">{item.code}</div>
        <div className="ml-resume-title">{item.title}</div>
        <div className="ml-resume-meta">
          {sourceLabel(item.source)}
          {pct ? ` · ${pct}` : ' · 在看'}
        </div>
      </div>
    </button>
  );
}, areResumeMediaCardPropsEqual);

/**
 * 片库网格卡片：Emby 风格封面覆盖层 + 可配置元信息
 */
const MediaCard = memo(function MediaCard({
  item,
  usingPreview,
  coverView,
  viewSettings,
  onWatchChanged,
  onEnqueuedCleanup,
  onPlayItem,
  onOpenDetail,
}: MediaCardRenderProps) {
  const [busy, setBusy] = useState(false);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const watchState = item.watchState;
  const watchLabel = watchState && watchState !== 'none' ? watchStateLabel(watchState) : '';
  const percentLabel = formatWatchPercent(item.userData);
  const progressPercent = resolveWatchProgressPercent(item.userData);
  const progressBarPercent = watchState === 'watched'
    ? 100
    : progressPercent > 0
      ? progressPercent
      : 0;
  const watchBadge =
    watchState === 'watched'
      ? { tone: 'success' as const, text: watchLabel }
      : watchState === 'in_progress'
        ? { tone: 'warning' as const, text: percentLabel ? `${watchLabel} ${percentLabel}` : watchLabel }
        : usingPreview
          ? { tone: 'warning' as const, text: '预览' }
          : { tone: 'success' as const, text: '已入库' };

  const coverResolved = resolveCoverImage(item, coverView);
  const { ref: d115CoverRef, coverUrl: d115Cover } = useDrive115Cover(item);
  const canTogglePlayed = Boolean(item.itemId && item.serverUrl && !usingPreview);
  const isWatched = watchState === 'watched';
  const canPlay = usingPreview || resolvePlaybackChoice(item).kind !== 'unavailable';

  const playItem = () => {
    if (!usingPreview) {
      onPlayItem?.(item);
      return;
    }
    window.dispatchEvent(
      new CustomEvent('media-open-115-play', { detail: { query: item.code, pickCode: item.pickCode } }),
    );
  };

  const setPlayed = async (played: boolean) => {
    if (!canTogglePlayed || busy) return;
    setBusy(true);
    try {
      await new Promise<{ success?: boolean; error?: string }>((resolve, reject) => {
        try {
          chrome.runtime.sendMessage(
            {
              type: 'EMBY_LIBRARY_SET_PLAYED',
              itemId: item.itemId,
              serverUrl: item.serverUrl,
              serverId: item.serverId,
              played,
            },
            (resp) => {
              const err = chrome.runtime.lastError;
              if (err) {
                reject(new Error(err.message));
                return;
              }
              resolve(resp || {});
            },
          );
        } catch (e) {
          reject(e);
        }
      }).then((resp) => {
        if (!resp.success) {
          const err = resp.error || '写回失败';
          if (/登录|令牌|ApiKey|UserData|用户/i.test(err)) {
            throw new Error(`${err}\n\n请到「设置 → Emby/Jellyfin」中登录媒体服务器用户账号后再试。`);
          }
          throw new Error(err);
        }
      });
      onWatchChanged?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      void toast(`标记失败：${msg}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const enqueueCleanup = () => {
    void (async () => {
      if (busy) return;
      setBusy(true);
      try {
        const copies = item.copies?.length ? item.copies : [{
          copyId: item.source === '115'
            ? `115:${item.itemId || item.pickCode}`
            : `${item.source}:${String(item.serverUrl || '').replace(/\/+$/, '')}:${item.itemId}`,
          source: item.source,
          serverName: item.serverName,
          serverUrl: item.serverUrl,
          serverId: item.serverId,
          itemId: item.itemId,
          fileId: item.source === '115' ? item.itemId : undefined,
          pickCode: item.pickCode,
          fileName: item.fileName,
          folderPath: item.folderPath,
        }];
        for (const copy of copies) {
          if (!copy.copyId) continue;
          await enqueueCompletedPlayback({
            code: item.code,
            title: item.title,
            source: copy.source === '115' ? 'drive115' : copy.source,
            copyId: copy.copyId,
            serverName: copy.serverName,
            serverUrl: copy.serverUrl,
            serverId: copy.serverId,
            itemId: copy.source === '115' ? undefined : copy.itemId,
            fileId: copy.source === '115' ? (copy.fileId || copy.itemId) : undefined,
            pickCode: copy.pickCode,
            fileName: copy.fileName,
            folderPath: copy.folderPath,
          });
        }
        onEnqueuedCleanup?.();
        void toast(`已将 ${copies.length} 个来源副本加入清理清单`, 'success');
      } catch (e) {
        void toast(e instanceof Error ? e.message : String(e), 'error');
      } finally {
        setBusy(false);
      }
    })();
  };

  const metaItems = buildCardMetaItems(item, viewSettings);
  const tagItems = buildCardTagItems(item, viewSettings);
  const sourceLabels = getMediaSourceLabels(item);
  const titleText = item.title || item.code;
  const sourceCopyCount = item.copies?.length ?? 0;
  const hasMultipleSources = sourceCopyCount > 1;

  return (
    <article
      ref={d115CoverRef}
      className="ml-card ml-card-emby"
      data-code={item.code}
      data-layout-card="1"
      data-watch-state={watchState || 'none'}
      data-card-size={viewSettings.cardSize}
    >
      <div className="ml-card-cover">
        <button
          type="button"
          className="ml-card-hit"
          onClick={() => onOpenDetail?.(item)}
          title={`查看详情${watchLabel ? ` · ${watchLabel}` : ''}`}
        >
          <MediaCover
            fit="cover"
            imageUrl={item.source === '115' && d115Cover ? d115Cover : coverResolved.url}
            fallbackImageUrl={coverResolved.fallbackUrl}
            artStyle={coverArtStyle(item, coverView)}
            alt={item.code}
            showPlayHint={false}
          />
        </button>

        <div
          className="ml-card-progress"
          role="progressbar"
          aria-valuenow={progressBarPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={
            progressBarPercent >= 100
              ? '已播放'
              : progressBarPercent > 0
                ? `已播放 ${progressBarPercent}%`
                : '未开始播放'
          }
        >
          <span className="ml-card-progress-fill" style={{ width: `${progressBarPercent}%` }} />
        </div>

        <div className="ml-card-overlay" aria-hidden={false}>
          <div className="ml-card-overlay-badges">
            <Badge tone={item.source === 'emby' ? 'primary' : item.source === 'jellyfin' ? 'info' : 'neutral'}>
              {sourceLabel(item.source)}
            </Badge>
            {hasMultipleSources ? (
              <Badge
                tone="neutral"
                className="ml-card-copy-count"
                data-media-copy-count={sourceCopyCount}
                title={`同一影片有 ${sourceCopyCount} 个可用来源`}
              >
                {sourceCopyCount} 个来源
              </Badge>
            ) : null}
            <Badge tone={watchBadge.tone}>{watchBadge.text}</Badge>
            {coverView === 'thumb' && coverResolved.fellBack ? <Badge tone="neutral">无缩略图</Badge> : null}
          </div>

          {canPlay ? (
            <button
              type="button"
              className="ml-card-overlay-play"
              title={item.source === '115' || usingPreview ? '115 播放' : '扩展内播放'}
              aria-label={item.source === '115' || usingPreview ? '115 播放' : '扩展内播放'}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                playItem();
              }}
            >
              ▶
            </button>
          ) : null}

          <div className="ml-card-overlay-actions">
            {canTogglePlayed ? (
              <button
                type="button"
                className="ml-card-overlay-icon"
                disabled={busy}
                title={isWatched ? '标记为未看' : '标记为已播放'}
                aria-label={isWatched ? '标记为未看' : '标记为已播放'}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void setPlayed(!isWatched);
                }}
              >
                ✓
              </button>
            ) : null}
            {item.source !== '115' && !usingPreview ? (
              <button
                type="button"
                className="ml-card-overlay-icon ml-card-overlay-icon-text"
                title="在 115 搜索并播放"
                aria-label="在 115 搜索并播放"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  window.dispatchEvent(
                    new CustomEvent('media-open-115-play', { detail: { query: item.code, pickCode: item.pickCode } }),
                  );
                }}
              >
                115
              </button>
            ) : null}
            <button
              type="button"
              className="ml-card-overlay-icon"
              title="添加到收藏"
              aria-label="添加到收藏"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void toast('收藏同步稍后开放', 'info');
              }}
            >
              ☆
            </button>
            <button
              type="button"
              className="ml-card-overlay-icon"
              title="更多操作"
              aria-label="更多操作"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowActionMenu(true);
              }}
            >
              ⋯
            </button>
          </div>
        </div>
      </div>

      <div className="ml-card-text">
        {viewSettings.visibleFields.title ? (
          <button
            type="button"
            className="ml-card-title-line"
            title={titleText}
            onClick={() => onOpenDetail?.(item)}
          >
            {titleText}
          </button>
        ) : null}
        {metaItems.length > 0 ? (
          <div className="ml-card-info-row">
            {metaItems.map((meta) => (
              <span key={meta.key} className="ml-card-info-item">{meta.text}</span>
            ))}
          </div>
        ) : null}
        <div className="ml-card-source-row" aria-label="影片来源">
          {sourceLabels.map((label) => (
            <span key={label} className="ml-card-source">{label}</span>
          ))}
        </div>
        {tagItems.length > 0 ? (
          <div className="ml-card-tag-row">
            {tagItems.map((tag) => (
              <span key={tag.key} className="ml-card-tag">{tag.text}</span>
            ))}
          </div>
        ) : null}
        {isWatched ? (
          <button
            type="button"
            className="ml-card-cleanup-link"
            disabled={busy}
            title="将当前全部来源副本加入待清理清单"
            onClick={enqueueCleanup}
          >
            加入清理清单
          </button>
        ) : null}
      </div>

      <OverlayShell
        open={showActionMenu}
        title={`${item.code} · 更多操作`}
        size="lg"
        onClose={() => setShowActionMenu(false)}
      >
        <div className="ml-card-action-sheet" data-media-card-action-sheet="1">
          <div className="ml-card-action-preview">
            <MediaCover
              fit="cover"
              imageUrl={item.source === '115' && d115Cover ? d115Cover : coverResolved.url}
              fallbackImageUrl={coverResolved.fallbackUrl}
              artStyle={coverArtStyle(item, coverView)}
              alt={item.code}
              showPlayHint={false}
            />
            <div className="ml-card-action-preview-text">
              <strong>{titleText}</strong>
              <span>
                {item.year ? `${item.year} · ` : ''}
                {sourceLabel(item.source)}
                {item.serverName ? ` · ${item.serverName}` : ''}
              </span>
            </div>
          </div>

          <div className="ml-card-action-list">
            {canPlay ? (
              <button
                type="button"
                className="ml-card-action-item"
                onClick={() => {
                  setShowActionMenu(false);
                  playItem();
                }}
              >
                <span aria-hidden="true">▶</span>
                <span>播放</span>
              </button>
            ) : null}
            <button
              type="button"
              className="ml-card-action-item"
              onClick={() => {
                setShowActionMenu(false);
                onOpenDetail?.(item);
              }}
            >
              <span aria-hidden="true">ℹ</span>
              <span>查看详情</span>
            </button>
            {item.source !== '115' && !usingPreview ? (
              <button
                type="button"
                className="ml-card-action-item"
                onClick={() => {
                  setShowActionMenu(false);
                  window.dispatchEvent(
                    new CustomEvent('media-open-115-play', { detail: { query: item.code, pickCode: item.pickCode } }),
                  );
                }}
              >
                <span aria-hidden="true">115</span>
                <span>在 115 搜索并播放</span>
              </button>
            ) : null}
            {canTogglePlayed ? (
              <button
                type="button"
                className="ml-card-action-item"
                disabled={busy}
                onClick={() => {
                  void setPlayed(!isWatched);
                }}
              >
                <span aria-hidden="true">✓</span>
                <span>{isWatched ? '标记为未看' : '标记为已播放'}</span>
              </button>
            ) : null}
            <button
              type="button"
              className="ml-card-action-item"
              onClick={() => {
                void toast('收藏同步稍后开放', 'info');
              }}
            >
              <span aria-hidden="true">☆</span>
              <span>添加到收藏</span>
            </button>
            {isWatched ? (
              <button
                type="button"
                className="ml-card-action-item"
                disabled={busy}
                onClick={() => {
                  setShowActionMenu(false);
                  enqueueCleanup();
                }}
              >
                <span aria-hidden="true">⌫</span>
                <span>加入清理清单</span>
              </button>
            ) : null}
          </div>
        </div>
      </OverlayShell>
    </article>
  );
}, areMediaCardPropsEqual);

type CardTextToken = { key: string; text: string };

function buildCardMetaItems(item: MediaBrowseItem, settings: MediaViewSettings): CardTextToken[] {
  const fields = settings.visibleFields;
  const nfo = item.nfoSummary;
  const out: CardTextToken[] = [];
  const runtime = resolveRuntimeText(item);
  if (fields.rating && nfo?.rating) out.push({ key: 'rating', text: `★ ${nfo.rating}` });
  if (fields.criticRating && nfo?.contentRating) out.push({ key: 'criticRating', text: nfo.contentRating });
  if (fields.year && item.year) out.push({ key: 'year', text: item.year });
  if (fields.runtime && runtime) out.push({ key: 'runtime', text: runtime });
  if (fields.studio && nfo?.studio) out.push({ key: 'studio', text: nfo.studio });
  if (fields.fileName && item.fileName) out.push({ key: 'fileName', text: item.fileName });
  return out;
}

function buildCardTagItems(item: MediaBrowseItem, settings: MediaViewSettings): CardTextToken[] {
  const fields = settings.visibleFields;
  const nfo = item.nfoSummary;
  const out: CardTextToken[] = [];
  if (fields.genres && nfo?.genres?.length) {
    out.push(...nfo.genres.slice(0, 3).map((genre) => ({ key: `genre:${genre}`, text: genre })));
  }
  if (fields.director && nfo?.director) out.push({ key: 'director', text: nfo.director });
  return out.slice(0, 5);
}

function resolveRuntimeText(item: MediaBrowseItem): string {
  const nfoRuntime = String(item.nfoSummary?.runtime || '').trim();
  if (nfoRuntime) return /分钟|分|min/i.test(nfoRuntime) ? nfoRuntime : `${nfoRuntime} 分钟`;
  const runtimeTicks = Number(item.userData?.runtimeTicks) || 0;
  if (runtimeTicks <= 0) return '';
  const minutes = Math.round(runtimeTicks / 10_000_000 / 60);
  return minutes > 0 ? `${minutes} 分钟` : '';
}

