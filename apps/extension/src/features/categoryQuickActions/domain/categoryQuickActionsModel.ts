/**
 * @file categoryQuickActionsModel.ts
 * @description 类别快捷操作的纯逻辑层（viewmodel + 集合读写 + 生效前提判定）。
 * 全部为纯函数，不触 DOM、不触 chrome API，供 unit 段直接断言（09-30-video-category-quick-actions）。
 *
 * 两个动作（coord 裁决：只做排除类，白名单/订阅类不做）：
 *  1. 屏蔽（列表页）= entryKey 写入 settings.listEnhancement.categoryFilter.black（去重）；
 *     生效前提 = 类别过滤总开关开 + 演员穿透开（口径复刻 listEnhancementManager.isCategoryFilterActive，
 *     运行时链零改动，红线）。前提不满足**仍写入**（记录用户意图）+ toast 提示暂不生效。
 *  2. 新作品不入库 = entryKey 写入 storage 键 new_works_config 的 filters.categoryBlackFilters（去重），
 *     下次扫描生效、无依赖前提。
 * 按钮 toggle 态：已在集合 → 翻「取消屏蔽」/「恢复入库」，点击移除。
 * @module features/categoryQuickActions/domain
 */
import type { NewWorksGlobalConfig } from '../../../types';
import { normalizeCategoryBlackValues } from '../../newWorks/categoryFilter';

/** 列表页类别过滤配置（只声明本文件用到的字段，避免与 listEnhancement 类型耦合）。 */
export interface ListCategoryFilterShape {
  enabled?: boolean;
  black?: string[];
}

/** 快捷动作所需的最小配置视图。 */
export interface CategoryQuickActionContext {
  /** settings.listEnhancement.categoryFilter */
  categoryFilter?: ListCategoryFilterShape;
  /** 旧键：categoryFilter.enabled 缺失时回退 */
  enableCategoryFilter?: boolean;
  /** 演员穿透（类别过滤的依赖前提） */
  enableActorPenetration?: boolean;
}

/**
 * 类别过滤总开关（复刻 listEnhancementManager.categoryFilterEnabledOf 口径：
 * 显式 categoryFilter.enabled 优先，缺失回退旧键 enableCategoryFilter === true）。
 * ★ listEnhancementManager 运行时链零改动，本函数只是 content 侧写前提示用的平行判定。
 */
export function categoryFilterEnabledOf(ctx: CategoryQuickActionContext | null | undefined): boolean {
  const explicit = ctx?.categoryFilter?.enabled;
  if (typeof explicit === 'boolean') return explicit;
  return ctx?.enableCategoryFilter === true;
}

/**
 * 类别过滤是否处于激活态（复刻 listEnhancementManager.isCategoryFilterActive 三条口径：
 * 总开关开 + 集合非空 + 演员穿透开）。
 */
export function isCategoryFilterActive(ctx: CategoryQuickActionContext | null | undefined): boolean {
  if (!ctx) return false;
  const black = Array.isArray(ctx.categoryFilter?.black) ? ctx.categoryFilter!.black : [];
  return categoryFilterEnabledOf(ctx) && black.length > 0 && ctx.enableActorPenetration === true;
}

/** entryKey 是否已在集合内（两侧集合都按字典归一，容忍 legacy 裸 id / t 码混存）。 */
export function containsEntryKey(values: readonly string[] | null | undefined, key: string): boolean {
  const { keys } = normalizeCategoryBlackValues(Array.isArray(values) ? values : []);
  return keys.has(key);
}

/** 加入集合（去重；保持既有顺序，新值追加尾部）。 */
export function addEntryKey(values: readonly string[] | null | undefined, key: string): string[] {
  const base = (Array.isArray(values) ? values : []).filter((v): v is string => typeof v === 'string');
  return containsEntryKey(base, key) ? base.slice() : [...base, key];
}

/** 移出集合（按字典归一后比较，裸 id 与 entryKey 同值也能删净）。 */
export function removeEntryKey(values: readonly string[] | null | undefined, key: string): string[] {
  const base = (Array.isArray(values) ? values : []).filter((v): v is string => typeof v === 'string');
  if (!containsEntryKey(base, key)) return base.slice();
  return base.filter(v => {
    const { keys } = normalizeCategoryBlackValues([v]);
    return !keys.has(key);
  });
}

// ── 动作按钮 viewmodel（面板渲染唯一入口；manager 只负责建 DOM） ──────────────

export type CategoryQuickActionId = 'listBlock' | 'newWorksBlock';

/** 单个按钮的渲染与语义描述。 */
export interface CategoryQuickActionSpec {
  id: CategoryQuickActionId;
  /** 未激活态文案 */
  idleText: string;
  /** 已激活（值已在集合中）态文案 */
  activeText: string;
  /** 图标（未激活 / 已激活） */
  idleIcon: string;
  activeIcon: string;
  /** 按钮状态类后缀（CSS 命名空间由 manager 拼接，x-category-quick-*） */
  stateClass: (active: boolean) => string;
  /** 点击语义：true=写入集合，false=移出集合 */
  enable: (active: boolean) => boolean;
  /** 成功后的 toast 文案（列表侧需附前提提示，由调用方补） */
  successText: (enable: boolean) => string;
}

