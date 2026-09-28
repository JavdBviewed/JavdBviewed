/**
 * @file actorHidingWorkflow.ts
 * @description actorHidingWorkflow
 * @module features/listEnhancement
 */
import type { ActorIndexRecord } from '../../../types';
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
import {
  recomputeListHiding,
  setHidingSource,
  readListHidingEnablement,
} from '../../list-hiding';
import { STATE } from '../../contentState';

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
  ensureActorIndex: () => Promise<Map<string, ActorIndexRecord>>;
  getActorById: (id: string) => Promise<ActorIndexRecord | null | undefined>;
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
    logger,
    verbose = false,
  } = options;
  const debugLog = (...args: any[]): void => {
    if (verbose) logger?.(...args);
  };

  try {
    debugLog(`[ActorHiding] ${videoInfo.code}: hideByBlacklist=${hideByBlacklist}, hideByNonFavorited=${hideByNonFavorited}, hideUnrecognized=${hideUnrecognized}`);

    if (!hideByBlacklist && !hideByNonFavorited && !hideUnrecognized) {
      options.clearActorOnlyHiding(item);
      return;
    }

    const actorIndex = await options.ensureActorIndex();

    const allActorIds = extractActorIdsFromListItem(item);
    debugLog(`[ActorHiding] ${videoInfo.code}: Found ${allActorIds.size} actor IDs in DOM: ${Array.from(allActorIds).join(', ')}`);

    let actorRecords: ActorIndexRecord[] = [];
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
      domActorIds: allActorIds,
      actors,
      actorIndexSize: actorIndex.size,
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
  // 仅打“来源”标记，真正的显隐由 recomputeListHiding 依据演员隐藏开关裁定。
  // 保留 data-hidden-by-actor / data-hide-reason-actor 供兼容检测。
  item.setAttribute('data-hidden-by-actor', 'true');
  item.setAttribute('data-hide-reason-actor', reason);
  setHidingSource(item, 'actor', true);
  recomputeListHiding(item, readListHidingEnablement(STATE.settings));
}

export function clearListItemActorHiding(item: HTMLElement): void {
  const hadActorHidden = item.hasAttribute('data-hidden-by-actor');
  if (!hadActorHidden) return;

  item.removeAttribute('data-hidden-by-actor');
  item.removeAttribute('data-hide-reason-actor');
  setHidingSource(item, 'actor', false);

  // 重算显隐，其它来源（状态/VR）标记若仍命中开关会继续隐藏。
  recomputeListHiding(item, readListHidingEnablement(STATE.settings));
}

/**
 * 类别黑名单命中：打「来源」标记（与 hideListItemByActor 对称）。
 * display:none 与 data-hide-reason（值含 CATEGORY_BLACKLIST）由 recomputeListHiding
 * 依据隐藏开关统一裁定；保留 data-hidden-by-category 供兼容检测。
 */
export function hideListItemByCategory(item: HTMLElement): void {
  item.setAttribute('data-hidden-by-category', 'true');
  setHidingSource(item, 'category', true);
  recomputeListHiding(item, readListHidingEnablement(STATE.settings));
}

/** 清除类别隐藏来源标记并重算显隐（其它来源标记若仍命中开关会继续隐藏）。 */
export function clearListItemCategoryHiding(item: HTMLElement): void {
  const hadCategoryHidden = item.hasAttribute('data-hidden-by-category');
  if (!hadCategoryHidden) return;

  item.removeAttribute('data-hidden-by-category');
  setHidingSource(item, 'category', false);

  recomputeListHiding(item, readListHidingEnablement(STATE.settings));
}
