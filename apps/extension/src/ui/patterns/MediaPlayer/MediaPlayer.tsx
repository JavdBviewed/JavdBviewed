/**
 * @file MediaPlayer.tsx
 * @description 扩展内播放器：ArtPlayer + hls.js；字幕 / 清晰度 / 章节高亮
 * @module ui/patterns/MediaPlayer
 */
import { useEffect, useRef, useState } from 'react';
import Artplayer from 'artplayer';
import Hls from 'hls.js';
import { cn } from '../../lib/cn';
import './MediaPlayer.css';

export type MediaPlayerHighlight = {
  time: number;
  text: string;
};

export type MediaPlayerSubtitle = {
  label: string;
  url: string;
  type?: 'vtt' | 'srt';
  default?: boolean;
  language?: string;
};

export type MediaPlayerQuality = {
  html: string;
  url: string;
  streamType?: 'mp4' | 'm3u8' | 'auto';
  default?: boolean;
};

export type MediaPlayerProps = {
  title: string;
  subtitle?: string;
  src: string;
  /** mp4 直链 / m3u8 HLS / auto 自动判断 */
  streamType?: 'mp4' | 'm3u8' | 'auto';
  poster?: string;
  autoPlay?: boolean;
  startTimeSeconds?: number;
  /** 进度条章节高亮 */
  highlights?: MediaPlayerHighlight[];
  /** 外挂/服务器字幕轨 */
  subtitles?: MediaPlayerSubtitle[];
  /** 清晰度 / 源切换 */
  qualities?: MediaPlayerQuality[];
  className?: string;
  /** video.crossOrigin：默认给 Emby 字幕用；115 CDN 直链传 null，避免 CORS 阻断播放。 */
  crossOrigin?: 'anonymous' | 'use-credentials' | null;
  onClose?: () => void;
  onProgress?: (info: { currentTime: number; duration: number; ended: boolean }) => void;
};

function resolveArtType(src: string, streamType?: string): string | undefined {
  const t = String(streamType || '').toLowerCase();
  if (t === 'm3u8' || t === 'hls') return 'm3u8';
  if (t === 'mp4') return undefined;
  const url = String(src || '').toLowerCase();
  if (url.includes('.m3u8') || (url.includes('playlist') && url.includes('m3u8'))) return 'm3u8';
  return undefined;
}