export const CATEGORY_QUICK_ACTION_SPECS: Readonly<Record<CategoryQuickActionId, CategoryQuickActionSpec>> = {
  listBlock: {
    id: 'listBlock',
    idleText: '屏蔽（列表页）',
    activeText: '取消屏蔽',
    idleIcon: '🚫',
    activeIcon: '✅',
    stateClass: (active) => (active ? 'blocked' : ''),
    enable: (active) => !active,
    successText: (enable) => (enable ? '该类别已加入列表页隐藏集' : '该类别已从列表页隐藏集移除'),
  },
  newWorksBlock: {
    id: 'newWorksBlock',
    idleText: '新作品不入库',
    activeText: '恢复入库',
    idleIcon: '📥',
    activeIcon: '↩️',
    stateClass: (active) => (active ? 'excluded' : ''),
    enable: (active) => !active,
    successText: (enable) => (enable ? '该类别影片将不再入库新作品' : '该类别影片已恢复入库新作品'),
  },
};

/** 列表侧「前提不满足」附加提示（coord 定稿文案）。 */
export const TEXT_LIST_FILTER_INACTIVE =
  '已加入列表页隐藏集；列表类别过滤未启用（需总开关+演员穿透开启），暂不生效';

/** 列表侧写入后的 toast 文案：前提满足→正常成功语；不满足→附加暂不生效提示。 */
export function listBlockToastText(enable: boolean, activeAfterWrite: boolean): string {
  if (!enable) return CATEGORY_QUICK_ACTION_SPECS.listBlock.successText(false);
  return activeAfterWrite ? CATEGORY_QUICK_ACTION_SPECS.listBlock.successText(true) : TEXT_LIST_FILTER_INACTIVE;
}

/**
 * 点击意图解析（aria-pressed 属性 → 本次写入方向 + 写成功后按钮应渲染的态）。
 *
 * ★ 抽成纯函数并由单测锁死：aria-pressed 是字符串属性，曾在 DOM 层
 *   连续两次取反（传参取反 + 渲染取反），造成「首次点击执行反向操作」的
 *   真实缺陷（真机探针 list_write_persisted=false 归因）。渲染侧应使用
 *   返回的 nextActive，不得再次取反。
 */
export function resolveActionIntent(
  id: CategoryQuickActionId,
  pressedAttribute: string | null,
): { enable: boolean; nextActive: boolean } {
  const active = pressedAttribute === 'true';
  const enable = CATEGORY_QUICK_ACTION_SPECS[id].enable(active);
  return { enable, nextActive: enable };
}

/** 面板按钮渲染态（当前集合命中情况 → 两个按钮的文案/图标/状态类）。 */
export interface CategoryQuickActionState {
  listBlocked: boolean;
  newWorksBlocked: boolean;
}

export interface CategoryQuickActionButtonView {
  id: CategoryQuickActionId;
  text: string;
  icon: string;
  className: string;
  /** data 属性值，供真机探针断言 */
  pressed: boolean;
}

/** 单按钮渲染态（文案/图标/状态类/aria-pressed）。 */
export function buttonView(id: CategoryQuickActionId, active: boolean): CategoryQuickActionButtonView {
  const spec = CATEGORY_QUICK_ACTION_SPECS[id];
  return {
    id,
    text: active ? spec.activeText : spec.idleText,
    icon: active ? spec.activeIcon : spec.idleIcon,
    className: spec.stateClass(active),
    pressed: active,
  };
}

export function buildButtonViews(state: CategoryQuickActionState): CategoryQuickActionButtonView[] {
  return [
    buttonView('listBlock', state.listBlocked),
    buttonView('newWorksBlock', state.newWorksBlocked),
  ];
}

// ── 存储写侧的纯构造（delta 组装，供 manager 注入写原语后调用；可单测） ────────

/**
 * 列表页屏蔽写入计划（delta 由 saveSettingsSectionDelta 在**最新原始节**上构造）。
 *
 * ★ delta 只含 categoryFilter 一个键，且在其内部**先展开既有对象**再覆盖 black：
 *   listEnhancement 其余字段由原语的「最新节 + delta 浅合并」保留；
 *   categoryFilter.enabled 缺失时保持缺失（不把旧键 enableCategoryFilter 的回退态
 *   固化成新键，避免与设置页保存路径抢写权），仅总开关已显式存在时原样带回。
 * ★ black 必须写 entryKey 原文（运行时 categoryBlackSet 直接吃字符串数组，无字典归一）。
 */
export interface ListBlockWritePlan {
  delta: { categoryFilter: Record<string, unknown> };
  nextBlack: string[];
  wasPresent: boolean;
  /** 写后类别过滤是否真正处于激活态（总开关开 + 集合非空 + 演员穿透开） */
  activeAfterWrite: boolean;
}

