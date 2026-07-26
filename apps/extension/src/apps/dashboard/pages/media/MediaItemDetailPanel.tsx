/**
 * @file MediaItemDetailPanel.tsx
 * @description 扩展内媒体详情（Emby 风格完整布局：章节 / 合集 / 相似 / 媒体流）
 * @module apps/dashboard/pages/media
 */
import { useEffect, useState } from 'react';
import type {
  EmbyItemChapterView,
  EmbyItemDetailView,
  EmbyRelatedItemView,
} from '../../../../features/embyLibrary/types';
import {
  formatBytes,
  formatChapterTime,
  formatRuntime,
} from '../../../../features/embyLibrary/domain/embyItemDetail';
import { LazyRemoteImage } from '../../../../ui/patterns/LazyRemoteImage/LazyRemoteImage';
import { sendRuntimeMessage } from '../../../../platform/browser/runtimeMessages';
import { resolveDrive115CoverUrl } from './drive115CoverCache';
import type { MediaBrowseItem } from './mediaBrowseModel';
import { resolveCoverImage, sourceLabel } from './mediaBrowseModel';
import { formatWatchPercent, watchStateLabel } from './mediaLibraryIndexAdapter';
import { HorizontalScroller } from './HorizontalScroller';
import './mediaItemDetail.css';

export type MediaItemDetailPanelProps = {
  item: MediaBrowseItem;
  onPlay?: (opts?: {
    startTimeSeconds?: number;
    highlights?: Array<{ time: number; text: string }>;
  }) => void;
  onClose?: () => void;
  /** 点击相似 / 合集卡片时打开另一条目详情 */
  onOpenItem?: (next: MediaBrowseItem) => void;
  /** 标记已看写回成功后回调 */
  onWatchChanged?: () => void;
};

/**
 * 本地详情弹窗内容：先用列表缓存，再拉 Emby 完整 Item 字段
 */