function playM3u8(video: HTMLVideoElement, url: string, art: Artplayer) {
  if (Hls.isSupported()) {
    const prev = (art as any).hls as Hls | undefined;
    if (prev) {
      try {
        prev.destroy();
      } catch {
        /* ignore */
      }
    }
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    (art as any).hls = hls;
    art.on('destroy', () => {
      try {
        hls.destroy();
      } catch {
        /* ignore */
      }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
  } else {
    art.notice.show = '当前环境不支持 HLS（m3u8）';
  }
}

/**
 * ArtPlayer 封装：HLS + 直链 + 字幕 + 清晰度
 */
export function MediaPlayer({
  title,
  subtitle,
  src,
  streamType,
  poster,
  autoPlay = true,
  startTimeSeconds,
  highlights,
  subtitles,
  qualities,
  className,
  crossOrigin = 'anonymous',
  onClose,
  onProgress,
}: MediaPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const artRef = useRef<Artplayer | null>(null);
  const onProgressRef = useRef(onProgress);
  const onCloseRef = useRef(onClose);
  const titleRef = useRef(title);
  const subtitleRef = useRef(subtitle);
  const autoPlayRef = useRef(autoPlay);
  const startTimeRef = useRef(startTimeSeconds);
  const highlightsRef = useRef(highlights);
  const subtitlesRef = useRef(subtitles);
  const qualitiesRef = useRef(qualities);
  const crossOriginRef = useRef(crossOrigin);
  const startAppliedRef = useRef(false);
  const [error, setError] = useState('');

  onProgressRef.current = onProgress;
  onCloseRef.current = onClose;
  titleRef.current = title;
  subtitleRef.current = subtitle;
  autoPlayRef.current = autoPlay;
  startTimeRef.current = startTimeSeconds;
  highlightsRef.current = highlights;
  subtitlesRef.current = subtitles;
  qualitiesRef.current = qualities;
  crossOriginRef.current = crossOrigin;

  // 字幕/清晰度列表变化时不整实例重建（避免进度丢失）；仅 src 变化重建
  // 但首次创建时要带上列表 —— 用 ref 在 mount 时读取
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !src) return undefined;

    setError('');
    startAppliedRef.current = false;

    const start = Number(startTimeRef.current) || 0;
    const t = titleRef.current;
    const st = subtitleRef.current;
    const artType = resolveArtType(src, streamType);
    const hl = (highlightsRef.current || [])
      .filter((h) => Number.isFinite(h.time) && h.time >= 0 && h.text)
      .map((h) => ({ time: h.time, text: String(h.text) }));

    const subTracks = (subtitlesRef.current || []).filter((s) => s.url && s.label);
    const defaultSub = subTracks.find((s) => s.default) || subTracks[0];
    const qualityList = (qualitiesRef.current || []).filter((q) => q.url && q.html);
    const videoAttrs: Partial<HTMLVideoElement> = { playsInline: true };
    if (crossOriginRef.current) {
      videoAttrs.crossOrigin = crossOriginRef.current;
    }

    const art = new Artplayer({
      container: el,
      url: src,
      ...(artType ? { type: artType as any } : {}),
      customType: {
        m3u8: playM3u8,
        hls: playM3u8,
      },
      poster: poster || '',
      theme: '#3b82f6',
      volume: 0.9,
      autoplay: autoPlayRef.current,
      muted: false,
      pip: true,
      autoSize: false,
      autoMini: false,
      screenshot: true,
      setting: true,
      loop: false,
      flip: true,
      playbackRate: true,
      aspectRatio: true,
      fullscreen: true,
      fullscreenWeb: true,
      subtitleOffset: subTracks.length > 0,
      miniProgressBar: true,
      mutex: true,
      backdrop: true,
      playsInline: true,
      autoPlayback: false,
      hotkey: true,
      lock: true,
      fastForward: true,
      autoOrientation: false,
      moreVideoAttr: videoAttrs,
      lang: 'zh-cn',
      ...(hl.length ? { highlight: hl } : {}),
      ...(defaultSub
        ? {
            subtitle: {
              url: defaultSub.url,
              type: defaultSub.type || 'vtt',
              encoding: 'utf-8',
              escape: true,
              style: {
                color: '#fff',
                fontSize: '18px',
                textShadow: '0 1px 4px rgba(0,0,0,.85)',
              },
            },
          }
        : {}),
      ...(qualityList.length > 1
        ? {
            quality: qualityList.map((q) => ({
              default: Boolean(q.default),
              html: q.html,
              url: q.url,
            })),
          }
        : {}),
      ...(subTracks.length
        ? {
            settings: [
              {
                width: 240,
                html: '字幕',
                tooltip: defaultSub?.label || '字幕',
                selector: [
                  {
                    html: '显示',
                    tooltip: '开',
                    switch: true,
                    onSwitch(item: any) {
                      item.tooltip = item.switch ? '关' : '开';
                      art.subtitle.show = !item.switch;
                      return !item.switch;
                    },
                  },
                  {
                    html: '关闭字幕',
                    url: '',
                  },
                  ...subTracks.map((s) => ({
                    default: Boolean(s.default || (defaultSub && s.url === defaultSub.url)),
                    html: s.label,
                    url: s.url,
                    type: s.type || 'vtt',
                  })),
                ],
                onSelect(item: any) {
                  if (!item?.url) {
                    art.subtitle.show = false;
                    return '关闭';
                  }
                  art.subtitle.switch(item.url, {
                    name: item.html,
                    type: item.type || 'vtt',
                  });
                  art.subtitle.show = true;
                  return item.html;
                },
              },
            ],
          }
        : {}),
      layers: [
        {
          name: 'javdb-title',
          html: `<div class="ui-media-player__layer-title"><div class="ui-media-player__layer-code"></div><div class="ui-media-player__layer-sub"></div></div>`,
          style: {
            position: 'absolute',
            left: '12px',
            top: '12px',
            pointerEvents: 'none',
            zIndex: '30',
            maxWidth: '70%',
          },
          mounted(layerEl) {
            const code = layerEl.querySelector('.ui-media-player__layer-code');
            const sub = layerEl.querySelector('.ui-media-player__layer-sub');
            if (code) code.textContent = t;
            if (sub) {
              if (st) {
                sub.textContent = st;
              } else {
                (sub as HTMLElement).style.display = 'none';
              }
            }
          },
        },
      ],
      // 关闭只保留右上角自研按钮，不在 ArtPlayer 控制栏再塞「关闭」
      controls: [],
    });

    artRef.current = art;

    // 切换清晰度时：若目标是 m3u8，需保证 customType 生效（ArtPlayer quality 会换 url）
    art.on('video:quality' as any, () => {
      /* quality switch handled by artplayer */
    });

    const applyStart = () => {
      if (startAppliedRef.current || start <= 0) return;
      try {
        const d = art.duration;
        const target = Number.isFinite(d) && d > 0
          ? Math.min(start, Math.max(0, d - 0.5))
          : start;
        // 同时写 currentTime 与 seek，兼容不同 ArtPlayer 版本
        try {
          art.currentTime = target;
        } catch {
          /* ignore */
        }
        try {
          art.seek = target;
        } catch {
          /* ignore */
        }
        // 仅当实际接近目标时标记已应用，避免 metadata 未就绪时“伪成功”
        const cur = art.currentTime || 0;
        if (start <= 2 || Math.abs(cur - target) < 2 || (Number.isFinite(d) && d > 0 && cur > 1)) {
          startAppliedRef.current = true;
        }
      } catch {
        /* ignore */
      }
    };

    art.on('ready', () => {
      applyStart();
      // HLS 等可能 ready 时 duration 仍为 0，延迟再 seek 一次
      window.setTimeout(applyStart, 400);
      window.setTimeout(applyStart, 1200);
      if (autoPlayRef.current) {
        void art.play().catch(() => {
          /* autoplay may be blocked */
        });
      }
    });

    art.on('video:loadedmetadata', applyStart);
    art.on('video:canplay', applyStart);

    art.on('video:timeupdate', () => {
      // 若起播后仍停在开头且配置了 start，再尝试一次
      if (!startAppliedRef.current && start > 2) {
        applyStart();
      }
      onProgressRef.current?.({
        currentTime: art.currentTime || 0,
        duration: art.duration || 0,
        ended: false,
      });
    });

    art.on('video:ended', () => {
      onProgressRef.current?.({
        currentTime: art.currentTime || 0,
        duration: art.duration || 0,
        ended: true,
      });
    });

    art.on('error', () => {
      setError('媒体加载失败（格式/鉴权/网络）');
    });

    art.on('video:error', () => {
      setError('媒体加载失败（格式/鉴权/网络）');
    });

    return () => {
      try {
        art.pause();
      } catch {
        /* ignore */
      }
      try {
        const hls = (art as any).hls as Hls | undefined;
        hls?.destroy();
      } catch {
        /* ignore */
      }
      try {
        art.destroy(true);
      } catch {
        /* ignore */
      }
      artRef.current = null;
    };
  }, [src, poster, streamType, crossOrigin]);

  useEffect(() => {
    const art = artRef.current;
    if (!art) return;
    try {
      const root = art.template?.$layer || art.template?.$player;
      if (!root) return;
      const layer = root.querySelector('.ui-media-player__layer-title') as HTMLElement | null;
      if (!layer) return;
      const code = layer.querySelector('.ui-media-player__layer-code');
      const sub = layer.querySelector('.ui-media-player__layer-sub') as HTMLElement | null;
      if (code) code.textContent = title;
      if (sub) {
        if (subtitle) {
          sub.textContent = subtitle;
          sub.style.display = '';
        } else {
          sub.textContent = '';
          sub.style.display = 'none';
        }
      }
    } catch {
      /* ignore */
    }
  }, [title, subtitle]);

  return (
    <div
      className={cn('ui-media-player', className)}
      data-ui-pattern="media-player"
      data-player-engine="artplayer"
      data-stream-type={streamType || 'auto'}
      data-has-subtitles={subtitles?.length ? '1' : '0'}
      data-has-qualities={qualities && qualities.length > 1 ? '1' : '0'}
      aria-label={`播放 ${title}`}
    >
      <button
        type="button"
        className="ui-media-player__close-fab"
        aria-label="关闭播放器"
        title="关闭"
        onClick={() => onCloseRef.current?.()}
      >
        ✕
      </button>
      {error ? <div className="ui-media-player__error-banner">{error}</div> : null}
      <div ref={containerRef} className="ui-media-player__art" />
    </div>
  );
}
