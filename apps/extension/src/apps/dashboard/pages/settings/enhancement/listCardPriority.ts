/**
 * @file listCardPriority.ts
 * @description list 子页卡片 → 调度中心任务优先级映射（10-25-enhancement-priority-badge）
 *
 * 单一事实源约定：
 * - 生产侧使用本静态映射表（徽章恒定展示调度等级，不随用户设置漂移；
 *   若生产直接调 buildDesignTasks 会读到 STATE.settings 实时值，门控任务可能缺席）。
 * - 蓝图侧（orchestratorDesign.buildDesignTasks / content bootstrap 预注册）改动
 *   label 或 phase 时，listCardPriority.test.ts 的同步锁单测会以真实蓝图对账本表，
 *   漂移=测试红（EXPECTED_TASK_PHASES 锁值 + label 存在性双重对账）。
 * - 一卡对应多个任务时取最高 phase（rank 数值小=优先级高，与
 *   orchestratorDesign.ts phaseOrder 一致）。
 * @module apps/dashboard/pages/settings/enhancement
 */
import { getTaskLabelShort } from '../../../../../dashboard/tabs/settings/enhancement/taskLabelCatalog';

export type CardPriorityPhase = 'critical' | 'high' | 'deferred' | 'idle';

/** 优先级排名：数值越小优先级越高（与 orchestratorDesign.ts:125 phaseOrder 一致） */
export const PHASE_RANK: Record<CardPriorityPhase, number> = {
  critical: 0,
  high: 1,
  deferred: 2,
  idle: 3,
};

/**
 * list 子页卡片 title → 调度任务 label 列表。
 * 仅收录「卡片主开关直接门控/消费对应任务」的卡；纯设置项卡（无调度任务）不进表。
 * 高清封面=无对应任务（enableHighQualityCover 硬编码 false，列表路径已弃用）→ 不加徽章。
 */
export const LIST_CARD_TASK_LABELS: Record<string, string[]> = {
  内容过滤: ['contentFilter:initialize'],
  点击增强: ['listEnhancement:init'],
  视频预览: ['listEnhancement:init'],
  演员水印: ['listEnhancement:init'],
  演员穿透: ['listEnhancement:init'],
  列表显示控制: ['listEnhancement:init'],
  快捷操作: ['list:observe:init', 'listEnhancement:init'],
  资源标签: ['list:observe:init', 'listEnhancement:init'],
};

/**
 * 蓝图同步锁值：映射表引用的每个 label 在蓝图中的 phase 锁定值。
 * listCardPriority.test.ts 用全开 settings stub 调真实 buildDesignTasks 逐 label 对账。
 */
export const EXPECTED_TASK_PHASES: Record<string, CardPriorityPhase> = {
  'list:observe:init': 'critical',
  'listEnhancement:init': 'high',
  'contentFilter:initialize': 'idle',
};

export type CardPriorityInfo = {
  phase: CardPriorityPhase;
  labels: string[];
  tooltip: string;
};

/**
 * 解析卡片徽章信息：无对应调度任务的卡返回 null（不渲染徽章）；
 * 某 label 缺 EXPECTED_TASK_PHASES 锁值同样返回 null（防御：登记表漂移时宁缺勿错）。
 */
export function getListCardPriority(title: string): CardPriorityInfo | null {
  const labels = LIST_CARD_TASK_LABELS[title];
  if (!labels || labels.length === 0) return null;

  let best: CardPriorityPhase | null = null;
  for (const label of labels) {
    const phase = EXPECTED_TASK_PHASES[label];
    if (!phase) return null;
    if (best === null || PHASE_RANK[phase] < PHASE_RANK[best]) best = phase;
  }
  if (best === null) return null;

  const taskNames = labels
    .map((label) => {
      const short = getTaskLabelShort(label);
      return short ? `${short}（${label}）` : label;
    })
    .join('、');

  return {
    phase: best,
    labels,
    tooltip: `调度中心优先级：${best}。对应任务：${taskNames}`,
  };
}