export function MediaItemDetailPanel({
  item,
  onPlay,
  onClose,
  onOpenItem,
  onWatchChanged,
}: MediaItemDetailPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<EmbyItemDetailView | null>(null);
  const [playedBusy, setPlayedBusy] = useState(false);
  const [playedLocal, setPlayedLocal] = useState<boolean | null>(null);
  const [nfo115, setNfo115] = useState<MediaBrowseItem['nfoSummary'] | null>(
    item.nfoSummary ?? null,
  );
  const [nfo115Loading, setNfo115Loading] = useState(false);
  const [d115Cover, setD115Cover] = useState('');

  const fallbackCover = resolveCoverImage(item, 'poster');
  const effectivePlayed =
    playedLocal != null
      ? playedLocal
      : Boolean(detail?.userData?.played || item.userData?.played || item.watchState === 'watched');
  const watchLabel = effectivePlayed
    ? '已看'
    : item.watchState && item.watchState !== 'none'
      ? watchStateLabel(item.watchState)
      : '未标记';
  const pct = formatWatchPercent(item.userData || detail?.userData);

  useEffect(() => {
    let cancelled = false;
    setError('');
    setDetail(null);
    setPlayedLocal(null);
    if (!item.itemId || !item.serverUrl) return undefined;
    if (item.source !== 'emby' && item.source !== 'jellyfin') return undefined;

    setLoading(true);
    chrome.runtime.sendMessage(
      {
        type: 'EMBY_LIBRARY_GET_ITEM_DETAIL',
        itemId: item.itemId,
        serverUrl: item.serverUrl,
        serverId: item.serverId,
      },
      (resp) => {
        if (cancelled) return;
        setLoading(false);
        const err = chrome.runtime.lastError;
        if (err) {
          setError(err.message || '拉取详情失败');
          return;
        }
        if (!resp?.success || !resp.detail) {
          setError(resp?.error || '拉取详情失败');
          return;
        }
        const d = resp.detail as EmbyItemDetailView;
        setDetail(d);
        if (d.userData) setPlayedLocal(Boolean(d.userData.played));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [item.itemId, item.serverUrl, item.serverId, item.source]);

  // 115 条目：懒下载解析 NFO 正文，填充标题/年份/简介（Emby 详情走服务器，115 需自行解析）
  useEffect(() => {
    let cancelled = false;
    setNfo115(item.nfoSummary ?? null);
    setNfo115Loading(false);
    if (item.source !== '115') return undefined;
    if (item.nfoSummary || !item.libraryKey) return undefined;
    setNfo115Loading(true);
    void sendRuntimeMessage({
      type: 'DRIVE115_MEDIA_LIBRARY_RESOLVE_NFO',
      key: item.libraryKey,
    })
      .then((resp: unknown) => {
        if (cancelled) return;
        const r = resp as { success?: boolean; summary?: typeof nfo115 } | undefined;
        if (r?.success && r.summary) setNfo115(r.summary);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setNfo115Loading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item.source, item.libraryKey, item.nfoSummary]);

  // 115 详情封面：现取直链（缓存复用），失败回退色块
  useEffect(() => {
    let cancelled = false;
    setD115Cover('');
    if (item.source !== '115' || !item.coverPickCode) return undefined;
    void resolveDrive115CoverUrl(item.coverPickCode).then((url) => {
      if (!cancelled && url) setD115Cover(url);
    });
    return () => {
      cancelled = true;
    };
  }, [item.source, item.coverPickCode]);

  const title = detail?.name || nfo115?.title || item.title;
  const primary = detail?.primaryImageUrl || d115Cover || fallbackCover.url;
  const backdrop = detail?.backdropImageUrl;
  const people = detail?.people || [];
  const chapters = detail?.chapters || [];
  const similar = detail?.similar || [];
  const collections = detail?.collections || [];
  const mediaStreams = detail?.mediaStreams || [];

  const togglePlayed = async () => {
    if (!item.itemId || !item.serverUrl || playedBusy) return;
    const next = !effectivePlayed;
    setPlayedBusy(true);
    try {
      const resp = await new Promise<{ success?: boolean; error?: string }>((resolve, reject) => {
        try {
          chrome.runtime.sendMessage(
            {
              type: 'EMBY_LIBRARY_SET_PLAYED',
              itemId: item.itemId,
              serverUrl: item.serverUrl,
              serverId: item.serverId,
              played: next,
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
      if (!resp.success) {
        throw new Error(resp.error || '写回失败');
      }
      setPlayedLocal(next);
      onWatchChanged?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // eslint-disable-next-line no-alert
      window.alert(`标记失败：${msg}`);
    } finally {
      setPlayedBusy(false);
    }
  };

  const openRelated = (rel: EmbyRelatedItemView) => {
    if (!onOpenItem || !item.serverUrl) return;
    const next: MediaBrowseItem = {
      code: rel.name,
      title: rel.name,
      source: item.source,
      year: rel.year ? String(rel.year) : '',
      hue: item.hue || 210,
      itemId: rel.itemId,
      serverUrl: item.serverUrl,
      serverId: item.serverId || detail?.serverId,
      serverName: item.serverName,
      coverImageUrl: rel.primaryImageUrl,
      imageUrls: rel.primaryImageUrl ? { Primary: rel.primaryImageUrl } : undefined,
    };
    onOpenItem(next);
  };

  const playChapter = (ch: EmbyItemChapterView) => {
    onPlay?.({
      startTimeSeconds: ch.startTimeSeconds || 0,
      highlights: chapters.map((c) => ({
        time: c.startTimeSeconds || 0,
        text: c.name || `章节 ${c.index + 1}`,
      })),
    });
  };

  const playMain = () => {
    onPlay?.({
      highlights: chapters.map((c) => ({
        time: c.startTimeSeconds || 0,
        text: c.name || `章节 ${c.index + 1}`,
      })),
    });
  };

  return (
    <div className="ml-detail" data-media-detail="1">
      <div
        className="ml-detail-backdrop"
        style={
          backdrop
            ? {
                // 渐变遮罩交给 CSS ::after，这里只铺全幅背景图
                backgroundImage: `url("${backdrop.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`,
              }
            : undefined
        }
      />

      {/* 顶部：封面 + 主信息横排，不占满整列高度 */}
      <div className="ml-detail-hero">
        <LazyRemoteImage
          className="ml-detail-cover"
          url={primary}
          asBackground
          lazy={false}
          alt={item.code}
        />

        <div className="ml-detail-hero-info">
          <div className="ml-detail-code">{item.code}</div>
          <h3 className="ml-detail-title">{title}</h3>

          <div className="ml-detail-pills">
            {detail?.communityRating != null ? (
              <span className="ml-detail-pill">★ {detail.communityRating.toFixed(1)}</span>
            ) : null}
            {detail?.criticRating != null ? (
              <span className="ml-detail-pill">Critics {detail.criticRating}</span>
            ) : null}
            {detail?.year || nfo115?.year || item.year ? (
              <span className="ml-detail-pill">{detail?.year || nfo115?.year || item.year}</span>
            ) : null}
            {formatRuntime(detail?.runtimeTicks) ? (
              <span className="ml-detail-pill">{formatRuntime(detail?.runtimeTicks)}</span>
            ) : null}
            {detail?.officialRating ? (
              <span className="ml-detail-pill">{detail.officialRating}</span>
            ) : null}
            <span className="ml-detail-pill">
              {sourceLabel(item.source)}
              {item.serverName ? ` · ${item.serverName}` : ''}
            </span>
            {item.source === '115' ? (
              <span className="ml-detail-pill" title="115 轻量索引不提供章节与相似推荐">
                片库浅层索引 · 无章节/相似
              </span>
            ) : null}
            {item.source === '115' && item.folderPath ? (
              <span className="ml-detail-pill" title={item.fileName || item.folderPath}>
                目录 {item.folderPath}
              </span>
            ) : null}
            {item.source === '115' && nfo115?.num ? (
              <span className="ml-detail-pill">番号 {nfo115.num}</span>
            ) : null}
            {item.source === '115' && nfo115?.rating ? (
              <span className="ml-detail-pill">★ {nfo115.rating}</span>
            ) : null}
            {item.source === '115' && nfo115?.runtime ? (
              <span className="ml-detail-pill">{nfo115.runtime} 分钟</span>
            ) : null}
            {item.source === '115' && nfo115?.releaseDate ? (
              <span className="ml-detail-pill">{nfo115.releaseDate}</span>
            ) : null}
            {item.source === '115' && nfo115?.studio ? (
              <span className="ml-detail-pill">{nfo115.studio}</span>
            ) : null}
            <span className="ml-detail-pill">
              {watchLabel}
              {pct ? ` · ${pct}` : ''}
            </span>
          </div>

          <div className="ml-detail-actions">
            {onPlay ? (
              <button type="button" className="ml-detail-btn ml-detail-btn-primary" onClick={() => playMain()}>
                ▶ 播放
              </button>
            ) : null}
            {item.itemId && item.serverUrl ? (
              <button
                type="button"
                className={`ml-detail-btn${effectivePlayed ? ' ml-detail-btn-active' : ''}`}
                disabled={playedBusy}
                onClick={() => {
                  void togglePlayed();
                }}
              >
                {playedBusy ? '写入中…' : effectivePlayed ? '✓ 已看' : '标记已看'}
              </button>
            ) : null}
            {onClose ? (
              <button type="button" className="ml-detail-btn" onClick={onClose}>
                关闭
              </button>
            ) : null}
          </div>

          {loading ? <p className="ml-detail-status">正在从媒体服务器拉取详情…</p> : null}
          {error ? <p className="ml-detail-error">{error}（仍可播放）</p> : null}

          {detail?.tagline ? <p className="ml-detail-tagline">{detail.tagline}</p> : null}
        </div>
      </div>

      {/* 下方区块使用完整弹窗宽度 */}
      <div className="ml-detail-content">
        {detail?.overview || nfo115?.plot ? (
          <p className="ml-detail-overview">{detail?.overview || nfo115?.plot}</p>
        ) : item.source === '115' && nfo115Loading ? (
          <p className="ml-detail-overview">正在解析 NFO…</p>
        ) : null}

        {item.source === '115' && nfo115?.actors?.length ? (
          <p className="ml-detail-line">
            <span className="ml-detail-k">演员</span>
            {nfo115.actors.join('、')}
          </p>
        ) : null}
        {item.source === '115' && nfo115?.genres?.length ? (
          <p className="ml-detail-line">
            <span className="ml-detail-k">类别</span>
            {nfo115.genres.join('、')}
          </p>
        ) : null}
        {item.source === '115' && nfo115?.director ? (
          <p className="ml-detail-line">
            <span className="ml-detail-k">导演</span>
            {nfo115.director}
          </p>
        ) : null}
        {item.source === '115' && nfo115?.series ? (
          <p className="ml-detail-line">
            <span className="ml-detail-k">系列</span>
            {nfo115.series}
          </p>
        ) : null}

        {people.filter((p) => /director/i.test(p.type || '')).length > 0 ? (
          <p className="ml-detail-line">
            <span className="ml-detail-k">导演</span>
            {people
              .filter((p) => /director/i.test(p.type || ''))
              .map((d) => d.name)
              .join('、')}
          </p>
        ) : null}

        {detail?.genres?.length ? (
          <p className="ml-detail-line">
            <span className="ml-detail-k">类型</span>
            {detail.genres.join('、')}
          </p>
        ) : null}

        {detail?.studios?.length ? (
          <p className="ml-detail-line">
            <span className="ml-detail-k">片商</span>
            {detail.studios.join('、')}
          </p>
        ) : null}

        {detail?.tags?.length ? (
          <p className="ml-detail-line">
            <span className="ml-detail-k">标签</span>
            {detail.tags.slice(0, 16).join('、')}
            {detail.tags.length > 16 ? '…' : ''}
          </p>
        ) : null}

        {(mediaStreams.length > 0
          || detail?.videoSummary
          || detail?.audioSummary
          || detail?.container
          || detail?.sizeBytes) ? (
          <div className="ml-detail-media">
            <h4>媒体信息</h4>
            {mediaStreams.length > 0
              ? mediaStreams.map((s, i) => (
                  <div key={`${s.type}-${i}`}>
                    {s.type} · {s.title}
                  </div>
                ))
              : (
                <>
                  {detail?.videoSummary ? <div>视频 · {detail.videoSummary}</div> : null}
                  {detail?.audioSummary ? <div>音频 · {detail.audioSummary}</div> : null}
                </>
                )}
            {detail?.container ? <div>容器 · {detail.container.toUpperCase()}</div> : null}
            {formatBytes(detail?.sizeBytes) ? <div>大小 · {formatBytes(detail?.sizeBytes)}</div> : null}
            {detail?.path ? <div className="ml-detail-mono">路径 · {detail.path}</div> : null}
          </div>
        ) : null}

        {people.length > 0 ? (
          <div className="ml-detail-people">
            <h4>演职人员</h4>
            <HorizontalScroller className="ml-detail-hscroll ml-detail-people-row" aria-label="演职人员">
              {people.map((p) => (
                <div key={`${p.id || p.name}-${p.type || ''}-${p.role || ''}`} className="ml-detail-person">
                  <LazyRemoteImage
                    className="ml-detail-person-avatar"
                    url={p.imageUrl}
                    asBackground
                    lazy
                    alt={p.name}
                  />
                  <div className="ml-detail-person-name" title={p.name}>{p.name}</div>
                  <div
                    className="ml-detail-person-role"
                    title={[p.type, p.role].filter(Boolean).join(' · ') || undefined}
                  >
                    {[p.type, p.role].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
              ))}
            </HorizontalScroller>
          </div>
        ) : null}

        {chapters.length > 0 ? (
          <div className="ml-detail-section">
            <h4>章节</h4>
            <HorizontalScroller className="ml-detail-hscroll" aria-label="章节">
              {chapters.map((ch) => (
                <button
                  key={`ch-${ch.index}-${ch.startPositionTicks}`}
                  type="button"
                  className="ml-detail-chapter"
                  title={`从 ${formatChapterTime(ch.startPositionTicks)} 播放`}
                  onClick={() => playChapter(ch)}
                >
                  <LazyRemoteImage
                    className="ml-detail-chapter-img"
                    url={ch.imageUrl}
                    asBackground
                    lazy
                    alt={ch.name}
                  />
                  <div className="ml-detail-chapter-meta">
                    <div className="ml-detail-chapter-name" title={ch.name}>{ch.name}</div>
                    <div className="ml-detail-chapter-time">
                      {formatChapterTime(ch.startPositionTicks)}
                    </div>
                  </div>
                </button>
              ))}
            </HorizontalScroller>
          </div>
        ) : null}

        {collections.length > 0 ? (
          <div className="ml-detail-section">
            <h4>出现在合集</h4>
            <HorizontalScroller className="ml-detail-hscroll" aria-label="合集">
              {collections.map((c) => (
                <button
                  key={`col-${c.itemId}`}
                  type="button"
                  className="ml-detail-related"
                  onClick={() => openRelated(c)}
                  title={c.overview || c.name}
                >
                  <LazyRemoteImage
                    className="ml-detail-related-img"
                    url={c.primaryImageUrl}
                    asBackground
                    lazy
                    alt={c.name}
                  />
                  <div className="ml-detail-related-name" title={c.name}>{c.name}</div>
                  {c.year ? <div className="ml-detail-related-year">{c.year}</div> : null}
                </button>
              ))}
            </HorizontalScroller>
          </div>
        ) : null}

        {similar.length > 0 ? (
          <div className="ml-detail-section">
            <h4>相似内容</h4>
            <HorizontalScroller className="ml-detail-hscroll" aria-label="相似内容">
              {similar.map((s) => (
                <button
                  key={`sim-${s.itemId}`}
                  type="button"
                  className="ml-detail-related"
                  onClick={() => openRelated(s)}
                  title={s.overview || s.name}
                >
                  <LazyRemoteImage
                    className="ml-detail-related-img"
                    url={s.primaryImageUrl}
                    asBackground
                    lazy
                    alt={s.name}
                  />
                  <div className="ml-detail-related-name" title={s.name}>{s.name}</div>
                  {s.year ? <div className="ml-detail-related-year">{s.year}</div> : null}
                </button>
              ))}
            </HorizontalScroller>
          </div>
        ) : null}
      </div>
    </div>
  );
}

