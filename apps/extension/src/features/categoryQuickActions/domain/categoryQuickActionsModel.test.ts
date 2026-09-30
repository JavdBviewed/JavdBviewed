/**
 * @file categoryQuickActionsModel.test.ts
 * @description 类别快捷操作纯逻辑层单测（09-30-video-category-quick-actions）。
 * 覆盖派单验收项：按钮状态 viewmodel + 列表侧生效前提判定 + 两侧存储写构造，
 * 并显式锁住 ★updateGlobalConfig 顶层浅合并陷阱（filters 必须整对象回传）。
 */
import { describe, expect, it } from 'vitest';
import type { NewWorksGlobalConfig } from '../../../types';
import {
  CATEGORY_QUICK_ACTION_SPECS,
  TEXT_LIST_FILTER_INACTIVE,
  addEntryKey,
  buildButtonViews,
  buildListEnhancementDelta,
  buildNewWorksFiltersPatch,
  buttonView,
  categoryFilterEnabledOf,
  categoryLinkMarkPlan,
  CATEGORY_STATE_LIST_BLOCKED_COLOR,
  CATEGORY_STATE_LIST_BLOCKED_TEXT_DECORATION,
  CATEGORY_STATE_NEW_WORKS_ICON,
  CATEGORY_STATE_TITLE_LIST_BLOCKED,
  CATEGORY_STATE_TITLE_NEW_WORKS_BLOCKED,
  CATEGORY_STATE_TITLE_SEPARATOR,
  containsEntryKey,
  isCategoryFilterActive,
  listBlockToastText,
  resolveActionIntent,
  removeEntryKey,
  type CategoryQuickActionContext,
  type CategoryQuickActionId,
} from './categoryQuickActionsModel';

const KEY = 'c4=17';
const OTHER = 'c7=28';

/** filters 完整形状构造器（必填键齐全，贴近真实存储对象）。 */
function filtersOf(over: Partial<NewWorksGlobalConfig['filters']> = {}): NewWorksGlobalConfig['filters'] {
  return {
    excludeViewed: true,
    excludeBrowsed: false,
    excludeWant: false,
    dateRange: 30,
    ...over,
  };
}

function configOf(over: Partial<NewWorksGlobalConfig> = {}): NewWorksGlobalConfig {
  return {
    checkInterval: 3600000,
    requestInterval: 1000,
    maxWorksPerCheck: 50,
    autoCleanup: true,
    cleanupDays: 30,
    filters: filtersOf(),
    ...over,
  };
}

describe('categoryFilterEnabledOf（总开关：显式优先、缺失回退旧键）', () => {
  it('categoryFilter.enabled 显式布尔值优先', () => {
    expect(categoryFilterEnabledOf({ categoryFilter: { enabled: true }, enableCategoryFilter: false })).toBe(true);
    expect(categoryFilterEnabledOf({ categoryFilter: { enabled: false }, enableCategoryFilter: true })).toBe(false);
  });

  it('enabled 缺失时回退旧键 enableCategoryFilter === true', () => {
    expect(categoryFilterEnabledOf({ enableCategoryFilter: true })).toBe(true);
    expect(categoryFilterEnabledOf({ enableCategoryFilter: false })).toBe(false);
    expect(categoryFilterEnabledOf({ categoryFilter: {}, enableCategoryFilter: true })).toBe(true);
    expect(categoryFilterEnabledOf({ categoryFilter: { enabled: undefined }, enableCategoryFilter: true })).toBe(true);
  });

  it('两键皆缺失 / 空上下文 → false；非布尔脏值不回退成 true', () => {
    expect(categoryFilterEnabledOf({})).toBe(false);
    expect(categoryFilterEnabledOf(null)).toBe(false);
    expect(categoryFilterEnabledOf(undefined)).toBe(false);
    expect(categoryFilterEnabledOf({ categoryFilter: { enabled: 'true' as any } })).toBe(false);
  });
});

