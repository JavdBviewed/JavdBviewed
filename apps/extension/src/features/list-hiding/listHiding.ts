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
export type ListHidingSource = 'viewed' | 'browsed' | 'want' | 'vr' | 'actor';

/** 来源 → data-hide-reason 的取值（保持与旧标记一致）。 */
export const LIST_HIDE_REASON_BY_SOURCE: Record<ListHidingSource, string> = {
  viewed: 'VIEWED',
  browsed: 'BROWSED',
  want: 'WANT',
  vr: 'VR',
  actor: 'ACTOR',
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
}

/** 返回某卡片当前所有隐藏来源标记。 */
export function getActiveHidingSources(item: HTMLElement): ListHidingSource[] {
  const found: ListHidingSource[] = [];
  for (const source of ['viewed', 'browsed', 'want', 'vr', 'actor'] as ListHidingSource[]) {
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
  for (const source of ['viewed', 'browsed', 'want', 'vr', 'actor'] as ListHidingSource[]) {
    item.removeAttribute(`${LIST_HIDE_SRC_ATTR}-${source}`);
  }
}

/**
 * 从当前全局设置读取隐藏开关。
 * 状态/VR 开关位于 settings.display，演员开关位于 settings.listEnhancement。
 */
export function readListHidingEnablement(settings: unknown): ListHidingEnablement {
  const s = (settings || {}) as {
    display?: { hideViewed?: boolean; hideBrowsed?: boolean; hideWant?: boolean; hideVR?: boolean };
    listEnhancement?: {
      hideBlacklistedActorsInList?: boolean;
      hideNonFavoritedActorsInList?: boolean;
      hideUnrecognizedActorsInList?: boolean;
    };
  };
  const actor = !!(
    s.listEnhancement?.hideBlacklistedActorsInList ||
    s.listEnhancement?.hideNonFavoritedActorsInList ||
    s.listEnhancement?.hideUnrecognizedActorsInList
  );
  return {
    viewed: !!s.display?.hideViewed,
    browsed: !!s.display?.hideBrowsed,
    want: !!s.display?.hideWant,
    vr: !!s.display?.hideVR,
    actor,
  };
}
