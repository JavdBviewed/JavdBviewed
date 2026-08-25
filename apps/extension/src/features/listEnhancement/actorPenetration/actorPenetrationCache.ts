/**
 * @file actorPenetrationCache.ts
 * @description 演员穿透详情缓存封装。
 * 成功结果 TTL 7 天；失败结果 TTL 10 分钟（抑制短时重试）；键按规范化番号隔离。
 * 复用平台统一 CacheManager（MISC 命名空间）。
 * @module features/listEnhancement/actorPenetration
 */
import { globalCache } from '../../../platform/storage/cache';
import type { DetailActor } from './parseDetailActors';

export interface ActorPenetrationCacheValue {
  actors: DetailActor[];
  hasMore: boolean;
  fetchedAt: number;
}

export type ActorPenetrationCacheResult =
  | { status: 'hit'; value: ActorPenetrationCacheValue }
  | { status: 'failed' }   // 失败短缓存有效期内：抑制重试
  | { status: 'miss' };

const KEY_PREFIX = 'actorPenetration:';
const SUCCESS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
const FAILURE_TTL_MS = 10 * 60 * 1000; // 10 分钟
const FAILURE_SENTINEL = { actors: [] as DetailActor[], hasMore: false, fetchedAt: 0 };

/** 把番号规范化成缓存键（小写、去空白）。 */
export function normalizeCodeKey(code: string): string {
  return code.trim().toLowerCase();
}

/**
 * 读取缓存：
 * - hit：成功结果未过期
 * - failed：失败短缓存有效期内（抑制重试）
 * - miss：无记录或已过期（可发起请求）
 */
export async function readActorPenetrationCache(code: string): Promise<ActorPenetrationCacheResult> {
  const key = KEY_PREFIX + normalizeCodeKey(code);
  const entry = await globalCache.get<{ failed?: boolean } & ActorPenetrationCacheValue>(key).catch(() => null);
  if (!entry) return { status: 'miss' };
  if (entry.failed) return { status: 'failed' };
  return { status: 'hit', value: { actors: entry.actors, hasMore: entry.hasMore, fetchedAt: entry.fetchedAt } };
}

/** 写入成功缓存（7 天 TTL）。 */
export async function writeActorPenetrationSuccess(
  code: string,
  value: ActorPenetrationCacheValue,
): Promise<void> {
  const key = KEY_PREFIX + normalizeCodeKey(code);
  await globalCache.set(key, { ...value }, SUCCESS_TTL_MS).catch(() => undefined);
}

/** 写入失败缓存（10 分钟 TTL），用于抑制失败后的请求风暴。 */
export async function writeActorPenetrationFailure(code: string): Promise<void> {
  const key = KEY_PREFIX + normalizeCodeKey(code);
  await globalCache.set(key, { failed: true, ...FAILURE_SENTINEL }, FAILURE_TTL_MS).catch(() => undefined);
}