describe('isCategoryFilterActive（三条口径：总开关 + 集合非空 + 演员穿透）', () => {
  it('三条全满足才为 true', () => {
    const ctx: CategoryQuickActionContext = {
      categoryFilter: { enabled: true, black: [OTHER] },
      enableActorPenetration: true,
    };
    expect(isCategoryFilterActive(ctx)).toBe(true);
  });

  it('集合为空 / 穿透未开 / 总开关关 → false', () => {
    expect(isCategoryFilterActive({ categoryFilter: { enabled: true, black: [] }, enableActorPenetration: true })).toBe(false);
    expect(isCategoryFilterActive({ categoryFilter: { enabled: true, black: [OTHER] } })).toBe(false);
    expect(isCategoryFilterActive({ categoryFilter: { enabled: false, black: [OTHER] }, enableActorPenetration: true })).toBe(false);
    expect(isCategoryFilterActive(null)).toBe(false);
  });

  it('回退口径同样参与判定（旧键开 + 穿透开 + 集合非空 → true）', () => {
    expect(isCategoryFilterActive({ categoryFilter: { black: [] }, enableCategoryFilter: true, enableActorPenetration: true })).toBe(false);
    expect(isCategoryFilterActive({ categoryFilter: { black: [OTHER] }, enableCategoryFilter: true, enableActorPenetration: true })).toBe(true);
  });
});

describe('集合读写纯函数（去重 + 字典归一容错）', () => {
  it('containsEntryKey 容忍 legacy 裸 id 形态', () => {
    expect(containsEntryKey(['17'], KEY)).toBe(true);
    expect(containsEntryKey([KEY], KEY)).toBe(true);
    expect(containsEntryKey([OTHER], KEY)).toBe(false);
    expect(containsEntryKey([], KEY)).toBe(false);
    expect(containsEntryKey(null, KEY)).toBe(false);
    expect(containsEntryKey(['t-abc'], KEY)).toBe(false);
  });

  it('addEntryKey 幂等去重、追加尾部、保留既有顺序', () => {
    expect(addEntryKey([], KEY)).toEqual([KEY]);
    expect(addEntryKey([OTHER], KEY)).toEqual([OTHER, KEY]);
    expect(addEntryKey([OTHER, KEY], KEY)).toEqual([OTHER, KEY]);
    expect(addEntryKey(['17'], KEY)).toEqual(['17']);
  });

  it('removeEntryKey 按归一后比较（裸 id 也能删净），未命中时原样返回副本', () => {
    expect(removeEntryKey([OTHER, KEY], KEY)).toEqual([OTHER]);
    expect(removeEntryKey([OTHER, '17'], KEY)).toEqual([OTHER]);
    const base = [OTHER];
    const out = removeEntryKey(base, KEY);
    expect(out).toEqual([OTHER]);
    expect(out).not.toBe(base);
  });

  it('脏输入（非字符串元素）被过滤', () => {
    expect(addEntryKey([null as any, OTHER], KEY)).toEqual([OTHER, KEY]);
    expect(removeEntryKey([undefined as any], KEY)).toEqual([]);
  });
});

describe('按钮 viewmodel（文案/图标/状态类/aria-pressed）', () => {
  it('两个动作的未激活与激活态文案按定稿', () => {
    expect(buttonView('listBlock', false)).toEqual({
      id: 'listBlock',
      text: '屏蔽（列表页）',
      icon: '🚫',
      className: '',
      pressed: false,
    });
    expect(buttonView('listBlock', true)).toMatchObject({ text: '取消屏蔽', icon: '✅', className: 'blocked', pressed: true });
    expect(buttonView('newWorksBlock', false)).toMatchObject({ text: '新作品不入库', icon: '📥', className: '', pressed: false });
    expect(buttonView('newWorksBlock', true)).toMatchObject({ text: '恢复入库', icon: '↩️', className: 'excluded', pressed: true });
  });

  it('点击语义 = 激活态取反（toggle）', () => {
    expect(CATEGORY_QUICK_ACTION_SPECS.listBlock.enable(true)).toBe(false);
    expect(CATEGORY_QUICK_ACTION_SPECS.listBlock.enable(false)).toBe(true);
    expect(CATEGORY_QUICK_ACTION_SPECS.newWorksBlock.enable(true)).toBe(false);
    expect(CATEGORY_QUICK_ACTION_SPECS.newWorksBlock.enable(false)).toBe(true);
  });

  it('buildButtonViews 固定顺序 = 列表屏蔽在前、新作品在后', () => {
    const views = buildButtonViews({ listBlocked: true, newWorksBlocked: false });
    expect(views.map(v => v.id)).toEqual(['listBlock', 'newWorksBlock']);
    expect(views[0].pressed).toBe(true);
    expect(views[1].pressed).toBe(false);
  });
});

