/**
 * @file useHorizontalScroller.ts
 * @description 横向卡片行：优先保证外层纵向滚动，横滑仅在明确手势时发生
 * @module apps/dashboard/pages/media
 */
import { useEffect, useRef } from 'react';

export type UseHorizontalScrollerOptions = {
  /** 是否启用拖拽滑动，默认 true */
  drag?: boolean;
  /**
   * 是否启用增强手势。false 时不绑定 wheel/drag（内容未溢出）
   * 默认 true
   */
  enabled?: boolean;
};

/**
 * 绑定横向滚动增强（关键原则：不抢详情弹窗的上下滚动）
 *
 * 会拦截 / 转为横滑的情况：
 * 1. 触控板明确横向滑动（|deltaX| 明显大于 |deltaY|）
 * 2. Shift + 滚轮（桌面常见“强制横滑”约定）
 * 3. 指针拖拽
 *
 * 不会拦截：
 * - 普通竖向滚轮 / 触控板上下滑 → 交给外层 Overlay body
 */
export function useHorizontalScroller<T extends HTMLElement = HTMLDivElement>(
  options: UseHorizontalScrollerOptions = {},
) {
  const { drag = true, enabled = true } = options;
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) {
      el?.classList.remove('is-dragging');
      return undefined;
    }

    const onWheel = (e: WheelEvent) => {
      const canScrollX = el.scrollWidth > el.clientWidth + 2;
      if (!canScrollX) return;

      const absX = Math.abs(e.deltaX);
      const absY = Math.abs(e.deltaY);

      // 1) 触控板明确横滑：交给原生横滑，阻止冒泡即可
      //    阈值：横向分量至少是纵向的 1.2 倍，且有实际位移
      if (absX > absY * 1.2 && absX > 0.5) {
        e.stopPropagation();
        return;
      }

      // 2) Shift + 滚轮：把纵向滚轮映射为横滑（显式手势）
      if (e.shiftKey && absY > 0) {
        const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        const maxLeft = el.scrollWidth - el.clientWidth;
        const next = Math.max(0, Math.min(maxLeft, el.scrollLeft + delta));
        // 到尽头且继续同向：放行，避免卡死
        if (
          (delta < 0 && el.scrollLeft <= 1)
          || (delta > 0 && el.scrollLeft >= maxLeft - 1)
        ) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        el.scrollLeft = next;
        return;
      }

      // 3) 普通竖向滚轮：完全不拦截，让详情弹窗上下滚
    };

    // 不用 capture 抢全局；bubble 即可，且仅处理上述明确横滑手势
    el.addEventListener('wheel', onWheel, { passive: false });

    if (!drag) {
      return () => {
        el.removeEventListener('wheel', onWheel);
      };
    }

    let active = false;
    let pointerId = -1;
    let startX = 0;
    let startY = 0;
    let startScroll = 0;
    let moved = false;
    let axis: 'none' | 'x' | 'y' = 'none';

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      // 可点击卡片（章节、合集、相似内容、外部链接）交给自身处理，
      // 不要因为横向拖拽的 pointer capture 吞掉一次普通点击。
      if (
        e.target instanceof Element
        && e.target.closest('button,a,[role=button],input,select,textarea')
      ) {
        return;
      }
      if (el.scrollWidth <= el.clientWidth + 2) return;
      active = true;
      moved = false;
      axis = 'none';
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      startScroll = el.scrollLeft;
      // 不立刻加 is-dragging：先看用户是横拖还是竖拖
      try {
        el.setPointerCapture(pointerId);
      } catch {
        /* ignore */
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!active || e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      // 方向锁：先判定主轴，竖拖则放弃横滑，避免拖卡片时误横移
      if (axis === 'none') {
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
        if (axis === 'y') {
          // 竖向意图：释放捕获，让外层正常处理
          active = false;
          try {
            el.releasePointerCapture(pointerId);
          } catch {
            /* ignore */
          }
          return;
        }
        el.classList.add('is-dragging');
      }

      if (axis !== 'x') return;
      if (Math.abs(dx) > 3) moved = true;
      if (moved) {
        el.scrollLeft = startScroll - dx;
      }
    };

    const endDrag = (e: PointerEvent) => {
      if (!active || e.pointerId !== pointerId) {
        // 可能已在竖向判定时结束
        el.classList.remove('is-dragging');
        return;
      }
      active = false;
      el.classList.remove('is-dragging');
      try {
        el.releasePointerCapture(pointerId);
      } catch {
        /* ignore */
      }
      if (moved && axis === 'x') {
        const swallow = (ev: Event) => {
          ev.preventDefault();
          ev.stopPropagation();
          el.removeEventListener('click', swallow, true);
        };
        el.addEventListener('click', swallow, true);
        window.setTimeout(() => el.removeEventListener('click', swallow, true), 0);
      }
      axis = 'none';
      moved = false;
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);

    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', endDrag);
      el.removeEventListener('pointercancel', endDrag);
      el.classList.remove('is-dragging');
    };
  }, [drag, enabled]);

  return ref;
}
