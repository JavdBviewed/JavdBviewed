/**
 * @file chromeRefreshCoordinator.ts
 * @description 在扩展页面与 service worker 间合并 Cloud token 刷新。
 * @module features/cloudSync
 */
import type { RefreshCoordinator } from '@javdb/sync-client';

const LOCK_NAME = 'javdb-cloud-sync-token-refresh';
let fallbackInFlight: Promise<unknown> | null = null;

function runFallback<T>(work: () => Promise<T>): Promise<T> {
  if (fallbackInFlight) return fallbackInFlight as Promise<T>;
  const current = work();
  fallbackInFlight = current;
  return current.finally(() => {
    if (fallbackInFlight === current) fallbackInFlight = null;
  });
}

export const chromeRefreshCoordinator: RefreshCoordinator = {
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return navigator.locks.request(LOCK_NAME, { mode: 'exclusive' }, work);
    }
    return runFallback(work);
  },
};