describe('toast 文案（前提不满足仍写入 + 明示暂不生效）', () => {
  it('取消屏蔽 → 移除文案（与前提无关）', () => {
    expect(listBlockToastText(false, true)).toBe('该类别已从列表页隐藏集移除');
    expect(listBlockToastText(false, false)).toBe('该类别已从列表页隐藏集移除');
  });

  it('写入且前提满足 → 正常成功语', () => {
    expect(listBlockToastText(true, true)).toBe('该类别已加入列表页隐藏集');
  });

  it('写入但前提不满足 → 定稿提示（含「需总开关+演员穿透开启」）', () => {
    const text = listBlockToastText(true, false);
    expect(text).toBe(TEXT_LIST_FILTER_INACTIVE);
    expect(text).toContain('已加入列表页隐藏集');
    expect(text).toContain('需总开关+演员穿透开启');
    expect(text).toContain('暂不生效');
  });

  it('新作品侧成功语无前提依赖口径', () => {
    expect(CATEGORY_QUICK_ACTION_SPECS.newWorksBlock.successText(true)).toBe('该类别影片将不再入库新作品');
    expect(CATEGORY_QUICK_ACTION_SPECS.newWorksBlock.successText(false)).toBe('该类别影片已恢复入库新作品');
  });
});

describe('buildListEnhancementDelta（只动 black，不抢设置页写权）', () => {
  it('保留 categoryFilter 其余键，只覆盖 black', () => {
    const plan = buildListEnhancementDelta(
      { categoryFilter: { enabled: true, white: ['c1=23'], black: [OTHER] } as any, enableActorPenetration: true },
      KEY,
      true,
    );
    expect(plan.delta.categoryFilter.white).toEqual(['c1=23']);
    expect(plan.delta.categoryFilter.enabled).toBe(true);
    expect(plan.delta.categoryFilter.black).toEqual([OTHER, KEY]);
    expect(plan.nextBlack).toEqual([OTHER, KEY]);
    expect(plan.wasPresent).toBe(false);
    expect(plan.activeAfterWrite).toBe(true);
  });

  it('delta 只含 categoryFilter 一个键（listEnhancement 其余字段交给写原语的最新节）', () => {
    const plan = buildListEnhancementDelta({ categoryFilter: { black: [] } }, KEY, true);
    expect(Object.keys(plan.delta)).toEqual(['categoryFilter']);
  });

  it('★enabled 缺失时不固化新键（不把旧键回退态写进 categoryFilter.enabled）', () => {
    const plan = buildListEnhancementDelta({ enableCategoryFilter: true, enableActorPenetration: true }, KEY, true);
    expect('enabled' in plan.delta.categoryFilter).toBe(false);
    expect(plan.delta.categoryFilter.black).toEqual([KEY]);
  });

  it('enabled 显式存在时原样带回（含 false）', () => {
    const plan = buildListEnhancementDelta({ categoryFilter: { enabled: false, black: [KEY] } }, KEY, false);
    expect(plan.delta.categoryFilter.enabled).toBe(false);
    expect(plan.delta.categoryFilter.black).toEqual([]);
    expect(plan.wasPresent).toBe(true);
  });

  it('前提不满足时仍给出写入计划，activeAfterWrite=false（供 toast 分支）', () => {
    const plan = buildListEnhancementDelta({ categoryFilter: { enabled: false }, enableActorPenetration: true }, KEY, true);
    expect(plan.nextBlack).toEqual([KEY]);
    expect(plan.activeAfterWrite).toBe(false);
    expect(listBlockToastText(true, plan.activeAfterWrite)).toBe(TEXT_LIST_FILTER_INACTIVE);
  });

  it('取消动作即使原本处于激活态，写后集合空 → activeAfterWrite=false', () => {
    const plan = buildListEnhancementDelta(
      { categoryFilter: { enabled: true, black: [KEY] }, enableActorPenetration: true },
      KEY,
      false,
    );
    expect(plan.nextBlack).toEqual([]);
    expect(plan.activeAfterWrite).toBe(false);
  });
});

