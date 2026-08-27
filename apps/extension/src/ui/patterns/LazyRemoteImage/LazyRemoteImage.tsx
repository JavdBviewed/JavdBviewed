/**
 * @file LazyRemoteImage.tsx
 * @description 通用远程图懒加载：IntersectionObserver + imageLoadGate
 * @module ui/patterns
 */
import { useEffect, useRef, useState, type CSSProperties, type Ref } from 'react';
import { requestImageLoad } from '../../lib/imageLoadGate';
import { observeWhenVisible } from '../../lib/sharedIntersectionObserver';
import { cn } from '../../lib/cn';

export type LazyRemoteImageProps = {
  url?: string | null;
  alt?: string;
  className?: string;
  style?: CSSProperties;
  /** 作为 CSS background-image 使用（续看条等） */
  asBackground?: boolean;
  /** 默认 true */
  lazy?: boolean;
};

/**
 * 列表/横滑条用远程图：进入视口且通过全局限流后才加载。
 */
export function LazyRemoteImage({
  url,
  alt = '',
  className,
  style,
  asBackground = false,
  lazy = true,
}: LazyRemoteImageProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(!lazy);
  const [src, setSrc] = useState('');
  // 加载失败（如 Emby 离线）后静默停止：不再换 src 重试，避免控制台 ERR_ 刷屏。
  const [failed, setFailed] = useState(false);
  const want = url ? String(url).trim() : '';

  useEffect(() => {
    if (!lazy) {
      setInView(true);
      return undefined;
    }
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return undefined;
    }
    return observeWhenVisible(el, () => setInView(true), {
      rootMargin: '180px 0px',
      threshold: 0.01,
    });
  }, [lazy]);

  useEffect(() => {
    setSrc('');
    setFailed(false);
    if (!inView || !want) return undefined;
    const ticket = requestImageLoad(() => setSrc(want));
    return () => ticket.cancel();
  }, [inView, want]);

  if (asBackground) {
    return (
      <div
        ref={ref}
        className={cn(className)}
        style={{
          ...style,
          ...(!failed && src
            ? {
                backgroundImage: `url("${src.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }
            : { backgroundColor: style?.backgroundColor || '#0f172a' }),
        }}
        role={alt ? 'img' : undefined}
        aria-label={alt || undefined}
      />
    );
  }

  // img 与占位共用 outer div 便于 IO
  return (
    <div ref={ref} className={cn(className)} style={style}>
      {src && !failed ? (
        <img
          src={src}
          alt={alt}
          decoding="async"
          referrerPolicy="no-referrer"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          onError={() => setFailed(true)}
        />
      ) : null}
    </div>
  );
}
