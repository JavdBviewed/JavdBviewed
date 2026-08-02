/**
 * @file useDrive115Cover.ts
 * @description 115 卡片封面视窗懒加载：进入可视区才现取直链，配合内存缓存复用。
 * @module apps/dashboard/pages/media
 */
import { useCallback, useEffect, useState } from 'react';
import { resolveDrive115CoverUrl } from './drive115CoverCache';
import type { MediaBrowseItem } from './mediaBrowseModel';

/**
 * 返回挂到卡片根节点的 ref 与已解析的封面直链。
 * - 仅 source==='115' 且有 coverPickCode 时才解析。
 * - IntersectionObserver 门控：进入可视区（含 200px 预取边距）才请求。
 */
export function useDrive115Cover(item: Pick<MediaBrowseItem, 'source' | 'coverPickCode'>): {
  ref: (node: HTMLElement | null) => void;
  coverUrl: string;
} {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [coverUrl, setCoverUrl] = useState('');
  const pickCode = item.source === '115' ? item.coverPickCode : undefined;

  useEffect(() => {
    setCoverUrl('');
    if (!pickCode) return undefined;
    let cancelled = false;
    let loaded = false;
    const load = () => {
      if (loaded) return;
      loaded = true;
      void resolveDrive115CoverUrl(pickCode).then((url) => {
        if (!cancelled && url) setCoverUrl(url);
      });
    };
    if (!node || typeof IntersectionObserver === 'undefined') {
      load();
      return () => {
        cancelled = true;
      };
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            load();
            io.disconnect();
            break;
          }
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(node);

    // IntersectionObserver 的首次回调不是同步保证；节点已经在视口内时直接触发，
    // 避免轮播切换或首屏卡片因观察器调度延迟一直显示占位图。
    const rect = node.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const nearViewport = rect.bottom >= -200
      && rect.right >= -200
      && rect.top <= viewportHeight + 200
      && rect.left <= viewportWidth + 200;
    if (nearViewport) {
      load();
      io.disconnect();
    }

    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [node, pickCode]);

  const ref = useCallback((nextNode: HTMLElement | null) => {
    setNode(nextNode);
  }, []);
  return { ref, coverUrl };
}