describe('buildNewWorksFiltersPatch（★浅合并陷阱：filters 整对象回传）', () => {
  it('保留 filters 内其余键（白名单/排除已看/日期…）不被顶层浅合并丢掉', () => {
    const config = configOf({
      filters: filtersOf({ categoryFilters: ['c1=23'], categoryBlackFilters: [OTHER], excludeAR: true, applyContentFilter: false }),
    });
    const patch = buildNewWorksFiltersPatch(config, KEY, true);
    expect(patch.filters?.categoryBlackFilters).toEqual([OTHER, KEY]);
    expect(patch.filters?.categoryFilters).toEqual(['c1=23']);
    expect(patch.filters?.excludeViewed).toBe(true);
    expect(patch.filters?.excludeBrowsed).toBe(false);
    expect(patch.filters?.excludeWant).toBe(false);
    expect(patch.filters?.dateRange).toBe(30);
    expect(patch.filters?.excludeAR).toBe(true);
    expect(patch.filters?.applyContentFilter).toBe(false);
  });

  it('模拟 manager 的 merged={...globalConfig,...patch}：filters 其余键与顶层其余键均不丢', () => {
    const config = configOf({
      autoCheckEnabled: true,
      concurrency: 3,
      lastGlobalCheck: 123,
      filters: filtersOf({ categoryFilters: ['c7=28'] }),
    });
    const patch = buildNewWorksFiltersPatch(config, KEY, true);
    const merged = { ...config, ...patch };
    expect(merged.autoCheckEnabled).toBe(true);
    expect(merged.concurrency).toBe(3);
    expect(merged.lastGlobalCheck).toBe(123);
    expect(merged.filters.categoryFilters).toEqual(['c7=28']);
    expect(merged.filters.categoryBlackFilters).toEqual([KEY]);
    expect(merged.filters.excludeViewed).toBe(true);
  });

  it('反例锁：若只回传 {categoryBlackFilters} 单键，浅合并会清空其余筛选（本线写法必须避免）', () => {
    const config = configOf({ filters: filtersOf({ categoryFilters: ['c1=23'] }) });
    const naive = { filters: { categoryBlackFilters: [KEY] } };
    const merged = { ...config, ...naive };
    expect((merged.filters as any).categoryFilters).toBeUndefined();
    const safe = { ...config, ...buildNewWorksFiltersPatch(config, KEY, true) };
    expect(safe.filters.categoryFilters).toEqual(['c1=23']);
  });

  it('移除动作同样整对象回传，且未命中集合时不误删', () => {
    const config = configOf({ filters: filtersOf({ categoryBlackFilters: [OTHER, KEY] }) });
    expect(buildNewWorksFiltersPatch(config, KEY, false).filters?.categoryBlackFilters).toEqual([OTHER]);
    const config2 = configOf({ filters: filtersOf({ categoryBlackFilters: [OTHER] }) });
    expect(buildNewWorksFiltersPatch(config2, KEY, false).filters?.categoryBlackFilters).toEqual([OTHER]);
  });

  it('legacy 裸 id 形态在集合内时不重复追加；filters 缺失时只回传新集合不抛错', () => {
    const config = configOf({ filters: filtersOf({ categoryBlackFilters: ['17'] }) });
    expect(buildNewWorksFiltersPatch(config, KEY, true).filters?.categoryBlackFilters).toEqual(['17']);
    const patch = buildNewWorksFiltersPatch({} as any, KEY, true);
    expect(patch.filters?.categoryBlackFilters).toEqual([KEY]);
    expect(buildNewWorksFiltersPatch(null, KEY, true).filters?.categoryBlackFilters).toEqual([KEY]);
  });
});

// ── resolveActionIntent：aria-pressed → 写入方向 + 写成功后渲染态 ──────────
// ★ 真机探针 RED 归因锁：DOM 层曾对 aria-pressed 双重取反，导致首次点击执行
//   反向操作（点「屏蔽」实际走移除分支）。此处锁死「 inactive → enable=true 且
//   nextActive=true 」的单向语义，渲染侧不得再取反。
describe('resolveActionIntent（点击意图极性）', () => {
  const IDS: CategoryQuickActionId[] = ['listBlock', 'newWorksBlock'];

  it.each(IDS)('%s：未激活态（aria-pressed="false"）点击 = 加入集合，写成功后渲染为激活', (id) => {
    expect(resolveActionIntent(id, 'false')).toEqual({ enable: true, nextActive: true });
  });

  it.each(IDS)('%s：属性缺失（首屏未渲染）视同未激活 → 加入集合', (id) => {
    expect(resolveActionIntent(id, null)).toEqual({ enable: true, nextActive: true });
  });

  it.each(IDS)('%s：已激活态（aria-pressed="true"）点击 = 移出集合，写成功后渲染为未激活', (id) => {
    expect(resolveActionIntent(id, 'true')).toEqual({ enable: false, nextActive: false });
  });

  it('属性值大小写/异常值一律按未激活处理（不出现第三态）', () => {
    expect(resolveActionIntent('listBlock', 'True')).toEqual({ enable: true, nextActive: true });
    expect(resolveActionIntent('newWorksBlock', 'yes')).toEqual({ enable: true, nextActive: true });
  });

  it('nextActive 恒等于 enable（渲染态即写入方向，无二次取反空间）', () => {
    for (const id of IDS) {
      for (const pressed of ['true', 'false', null]) {
        const r = resolveActionIntent(id, pressed);
        expect(r.nextActive).toBe(r.enable);
      }
    }
  });

  it('连续两次点击的意图互为反向（可就地撤销）', () => {
    for (const id of IDS) {
      const first = resolveActionIntent(id, 'false');
      const second = resolveActionIntent(id, String(first.nextActive));
      expect(second.enable).toBe(!first.enable);
      expect(second.nextActive).toBe(false);
    }
  });
});

