/**
 * @file actorMarks.ts
 * @description 演员名称标识（列表穿透卡片用）。
 * 与影片页 markActorsOnPage 同一套判定：
 * - 黑名单（blacklisted = true）→ 红色 + 删除线
 * - 已收藏（本地演员库存在记录）→ 绿色
 * - 已订阅（订阅列表包含该演员）→ 追加 🔔 标记
 * 任一状态命中即返回对应 ActorLinkMark；全部未命中返回 undefined（名称保持默认）。
 * 判定为纯函数：输入演员记录与订阅集合，输出标识（或 undefined），不触碰 DOM、不读 chrome。
 * @module features/listEnhancement/actorPenetration
 */
import type { ActorRecord } from '../../../types';
import type { ActorLinkMark } from './renderActorRow';

export interface ActorMarkLookup {
  /** 按 id 查本地演员记录（不存在返回 null）。 */
  getActorById: (id: string) => Promise<ActorRecord | null | undefined>;
  /** 已订阅的演员 id 集合。 */
  subscribedActorIds: Set<string>;
}

/**
 * 计算单个演员的名称标识。
 * 优先级：黑名单 > 已收藏 > 已订阅（订阅可叠加在收藏上）。
 * @param actorId 演员 id（来自详情解析的 /actors/:id）
 * @param record  本地演员记录（可能为 null）
 * @param lookup  查询上下文（订阅集合；getActorById 仅供扩展，这里直接用 record）
 */
export function resolveActorLinkMark(
  actorId: string,
  record: ActorRecord | null | undefined,
  lookup: Pick<ActorMarkLookup, 'subscribedActorIds'>,
): ActorLinkMark | undefined {
  const isBlacklisted = record?.blacklisted === true;
  const isCollected = !!record;
  const isSubscribed = lookup.subscribedActorIds.has(actorId);

  if (!isCollected && !isSubscribed) return undefined;

  if (isBlacklisted) {
    return { status: 'blacklisted', title: '黑名单' };
  }
  if (isCollected) {
    return {
      status: 'collected',
      title: isSubscribed ? '已收藏 · 已订阅' : '已收藏',
    };
  }
  return { status: 'subscribed', title: '已订阅' };
}

/**
 * 为一个演员解析名称标识（查询本地记录 + 订阅）。
 * 任何异常都回退为 undefined，不抛错、不阻断列表交互。
 */
export async function resolveActorMarkFor(
  actorId: string,
  lookup: ActorMarkLookup,
): Promise<ActorLinkMark | undefined> {
  if (!actorId) return undefined;
  let record: ActorRecord | null | undefined;
  try {
    record = await lookup.getActorById(actorId);
  } catch {
    return undefined;
  }
  return resolveActorLinkMark(actorId, record, lookup);
}
