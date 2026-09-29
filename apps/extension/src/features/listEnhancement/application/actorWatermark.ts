/**
 * @file actorWatermark.ts
 * @description actorWatermark
 * @module features/listEnhancement
 */
import type { ActorIndexRecord } from '../../../types';

export interface ActorSubscriptionRecord {
  actorId: string;
}

export interface ActorDataCacheDependencies {
  ttlMs?: number;
  getAllActors: () => Promise<ActorIndexRecord[]>;
  getSubscriptions: () => Promise<ActorSubscriptionRecord[]>;
  logger?: (...args: any[]) => void;
}

export interface ActorDataCache {
  ensureActorIndex: () => Promise<Map<string, ActorIndexRecord>>;
  ensureSubscriptions: () => Promise<Set<string>>;
  getActorById: (id: string) => Promise<ActorIndexRecord | null>;
  /** 同步读取已加载的演员索引（未加载返回 null）。 */
  getActorByIdSync: (id: string) => ActorIndexRecord | null;
  clear: () => void;
}

export interface ActorLookupDependencies {
  getActorById: (id: string) => Promise<ActorIndexRecord | null | undefined>;
}

export interface ActorWatermarkBadgeInput {
  actor: ActorIndexRecord;
  isBlack: boolean;
  isSub: boolean;
}

export interface ActorWatermarkRenderOptions {
  opacity: number;
  position: string;
}

const DEFAULT_CACHE_TTL = 5 * 60 * 1000;
const MAX_DOM_ACTORS = 8;
const MAX_WATERMARK_ACTORS = 6;
const WATERMARK_VISIBLE_BADGES = 4;

export function createActorDataCache(deps: ActorDataCacheDependencies): ActorDataCache {
  let actorIndex: Map<string, ActorIndexRecord> | null = null;
  let actorIdIndex: Map<string, ActorIndexRecord> | null = null;
  let subscribedActorIds: Set<string> | null = null;
  let loadingActorIndex = false;
  let loadingSubscriptions = false;
  let actorIndexTimestamp = 0;
  let subscribedActorIdsTimestamp = 0;
  const ttlMs = deps.ttlMs ?? DEFAULT_CACHE_TTL;

  const logger = (...args: any[]) => deps.logger?.(...args);

  return {
    async ensureActorIndex(): Promise<Map<string, ActorIndexRecord>> {
      const now = Date.now();
      const isCacheExpired = actorIndexTimestamp > 0 && (now - actorIndexTimestamp) > ttlMs;

      if (isCacheExpired) {
        logger('Actor index cache expired, clearing...');
        actorIndex = null;
        actorIndexTimestamp = 0;
      }

      if (loadingActorIndex) {
        await waitFor(() => !loadingActorIndex);
        return actorIndex ?? new Map();
      }

      if (actorIndex) return actorIndex;

      loadingActorIndex = true;
      try {
        const actors = await deps.getAllActors();
        const index = buildActorIndex(actors);
        actorIndex = index;
        actorIdIndex = new Map(actors.map(actor => [actor.id, actor]));
        actorIndexTimestamp = Date.now();
        logger(`Actor index loaded: ${index.size} entries`);
      } catch (error) {
        logger('Failed to build actor index:', error);
        actorIndex = new Map();
        actorIdIndex = new Map();
        actorIndexTimestamp = Date.now();
      } finally {
        loadingActorIndex = false;
      }

      return actorIndex;
    },

    async ensureSubscriptions(): Promise<Set<string>> {
      const now = Date.now();
      const isCacheExpired = subscribedActorIdsTimestamp > 0 && (now - subscribedActorIdsTimestamp) > ttlMs;

      if (isCacheExpired) {
        logger('Subscriptions cache expired, clearing...');
        subscribedActorIds = null;
        subscribedActorIdsTimestamp = 0;
      }

      if (loadingSubscriptions) {
        await waitFor(() => !loadingSubscriptions);
        return subscribedActorIds ?? new Set();
      }

      if (subscribedActorIds) return subscribedActorIds;

      loadingSubscriptions = true;
      try {
        const subs = await deps.getSubscriptions();
        subscribedActorIds = new Set(subs.map(sub => sub.actorId));
        subscribedActorIdsTimestamp = Date.now();
        logger(`Subscriptions loaded: ${subscribedActorIds.size} actors`);
      } catch (error) {
        logger('Failed to load subscriptions:', error);
        subscribedActorIds = new Set();
        subscribedActorIdsTimestamp = Date.now();
      } finally {
        loadingSubscriptions = false;
      }

      return subscribedActorIds;
    },

    async getActorById(id: string): Promise<ActorIndexRecord | null> {
      await this.ensureActorIndex();
      return actorIdIndex?.get(id) ?? null;
    },

    getActorByIdSync(id: string): ActorIndexRecord | null {
      return actorIdIndex?.get(id) ?? null;
    },

    clear(): void {
      logger('Clearing actor caches...');
      actorIndex = null;
      actorIdIndex = null;
      subscribedActorIds = null;
      loadingActorIndex = false;
      loadingSubscriptions = false;
      actorIndexTimestamp = 0;
      subscribedActorIdsTimestamp = 0;
    },
  };
}

