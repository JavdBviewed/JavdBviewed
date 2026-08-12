/**
 * @file useDrive115Cover.ts
 * @description 115 卡片封面视窗懒加载：进入可视区才现取直链，配合内存缓存复用。
 * @module apps/dashboard/pages/media
 */
import { useCallback, useRef, useState } from 'react';
import { observeWhenVisible } from '../../../../ui/lib/sharedIntersectionObserver';
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
  const [coverUrl, setCoverUrl] = useState('');
  const coverUrlRef = useRef('');
  const cleanupRef = useRef<(() => void) | null>(null);
  const pickCode = item.source === '115' ? item.coverPickCode : undefined;

  const ref = useCallback((node: HTMLElement | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (coverUrlRef.current) {
      coverUrlRef.current = '';
      setCoverUrl('');
    }
    if (!node || !pickCode) return;

    let cancelled = false;
    let loaded = false;
    const load = () => {
      if (loaded) return;
      loaded = true;
      void resolveDrive115CoverUrl(pickCode).then((url) => {
        if (!cancelled && url) {
          coverUrlRef.current = url;
          setCoverUrl(url);
        }
      });
    };
    if (!node || typeof IntersectionObserver === 'undefined') {
      load();
      cleanupRef.current = () => {
        cancelled = true;
      };
      return;
    }

    // 先判断视口，避免为首屏可见卡片创建后立即销毁的观察器。
    const rect = node.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const nearViewport = rect.bottom >= -200
      && rect.right >= -200
      && rect.top <= viewportHeight + 200
      && rect.left <= viewportWidth + 200;
    if (nearViewport) {
      load();
      cleanupRef.current = () => {
        cancelled = true;
      };
      return;
    }

    const stopObserving = observeWhenVisible(node, load, { rootMargin: '200px' });
    cleanupRef.current = () => {
      cancelled = true;
      stopObserving();
    };
  }, [pickCode]);
  return { ref, coverUrl };
}
