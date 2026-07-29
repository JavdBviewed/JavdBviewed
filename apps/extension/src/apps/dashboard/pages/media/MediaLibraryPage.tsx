/**
 * @file MediaLibraryPage.tsx
 * @description 媒体库浏览页：筛选 + 堆叠轮播 + 网格；优先展示本地 Emby/Jellyfin 索引
 * @module apps/dashboard/pages/media
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '../../../../ui/primitives/Badge/Badge';
import { Button } from '../../../../ui/primitives/Button/Button';
import { Input } from '../../../../ui/primitives/Input/Input';
import { MediaCover } from '../../../../ui/primitives/MediaCover/MediaCover';
import { EmptyState } from '../../../../ui/patterns/EmptyState/EmptyState';
import { MediaPlayer } from '../../../../ui/patterns/MediaPlayer/MediaPlayer';
import { OverlayShell } from '../../../../ui/patterns/OverlayShell/OverlayShell';
import { LazyRemoteImage } from '../../../../ui/patterns/LazyRemoteImage/LazyRemoteImage';
import { useDrive115Cover } from './useDrive115Cover';
import { resolveDashboardNavState } from '../../../../dashboard/tabs/navModel';
import type { EmbyLibraryState } from '../../../../features/embyLibrary/types';
import { STORAGE_KEYS } from '../../../../utils/config';
import { getValue } from '../../../../utils/storage';
import {
  coverArtStyle,
  filterMediaItems,
  heroItems,
  MEDIA_HERO_VISIBLE_RADIUS,
  MEDIA_COVER_VIEW_MODES,
  MEDIA_PREVIEW_ITEMS,
  readCoverViewMode,
  resolveCoverImage,
  resolveCoverImageUrl,
  resumeMediaItems,
  type MediaBrowseItem,
  type MediaBrowseSource,
  type MediaCoverViewMode,
  type MediaWatchFilter,
  relativeCarouselPos,
  sourceLabel,
  subPathToFilter,
  writeCoverViewMode,
} from './mediaBrowseModel';
import {
  formatWatchPercent,
  hasLibraryIndex,
  hasDrive115LibraryIndex,
  mapLibraryStateToBrowseItems,
  mapDrive115LibraryStateToBrowseItems,
  mergeBrowseCatalogs,
  mergeLocalWatchEvidence,
  resolveWatchProgressPercent,
  watchStateLabel,
} from './mediaLibraryIndexAdapter';
import { Media115PlayPanel, type Media115ResolvedStream } from './Media115PlayPanel';
import { Media115CleanupPanel } from './Media115CleanupPanel';
import { MediaItemDetailPanel } from './MediaItemDetailPanel';
import { enqueueWatchedForCleanup } from '../../../../features/drive115/v2/drive115CleanupActions';
import { loadWatchEvidenceMap } from '../../../../features/media/mediaWatchEvidence';
import './mediaPage.css';

const FILTERS: { id: MediaBrowseSource; label: string }[] = [
  { id: 'all', label: '全部来源' },
  { id: 'emby', label: 'Emby' },
  { id: 'jellyfin', label: 'Jellyfin' },
  { id: '115', label: '115' },
];

const WATCH_FILTERS: { id: MediaWatchFilter; label: string }[] = [
  { id: 'all', label: '全部状态' },
  { id: 'in_progress', label: '在看' },
  { id: 'watched', label: '真实已看' },
  { id: 'not_watched', label: '未看完' },
];

const EMPTY_STATE: EmbyLibraryState = { entries: {}, updatedAt: 0 };

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
};

function reportDrive115Evidence(payload: Record<string, unknown>): void {
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    chrome.runtime.sendMessage({ type: 'MEDIA_WATCH_EVIDENCE_REPORT', ...payload }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    /* ignore */
  }
}