/**
 * 演员名标记预热簇（线② Stage B 自 listEnhancementManager 外移，判定与副作用逐字保留）。
 * 预热标记与订阅集合改由本模块私有持有；开关判定与穿透行重放经依赖注入，
 * 禁止反向 import listEnhancementManager（循环依赖）。
 */
export interface ActorNameMarkPrepDependencies {
  actorDataCache: ActorDataCache;
  /** 是否允许重放已渲染的穿透行（原 manager 的 enableActorNameMarks + enableActorPenetration 双门）。 */
  canReapplyRowMarks: () => boolean;
  /** 重放已渲染的穿透行（manager 编排能力回调注入）。 */
  reapplyRowMarks: () => void;
}

export interface ActorNameMarkPrep {
  isPrepped: () => boolean;
  markPrepped: () => void;
  getSubscribedActorIds: () => Set<string>;
  clearActorCaches: () => void;
  warmActorNameMarkData: () => Promise<void>;
  reapplyActorRowMarksIfReady: () => void;
  invalidateActorNameMarkPrep: () => void;
  resetActorNameMarkPrep: () => void;
}

export function createActorNameMarkPrep(
  deps: ActorNameMarkPrepDependencies,
): ActorNameMarkPrep {
  // 名称标识数据是否已预热完成（索引 + 订阅）
  let prepped = false;
  let subscribedActorIds = new Set<string>();

  const resetPrepState = (): void => {
    prepped = false;
    subscribedActorIds = new Set();
  };

  return {
    isPrepped: () => prepped,
    markPrepped: () => {
      prepped = true;
    },
    getSubscribedActorIds: () => subscribedActorIds,
    /**
     * 清除演员相关缓存
     * 在以下情况调用：
     * 1. 翻页前
     * 2. 配置变化时
     * 3. 手动刷新时
     */
    clearActorCaches: () => {
      deps.actorDataCache.clear();
    },
    /**
     * 预热演员名称标识所需的本地数据（演员索引 + 订阅集合）。
     * getActorMark 为同步读取，必须先完成异步加载；完成后重放已渲染的行，
     * 使首帧渲染时标识缺失的卡片补上着色。
     */
    warmActorNameMarkData: async () => {
      try {
        await Promise.all([
          deps.actorDataCache.ensureActorIndex(),
          deps.actorDataCache.ensureSubscriptions(),
        ]);
      } catch {
        subscribedActorIds = new Set();
      }
      try {
        subscribedActorIds = new Set(await deps.actorDataCache.ensureSubscriptions());
      } catch {
        subscribedActorIds = new Set();
      }
    },
    /** 名称标识预热完成/失效后，重放已渲染的穿透行以补全着色。 */
    reapplyActorRowMarksIfReady: () => {
      if (!deps.canReapplyRowMarks()) return;
      deps.reapplyRowMarks();
    },
    /** 演员索引被清除（翻页/刷新）时，若已重放则重置预热标记。 */
    invalidateActorNameMarkPrep: () => {
      if (prepped) {
        resetPrepState();
      }
    },
    /** 名称标识开关翻转时重置预热状态（原 manager 内联的两行赋值）。 */
    resetActorNameMarkPrep: resetPrepState,
  };
}

