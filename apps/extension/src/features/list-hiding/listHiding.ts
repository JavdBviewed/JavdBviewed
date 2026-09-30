/**
 * @file listHiding.ts
 * @description 列表卡片隐藏的共享标记工具。
 *
 * 历史上“隐藏影片”分散在三个模块里，且部分动作没有用户开关：
 * - 状态隐藏（已看/想看/已浏览）：itemProcessor
 * - VR 隐藏：itemProcessor
 * - 演员过滤（黑名单/未收藏/未识别）：listEnhancementManager
 * - 关键字过滤规则（hide 动作）：contentFilterManager
 *
 * 本模块把这些动作统一抽象成「隐藏来源标记」：
 * 每个来源在卡片上打一个 data-hide-src-* 属性，
 * 重算函数根据「来源属性 ∩ 当前启用开关」决定最终显隐，
 * 从而让每一个隐藏动作都拥有独立开关，且开关切换可即时生效。
 *
 * @module features/list-hiding
 */

/** 隐藏来源标记属性前缀。完整属性名为 `data-hide-src-${source}`。 */
export const LIST_HIDE_SRC_ATTR = 'data-hide-src';

/** 默认隐藏属性（保留兼容旧逻辑与外部检测）。 */
export const LIST_HIDE_DEFAULT_ATTR = 'data-hidden-by-default';

/** 隐藏来源标识。 */
export type ListHidingSource =
  | 'viewed'
  | 'browsed'
  | 'want'
  | 'vr'
  | 'actor'
  | 'category'
  | 'mediaLibrary'
  | 'realWatched';

/** 影片类别过滤三态（09-29-contentfilter-category-merge）：off=不过滤 / whitelist=仅保留所选 / blacklist=命中隐藏。 */
export type CategoryFilterMode = 'off' | 'whitelist' | 'blacklist';

/**
 * 解析类别过滤 mode（读时旧键迁移，09-29）：
 * 显式合法 mode 优先；categoryFilter.mode 缺失时按旧键 enableCategoryFilter 迁移
 * （true→blacklist，否则 off）。
 * （09-29-cftabs：三态已下线，本函数仅保留迁移辅助角色——
 * 新口径为 resolveCategoryFilterEnabled / migrateCategoryFilterState，
 * 设置页模型与列表运行时统一走新函数。）
 */
export function resolveCategoryFilterMode(
  le: {
    enableCategoryFilter?: unknown;
    categoryFilter?: { mode?: unknown };
  } | null | undefined,
): CategoryFilterMode {
  const mode = le?.categoryFilter?.mode;
  if (mode === 'off' || mode === 'whitelist' || mode === 'blacklist') return mode;
  return le?.enableCategoryFilter === true ? 'blacklist' : 'off';
}

/**
 * 读时解析类别过滤启用态（09-29-cftabs：三态循环下线 → 普通总开关 + 每类别独立勾选）。
 * 显式 categoryFilter.enabled 布尔优先；缺失时按旧三态 mode 迁移（blacklist→true，whitelist/off→false）。
 * 所有读取点（设置页模型 / 列表运行时 / 隐藏 backstop）共用此口径；存量数据零回填。
 */
export function resolveCategoryFilterEnabled(
  le: {
    enableCategoryFilter?: unknown;
    categoryFilter?: { enabled?: unknown; mode?: unknown };
  } | null | undefined,
): boolean {
  return migrateCategoryFilterState(le).enabled;
}

/**
 * 类别过滤读时旧数据迁移（09-29-cftabs）：返回 { enabled, black }（black=勾选要隐藏的类别集合）。
 * - 显式 enabled 布尔 → 照用，black 原样保留；
 * - 无 enabled，按 mode 迁移：
 *   - blacklist → enabled=true，black 保留（语义一致：命中=隐藏）；
 *   - whitelist → enabled=false，black 清空（「仅保留所选」语义无法无损映射到「命中隐藏」，
 *     重置为关并需用户重新勾选——用户可见行为变化，09-29-cftabs 裁决）；
 *   - off / 旧键 false / 缺失 → enabled=false，black 保留（与旧「mode off 集合保留」语义一致）。
 * 零回填：本函数不改存储，读时迁移结果在下次保存落盘。
 */