function reportDrive115StreamProgress(
  stream: Drive115PlayerStream,
  opts: { positionSeconds: number; durationSeconds?: number; forceWatched?: boolean },
): void {
  const duration = Math.max(0, Number(opts.durationSeconds) || 0);
  const position = Math.max(0, Number(opts.positionSeconds) || 0);
  if (duration <= 0) return;
  const percent = opts.forceWatched ? 100 : Math.min(100, (position / duration) * 100);
  reportDrive115Evidence({
    code: stream.code,
    source: 'drive115',
    percent,
    positionSec: opts.forceWatched ? duration : position,
    durationSec: duration,
    pickCode: stream.pickCode,
    fileId: stream.fileId,
    fileName: stream.fileName || stream.title,
    forceWatched: Boolean(opts.forceWatched),
  });
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

/**
 * 媒体库主页面
 */
export function MediaLibraryPage() {
  const [filter, setFilter] = useState<MediaBrowseSource>('all');
  const [watchFilter, setWatchFilter] = useState<MediaWatchFilter>('all');
  const [coverView, setCoverView] = useState<MediaCoverViewMode>(() => readCoverViewMode());
  const [query, setQuery] = useState('');
  const [heroIndex, setHeroIndex] = useState(0);
  const [catalog, setCatalog] = useState<MediaBrowseItem[]>(MEDIA_PREVIEW_ITEMS);
  const [usingPreview, setUsingPreview] = useState(true);
  const [indexUpdatedAt, setIndexUpdatedAt] = useState(0);
  const [loadingIndex, setLoadingIndex] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [librarySyncMessage, setLibrarySyncMessage] = useState('');
  const [show115Panel, setShow115Panel] = useState(false);
  const [play115Query, setPlay115Query] = useState('');
  const [play115PickCode, setPlay115PickCode] = useState('');
  const play115StartTimeRef = useRef(0);
  const [showCleanupPanel, setShowCleanupPanel] = useState(false);
  const [cleanupRefreshKey, setCleanupRefreshKey] = useState(0);
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

  // 兼容旧 hash 子路径
  useEffect(() => {
    const apply = () => {
      const state = resolveDashboardNavState(window.location.hash);
      if (state.tabId === 'tab-media') {
        setFilter(subPathToFilter(state.subPath));
      }
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);

  /**
   * 从 storage 读取本地索引并刷新目录
   */
  const reloadCatalogFromStorage = async () => {
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
      const embyItems = hasLibraryIndex(state) ? mapLibraryStateToBrowseItems(state) : [];
      const drive115Items = hasDrive115LibraryIndex(drive115State)
        ? mapDrive115LibraryStateToBrowseItems(drive115State as any)
        : [];
      const merged = mergeBrowseCatalogs(embyItems, drive115Items);
      if (merged.length > 0) {
        setCatalog(mergeLocalWatchEvidence(merged, evidence));
        setUsingPreview(false);
        setIndexUpdatedAt(
          Math.max(Number(state.updatedAt) || 0, Number(drive115State?.updatedAt) || 0),
        );
      } else {
        setCatalog(MEDIA_PREVIEW_ITEMS);
        setUsingPreview(true);
        setIndexUpdatedAt(0);
      }
    } catch {
      setCatalog(MEDIA_PREVIEW_ITEMS);
      setUsingPreview(true);
      setIndexUpdatedAt(0);
    } finally {
      setLoadingIndex(false);
    }
  };

  // 首次进入读取索引
  useEffect(() => {
    void reloadCatalogFromStorage();
  }, []);

  // 索引写入后实时刷新目录：115 增量入库 / Emby 同步都会更新本地库，无需重进页面
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
    const watchedKeys = [STORAGE_KEYS.DRIVE115_LIBRARY_STATE, STORAGE_KEYS.EMBY_LIBRARY_STATE];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'local') return;
      if (!watchedKeys.some((key) => key in changes)) return;
      // 防抖：增量入库会连续触发多次变更，合并为一次刷新，避免抖动
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void reloadCatalogFromStorage();
      }, 400);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      if (timer) clearTimeout(timer);
      chrome.storage.onChanged.removeListener(onChanged);
    };
    // reloadCatalogFromStorage 只读 storage + 调用稳定 setState，捕获首个闭包即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const playEmbyItem = async (
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
  };


  const handleDrive115StreamReady = useCallback((stream: Media115ResolvedStream) => {
    const candidate = stream.candidate;
    const code = stream.query || candidate.fileName || candidate.pickCode;
    const start = Math.max(0, Number(play115StartTimeRef.current) || 0);
    drive115LastProgressReportRef.current = 0;
    drive115LastProgressPosRef.current = start;
    drive115LastProgressDurationRef.current = 0;
    setShow115Panel(false);
    setDrive115Stream({
      code,
      title: candidate.fileName || stream.query || candidate.pickCode,
      streamUrl: stream.streamUrl,
      streamType: stream.streamType || 'auto',
      pickCode: candidate.pickCode,
      fileId: candidate.fileId,
      fileName: candidate.fileName,
      ...(stream.webPlayUrl ? { webPlayUrl: stream.webPlayUrl } : {}),
      ...(start > 2 ? { startTimeSeconds: start } : {}),
    });
    play115StartTimeRef.current = 0;
    if (stream.message) {
      void toast(stream.message, 'info');
    }
  }, []);

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
    if (duration <= 0) return;

    if (info.ended) {
      reportDrive115StreamProgress(cur, {
        positionSeconds: duration,
        durationSeconds: duration,
        forceWatched: true,
      });
      void reloadCatalogFromStorage();
      return;
    }

    const now = Date.now();
    if (now - drive115LastProgressReportRef.current < 8000) return;
    drive115LastProgressReportRef.current = now;
    reportDrive115StreamProgress(cur, {
      positionSeconds: position,
      durationSeconds: duration,
    });
  }, []);

  const closeDrive115Player = useCallback(() => {
    const streamSnap = drive115StreamRef.current;
    const position = drive115LastProgressPosRef.current;
    const duration = drive115LastProgressDurationRef.current;
    setDrive115Stream(null);
    if (streamSnap && duration > 0) {
      reportDrive115StreamProgress(streamSnap, {
        positionSeconds: position,
        durationSeconds: duration,
      });
    }
    void reloadCatalogFromStorage();
  }, []);

  /**
   * 触发后台媒体库同步后刷新本地目录
   */
  const handleSyncLibrary = async () => {
    if (syncing) return;
    setSyncing(true);
    setLibrarySyncMessage('正在同步媒体库…');
    try {
      const response = await new Promise<{
        success?: boolean;
        synced?: number;
        failed?: number;
        error?: string;
        serverResults?: Array<{
          serverName?: string;
          success?: boolean;
          error?: string;
          itemCount?: number;
          indexedCount?: number;
        }>;
      }>((resolve, reject) => {
        try {
          chrome.runtime.sendMessage(
            { type: 'EMBY_LIBRARY_SYNC', manual: true },
            (resp) => {
              const err = chrome.runtime.lastError;
              if (err) {
                reject(new Error(err.message));
                return;
              }
              resolve(resp || {});
            },
          );
        } catch (error) {
          reject(error);
        }
      });

      await reloadCatalogFromStorage();

      if (response.success) {
        const synced = Number(response.synced || 0);
        const failed = Number(response.failed || 0);
        const parts = [`同步完成：成功 ${synced} 台`];
        if (failed > 0) parts.push(`失败 ${failed} 台`);
        const failDetail = (response.serverResults || [])
          .filter((r) => !r.success && r.error)
          .map((r) => `${r.serverName || '服务器'}: ${r.error}`)
          .slice(0, 2)
          .join('；');
        const message = failDetail ? `${parts.join('，')}（${failDetail}）` : parts.join('，');
        setLibrarySyncMessage(message);
        // toast 类型：全成功 success；部分成功 warning；全失败 / 无可同步服务器 error|warning
        if (failed === 0) {
          if (synced === 0) {
            await toast(message || '还没有可同步的媒体服务器', 'warning');
          } else {
            await toast(message, 'success');
          }
        } else if (synced > 0) {
          await toast(message, 'warning');
        } else {
          await toast(message, 'error');
        }
      } else {
        const failDetail = (response.serverResults || [])
          .filter((r) => !r.success && r.error)
          .map((r) => `${r.serverName || '服务器'}: ${r.error}`)
          .slice(0, 3)
          .join('；');
        const message =
          failDetail
          || response.error
          || '同步失败，请到「设置 → Emby/Jellyfin」查看诊断（常见：服务器 502/超时/Key 错误）';
        setLibrarySyncMessage(message);
        await toast(message, 'error');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const full = `同步失败：${message}`;
      setLibrarySyncMessage(full);
      await toast(full, 'error');
    } finally {
      setSyncing(false);
    }
  };

  const heroes = useMemo(() => heroItems(catalog), [catalog]);
  const resumeList = useMemo(() => resumeMediaItems(catalog, 8), [catalog]);
  const list = useMemo(
    () => filterMediaItems(catalog, filter, query, watchFilter),
    [catalog, filter, query, watchFilter],
  );

  useEffect(() => {
    if (heroes.length === 0) return;
    const timer = window.setInterval(() => {
      setHeroIndex((i) => (i + 1) % heroes.length);
    }, 4500);
    return () => window.clearInterval(timer);
  }, [heroes.length]);

  // 目录变化时复位轮播
  useEffect(() => {
    setHeroIndex(0);
  }, [catalog]);

  const goHero = (next: number) => {
    if (heroes.length === 0) return;
    setHeroIndex(((next % heroes.length) + heroes.length) % heroes.length);
  };

  const lastSyncLabel = indexUpdatedAt
    ? `更新于 ${new Date(indexUpdatedAt).toLocaleString()}`
    : usingPreview
      ? '尚未同步'
      : loadingIndex
        ? '读取索引中…'
        : '暂无同步时间';

  return (
    <div className="ml-page" data-media-page data-media-stack="react" data-cover-view={coverView}>

      {heroes.length > 0 ? (
        <section className="ml-hero" aria-label="推荐轮播">
          <div className="ml-hero-track">
            {heroes.map((item, i) => {
              const pos = relativeCarouselPos(i, heroIndex, heroes.length);
              const posAttr =
                pos >= -MEDIA_HERO_VISIBLE_RADIUS && pos <= MEDIA_HERO_VISIBLE_RADIUS
                  ? String(pos)
                  : 'hide';
              const isActive = pos === 0;
              const heroCover = resolveCoverImage(item, coverView);
              const canPlayEmby =
                (item.source === 'emby' || item.source === 'jellyfin')
                && Boolean(item.itemId && item.serverUrl)
                && !usingPreview;
              const canPlay115 = item.source === '115' || usingPreview;
              return (
                <div
                  key={`${item.source}:${item.itemId || item.code}`}
                  className="ml-hero-card"
                  data-pos={posAttr}
                  data-cover-mode={coverView}
                  data-active={isActive ? '1' : '0'}
                >
                  <button
                    type="button"
                    className="ml-hero-hit"
                    title={isActive ? `查看详情 · ${item.code}` : `切换到 ${item.code}`}
                    onClick={() => {
                      if (!isActive) {
                        goHero(i);
                        return;
                      }
                      setDetailItem(item);
                    }}
                  >
                    <MediaCover
                      hoverZoom={false}
                      showPlayHint={false}
                      fit="cover"
                      imageUrl={heroCover.url}
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
                              {heroCover.fellBack && coverView === 'thumb' ? ' · 无略缩图' : ''}
                            </div>
                          ) : null}
                        </>
                      }
                    />
                  </button>
                  {isActive ? (
                    <div className="ml-hero-actions">
                      {canPlayEmby ? (
                        <button
                          type="button"
                          className="ml-hero-play"
                          title="使用已登录令牌在扩展内播放"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void playEmbyItem(item);
                          }}
                        >
                          <span aria-hidden="true">▶</span>
                          <span>播放</span>
                        </button>
                      ) : canPlay115 ? (
                        <button
                          type="button"
                          className="ml-hero-play"
                          title="115 播放"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            window.dispatchEvent(
                              new CustomEvent('media-open-115-play', { detail: { query: item.code, pickCode: item.pickCode }, }),
                            );
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
                          setDetailItem(item);
                        }}
                      >
                        详情
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <button type="button" className="ml-hero-nav prev" aria-label="上一张" onClick={() => goHero(heroIndex - 1)}>
            ‹
          </button>
          <button type="button" className="ml-hero-nav next" aria-label="下一张" onClick={() => goHero(heroIndex + 1)}>
            ›
          </button>
          <div className="ml-hero-dots">
            {heroes.map((item, i) => (
              <button
                key={`${item.source}:${item.itemId || item.code}`}
                type="button"
                className={`ml-hero-dot${i === heroIndex ? ' is-active' : ''}`}
                aria-label={`第 ${i + 1} 张`}
                onClick={() => goHero(i)}
              />
            ))}
          </div>
        </section>
      ) : null}

      <div className="ml-toolbar" role="region" aria-label="媒体库工具栏">
        <div className="ml-view-bar" role="toolbar" aria-label="媒体库视图设置">
          <div className="ml-view-count" aria-live="polite">
            共 {list.length} 项
            {!usingPreview && catalog.length !== list.length ? (
              <span className="ml-view-count-sub"> / 索引 {catalog.length}</span>
            ) : null}
          </div>

          <label className="ml-select-wrap">
            <span className="ml-select-label">来源</span>
            <select
              className="ml-select"
              value={filter}
              data-media-filter={filter}
              aria-label="来源筛选"
              onChange={(e) => setFilter(e.currentTarget.value as MediaBrowseSource)}
            >
              {FILTERS.map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
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
                setCoverView(next);
                writeCoverViewMode(next);
              }}
            >
              {MEDIA_COVER_VIEW_MODES.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </label>

          <span className="ml-view-sep" aria-hidden="true" />

          <div className="ml-view-actions">
            <div className="ml-sync-cluster">
              <span className="ml-help-wrap">
                <button
                  type="button"
                  className="ml-help-btn"
                  aria-label="同步帮助"
                  title="同步帮助"
                >
                  ?
                </button>
                <div className="ml-help-pop" role="tooltip">
                  <div className="ml-help-pop-title">媒体库同步说明</div>
                  <ul className="ml-help-pop-list">
                    <li>从已启用的 Emby/Jellyfin 拉取影片索引到本扩展本地。</li>
                    <li>请先在「设置 → Emby/Jellyfin」配置服务器、API Key，并登录用户账号。</li>
                    <li>同步写入本地索引；封面按视口懒加载并限流，减轻服务器压力。</li>
                    <li>问题排查：打开日志设置中的「媒体库」模块，查看 [MEDIA]/[EMBY] 日志。</li>
                  </ul>
                </div>
              </span>
              <button
                type="button"
                className="ml-view-btn ml-view-btn-primary ml-sync-btn"
                disabled={syncing}
                title="同步 Emby/Jellyfin 媒体库"
                onClick={() => {
                  void handleSyncLibrary();
                }}
              >
                {syncing ? '同步中…' : '同步'}
                <span className="ml-sync-meta">（{lastSyncLabel}）</span>
              </button>
            </div>
            <button
              type="button"
              className="ml-view-btn"
              disabled={loadingIndex || syncing}
              title="从本地索引刷新列表"
              onClick={() => {
                void reloadCatalogFromStorage();
              }}
            >
              刷新
            </button>
            <button
              type="button"
              className="ml-view-btn"
              title="打开 115 播放面板"
              onClick={() => {
                setPlay115Query(query.trim());
                setPlay115PickCode('');
                play115StartTimeRef.current = 0;
                setShow115Panel(true);
              }}
            >
              115
            </button>
            <button
              type="button"
              className={`ml-view-btn${showCleanupPanel ? ' is-active' : ''}`}
              title="打开/关闭 115 清理清单"
              onClick={() => setShowCleanupPanel((v) => !v)}
            >
              清理
            </button>
          </div>

          {librarySyncMessage ? <span className="ml-sync-msg ml-sync-msg-inline">{librarySyncMessage}</span> : null}

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

      {!usingPreview && resumeList.length > 0 ? (
        <section className="ml-resume" aria-label="继续观看">
          <div className="ml-section-head">
            <h3>继续观看</h3>
            <span>{resumeList.length} 部 · 扩展内续播</span>
          </div>
          <div className="ml-resume-row">
            {resumeList.map((item) => {
              const pctNum = resolveWatchProgressPercent(item.userData);
              // 在看列表里即便 percent 暂为 0，也给可见进度条（避免“有续看却无条”）
              const barPct = pctNum > 0 ? pctNum : 5;
              const pct = pctNum > 0 ? `${pctNum}%` : '';
              const resumeCover = resolveCoverImageUrl(item, 'thumb') || item.coverImageUrl;
              const canPlay = item.source === '115'
                ? Boolean(item.pickCode)
                : Boolean(item.itemId && item.serverUrl);
              return (
                <button
                  key={`resume-${item.code}`}
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
                    if (item.source === '115') {
                      setPlay115Query(item.code || item.title || '');
                      setPlay115PickCode(item.pickCode || '');
                      play115StartTimeRef.current = resumeSec > 2 ? resumeSec : 0;
                      setShow115Panel(true);
                      return;
                    }
                    void playEmbyItem(
                      {
                        code: item.code,
                        title: item.title,
                        itemId: item.itemId,
                        serverUrl: item.serverUrl,
                        serverId: item.serverId,
                        resumePositionSeconds: resumeSec > 2 ? resumeSec : 0,
                      },
                      {
                        startTimeSeconds: resumeSec > 2 ? resumeSec : undefined,
                      },
                    );
                  }}
                >
                  <div className="ml-resume-cover-wrap">
                    <LazyRemoteImage
                      className="ml-resume-cover"
                      url={resumeCover}
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
            })}
          </div>
        </section>
      ) : null}

      <OverlayShell
        open={show115Panel}
        title="115 播放"
        size="xl"
        windowControls
        onClose={() => setShow115Panel(false)}
      >
        <div data-media-115-play-overlay="1">
          <Media115PlayPanel
            initialQuery={play115Query}
            initialPickCode={play115PickCode}
            onStreamReady={handleDrive115StreamReady}
            onClose={() => setShow115Panel(false)}
          />
        </div>
      </OverlayShell>

      {showCleanupPanel ? (
        <Media115CleanupPanel
          refreshKey={cleanupRefreshKey}
          onClose={() => setShowCleanupPanel(false)}
        />
      ) : null}


      <OverlayShell
        open={Boolean(embyStream)}
        title={embyStream ? `播放 · ${embyStream.code}` : '播放'}
        size="full"
        hideHeader
        closeOnBackdrop={false}
        onClose={closeEmbyPlayer}
      >
        {embyStream ? (
          <MediaPlayer
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
          <MediaPlayer
            title={drive115Stream.code}
            subtitle={drive115Stream.title}
            src={drive115Stream.streamUrl}
            streamType={drive115Stream.streamType || 'auto'}
            startTimeSeconds={drive115Stream.startTimeSeconds}
            crossOrigin={null}
            onClose={closeDrive115Player}
            onProgress={reportDrive115PlayerProgress}
          />
        ) : null}
      </OverlayShell>

      <OverlayShell
        open={Boolean(detailItem)}
        title={detailItem ? `${detailItem.code} · 详情` : '详情'}
        size="xl"
        windowControls
        onClose={() => setDetailItem(null)}
      >
        {detailItem ? (
          <MediaItemDetailPanel
            item={detailItem}
            onPlay={(opts) => {
              const it = detailItem;
              if (!it) return;
              if (it.source === '115') {
                setDetailItem(null);
                setPlay115Query(it.code || it.title || '');
                setPlay115PickCode(it.pickCode || '');
                play115StartTimeRef.current = Math.max(
                  0,
                  Number(opts?.startTimeSeconds)
                    || (Number(it.userData?.positionTicks) || 0) / 10_000_000,
                );
                setShow115Panel(true);
                return;
              }
              const highlights = (opts as any)?.highlights as Array<{ time: number; text: string }> | undefined;
              setDetailItem(null);
              void playEmbyItem(it, {
                startTimeSeconds: opts?.startTimeSeconds,
                highlights,
              });
            }}
            onOpenItem={(next) => setDetailItem(next)}
            onWatchChanged={() => {
              void reloadCatalogFromStorage();
            }}
            onClose={() => setDetailItem(null)}
          />
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
                : '略缩图横版 · 铺满'}
          </span>
        </div>

        {list.length === 0 ? (
          <EmptyState
            className="ml-empty"
            id="mediaLibraryEmpty"
            title="这里还没有可展示的条目"
            description={
              usingPreview
                ? '可先到设置中配置 Emby / Jellyfin 并完成媒体库同步，或在 115 设置配置片库目录并索引。'
                : filter === '115'
                  ? '115 筛选下无条目。请到 115 设置配置片库根目录并点击「立即索引」。'
                  : '当前筛选下无结果，可切换来源或清空搜索。'
            }
            action={
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
            }
          />
        ) : (
          <div className="ml-grid" id="mediaLibraryGrid" data-layout-check="media-grid">
            {list.map((item) => (
              <MediaCard
                key={`${item.source}:${item.itemId || item.code}`}
                item={item}
                usingPreview={usingPreview}
                coverView={coverView}
                onWatchChanged={() => {
                  void reloadCatalogFromStorage();
                }}
                onEnqueuedCleanup={() => {
                  setShowCleanupPanel(true);
                  setCleanupRefreshKey((k) => k + 1);
                }}
                onPlayEmby={(it) => { void playEmbyItem(it); }}
                onOpenDetail={(it) => setDetailItem(it)}
              />
            ))}
          </div>
        )}
      </section>

      <div className="ml-note" role="note">
        {usingPreview
          ? '当前展示预览数据。完成 Emby/Jellyfin 媒体库同步后，将自动改用本地索引。'
          : '当前展示本地媒体库索引。点卡片打开扩展内详情，点播放在弹窗播放器中播放（令牌取流）。'}
      </div>
    </div>
  );
}

/**
 * 片库网格卡片：封面点详情外链；播放钮走扩展内 token 取流
 */
function MediaCard({
  item,
  usingPreview,
  coverView,
  onWatchChanged,
  onEnqueuedCleanup,
  onPlayEmby,
  onOpenDetail,
}: {
  item: MediaBrowseItem;
  usingPreview: boolean;
  coverView: MediaCoverViewMode;
  onWatchChanged?: () => void;
  onEnqueuedCleanup?: () => void;
  onPlayEmby?: (item: MediaBrowseItem) => void;
  onOpenDetail?: (item: MediaBrowseItem) => void;
}) {
  const [busy, setBusy] = useState(false);
  const watchState = item.watchState;
  const watchLabel = watchState && watchState !== 'none' ? watchStateLabel(watchState) : '';
  const percentLabel = formatWatchPercent(item.userData);
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
      // eslint-disable-next-line no-alert
      window.alert(`标记失败：${msg}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article
      ref={d115CoverRef}
      className="ml-card"
      data-code={item.code}
      data-layout-card="1"
      data-watch-state={watchState || 'none'}
    >
      <div className="ml-card-cover">
        {/* 点封面 → 详情外链；点播放钮 → 扩展内取流（互不抢事件） */}
        <button
          type="button"
          className="ml-card-hit"
          onClick={() => onOpenDetail?.(item)}
          title={`查看详情${watchLabel ? ` · ${watchLabel}` : ''}`}
        >
          <MediaCover
            // 列表统一 cover 铺满，避免框内黑边；框比仍由 data-cover-view 控制
            fit="cover"
            imageUrl={item.source === '115' && d115Cover ? d115Cover : coverResolved.url}
            fallbackImageUrl={coverResolved.fallbackUrl}
            artStyle={coverArtStyle(item, coverView)}
            alt={item.code}
            badges={
              <>
                <Badge tone={item.source === 'emby' ? 'primary' : item.source === 'jellyfin' ? 'info' : 'neutral'}>
                  {sourceLabel(item.source)}
                </Badge>
                <Badge tone={watchBadge.tone}>{watchBadge.text}</Badge>
                {coverView === 'thumb' && coverResolved.fellBack ? (
                  <Badge tone="neutral">无略缩图</Badge>
                ) : null}
              </>
            }
            footer={
              <>
                <span className="ml-code">{item.code}</span>
                <div className="ml-card-title">{item.title}</div>
              </>
            }
            showPlayHint={false}
          />
        </button>
        {/* 播放：Emby/JF 用设置页 token 取流；115 走 115 面板 */}
        {(item.source === 'emby' || item.source === 'jellyfin') && item.itemId && item.serverUrl && !usingPreview ? (
          <button
            type="button"
            className="ml-card-play"
            title="使用已登录令牌在扩展内播放"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onPlayEmby?.(item);
            }}
          >
            <span aria-hidden="true">▶</span>
            <span className="ml-card-play-text">播放</span>
          </button>
        ) : item.source === '115' || usingPreview ? (
          <button
            type="button"
            className="ml-card-play"
            title="115 播放"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              window.dispatchEvent(
                new CustomEvent('media-open-115-play', { detail: { query: item.code, pickCode: item.pickCode } }),
              );
            }}
          >
            <span aria-hidden="true">▶</span>
            <span className="ml-card-play-text">播放</span>
          </button>
        ) : null}
      </div>
            <div className="ml-meta">
        <span>{item.serverName || sourceLabel(item.source)}</span>
        <span className="ml-link-group">
          {(item.source === 'emby' || item.source === 'jellyfin') && item.itemId && !usingPreview ? (
            <button
              type="button"
              className="ml-open-link"
              onClick={() => onPlayEmby?.(item)}
            >
              播放
            </button>
          ) : null}
          <button
            type="button"
            className="ml-open-link ml-open-link-secondary"
            onClick={() => onOpenDetail?.(item)}
          >
            详情
          </button>
        </span>
      </div>
      {canTogglePlayed ? (
        <div className="ml-card-actions">
          <button
            type="button"
            className="ml-watch-btn"
            disabled={busy}
            onClick={() => void setPlayed(!isWatched)}
            title={isWatched ? '在 Emby/JF 标记为未看' : '在 Emby/JF 标记为真实已看'}
          >
            {busy ? '…' : isWatched ? '标为未看' : '标为真实已看'}
          </button>
          {isWatched ? (
            <button
              type="button"
              className="ml-watch-btn"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  try {
                    const ret = await enqueueWatchedForCleanup({
                      code: item.code,
                      title: item.title,
                      embyItemId: item.itemId,
                      embyServerUrl: item.serverUrl,
                    });
                    onEnqueuedCleanup?.();
                    // eslint-disable-next-line no-alert
                    window.alert(
                      ret.bound
                        ? `已加入 115 清理清单（已绑定文件）`
                        : `已加入清理清单${ret.message ? `：${ret.message}` : ''}`,
                    );
                  } catch (e) {
                    // eslint-disable-next-line no-alert
                    window.alert(e instanceof Error ? e.message : String(e));
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
              title="真实已看 → 加入 115 待清理清单"
            >
              加入清理
            </button>
          ) : null}
          <button
            type="button"
            className="ml-watch-btn"
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent('media-open-115-play', { detail: { query: item.code, pickCode: item.pickCode } }),
              );
            }}
            title="在 115 搜索并播放"
          >
            115
          </button>
        </div>
      ) : item.source === '115' || usingPreview ? (
        <div className="ml-card-actions">
          <button
            type="button"
            className="ml-watch-btn"
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent('media-open-115-play', { detail: { query: item.code, pickCode: item.pickCode } }),
              );
            }}
            title="在 115 搜索并播放"
          >
            115 播放
          </button>
        </div>
      ) : null}
    </article>
  );
}


