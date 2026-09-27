/**
 * @file actorHiding.ts
 * @description actorHiding
 * @module features/listEnhancement
 */
import type { ActorIndexRecord } from '../../../types';

export type ActorHidingReason = 'ACTOR_BLACKLIST' | 'ACTOR_NOT_FAVORITED' | 'ACTOR_UNRECOGNIZED';

export interface ActorHidingDecisionInput {
  hideByBlacklist: boolean;
  hideByNonFavorited: boolean;
  hideUnrecognized: boolean;
  domActorIds: Set<string>;
  actors: ActorIndexRecord[];
  actorIndexSize: number;
}

export interface ActorHidingDecision {
  reason: ActorHidingReason | null;
  matchedBlack: boolean;
  matchedNonFavorited: boolean;
  matchedUnrecognized: boolean;
  hasAnyFavoritedActor: boolean | null;
}

export function decideActorHiding(input: ActorHidingDecisionInput): ActorHidingDecision {
  const matchedBlack = input.hideByBlacklist && input.actors.some(actor => !!actor.blacklisted);
  const matchedNonFavorited = input.hideByNonFavorited
    ? isNonFavoritedMatch(input)
    : false;
  // 仅当「无任何本地演员记录且 DOM 无演员信息、但演员库非空」时视为未识别；
  // 空演员库（新装/未导入）时不隐藏，避免整列被藏。
  const matchedUnrecognized =
    input.hideUnrecognized &&
    input.actors.length === 0 &&
    input.domActorIds.size === 0 &&
    input.actorIndexSize > 0;

  return {
    reason: matchedBlack
      ? 'ACTOR_BLACKLIST'
      : matchedNonFavorited
        ? 'ACTOR_NOT_FAVORITED'
        : matchedUnrecognized
          ? 'ACTOR_UNRECOGNIZED'
          : null,
    matchedBlack,
    matchedNonFavorited,
    matchedUnrecognized,
    hasAnyFavoritedActor: input.hideByNonFavorited && input.actors.length > 0
      ? hasAnyFavoritedActor(input.actors)
      : null,
  };
}

function isNonFavoritedMatch(input: ActorHidingDecisionInput): boolean {
  // case1：DOM 有演员信息但匹配记录为零（匹配到名字但库无记录 = 未收藏）→ 照藏
  if (input.domActorIds.size > 0 && input.actors.length === 0) {
    return true;
  }

  // case2：有匹配演员 → 隐藏仅当无任何匹配演员处于收藏
  //（favorited 缺省 = 已收藏，显式 false = 未收藏；拉黑与收藏正交，拉黑不改变收藏判定）
  if (input.actors.length > 0) {
    return !hasAnyFavoritedActor(input.actors);
  }

  // case3：无任何演员信息时并入「未识别」语义：须同时满足 hideUnrecognized 且演员库非空
  //（空演员库保护，2026-09-27 真机审计 B2 修复：原实现绕过空库保护）。
  return input.hideUnrecognized && input.actorIndexSize > 0;
}

/**
 * 真收藏判定（09-28-actor-favorited-field）：favorited 缺省 = 已收藏，
 * 显式 false = 未收藏；与 showStatusBadge / backupRange 的 `!== false` 纪律一致。
 * 拉黑（blacklisted）与收藏是两个正交状态，不在此判定内。
 */
function hasAnyFavoritedActor(actors: ActorIndexRecord[]): boolean {
  return actors.some(actor => actor.favorited !== false);
}
