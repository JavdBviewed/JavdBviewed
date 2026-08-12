/**
 * @file MediaCover.tsx
 * @description 媒体封面原语。高度由内部 frame 的 aspect-ratio 在文档流中撑开。
 * @module ui/primitives
 *
 * 高度合约：
 * 1. 唯一高度来源：.ui-media-cover__frame 的 aspect-ratio（文档流）
 * 2. art/shade/badges/footer/play 全部 absolute，挂在 frame 上
 * 3. 悬浮只缩放 art，禁止移动外框
 * 4. 禁止 padding-top% 撑高（flex/button 下易变成 0）
 * 5. 真实封面优先 <img>；**视口可见后才起载** + 全局限流（imageLoadGate）
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { requestImageLoad } from '../../lib/imageLoadGate';
import { observeWhenVisible } from '../../lib/sharedIntersectionObserver';
import './MediaCover.css';

export type MediaCoverProps = {
  /** 封面图 URL（优先用 img 加载） */
  imageUrl?: string | null;
  /** 主图失败时的次选 URL */
  fallbackImageUrl?: string | null;
  /** 封面背景（渐变或 url(...)）；无 imageUrl 时使用 */
  artStyle?: CSSProperties;
  /**
   * 图片适配：
   * - contain：完整显示，不裁切（默认，适合竖版 AV 封面）
   * - cover：铺满裁切（适合横版剧照）
   */
  fit?: 'contain' | 'cover';
  /** 左上/右上等徽章区 */
  badges?: ReactNode;
  /** 底部文案（番号、标题） */
  footer?: ReactNode;
  /** 是否显示悬浮播放钮 */
  showPlayHint?: boolean;
  className?: string;
  /** 是否启用轻微缩放悬浮（默认 true） */
  hoverZoom?: boolean;
  /** img alt */
  alt?: string;
  /**
   * 是否启用视口懒加载（默认 true）。
   * 详情弹窗等已在视口内的场景可设 false，但仍走全局限流。
   */
  lazy?: boolean;
};

/**
 * 稳定封面壳（懒加载 + 限流）
 */
export function MediaCover({
  imageUrl,
  fallbackImageUrl,
  artStyle,
  fit = 'contain',
  badges,
  footer,
  showPlayHint = true,
  className,
  hoverZoom = true,
  alt = '',
  lazy = true,
}: MediaCoverProps) {
  const primary = imageUrl ? String(imageUrl).trim() : '';
  const secondary = fallbackImageUrl ? String(fallbackImageUrl).trim() : '';
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(!lazy);
  const [activeSrc, setActiveSrc] = useState('');
  const [failedPrimary, setFailedPrimary] = useState(false);

  // 视口检测：进入附近区域才允许起载
  useEffect(() => {
    if (!lazy) {
      setInView(true);
      return undefined;
    }
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return undefined;
    }
    return observeWhenVisible(el, () => setInView(true), {
      rootMargin: '180px 0px',
      threshold: 0.01,
    });
  }, [lazy]);

  // 可见后经全局限流再挂 src
  useEffect(() => {
    setFailedPrimary(false);
    setActiveSrc('');
    if (!inView) return undefined;

    const want = primary;
    if (!want) return undefined;

    const ticket = requestImageLoad(() => {
      setActiveSrc(want);
    });
    return () => ticket.cancel();
  }, [inView, primary]);

  const showImg = Boolean(activeSrc);

  return (
    <div
      ref={rootRef}
      className={cn(
        'ui-media-cover',
        hoverZoom && 'ui-media-cover--hover-zoom',
        fit === 'cover' ? 'ui-media-cover--fit-cover' : 'ui-media-cover--fit-contain',
        className,
      )}
    >
      <div className="ui-media-cover__frame">
        {showImg ? (
          <img
            className="ui-media-cover__art ui-media-cover__art-img"
            src={activeSrc}
            alt={alt}
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => {
              if (!failedPrimary && secondary && secondary !== activeSrc) {
                setFailedPrimary(true);
                // 回退图也走限流，避免瞬间二次风暴
                const ticket = requestImageLoad(() => setActiveSrc(secondary));
                // 无法在 onError 里方便 cancel；短生命周期可接受
                void ticket;
                return;
              }
              setActiveSrc('');
            }}
          />
        ) : (
          <div className="ui-media-cover__art" style={artStyle} />
        )}
        <div className="ui-media-cover__shade" aria-hidden="true" />
        {badges ? <div className="ui-media-cover__badges">{badges}</div> : null}
        {footer ? <div className="ui-media-cover__footer">{footer}</div> : null}
        {showPlayHint ? (
          <div className="ui-media-cover__play" aria-hidden="true">
            <span>▶</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
