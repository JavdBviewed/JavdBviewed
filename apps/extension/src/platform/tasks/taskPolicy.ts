/**
 * @file taskPolicy.ts
 * @description 任务调度策略 —— 定义任务桶（bucket）分类和并发限制
 * @module platform/tasks
 *
 * 任务按 label 前缀分桶，每个桶有独立的并发上限，
 * 防止同一类任务（如翻译、磁力搜索）占用过多资源。
 */

/** 各任务桶的最大并发数 */
export const TASK_BUCKET_LIMITS: Record<string, number> = {
  videoStatus: 6,                                     // 视频状态查询
  translate: 1,                                       // 翻译（严格串行，避免 API 限流）
  actorMarks: 3,                                      // 演员标记
  actorRemarks: 3,                                    // 演员备注（Wiki 数据）
  drive115: 4,                                        // 115 网盘操作
  'drive115-push': 3,                                 // 115 推送
  insights: 3,                                        // AI 分析报告
  videoFavoriteRating: 3,                             // 收藏评分
  contentFilter: 3,                                   // 内容过滤
  'ui-light': 8,                                      // UI 轻量任务
  'video-light': 8,                                   // 视频页轻量任务
  auxiliary: 20,                                      // 辅助任务（宽限）
};

/** 跨桶租约预算，避免多个任务桶同时放大页面侧工作量。 */
export const TASK_GLOBAL_LEASE_LIMITS = {
  visible: 6,
  hidden: 3,
  visiblePriorityReserve: 1,
  hiddenPriorityReserve: 1,
} as const;

export const TASK_PAGE_LEASE_LIMITS = {
  visible: 4,
  hidden: 1,
} as const;

/**
 * Cross-bucket limits for source-page operations which each perform a large
 * local-library read/write or DOM pass. They must not start together on
 * several source tabs.
 */
export const TASK_LEASE_GROUP_LIMITS: Record<string, number> = {
  'source-page-heavy': 1,
};

export function resolveTaskLeaseGroup(label: string): string | null {
  if (label === 'videoStatus:initialSync' || label === 'actorMarks:page') {
    return 'source-page-heavy';
  }
  return null;
}

/**
 * 根据任务 label 解析所属桶。
 *
 * 翻译桶校准（P2）：
 * - 真正打翻译 API / 父级 translate 任务 → translate（串行）
 * - 仅 UI 的 prepare/render、titleTranslateBtn → 不进 translate，避免占串行槽
 */
export function resolveTaskBucket(label: string): string {
  const raw = String(label || '');
  const lower = raw.toLowerCase();

  if (raw.startsWith('videoStatus:')) return 'videoStatus';

  if (lower.includes('translate')) {
    // UI-only：按钮挂载、准备 DOM、渲染结果 — 不占 translate 串行桶
    if (
      lower.endsWith(':prepare')
      || lower.endsWith(':render')
      || lower.includes('titletranslate')
    ) {
      return 'video-light';
    }
    return 'translate';
  }

  if (raw.startsWith('actorMarks')) return 'actorMarks';
  if (raw.startsWith('actorRemarks')) return 'actorRemarks';
  if (raw === 'drive115:push') return 'drive115-push';
  if (raw.startsWith('drive115')) return 'drive115';
  if (raw.startsWith('insights')) return 'insights';
  if (raw.startsWith('videoFavoriteRating')) return 'videoFavoriteRating';
  if (raw.startsWith('contentFilter')) return 'contentFilter';
  if (raw.startsWith('ui:remove-unwanted') || raw.includes(':panel')) return 'ui-light';
  if (raw.startsWith('videoEnhancement:') || raw.startsWith('ux:magnet:')) return 'video-light';
  return 'auxiliary';
}