// ── 类别链接文字级状态标记计划（09-30-category-link-state） ──────────────────

describe('categoryLinkMarkPlan（状态标记渲染计划：4 组合 + 共存 + title 拼接）', () => {
  it('组合一：两集合皆未命中 → 全 false、titleText=null（调用方须还原原 title）', () => {
    const plan = categoryLinkMarkPlan(KEY, [], []);
    expect(plan).toEqual({
      entryKey: KEY,
      listBlocked: false,
      newWorksBlocked: false,
      needsStrike: false,
      needsIcon: false,
      titleText: null,
    });
  });

  it('组合二：仅列表页屏蔽集命中 → 红+删除线、无图标、单段 title', () => {
    const plan = categoryLinkMarkPlan(KEY, [KEY], []);
    expect(plan.needsStrike).toBe(true);
    expect(plan.needsIcon).toBe(false);
    expect(plan.titleText).toBe(CATEGORY_STATE_TITLE_LIST_BLOCKED);
    expect(plan.titleText).toBe('已屏蔽：列表页隐藏该类别');
  });

  it('组合三：仅新作品不入库集命中 → 禁止图标、无删除线、单段 title', () => {
    const plan = categoryLinkMarkPlan(KEY, [], [KEY]);
    expect(plan.needsStrike).toBe(false);
    expect(plan.needsIcon).toBe(true);
    expect(plan.titleText).toBe(CATEGORY_STATE_TITLE_NEW_WORKS_BLOCKED);
    expect(plan.titleText).toBe('新作品不入库：该类别影片将不再入库');
  });

  it('组合四：两集合同命中 → 红删除线与图标共存，title 两段用中文分号拼接', () => {
    const plan = categoryLinkMarkPlan(KEY, [OTHER, KEY], [KEY, OTHER]);
    expect(plan.needsStrike).toBe(true);
    expect(plan.needsIcon).toBe(true);
    expect(plan.titleText).toBe(
      `${CATEGORY_STATE_TITLE_LIST_BLOCKED}${CATEGORY_STATE_TITLE_SEPARATOR}${CATEGORY_STATE_TITLE_NEW_WORKS_BLOCKED}`,
    );
    expect(plan.titleText).toBe('已屏蔽：列表页隐藏该类别；新作品不入库：该类别影片将不再入库');
  });

  it('色值/线型/图标沿用 coord 裁决口径（与演员黑名单同色；图标=🚫）', () => {
    expect(CATEGORY_STATE_LIST_BLOCKED_COLOR).toBe('#d32f2f');
    expect(CATEGORY_STATE_LIST_BLOCKED_TEXT_DECORATION).toBe('line-through');
    expect(CATEGORY_STATE_NEW_WORKS_ICON).toBe('🚫');
  });

  it('legacy 裸 id 形态同样命中（沿用 containsEntryKey 归一口径）', () => {
    const bare = '17';
    expect(categoryLinkMarkPlan('c4=17', [bare], []).listBlocked).toBe(true);
    expect(categoryLinkMarkPlan('c4=17', [], [bare]).newWorksBlocked).toBe(true);
  });

  it('脏集合输入（null/undefined/非字符串元素）不抛错且按未命中处理', () => {
    expect(categoryLinkMarkPlan(KEY, undefined, null).needsStrike).toBe(false);
    expect(categoryLinkMarkPlan(KEY, [1 as any, null as any], ['']).needsIcon).toBe(false);
  });

  it('★纯函数：不触 DOM、不触 chrome（node 环境下两全局均不存在仍可调用），且返回可序列化计划', () => {
    expect(typeof document).toBe('undefined');
    expect(typeof (globalThis as any).chrome).toBe('undefined');
    const plan = categoryLinkMarkPlan(KEY, [KEY], [KEY]);
    expect(Object.keys(plan)).toEqual(['entryKey', 'listBlocked', 'newWorksBlocked', 'needsStrike', 'needsIcon', 'titleText']);
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
  });
});