export function buildActorIndex(actors: ActorIndexRecord[]): Map<string, ActorIndexRecord> {
  const index = new Map<string, ActorIndexRecord>();
  actors.forEach(actor => {
    pushActorIndexKey(index, actor.name, actor);
    (actor.aliases || []).forEach(alias => pushActorIndexKey(index, alias, actor));
  });
  return index;
}

export function extractActorIdsFromListItem(item: HTMLElement): Set<string> {
  const anchors = Array.from(item.querySelectorAll('a[href*="/actors/"]')) as HTMLAnchorElement[];
  const ids = new Set<string>();

  for (const anchor of anchors) {
    const href = anchor.getAttribute('href') || '';
    const match = href.match(/\/actors\/([^\/?#]+)/);
    if (match?.[1]) ids.add(match[1]);
  }

  return ids;
}

export async function extractActorsFromListItem(
  item: HTMLElement,
  deps: ActorLookupDependencies,
): Promise<ActorIndexRecord[]> {
  const ids = extractActorIdsFromListItem(item);
  if (ids.size === 0) {
    return [];
  }

  try {
    const list = await Promise.all(
      Array.from(ids).slice(0, MAX_DOM_ACTORS).map(id => deps.getActorById(id).catch(() => null)),
    );
    return list.filter(Boolean) as ActorIndexRecord[];
  } catch {
    return [];
  }
}

export function renderActorWatermark(
  coverElement: HTMLElement,
  actorBadges: ActorWatermarkBadgeInput[],
  options: ActorWatermarkRenderOptions,
): void {
  coverElement.querySelector('.x-actor-wm')?.remove();

  const actors = actorBadges.slice(0, MAX_WATERMARK_ACTORS);
  if (actors.length === 0) {
    return;
  }

  const computedStyle = window.getComputedStyle(coverElement);
  if (computedStyle.position === 'static') {
    coverElement.style.position = 'relative';
  }

  const watermark = document.createElement('div');
  watermark.className = 'x-actor-wm';
  watermark.style.opacity = String(clamp(options.opacity, 0, 1));
  watermark.classList.add(`pos-${options.position || 'top-right'}`);

  const visible = actors.slice(0, WATERMARK_VISIBLE_BADGES);
  const rest = actors.length - visible.length;

  visible.forEach(input => {
    const badge = document.createElement('span');
    const className = input.isBlack ? 'badge-red' : input.isSub ? 'badge-green' : 'badge-amber';
    badge.className = `x-actor-badge ${className}`;
    badge.textContent = input.isBlack ? '黑' : input.isSub ? '订' : '藏';
    badge.title = `${input.actor.name} ${input.isBlack ? '【黑名单】' : input.isSub ? '【订阅】' : '【收藏】'}`;
    watermark.appendChild(badge);
  });

  if (rest > 0) {
    const more = document.createElement('span');
    more.className = 'x-actor-badge x-actor-more';
    more.textContent = `+${rest}`;
    more.title = actors.slice(WATERMARK_VISIBLE_BADGES).map(input => input.actor.name).join('、');
    watermark.appendChild(more);
  }

  coverElement.appendChild(watermark);
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate() && Date.now() - startedAt < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

function pushActorIndexKey(index: Map<string, ActorIndexRecord>, key: string | undefined, actor: ActorIndexRecord): void {
  const normalized = (key || '').trim().toLowerCase();
  if (!normalized || index.has(normalized)) {
    return;
  }

  index.set(normalized, actor);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
