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
  /**
   * 详情页解析出的影片类别 entryKey 列表（'c4=17' 形式，字典内条目）。
   * 可选：旧缓存无此字段 → undefined，消费方（类别黑名单过滤）不得触发隐藏（兼容）。
   */
  categories?: string[];
}

export type ActorPenetrationCacheResult =
  | { status: 'hit'; value: ActorPenetrationCacheValue }
  | { status: 'failed'; loginRequired?: boolean }   // 失败短缓存有效期内：抑制重试
  | { status: 'miss' };

const KEY_PREFIX = 'actorPenetration:';
const SUCCESS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
const FAILURE_TTL_MS = 10 * 60 * 1000; // 10 分钟
// 「需登录」独立状态（09-26-display-settings-audit B7）：登录受限番 302→登录页，
// 与网络失败分开标记，避免真实状态被混淆；TTL 取 1 小时——比 10 分钟抑制
// 请求风暴，又不至于用户登录后长期看不到穿透行。
const LOGIN_REQUIRED_TTL_MS = 60 * 60 * 1000; // 1 小时
const FAILURE_SENTINEL = { actors: [] as DetailActor[], hasMore: false, fetchedAt: 0 };

/** 把番号规范化成缓存键（小写、去空白）。 */
export function normalizeCodeKey(code: string): string {
  return code.trim().toLowerCase();
}

/**
 * 读取缓存：
 * - hit：成功结果未过期
 * - failed：失败短缓存有效期内（抑制重试）；loginRequired 标记「需登录」独立状态
 * - miss：无记录或已过期（可发起请求）
 */
export async function readActorPenetrationCache(code: string): Promise<ActorPenetrationCacheResult> {
  const key = KEY_PREFIX + normalizeCodeKey(code);
  const entry = await globalCache.get<{ failed?: boolean; loginRequired?: boolean } & ActorPenetrationCacheValue>(key).catch(() => null);
  if (!entry) return { status: 'miss' };
  if (entry.failed) return { status: 'failed', loginRequired: entry.loginRequired === true };
  // categories 仅接受 string[] 形态；旧缓存无此字段或脏数据 → undefined（消费方不触发类别隐藏）。
  const categories = Array.isArray(entry.categories) ? entry.categories : undefined;
  return { status: 'hit', value: { actors: entry.actors, hasMore: entry.hasMore, fetchedAt: entry.fetchedAt, categories } };
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

/** 写入「需登录」缓存（1 小时 TTL）：详情 302 到登录页的独立状态，不与网络失败混用。 */
export async function writeActorPenetrationLoginRequired(code: string): Promise<void> {
  const key = KEY_PREFIX + normalizeCodeKey(code);
  await globalCache.set(key, { failed: true, loginRequired: true, ...FAILURE_SENTINEL }, LOGIN_REQUIRED_TTL_MS).catch(() => undefined);
}
