/**
 * @file subscribedActorIds.ts
 * @description 演员订阅 ID 只读数据源（09-30-popup-actorfilter-subscribed）
 * @module features/listEnhancement
 *
 * 口径（coord 裁决）：
 * - 只统计 enabled === true 的订阅；缺 enabled 字段的存量记录按「未启用」处理
 *   （方向=零命中零误隐：宁可少隐，不误隐）。
 * - content 侧直接读 chrome.storage 的 new_works_subscriptions，惰性读 + 单飞缓存 + TTL。
 *   不走 newWorksManager.getSubscriptions()：其 initialize() 带 isLoaded 短路
 *   （features/newWorks/manager.ts L118-120），内容脚本实例的内存订阅表不会随
 *   其它页面（新作品页/演员页快捷动作）的写入刷新，会把停用订阅算进来。
 * - 该键 storage.onChanged → invalidate()（接线见 listEnhancementManager.initialize）。
 */
import { STORAGE_KEYS } from '../../../utils/config';
import { getValue } from '../../../utils/storage';

/** 订阅集合缓存 TTL（与演员数据缓存同量级，5 分钟）。 */
export const SUBSCRIBED_ACTOR_IDS_TTL_MS = 5 * 60 * 1000;

const EMPTY_ACTOR_IDS: ReadonlySet<string> = new Set<string>();

export interface SubscribedActorIdsSource {
  /** 惰性读取「启用中的订阅」演员 ID 集合；读取失败返回空集合且不缓存（下次重试）。 */
  get(): Promise<ReadonlySet<string>>;
  /** 失效缓存（订阅数据变化时由调用方触发）。 */
  invalidate(): void;
}

export interface SubscribedActorIdsDeps {
  /** 订阅表读取器（storage 键 new_works_subscriptions 的原始值），可注入以便单测。 */
  readSubscriptions?: () => Promise<unknown>;
  ttlMs?: number;
  logger?: (...args: unknown[]) => void;
}

/** 纯函数：从订阅表挑出「启用中」的 actorId（只计 enabled === true，无有效 actorId 的条目丢弃）。 */
export function collectEnabledActorIds(raw: unknown): Set<string> {
  const ids = new Set<string>();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ids;
  for (const value of Object.values(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const sub = value as { actorId?: unknown; enabled?: unknown };
    if (sub.enabled !== true) continue;
    if (typeof sub.actorId !== 'string' || sub.actorId.length === 0) continue;
    ids.add(sub.actorId);
  }
  return ids;
}

export function createSubscribedActorIdsSource(
  deps: SubscribedActorIdsDeps = {},
): SubscribedActorIdsSource {
  const read = deps.readSubscriptions ??
    (() => getValue<Record<string, unknown>>(STORAGE_KEYS.NEW_WORKS_SUBSCRIPTIONS, {}));
  const ttlMs = deps.ttlMs ?? SUBSCRIBED_ACTOR_IDS_TTL_MS;
  const logger = deps.logger;

  let cached: ReadonlySet<string> | null = null;
  let cachedAt = 0;
  let pending: Promise<ReadonlySet<string>> | null = null;

  return {
    async get(): Promise<ReadonlySet<string>> {
      const now = Date.now();
      if (cached && cachedAt > 0 && now - cachedAt > ttlMs) {
        logger?.('subscribedActorIds: 订阅缓存过期，重读');
        cached = null;
        cachedAt = 0;
      }
      if (cached) return cached;
      // 单飞：并发卡片请求共用同一次 storage 读
      if (pending) return pending;

      pending = (async () => {
        try {
          const raw = await read();
          const ids = collectEnabledActorIds(raw);
          cached = ids;
          cachedAt = Date.now();
          logger?.(`subscribedActorIds: 已加载启用中的订阅 ${ids.size} 个`);
          return ids;
        } catch (error) {
          // 读取失败按空集合处理（零命中零误隐），且不写缓存，等待下次调用重试
          logger?.('subscribedActorIds: 读取订阅数据失败，本次按空集合处理', error);
          return EMPTY_ACTOR_IDS;
        } finally {
          pending = null;
        }
      })();

      return pending;
    },

    invalidate(): void {
      cached = null;
      cachedAt = 0;
    },
  };
}

/** content 侧默认单例（演员隐藏链共用同一份缓存）。 */
export const subscribedActorIdsSource = createSubscribedActorIdsSource();
