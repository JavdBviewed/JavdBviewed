/**
 * @file sharedIntersectionObserver.ts
 * @description 按观察参数复用 IntersectionObserver，避免列表组件按节点重复创建观察器。
 * @module ui/lib
 */

export type SharedIntersectionObserverOptions = {
  rootMargin?: string;
  threshold?: number;
};

type ObserverBucket = {
  observer: IntersectionObserver;
  targets: Map<Element, () => void>;
};

const buckets = new Map<string, ObserverBucket>();

function normalizeOptions(options: SharedIntersectionObserverOptions): { rootMargin: string; threshold: number } {
  return {
    rootMargin: options.rootMargin ?? '0px',
    threshold: options.threshold ?? 0,
  };
}

function getBucket(options: SharedIntersectionObserverOptions): ObserverBucket | null {
  if (typeof IntersectionObserver === 'undefined') return null;
  const normalized = normalizeOptions(options);
  const key = `${normalized.rootMargin}|${normalized.threshold}`;
  const existing = buckets.get(key);
  if (existing) return existing;

  const targets = new Map<Element, () => void>();
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting && entry.intersectionRatio <= 0) continue;
      const callback = targets.get(entry.target);
      if (!callback) continue;
      targets.delete(entry.target);
      observer.unobserve(entry.target);
      callback();
    }
    if (targets.size === 0) {
      observer.disconnect();
      buckets.delete(key);
    }
  }, {
    rootMargin: normalized.rootMargin,
    threshold: normalized.threshold,
  });
  const bucket = { observer, targets };
  buckets.set(key, bucket);
  return bucket;
}

/** 注册一次性可见回调，并返回可用于组件卸载的清理函数。 */
export function observeWhenVisible(
  node: Element | null,
  callback: () => void,
  options: SharedIntersectionObserverOptions = {},
): () => void {
  if (!node) return () => {};
  const bucket = getBucket(options);
  if (!bucket) {
    callback();
    return () => {};
  }

  bucket.targets.set(node, callback);
  bucket.observer.observe(node);
  return () => {
    if (bucket.targets.get(node) !== callback) return;
    bucket.targets.delete(node);
    bucket.observer.unobserve(node);
    if (bucket.targets.size === 0) {
      bucket.observer.disconnect();
      for (const [key, current] of buckets.entries()) {
        if (current === bucket) buckets.delete(key);
      }
    }
  };
}

/** 测试辅助：清空仍在等待的观察器。 */
export function clearSharedIntersectionObserversForTest(): void {
  for (const bucket of buckets.values()) {
    bucket.observer.disconnect();
  }
  buckets.clear();
}
