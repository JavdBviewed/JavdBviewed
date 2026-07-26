/**
 * @file useDrive115Cover.ts
 * @description 115 卡片封面视窗懒加载：进入可视区才现取直链，配合内存缓存复用。
 * @module apps/dashboard/pages/media
 */
import { useEffect, useRef, useState } from 'react';
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
  const nodeRef = useRef<HTMLElement | null>(null);
  const [coverUrl, setCoverUrl] = useState('');
  const pickCode = item.source === '115' ? item.coverPickCode : undefined;

  useEffect(() => {
    setCoverUrl('');
    if (!pickCode) return undefined;
    let cancelled = false;
    const load = () => {
      void resolveDrive115CoverUrl(pickCode).then((url) => {
        if (!cancelled && url) setCoverUrl(url);
      });
    };
    const el = nodeRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
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
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [pickCode]);

  const ref = (node: HTMLElement | null) => {
    nodeRef.current = node;
  };
  return { ref, coverUrl };
}
