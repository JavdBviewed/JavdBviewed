/**
 * @file MediaItemDetailPanel.tsx
 * @description 扩展内媒体详情（Emby 风格完整布局：章节 / 合集 / 相似 / 媒体流）
 * @module apps/dashboard/pages/media
 */
import { useEffect, useRef, useState } from 'react';
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
import { NFO_SUMMARY_SCHEMA_VERSION } from '../../../../features/drive115/mediaLibrary/parseEntryMeta';
import { resolveDrive115CoverUrl } from './drive115CoverCache';
import type { MediaBrowseItem, MediaSourceCopy } from './mediaBrowseModel';
import {
  formatMediaSourceCopyLabel,
  getMediaSourceCopies,
  getMediaSourceCopyPlaybackStatus,
  getPreferredDetailSourceCopy,
  resolveCoverImage,
  sourceLabel,
} from './mediaBrowseModel';
import { formatWatchPercent, watchStateLabel } from './mediaLibraryIndexAdapter';
import { HorizontalScroller } from './HorizontalScroller';
import './mediaItemDetail.css';

export type MediaItemDetailPanelProps = {
  item: MediaBrowseItem;
  onPlay?: (opts?: {
    startTimeSeconds?: number;
    highlights?: Array<{ time: number; text: string }>;
  }) => void;
  onPlayCopy?: (copy: MediaSourceCopy, opts?: {
    startTimeSeconds?: number;
    highlights?: Array<{ time: number; text: string }>;
  }) => void;
  onClose?: () => void;
  /** 点击相似 / 合集卡片时打开另一条目详情 */
  onOpenItem?: (next: MediaBrowseItem) => void;
  /** 标记已看写回成功后回调 */
  onWatchChanged?: () => void;
};

type DetailInfoRow = readonly [string, string, 'normal' | 'wide'];
type DetailPlaybackOptions = {
  startTimeSeconds?: number;
  highlights?: Array<{ time: number; text: string }>;
};

function appendDetailInfoRow(
  rows: DetailInfoRow[],
  label: string,
  value: string | undefined | null,
  variant: 'normal' | 'wide' = 'normal',
): void {
  const text = String(value || '').trim();
  if (!text) return;
  rows.push([label, text, variant]);
}

function joinLimited(values: string[] | undefined, limit = 16): string {
  if (!values?.length) return '';
  const visible = values.map((item) => String(item || '').trim()).filter(Boolean);
  if (!visible.length) return '';
  return `${visible.slice(0, limit).join('\u3001')}${visible.length > limit ? '\u2026' : ''}`;
}

function formatMinutesText(value?: string): string {
  const text = String(value || '').trim();
  if (!text) return '';
  return /\u5206\u949f|\u5206|minute|min/i.test(text) ? text : `${text} \u5206\u949f`;
}

/**
 * 本地详情弹窗内容：先用列表缓存，再拉 Emby 完整 Item 字段
 */
