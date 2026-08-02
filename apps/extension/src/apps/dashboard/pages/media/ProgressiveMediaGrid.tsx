/**
 * @file ProgressiveMediaGrid.tsx
 * @description 媒体卡片渐进渲染，避免大目录首次一次性挂载全部卡片。
 * @module apps/dashboard/pages/media
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

export const PROGRESSIVE_MEDIA_BATCH_SIZE = 48;
const MAX_PRIORITY_ITEMS = 8;

type ProgressiveMediaGridProps<T> = {
  items: readonly T[];
  itemKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  priorityItem?: (item: T, index: number) => boolean;
  className?: string;
};

/**
 * 保持页面级滚动体验，只把尚未接近视口的卡片延后挂载。
 * IntersectionObserver 不可用时保留“加载更多”按钮作为可访问回退。
 */
export function ProgressiveMediaGrid<T>({
  items,
  itemKey,
  renderItem,
  priorityItem,
  className = 'ml-grid',
}: ProgressiveMediaGridProps<T>) {
  const [visibleCount, setVisibleCount] = useState(() => Math.min(
    items.length,
    PROGRESSIVE_MEDIA_BATCH_SIZE,
  ));
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVisibleCount(Math.min(items.length, PROGRESSIVE_MEDIA_BATCH_SIZE));
  }, [items]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || visibleCount >= items.length || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setVisibleCount((current) => Math.min(
        items.length,
        current + PROGRESSIVE_MEDIA_BATCH_SIZE,
      ));
    }, { rootMargin: '640px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [items.length, visibleCount]);

  let priorityCount = 0;
  const visibleItems = items.filter((item, index) => {
    if (index < visibleCount) return true;
    if (priorityCount >= MAX_PRIORITY_ITEMS || priorityItem?.(item, index) !== true) return false;
    priorityCount += 1;
    return true;
  });

  return (
    <div className={className} id="mediaLibraryGrid" data-layout-check="media-grid">
      {visibleItems.map((item, index) => (
        <div key={itemKey(item, index)} className="ml-grid-item">
          {renderItem(item, index)}
        </div>
      ))}
      {visibleCount < items.length ? (
        <div ref={sentinelRef} className="ml-grid-load-more" role="status" aria-live="polite">
          <span>正在准备更多影片…</span>
          <button
            type="button"
            className="ml-grid-load-more-button"
            onClick={() => setVisibleCount((current) => Math.min(
              items.length,
              current + PROGRESSIVE_MEDIA_BATCH_SIZE,
            ))}
          >
            加载更多（剩余 {items.length - visibleCount} 部）
          </button>
        </div>
      ) : null}
    </div>
  );
}