export function buildListEnhancementDelta(
  ctx: CategoryQuickActionContext | null | undefined,
  key: string,
  enable: boolean,
): ListBlockWritePlan {
  const currentFilter: ListCategoryFilterShape = ctx?.categoryFilter || {};
  const wasPresent = containsEntryKey(currentFilter.black, key);
  const nextBlack = enable ? addEntryKey(currentFilter.black, key) : removeEntryKey(currentFilter.black, key);
  const nextFilter: Record<string, unknown> = { ...currentFilter, black: nextBlack };
  return {
    delta: { categoryFilter: nextFilter },
    nextBlack,
    wasPresent,
    activeAfterWrite: categoryFilterEnabledOf(ctx) && nextBlack.length > 0 && ctx?.enableActorPenetration === true,
  };
}



/**
 * 新作品不入库：整对象回传 filters。
 *
 * ★ 浅合并陷阱（必须整对象回传）：NewWorksManager.updateGlobalConfig 做的是
 *   merged = {...this.globalConfig, ...config}（**顶层浅合并**），传 { filters: { categoryBlackFilters } }
 *   会把 filters 内其余键（白名单/日期/排除已看…）整体丢掉。故本函数入参是**当前完整 config**，
 *   返回带完整 filters 的补丁。
 */
/** filters 的真实形状直接取自存储主类型，避免自定义 shape 与实际配置漂移。 */
export type NewWorksFiltersShape = NewWorksGlobalConfig['filters'];
export type NewWorksConfigShape = Pick<NewWorksGlobalConfig, 'filters'>;

export function buildNewWorksFiltersPatch(
  config: NewWorksConfigShape | null | undefined,
  key: string,
  enable: boolean,
): NewWorksConfigShape {
  const base: Partial<NewWorksFiltersShape> = config?.filters ?? {};
  // 运行时若旧配置缺 filters，只回传新集合（读取侧有默认值兜底）；正常路径整对象保留其余键。
  const filters = {
    ...(base as NewWorksFiltersShape),
    categoryBlackFilters: enable
      ? addEntryKey(base.categoryBlackFilters, key)
      : removeEntryKey(base.categoryBlackFilters, key),
  };
  return { filters };
}

// ── 类别链接文字级状态标记（09-30-category-link-state；纯函数，不触 DOM/不触 chrome） ──

/**
 * 屏蔽（列表页）态的链接颜色与线型。
 * ★ 与演员黑名单同色同口径（features/videoDetail/pageHandler.ts L948 colorBlacklisted /
 *   L989 textDecoration='line-through'，features/listEnhancement/actorPenetration/
 *   renderActorRow.ts L242 同色），coord 裁决复用，不另立色值。
 */
export const CATEGORY_STATE_LIST_BLOCKED_COLOR = '#d32f2f';
export const CATEGORY_STATE_LIST_BLOCKED_TEXT_DECORATION = 'line-through';

/** 不入库态图标（coord 批复=直接用 emoji；必须落在链接**外**的兄弟节点，见 manager）。 */
export const CATEGORY_STATE_NEW_WORKS_ICON = '🚫';

/** 三条 title 口径（coord 定稿，全简体中文）。 */
export const CATEGORY_STATE_TITLE_LIST_BLOCKED = '已屏蔽：列表页隐藏该类别';
export const CATEGORY_STATE_TITLE_NEW_WORKS_BLOCKED = '新作品不入库：该类别影片将不再入库';
/** 双态共存时的 title 拼接符（中文分号）。 */
export const CATEGORY_STATE_TITLE_SEPARATOR = '；';

/** 单链接状态标记渲染计划。 */
export interface CategoryLinkMarkPlan {
  entryKey: string;
  /** 命中列表页隐藏集 */
  listBlocked: boolean;
  /** 命中新作品不入库集 */
  newWorksBlocked: boolean;
  /** 需要红 + 删除线（= listBlocked，两态互不干扰可共存） */
  needsStrike: boolean;
  /** 需要链接前的禁止图标兄弟节点（= newWorksBlocked） */
  needsIcon: boolean;
  /** 需要写入的 title；null = 无状态，调用方须还原链接原 title */
  titleText: string | null;
}

/**
 * 状态标记计划：entryKey + 两个集合 → 渲染字段。
 * 两态共存时 title 用中文分号拼接；两集合同未命中 → titleText=null（还原原值）。
 * ★ 纯函数：只读入参、只返回计划，不触 DOM、不触 chrome API（单测直接断言）。
 */
export function categoryLinkMarkPlan(
  entryKey: string,
  listBlack: readonly string[] | null | undefined,
  newWorksBlack: readonly string[] | null | undefined,
): CategoryLinkMarkPlan {
  const listBlocked = containsEntryKey(listBlack, entryKey);
  const newWorksBlocked = containsEntryKey(newWorksBlack, entryKey);
  const segments: string[] = [];
  if (listBlocked) segments.push(CATEGORY_STATE_TITLE_LIST_BLOCKED);
  if (newWorksBlocked) segments.push(CATEGORY_STATE_TITLE_NEW_WORKS_BLOCKED);
  return {
    entryKey,
    listBlocked,
    newWorksBlocked,
    needsStrike: listBlocked,
    needsIcon: newWorksBlocked,
    titleText: segments.length > 0 ? segments.join(CATEGORY_STATE_TITLE_SEPARATOR) : null,
  };
}