export function MediaItemDetailPanel({
  item,
  onPlay,
  onPlayCopy,
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
  const [nfo115Error, setNfo115Error] = useState('');
  const [d115Cover, setD115Cover] = useState('');
  const [showPlaybackMenu, setShowPlaybackMenu] = useState(false);
  const [pendingPlaybackOptions, setPendingPlaybackOptions] = useState<DetailPlaybackOptions | undefined>();
  const playbackMenuRef = useRef<HTMLDivElement | null>(null);

  const preferredDetailCopy = getPreferredDetailSourceCopy(item);
  const detailSource = preferredDetailCopy?.source ?? item.source;
  const detailItemId = preferredDetailCopy?.itemId ?? item.itemId;
  const detailServerUrl = preferredDetailCopy?.serverUrl ?? item.serverUrl;
  const detailServerId = preferredDetailCopy?.serverId ?? item.serverId;
  const detailServerName = preferredDetailCopy?.serverName ?? item.serverName;
  const is115Detail = detailSource === '115';

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
  const sourceCopies = getMediaSourceCopies(item);
  const playableSourceCopies = sourceCopies.filter((copy) => getMediaSourceCopyPlaybackStatus(copy).playable);

  useEffect(() => {
    setShowPlaybackMenu(false);
    setPendingPlaybackOptions(undefined);
  }, [item]);

  useEffect(() => {
    if (!showPlaybackMenu) return undefined;
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (!playbackMenuRef.current?.contains(event.target as Node)) {
        setShowPlaybackMenu(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowPlaybackMenu(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointerDown);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointerDown);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [showPlaybackMenu]);

  useEffect(() => {
    let cancelled = false;
    setError('');
    setDetail(null);
    setPlayedLocal(null);
    if (!detailItemId || !detailServerUrl) return undefined;
    if (detailSource !== 'emby' && detailSource !== 'jellyfin') return undefined;

    setLoading(true);
    chrome.runtime.sendMessage(
      {
        type: 'EMBY_LIBRARY_GET_ITEM_DETAIL',
        itemId: detailItemId,
        serverUrl: detailServerUrl,
        serverId: detailServerId,
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
  }, [detailItemId, detailServerUrl, detailServerId, detailSource]);

  // 115 条目：懒下载解析 NFO 正文，填充标题/年份/简介（Emby 详情走服务器，115 需自行解析）
  useEffect(() => {
    let cancelled = false;
    setNfo115(item.nfoSummary ?? null);
    setNfo115Loading(false);
    setNfo115Error('');
    if (!is115Detail) return undefined;
    if ((item.nfoSummary?.schemaVersion || 0) >= NFO_SUMMARY_SCHEMA_VERSION) return undefined;
    if (!item.libraryKey) {
      setNfo115Error('缺少索引 key，无法解析 NFO');
      return undefined;
    }
    setNfo115Loading(true);
    void sendRuntimeMessage({
      type: 'DRIVE115_MEDIA_LIBRARY_RESOLVE_NFO',
      key: item.libraryKey,
    })
      .then((resp: unknown) => {
        if (cancelled) return;
        const r = resp as {
          success?: boolean;
          summary?: typeof nfo115;
          message?: string;
          error?: string;
        } | undefined;
        if (r?.success && r.summary) {
          setNfo115(r.summary);
          setNfo115Error('');
          return;
        }
        setNfo115Error(r?.message || r?.error || '该条目没有可解析的 NFO');
      })
      .catch((e: unknown) => {
        if (!cancelled) setNfo115Error(e instanceof Error ? e.message : String(e || 'NFO 解析失败'));
      })
      .finally(() => {
        if (!cancelled) setNfo115Loading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [is115Detail, item.libraryKey, item.nfoSummary]);

  // 115 详情封面：现取直链（缓存复用），失败回退色块
  useEffect(() => {
    let cancelled = false;
    setD115Cover('');
    if (!is115Detail || !item.coverPickCode) return undefined;
    void resolveDrive115CoverUrl(item.coverPickCode).then((url) => {
      if (!cancelled && url) setD115Cover(url);
    });
    return () => {
      cancelled = true;
    };
  }, [is115Detail, item.coverPickCode]);

  const title = detail?.name || (is115Detail ? nfo115?.title : '') || item.title;
  const nfoOriginalTitle =
    is115Detail && nfo115?.originalTitle && nfo115.originalTitle !== title
      ? nfo115.originalTitle
      : '';
  const primary = detail?.primaryImageUrl || d115Cover || fallbackCover.url;
  const backdrop = detail?.backdropImageUrl || (is115Detail ? primary : undefined);
  const people = detail?.people || [];
  const chapters = detail?.chapters || [];
  const similar = detail?.similar || [];
  const collections = detail?.collections || [];
  const mediaStreams = detail?.mediaStreams || [];
  const embyDirectors = people
    .filter((p) => /director/i.test(p.type || ''))
    .map((d) => d.name)
    .filter(Boolean)
    .join('、');
  const detailTags = joinLimited(detail?.tags);
  const infoRows: DetailInfoRow[] = [];
  if (is115Detail) {
    appendDetailInfoRow(infoRows, '\u539f\u540d', nfoOriginalTitle, 'wide');
    appendDetailInfoRow(infoRows, '\u756a\u53f7', nfo115?.num);
    appendDetailInfoRow(infoRows, '\u6f14\u5458', joinLimited(nfo115?.actors), 'wide');
    appendDetailInfoRow(infoRows, '\u7c7b\u522b', joinLimited(nfo115?.genres), 'wide');
    appendDetailInfoRow(infoRows, '\u5bfc\u6f14', nfo115?.director);
    appendDetailInfoRow(infoRows, '\u7cfb\u5217', nfo115?.series);
    appendDetailInfoRow(infoRows, '\u7247\u5546', nfo115?.studio);
    appendDetailInfoRow(infoRows, '\u53d1\u884c', nfo115?.publisher);
    appendDetailInfoRow(infoRows, '\u53d1\u884c\u65e5\u671f', nfo115?.releaseDate);
    appendDetailInfoRow(infoRows, '\u5e74\u4efd', nfo115?.year);
    appendDetailInfoRow(infoRows, '\u65f6\u957f', formatMinutesText(nfo115?.runtime));
    appendDetailInfoRow(infoRows, '\u8bc4\u5206', nfo115?.rating ? `\u2605 ${nfo115.rating}` : '');
    appendDetailInfoRow(infoRows, '\u5206\u7ea7', nfo115?.contentRating);
    appendDetailInfoRow(infoRows, '\u5730\u533a', nfo115?.countryCode);
    appendDetailInfoRow(infoRows, '\u7ad9\u70b9', nfo115?.website, 'wide');
  } else {
    appendDetailInfoRow(infoRows, '\u5bfc\u6f14', embyDirectors);
    appendDetailInfoRow(infoRows, '\u7c7b\u578b', joinLimited(detail?.genres), 'wide');
    appendDetailInfoRow(infoRows, '\u7247\u5546', joinLimited(detail?.studios));
    appendDetailInfoRow(infoRows, '\u6807\u7b7e', detailTags, 'wide');
  }

  const togglePlayed = async () => {
    if (!detailItemId || !detailServerUrl || playedBusy) return;
    const next = !effectivePlayed;
    setPlayedBusy(true);
    try {
      const resp = await new Promise<{ success?: boolean; error?: string }>((resolve, reject) => {
        try {
          chrome.runtime.sendMessage(
            {
              type: 'EMBY_LIBRARY_SET_PLAYED',
              itemId: detailItemId,
              serverUrl: detailServerUrl,
              serverId: detailServerId,
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
    if (!onOpenItem || !detailServerUrl) return;
    const next: MediaBrowseItem = {
      code: rel.name,
      title: rel.name,
      source: detailSource,
      year: rel.year ? String(rel.year) : '',
      hue: item.hue || 210,
      itemId: rel.itemId,
      serverUrl: detailServerUrl,
      serverId: detailServerId || detail?.serverId,
      serverName: detailServerName,
      coverImageUrl: rel.primaryImageUrl,
      imageUrls: rel.primaryImageUrl ? { Primary: rel.primaryImageUrl } : undefined,
    };
    onOpenItem(next);
  };

  const playChapter = (ch: EmbyItemChapterView) => {
    requestDetailPlayback({
      startTimeSeconds: ch.startTimeSeconds || 0,
      highlights: chapters.map((c) => ({
        time: c.startTimeSeconds || 0,
        text: c.name || `章节 ${c.index + 1}`,
      })),
    });
  };

  const requestDetailPlayback = (opts?: DetailPlaybackOptions) => {
    const playbackOptions = opts || {
      highlights: chapters.map((chapter) => ({
        time: chapter.startTimeSeconds || 0,
        text: chapter.name || `章节 ${chapter.index + 1}`,
      })),
    };
    if (playableSourceCopies.length > 1) {
      setPendingPlaybackOptions(playbackOptions);
      setShowPlaybackMenu((open) => !open);
      return;
    }
    if (playableSourceCopies.length === 1 && onPlayCopy) {
      onPlayCopy(playableSourceCopies[0], playbackOptions);
      return;
    }
    onPlay?.(playbackOptions);
  };

  const playMain = () => {
    requestDetailPlayback({
      highlights: chapters.map((c) => ({
      time: c.startTimeSeconds || 0,
      text: c.name || `章节 ${c.index + 1}`,
      })),
    });
  };

  const playSourceCopy = (copy: MediaSourceCopy) => {
    if (!getMediaSourceCopyPlaybackStatus(copy).playable) return;
    setShowPlaybackMenu(false);
    onPlayCopy?.(copy, pendingPlaybackOptions);
    setPendingPlaybackOptions(undefined);
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
            {detail?.year || (is115Detail ? nfo115?.year : '') || item.year ? (
              <span className="ml-detail-pill">{detail?.year || (is115Detail ? nfo115?.year : '') || item.year}</span>
            ) : null}
            {formatRuntime(detail?.runtimeTicks) ? (
              <span className="ml-detail-pill">{formatRuntime(detail?.runtimeTicks)}</span>
            ) : null}
            {detail?.officialRating ? (
              <span className="ml-detail-pill">{detail.officialRating}</span>
            ) : null}
            <span className="ml-detail-pill">
              {sourceLabel(detailSource)}
              {detailServerName ? ` · ${detailServerName}` : ''}
            </span>
            {is115Detail ? (
              <span className="ml-detail-pill" title="115 轻量索引不提供章节与相似推荐">
                片库浅层索引 · 无章节/相似
              </span>
            ) : null}
            {is115Detail && item.folderPath ? (
              <span className="ml-detail-pill" title={item.fileName || item.folderPath}>
                目录 {item.folderPath}
              </span>
            ) : null}
            {is115Detail && nfo115?.num ? (
              <span className="ml-detail-pill">番号 {nfo115.num}</span>
            ) : null}
            {is115Detail && nfo115?.rating ? (
              <span className="ml-detail-pill">★ {nfo115.rating}</span>
            ) : null}
            {is115Detail && nfo115?.runtime ? (
              <span className="ml-detail-pill">{nfo115.runtime} 分钟</span>
            ) : null}
            {is115Detail && nfo115?.releaseDate ? (
              <span className="ml-detail-pill">{nfo115.releaseDate}</span>
            ) : null}
            {is115Detail && nfo115?.studio ? (
              <span className="ml-detail-pill">{nfo115.studio}</span>
            ) : null}
            {is115Detail && nfo115?.publisher && nfo115.publisher !== nfo115.studio ? (
              <span className="ml-detail-pill">发行 {nfo115.publisher}</span>
            ) : null}
            <span className="ml-detail-pill">
              {watchLabel}
              {pct ? ` · ${pct}` : ''}
            </span>
          </div>

          <div className="ml-detail-actions">
            {onPlay || onPlayCopy ? (
              <div className="ml-detail-play-menu" ref={playbackMenuRef}>
                <button
                  type="button"
                  className="ml-detail-btn ml-detail-btn-primary"
                  aria-expanded={showPlaybackMenu}
                  aria-haspopup={playableSourceCopies.length > 1 ? 'menu' : undefined}
                  onClick={playMain}
                >
                  ▶ {playableSourceCopies.length > 1 ? '选择播放来源' : '播放'}
                </button>
                {showPlaybackMenu ? (
                  <div className="ml-detail-play-menu-popover" role="menu" aria-label="选择播放来源">
                    {sourceCopies.map((copy) => {
                      const status = getMediaSourceCopyPlaybackStatus(copy);
                      const label = formatMediaSourceCopyLabel(copy);
                      const progress = formatWatchPercent(copy.userData);
                      return (
                        <button
                          key={copy.copyId}
                          type="button"
                          role="menuitem"
                          className="ml-detail-play-menu-item"
                          disabled={!status.playable || !onPlayCopy}
                          title={status.playable ? `使用 ${label} 播放` : status.reason}
                          onClick={() => playSourceCopy(copy)}
                        >
                          <strong>{label}</strong>
                          <small>
                            {status.playable ? '可播放' : status.reason || '暂不可播放'}
                            {progress ? ` · 已播放 ${progress}` : ''}
                            {copy.fileName ? ` · ${copy.fileName}` : ''}
                          </small>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
            {detailItemId && detailServerUrl ? (
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

          {detail?.tagline || (is115Detail ? nfo115?.tagline : '') ? (
            <p className="ml-detail-tagline">{detail?.tagline || (is115Detail ? nfo115?.tagline : '')}</p>
          ) : null}
        </div>
      </div>

      {/* 下方区块使用完整弹窗宽度 */}
      <div className="ml-detail-content">
        {detail?.overview || (is115Detail ? nfo115?.plot : '') ? (
          <p className="ml-detail-overview">{detail?.overview || (is115Detail ? nfo115?.plot : '')}</p>
        ) : is115Detail && nfo115Loading ? (
          <p className="ml-detail-overview">正在解析 NFO…</p>
        ) : is115Detail && nfo115Error ? (
          <p className="ml-detail-status">NFO 状态：{nfo115Error}</p>
        ) : null}

        {is115Detail && !item.coverPickCode ? (
          <p className="ml-detail-status">封面状态：索引中没有发现封面文件</p>
        ) : null}

        {infoRows.length > 0 ? (
          <div className="ml-detail-info-card" data-detail-info-card="1">
            <h4>{is115Detail ? 'NFO 信息' : '基础信息'}</h4>
            <dl className="ml-detail-info-grid">
              {infoRows.map(([label, value, variant]) => (
                <div
                  key={`${label}:${value}`}
                  className={`ml-detail-info-row${variant === 'wide' ? ' ml-detail-info-row-wide' : ''}`}
                >
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}

        {item.copies?.length ? (
          <section className="ml-detail-section" data-media-source-copies="1">
            <h4>可用来源</h4>
            <div className="ml-detail-copy-list">
              {item.copies.map((copy) => {
                const copyProgress = formatWatchPercent(copy.userData);
                const playbackStatus = getMediaSourceCopyPlaybackStatus(copy);
                const copyLabel = formatMediaSourceCopyLabel(copy);
                return (
                  <div key={copy.copyId} className="ml-detail-copy-row">
                    <span className="ml-detail-copy-source">{sourceLabel(copy.source)}</span>
                    <span className="ml-detail-copy-main">
                      <strong>{copyLabel}</strong>
                      {copy.fileName || copy.folderPath ? (
                        <small title={copy.folderPath || copy.fileName}>
                          {copy.fileName || copy.folderPath}
                        </small>
                      ) : null}
                    </span>
                    {copyProgress ? (
                      <span className="ml-detail-copy-progress">已播放 {copyProgress}</span>
                    ) : null}
                    <button
                      type="button"
                      className="ml-detail-copy-play"
                      disabled={!playbackStatus.playable || !onPlayCopy}
                      title={playbackStatus.playable ? `使用 ${copyLabel} 播放` : playbackStatus.reason}
                      onClick={() => {
                        if (!playbackStatus.playable) return;
                        onPlayCopy?.(copy, {
                          highlights: chapters.map((chapter) => ({
                            time: chapter.startTimeSeconds || 0,
                            text: chapter.name || `章节 ${chapter.index + 1}`,
                          })),
                        });
                      }}
                    >
                      {playbackStatus.playable ? '播放此来源' : playbackStatus.reason || '暂不可播放'}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
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

