/**
 * @file actorHiding.ts
 * @description actorHiding
 * @module features/listEnhancement
 */
import type { ActorRecord } from '../../../types';

export type ActorHidingReason = 'ACTOR_BLACKLIST' | 'ACTOR_NOT_FAVORITED' | 'ACTOR_UNRECOGNIZED';

export interface ActorHidingDecisionInput {
  hideByBlacklist: boolean;
  hideByNonFavorited: boolean;
  hideUnrecognized: boolean;
  treatSubscribedAsFavorited: boolean;
  domActorIds: Set<string>;
  actors: ActorRecord[];
  subscribedActorIds: Set<string>;
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
      ? hasAnyFavoritedActor(input.actors, input.treatSubscribedAsFavorited, input.subscribedActorIds)
      : null,
  };
}

function isNonFavoritedMatch(input: ActorHidingDecisionInput): boolean {
  if (input.domActorIds.size > 0 && input.actors.length === 0) {
    return true;
  }

  if (input.actors.length > 0) {
    return !hasAnyFavoritedActor(input.actors, input.treatSubscribedAsFavorited, input.subscribedActorIds);
  }

  return input.hideUnrecognized;
}

function hasAnyFavoritedActor(
  actors: ActorRecord[],
  treatSubscribedAsFavorited: boolean,
  subscribedActorIds: Set<string>,
): boolean {
  return actors.some(actor => {
    if (actor.blacklisted) {
      return false;
    }

    const isFavorited = true;
    const isSubscribed = treatSubscribedAsFavorited && subscribedActorIds.has(actor.id);
    return isFavorited || isSubscribed;
  });
}
