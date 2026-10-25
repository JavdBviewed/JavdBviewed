/**
 * @vitest-environment jsdom
 * @file listCardPriority.test.ts
 * @description 列表页卡片 → 调度中心任务优先级映射 + 蓝图同步锁（10-25-enhancement-priority-badge）
 *
 * 同步锁机制（runtime import）：覆写 dashboard STATE.settings 为全开 stub 后调真实
 * buildDesignTasks，断言映射表每个 label 在蓝图中存在且 phase 与锁定值一致；
 * 蓝图改 phase / 删任务 / 改名 → 本文件红（防后续蓝图改动漂移）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STATE } from '../../../../../dashboard/state';
import { buildDesignTasks } from '../../../../../dashboard/tabs/settings/enhancement/orchestrator/orchestratorDesign';
import {
  EXPECTED_TASK_PHASES,
  getListCardPriority,
  LIST_CARD_TASK_LABELS,
  PHASE_RANK,
} from './listCardPriority';

/** 全开 stub：确保三个映射 label 对应任务全部进入设计蓝图（见 01-ack.md §2 门控条件） */
const FULLY_ON_STUB = {
  userExperience: {
    enableContentFilter: true,
    enableListEnhancement: true,
    enableKeyboardShortcuts: false,
    enableMagnetSearch: false,
    enableAnchorOptimization: false,
    enablePasswordHelper: false,
    enableSuperRanking: false,
    enableActorEnhancement: false,
  },
  videoEnhancement: {
    enableActorQuickActions: false,
    enableCategoryQuickActions: false,
    showLoadingIndicator: false,
  },
  listEnhancement: {},
  actorEnhancement: {},
  emby: {},
  dataEnhancement: {},
  translation: {},
} as any;

describe('listCardPriority 蓝图同步锁（10-25-enhancement-priority-badge）', () => {
  let originalSettings: unknown;

  beforeEach(() => {
    originalSettings = STATE.settings;
    STATE.settings = FULLY_ON_STUB;
  });

  afterEach(() => {
    STATE.settings = originalSettings;
  });

  it('映射表每个 label 都存在于设计蓝图（buildDesignTasks）', () => {
    const blueprint = new Map(buildDesignTasks(() => FULLY_ON_STUB).map((t) => [t.label, t]));
    const labels = Array.from(new Set(Object.values(LIST_CARD_TASK_LABELS).flat()));
    expect(labels.length).toBeGreaterThanOrEqual(3);
    for (const label of labels) {
      expect(blueprint.has(label), `蓝图缺少任务 label：${label}`).toBe(true);
    }
  });

  it('EXPECTED_TASK_PHASES 锁定值与蓝图实际 phase 逐 label 一致', () => {
    const blueprint = new Map(buildDesignTasks(() => FULLY_ON_STUB).map((t) => [t.label, t]));
    for (const [label, phase] of Object.entries(EXPECTED_TASK_PHASES)) {
      const task = blueprint.get(label);
      expect(task, `蓝图缺少任务 label：${label}`).toBeTruthy();
      expect(task!.phase, `任务 ${label} 的 phase 漂移：期望 ${phase}，蓝图 ${task!.phase}`).toBe(phase);
    }
  });

  it('映射表每个 label 都有 phase 锁定值（新增 label 必须同步登记）', () => {
    for (const labels of Object.values(LIST_CARD_TASK_LABELS)) {
      for (const label of labels) {
        expect(EXPECTED_TASK_PHASES[label], `label ${label} 缺少 EXPECTED_TASK_PHASES 锁定值`).toBeDefined();
      }
    }
  });
});

describe('getListCardPriority 取最高 phase 与徽章解析', () => {
  it('一卡多任务取最高 phase（快捷操作/资源标签 = critical）', () => {
    for (const title of ['快捷操作', '资源标签']) {
      const info = getListCardPriority(title);
      expect(info, `${title} 应解析出徽章`).toBeTruthy();
      expect(info!.phase).toBe('critical');
      expect(info!.labels).toEqual(['list:observe:init', 'listEnhancement:init']);
      expect(PHASE_RANK[info!.phase]).toBe(0);
    }
  });

  it('单任务卡 phase 与锁定值一致（内容过滤=idle / 点击增强=high）', () => {
    expect(getListCardPriority('内容过滤')!.phase).toBe('idle');
    expect(getListCardPriority('点击增强')!.phase).toBe('high');
    expect(getListCardPriority('视频预览')!.phase).toBe('high');
    expect(getListCardPriority('演员水印')!.phase).toBe('high');
    expect(getListCardPriority('演员穿透')!.phase).toBe('high');
    expect(getListCardPriority('列表显示控制')!.phase).toBe('high');
  });

  it('无对应调度任务的卡返回 null（高清封面=列表路径已弃用，不加徽章）', () => {
    expect(getListCardPriority('高清封面')).toBeNull();
    expect(getListCardPriority('不存在的卡片')).toBeNull();
  });

  it('tooltip 含中文说明、全部任务 label 与中文名（taskLabelCatalog）', () => {
    const multi = getListCardPriority('快捷操作')!.tooltip;
    expect(multi).toContain('调度中心优先级：critical');
    expect(multi).toContain('列表页观察器初始化（list:observe:init）');
    expect(multi).toContain('列表增强初始化（listEnhancement:init）');

    const single = getListCardPriority('内容过滤')!.tooltip;
    expect(single).toContain('调度中心优先级：idle');
    expect(single).toContain('内容过滤初始化（contentFilter:initialize）');
  });
});
