import { observeWhenVisible } from '../../../ui/lib/sharedIntersectionObserver';

/**
 * 可见性门控（按 concern 命名空间，08-29-actor-passthrough-category-filter D 修复）。
 *
 * 同一张卡片可能同时挂多个 concern 的延后任务（演员增强 watermark/隐藏 与
 * 演员穿透/类别过滤重放）。每张卡片只注册一个可见性观察，条件满足时扇出执行
 * 该卡已登记的全部 concern 回调；cancel/cancelAll 可按 concern 精确取消，
 * 避免误杀其它 concern 的挂起任务——
 * 典型场景：settings-updated 路径先经 updateConfig 触发类别过滤重放入队
 * （reapplyCategoryFilterForAll → enqueueActorPenetration），随后
 * reapplyActorHidingForAll 的 cancelAll 会把穿透重放的挂起任务一并取消，
 * 导致视口外卡片的「缓存命中即时重放」永久丢失，直到 reload 才生效。
 */
export interface ActorVisibilityGate {
  /** 登记一个 concern 的延后任务；该 concern 已有挂起任务时直接跳过。返回 true 表示任务处于挂起/将执行态。 */
  defer(item: HTMLElement, callback: () => void, concern?: string): boolean;
  /** 取消某卡片的挂起任务（缺省全部 concern）。 */
  cancel(item: HTMLElement, concern?: string): void;
  /** 取消全部卡片的挂起任务（缺省全部 concern）。 */
  cancelAll(concern?: string): void;
}

const ACTOR_VISIBILITY_OPTIONS = {
  rootMargin: '240px 0px',
  threshold: 0.01,
};

const DEFAULT_CONCERN = 'default';

export function createActorVisibilityGate(): ActorVisibilityGate {
  /** item → concern → callback（同一 concern 幂等，多 concern 并存）。 */
  const pending = new Map<HTMLElement, Map<string, () => void>>();
  /** item → 该卡片唯一可见性注册的解绑函数。 */
  const stops = new WeakMap<HTMLElement, () => void>();

  const release = (item: HTMLElement): void => {
    const stop = stops.get(item);
    stops.delete(item);
    if (stop) stop();
  };

  return {
    defer(item, callback, concern = DEFAULT_CONCERN): boolean {
      if (typeof IntersectionObserver === 'undefined') {
        return false;
      }
      const existing = pending.get(item);
      if (existing && existing.has(concern)) {
        return true;
      }
      if (!existing) {
        pending.set(item, new Map([[concern, callback]]));
        stops.set(item, observeWhenVisible(item, () => {
          const callbacks = pending.get(item);
          if (!callbacks) return;
          pending.delete(item);
          release(item);
          // 单个 concern 回调抛错不得阻塞其余 concern
          for (const run of [...callbacks.values()]) {
            try {
              run();
            } catch {
              /* 单 concern 失败隔离 */
            }
          }
        }, ACTOR_VISIBILITY_OPTIONS));
        return true;
      }
      existing.set(concern, callback);
      return true;
    },

    cancel(item, concern): void {
      const callbacks = pending.get(item);
      if (!callbacks) return;
      if (concern === undefined) {
        callbacks.clear();
        pending.delete(item);
        release(item);
        return;
      }
      if (!callbacks.delete(concern)) return;
      if (callbacks.size === 0) {
        pending.delete(item);
        release(item);
      }
    },

    cancelAll(concern): void {
      if (concern === undefined) {
        for (const [item, callbacks] of [...pending]) {
          callbacks.clear();
          pending.delete(item);
          release(item);
        }
        return;
      }
      for (const [item, callbacks] of [...pending]) {
        if (!callbacks.delete(concern)) continue;
        if (callbacks.size === 0) {
          pending.delete(item);
          release(item);
        }
      }
    },
  };
}
