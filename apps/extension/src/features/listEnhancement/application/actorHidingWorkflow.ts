/**
 * @file actorHidingWorkflow.ts
 * @description actorHidingWorkflow
 * @module features/listEnhancement
 */
import type { ActorRecord } from '../../../types';
import {
  decideActorHiding,
  type ActorHidingReason,
} from './actorHiding';
import {
  matchActorsFromTitle,
} from './actorMatching';
import {
  extractActorIdsFromListItem,
  extractActorsFromListItem,
} from './actorWatermark';

export interface ActorHidingWorkflowVideoInfo {
  code: string;
  title: string;
  url: string;
}

export interface ApplyActorBasedHidingOptions {
  item: HTMLElement;
  videoInfo: ActorHidingWorkflowVideoInfo;
  hideByBlacklist: boolean;
  hideByNonFavorited: boolean;
  hideUnrecognized: boolean;
  treatSubscribedAsFavorited: boolean;
  ensureActorIndex: () => Promise<Map<string, ActorRecord>>;
  ensureSubscriptions: () => Promise<Set<string>>;
  getActorById: (id: string) => Promise<ActorRecord | null | undefined>;
  hideItemByActor: (item: HTMLElement, reason: ActorHidingReason) => void;
  clearActorOnlyHiding: (item: HTMLElement) => void;
  logger?: (...args: any[]) => void;
  verbose?: boolean;
}

export async function applyActorBasedHiding(options: ApplyActorBasedHidingOptions): Promise<void> {
  const {
    item,
    videoInfo,
    hideByBlacklist,
    hideByNonFavorited,
    hideUnrecognized,
    treatSubscribedAsFavorited,
    logger,
    verbose = false,
  } = options;
  const debugLog = (...args: any[]): void => {
    if (verbose) logger?.(...args);
  };

  try {
    debugLog(`[ActorHiding] ${videoInfo.code}: hideByBlacklist=${hideByBlacklist}, hideByNonFavorited=${hideByNonFavorited}, hideUnrecognized=${hideUnrecognized}`);

    if (!hideByBlacklist && !hideByNonFavorited) {
      options.clearActorOnlyHiding(item);
      return;
    }

    const [actorIndex, subscribed] = await Promise.all([
      options.ensureActorIndex(),
      options.ensureSubscriptions(),
    ]);

    const allActorIds = extractActorIdsFromListItem(item);
    debugLog(`[ActorHiding] ${videoInfo.code}: Found ${allActorIds.size} actor IDs in DOM: ${Array.from(allActorIds).join(', ')}`);

    let actorRecords: ActorRecord[] = [];
    if (allActorIds.size > 0) {
      try {
        actorRecords = await extractActorsFromListItem(item, {
          getActorById: options.getActorById,
        });
        debugLog(`[ActorHiding] ${videoInfo.code}: Found ${actorRecords.length} actors in local DB: ${actorRecords.map(a => `${a.name}(${a.id})`).join(', ')}`);
      } catch (error) {
        logger?.(`[ActorHiding] ${videoInfo.code}: Failed to fetch actor records:`, error);
      }
    }

    let actors = actorRecords;
    if (actors.length === 0 && allActorIds.size === 0) {
      actors = matchActorsFromTitle(videoInfo.title, actorIndex);
      debugLog(`[ActorHiding] ${videoInfo.code}: Extracted ${actors.length} actors from title`);
    }

    const decision = decideActorHiding({
      hideByBlacklist,
      hideByNonFavorited,
      hideUnrecognized,
      treatSubscribedAsFavorited,
      domActorIds: allActorIds,
      actors,
      subscribedActorIds: subscribed,
    });

    debugLog(`[ActorHiding] ${videoInfo.code}: Final decision - matchedBlack=${decision.matchedBlack}, matchedNonFav=${decision.matchedNonFavorited}, reason=${decision.reason || 'none'}`);

    if (decision.reason) {
      options.hideItemByActor(item, decision.reason);
      debugLog(`[ActorHiding] ${videoInfo.code}: Hidden by ${decision.reason}`);
      return;
    }

    options.clearActorOnlyHiding(item);
    debugLog(`[ActorHiding] ${videoInfo.code}: Not hidden, clearing actor-only hiding`);
  } catch (error) {
    logger?.('applyActorBasedHiding failed:', error);
  }
}

export function hideListItemByActor(item: HTMLElement, reason: ActorHidingReason): void {
  item.style.display = 'none';
  item.setAttribute('data-hidden-by-default', 'true');
  item.setAttribute('data-hidden-by-actor', 'true');
  item.setAttribute('data-hide-reason-actor', reason);
}

export function clearListItemActorHiding(item: HTMLElement): void {
  const hadActorHidden = item.hasAttribute('data-hidden-by-actor');
  if (!hadActorHidden) return;

  item.removeAttribute('data-hidden-by-actor');
  item.removeAttribute('data-hide-reason-actor');

  const hasOtherReason = item.hasAttribute('data-hide-reason');
  if (!hasOtherReason) {
    item.style.display = '';
    item.removeAttribute('data-hidden-by-default');
  }
}