export function migrateCategoryFilterState(
  le: {
    enableCategoryFilter?: unknown;
    categoryFilter?: { enabled?: unknown; mode?: unknown; black?: unknown };
  } | null | undefined,
): { enabled: boolean; black: string[] } {
  const cf = le?.categoryFilter;
  const black = Array.isArray(cf?.black)
    ? (cf!.black as unknown[]).filter((k): k is string => typeof k === 'string')
    : [];
  const explicit = cf?.enabled;
  if (typeof explicit === 'boolean') return { enabled: explicit, black };
  const mode = resolveCategoryFilterMode(le);
  if (mode === 'whitelist') return { enabled: false, black: [] };
  return { enabled: mode === 'blacklist', black };
}

/** 来源 → data-hide-reason 的取值（保持与旧标记一致）。 */
export const LIST_HIDE_REASON_BY_SOURCE: Record<ListHidingSource, string> = {
  viewed: 'VIEWED',
  browsed: 'BROWSED',
  want: 'WANT',
  vr: 'VR',
  actor: 'ACTOR',
  category: 'CATEGORY_BLACKLIST',
  mediaLibrary: 'MEDIA_LIBRARY',
  realWatched: 'REAL_WATCHED',
};

/**
 * 隐藏开关的读取器。
 * key 为 ListHidingSource，返回该来源当前是否启用隐藏。
 * 由调用方根据 STATE.settings 提供，便于测试与解耦。
 */
export interface ListHidingEnablement {
  viewed: boolean;
  browsed: boolean;
  want: boolean;
  vr: boolean;
  actor: boolean;
  /** 类别过滤隐藏：总开关开且勾选集合非空且演员穿透开（09-29-cftabs；三态共同前提语义不变）。 */
  category: boolean;
  /** 媒体库已入库隐藏（display.hideInMediaLibrary：Emby/JF 索引或 115 网盘索引任一命中，09-30-media-library-hide-filter）。 */
  mediaLibrary: boolean;
  /** 真实已看隐藏（display.hideRealWatched：Emby/JF 进度达阈值或已标记看完；与 mediaLibrary 共用索引数据）。 */
  realWatched: boolean;
}

/** 返回某卡片当前所有隐藏来源标记。 */
export function getActiveHidingSources(item: HTMLElement): ListHidingSource[] {
  const found: ListHidingSource[] = [];
  for (const source of ['viewed', 'browsed', 'want', 'vr', 'actor', 'category', 'mediaLibrary', 'realWatched'] as ListHidingSource[]) {
    if (item.hasAttribute(`${LIST_HIDE_SRC_ATTR}-${source}`)) {
      found.push(source);
    }
  }
  return found;
}

/** 设置某个隐藏来源标记（value 为 true 添加，false 移除）。 */
export function setHidingSource(item: HTMLElement, source: ListHidingSource, value: boolean): void {
  if (value) {
    item.setAttribute(`${LIST_HIDE_SRC_ATTR}-${source}`, 'true');
  } else {
    item.removeAttribute(`${LIST_HIDE_SRC_ATTR}-${source}`);
  }
}

/**
 * 计算当前应生效的隐藏来源：来源标记 ∩ 启用开关。
 * 注意：只有「来源已标记」且「该来源开关开启」才会真正隐藏。
 */
export function computeEffectiveHiding(
  item: HTMLElement,
  enablement: ListHidingEnablement,
): ListHidingSource[] {
  return getActiveHidingSources(item).filter(source => enablement[source]);
}

/**
 * 根据当前来源标记与开关，重算卡片显隐并同步默认隐藏属性。
 * 返回本次生效的隐藏来源列表（可能为空）。
 */
