/**
 * @file drive115CoverCache.ts
 * @description 115 封面直链的内存短 TTL 缓存 + 在途去重。
 *   115 下载直链短时有效 → 只缓存 URL（不持久化、不下载字节），带 TTL + LRU 上限，避免本地卡死。
 * @module apps/dashboard/pages/media
 */
import { sendRuntimeMessage } from '../../../../platform/browser/runtimeMessages';

/** 直链缓存有效期（ms）：取保守值，短于 115 直链实际有效期，避免用到过期直链 */
const COVER_URL_TTL_MS = 3 * 60 * 1000;
/** LRU 条目上限：仅缓存最近浏览过的封面，避免无限增长 */
const COVER_CACHE_CAP = 300;

type CacheEntry = { url: string; expiresAt: number };

// Map 迭代顺序即插入顺序，配合 delete+set 实现 LRU
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string>>();

function nowMs(): number {
  return Date.now();
}

function readCache(pickCode: string): string | null {
  const hit = cache.get(pickCode);
  if (!hit) return null;
  if (hit.expiresAt <= nowMs()) {
    cache.delete(pickCode);
    return null;
  }
  // 命中即刷新为最近使用
  cache.delete(pickCode);
  cache.set(pickCode, hit);
  return hit.url;
}

function writeCache(pickCode: string, url: string): void {
  cache.set(pickCode, { url, expiresAt: nowMs() + COVER_URL_TTL_MS });
  // 超上限时淘汰最旧
  while (cache.size > COVER_CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * 解析 115 封面直链：先查内存缓存（未过期即复用），未命中则现取一次直链。
 * 在途请求按 pickCode 去重。失败/无直链返回空串。
 */
export async function resolveDrive115CoverUrl(pickCode: string): Promise<string> {
  const code = String(pickCode || '').trim();
  if (!code) return '';

  const cached = readCache(code);
  if (cached) return cached;

  const pending = inflight.get(code);
  if (pending) return pending;

  const task = (async (): Promise<string> => {
    try {
      const resp = (await sendRuntimeMessage({
        type: 'DRIVE115_MEDIA_LIBRARY_RESOLVE_COVER_URL',
        pickCode: code,
      })) as { success?: boolean; url?: string } | undefined;
      const url = resp?.success && resp.url ? String(resp.url) : '';
      if (url) writeCache(code, url);
      return url;
    } catch {
      return '';
    } finally {
      inflight.delete(code);
    }
  })();

  inflight.set(code, task);
  return task;
}

/** 测试/登出用：清空封面缓存 */
export function clearDrive115CoverCache(): void {
  cache.clear();
  inflight.clear();
}
