/**
 * @file sessionResultCache.ts
 * @description 跨页结果缓存（内存 + globalCache），仅缓存查询结果不缓存 DOM
 * @module platform/storage
 */

import { globalCache } from './cache';

export type SessionResultNamespace =
  | 'onlineAvailability'
  | 'relatedLists'
  | 'fc2'
  | 'magnetsExternal'
  | string;

export interface SessionResultCacheOptions {
  /** 过期毫秒；默认 10 分钟 */
  ttlMs?: number;
  /** 强制跳过缓存 */
  force?: boolean;
}

export const SESSION_RESULT_TTL = {
  onlineAvailability: 12 * 60 * 1000,
  relatedLists: 10 * 60 * 1000,
  fc2: 20 * 60 * 1000,
  magnetsExternal: 8 * 60 * 1000,
  default: 10 * 60 * 1000,
} as const;

interface MemoryEntry<T> {
  data: T;
  expireAt: number;
}

const memoryStore = new Map<string, MemoryEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

function fullKey(namespace: string, identity: string): string {
  return `sessionResult:${namespace}:${String(identity || '').trim().toUpperCase()}`;
}

function resolveTtl(namespace: string, ttlMs?: number): number {
  if (typeof ttlMs === 'number' && ttlMs > 0) return ttlMs;
  if (namespace in SESSION_RESULT_TTL) {
    return SESSION_RESULT_TTL[namespace as keyof typeof SESSION_RESULT_TTL];
  }
  return SESSION_RESULT_TTL.default;
}

function peekMemory<T>(key: string): T | null {
  const mem = memoryStore.get(key) as MemoryEntry<T> | undefined;
  if (!mem) return null;
  if (mem.expireAt <= Date.now()) {
    memoryStore.delete(key);
    return null;
  }
  return mem.data;
}

export function clearSessionResultMemory(): void {
  memoryStore.clear();
  inflight.clear();
}

export async function getSessionResult<T>(
  namespace: SessionResultNamespace,
  identity: string,
): Promise<T | null> {
  const key = fullKey(namespace, identity);
  const memHit = peekMemory<T>(key);
  if (memHit != null) return memHit;

  try {
    const stored = await globalCache.get<T>(key);
    if (stored == null) return null;
    memoryStore.set(key, {
      data: stored,
      expireAt: Date.now() + resolveTtl(namespace),
    });
    return stored;
  } catch {
    return null;
  }
}

export async function setSessionResult<T>(
  namespace: SessionResultNamespace,
  identity: string,
  data: T,
  ttlMs?: number,
): Promise<void> {
  const key = fullKey(namespace, identity);
  const ttl = resolveTtl(namespace, ttlMs);
  memoryStore.set(key, { data, expireAt: Date.now() + ttl });
  try {
    await globalCache.set(key, data, ttl);
  } catch {
    // storage 失败时至少保留内存
  }
}

/**
 * 跨页 get-or-fetch：同 key 并发只打一次网络。
 * 在任何 await 之前同步登记 inflight，避免双 miss 双发。
 */
export async function getOrFetchSessionResult<T>(
  namespace: SessionResultNamespace,
  identity: string,
  fetcher: () => Promise<T>,
  options: SessionResultCacheOptions = {},
): Promise<{ data: T; fromCache: boolean }> {
  const key = fullKey(namespace, identity);

  if (!options.force) {
    const pending = inflight.get(key) as Promise<T> | undefined;
    if (pending) {
      return { data: await pending, fromCache: true };
    }
    const memHit = peekMemory<T>(key);
    if (memHit != null) {
      return { data: memHit, fromCache: true };
    }
  }

  // 同步占位，后续 await 前其它调用方会命中 inflight
  let resolveRun!: (value: T) => void;
  let rejectRun!: (reason?: unknown) => void;
  const run = new Promise<T>((resolve, reject) => {
    resolveRun = resolve;
    rejectRun = reject;
  });
  // 占位 Promise 只用于其它并发调用复用结果；没有并发等待者时，
  // fetcher 失败也不应在测试/页面里留下未处理 rejection?
  run.catch(() => undefined);
  inflight.set(key, run);

  try {
    if (!options.force) {
      const cached = await getSessionResult<T>(namespace, identity);
      if (cached != null) {
        resolveRun(cached);
        return { data: cached, fromCache: true };
      }
    }

    const data = await fetcher();
    await setSessionResult(namespace, identity, data, options.ttlMs);
    resolveRun(data);
    return { data, fromCache: false };
  } catch (error) {
    rejectRun(error);
    throw error;
  } finally {
    inflight.delete(key);
  }
}