export function recomputeListHiding(
  item: HTMLElement,
  enablement: ListHidingEnablement,
): ListHidingSource[] {
  const effective = computeEffectiveHiding(item, enablement);

  if (effective.length > 0) {
    item.style.display = 'none';
    item.setAttribute(LIST_HIDE_DEFAULT_ATTR, 'true');
    item.setAttribute('data-hide-reason', effective.map(source => LIST_HIDE_REASON_BY_SOURCE[source]).join(','));
  } else {
    item.style.display = '';
    item.removeAttribute(LIST_HIDE_DEFAULT_ATTR);
    item.removeAttribute('data-hide-reason');
  }

  return effective;
}

/** 清除某卡片上所有隐藏来源标记（不改变显隐，由调用方决定是否重算）。 */
export function clearHidingSources(item: HTMLElement): void {
  for (const source of ['viewed', 'browsed', 'want', 'vr', 'actor', 'category', 'mediaLibrary', 'realWatched'] as ListHidingSource[]) {
    item.removeAttribute(`${LIST_HIDE_SRC_ATTR}-${source}`);
  }
}

/**
 * 从当前全局设置读取隐藏开关。
 * 状态/VR 开关位于 settings.display，演员开关位于 settings.listEnhancement。
 */
export function readListHidingEnablement(settings: unknown): ListHidingEnablement {
  const s = (settings || {}) as {
    display?: {
      hideViewed?: boolean;
      hideBrowsed?: boolean;
      hideWant?: boolean;
      hideVR?: boolean;
      hideInMediaLibrary?: boolean;
      hideRealWatched?: boolean;
    };
    listEnhancement?: {
      hideBlacklistedActorsInList?: boolean;
      hideNonFavoritedActorsInList?: boolean;
      hideUnrecognizedActorsInList?: boolean;
      enableActorPenetration?: boolean;
      enableCategoryFilter?: boolean;
      categoryFilter?: { black?: unknown; enabled?: unknown; mode?: unknown };
    };
  };
  const actor = !!(
    s.listEnhancement?.hideBlacklistedActorsInList ||
    s.listEnhancement?.hideNonFavoritedActorsInList ||
    s.listEnhancement?.hideUnrecognizedActorsInList
  );
  const categoryBlack = Array.isArray(s.listEnhancement?.categoryFilter?.black)
    ? s.listEnhancement!.categoryFilter!.black
    : [];
  // 09-29-cftabs：三态下线 → 总开关；enabled 缺失时按旧三态迁移（blacklist→开，whitelist/off→关）；
  // 共同前提=演员穿透开（与 manager.isCategoryFilterActive 对齐，
  // 穿透关时 backstop 不再兜住残留类别标记）。
  const category =
    resolveCategoryFilterEnabled(s.listEnhancement) &&
    categoryBlack.length > 0 &&
    s.listEnhancement?.enableActorPenetration === true;
  return {
    viewed: !!s.display?.hideViewed,
    browsed: !!s.display?.hideBrowsed,
    want: !!s.display?.hideWant,
    vr: !!s.display?.hideVR,
    actor,
    category,
    // 09-30-media-library-hide-filter：媒体库来源读 display.*（零回填，缺省 false）
    mediaLibrary: !!s.display?.hideInMediaLibrary,
    realWatched: !!s.display?.hideRealWatched,
  };
}

/**
 * 判断是否处于「状态聚合页」（想看/已看列表）。
 * 这些页面强制显示全部卡片，不应用任何内置隐藏来源（含类别黑名单）。
 */
export function isStatusAggregatePage(pathname: string): boolean {
  return pathname.startsWith('/users/want_watch_videos') || pathname.startsWith('/users/watched_videos');
}

/**
 * 当前页面是否豁免类别黑名单隐藏（搜索页 / 状态聚合页）。
 * 与状态隐藏的页面范围一致（08-29-actor-passthrough-category-filter design：
 * 「搜索页、/users/want_watch_videos、/users/watched_videos 不执行」）。
 */
export function isCategoryFilterExemptPage(pathname: string, isSearchPage: boolean): boolean {
  return isSearchPage || isStatusAggregatePage(pathname);
}
