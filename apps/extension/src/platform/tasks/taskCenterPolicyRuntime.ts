/**
 * @file taskCenterPolicyRuntime.ts
 * @description 任务中心策略运行时 —— 根据页面可见性和任务策略计算实际并发限制和任务处置
 * @module platform/tasks
 *
 * 核心逻辑：前台页面可见时按基础限制执行，后台页面根据 visibilityPolicy 调整。
 */
import type { GlobalTaskVisibilityPolicy, GlobalTaskStatus } from '../../shared/taskCenterTypes';

/** 根据页面可见性和任务策略计算有效桶并发限制 */
export function getEffectiveBucketLimit(input: {
  baseLimit: number;
  visible: boolean;                                    // 页面是否可见
  policy: GlobalTaskVisibilityPolicy;
}): number {
  const baseLimit = Math.max(0, input.baseLimit);
  if (input.visible) return baseLimit;
  if (input.policy === 'foreground_only') return 0;
  if (input.policy === 'background_allowed' || input.policy === 'background_throttled') {
    return Math.max(0, Math.min(4, baseLimit));
  }
  // Current product contract: foreground_first prioritizes visible pages, but does not run while hidden.
  return 0;
}

export function computeTaskDisposition(input: {
  status: GlobalTaskStatus;
  heartbeatTs?: number;
  timeoutMs: number;
  now: number;
}): 'active' | 'stale' {
  if (!['leased', 'running'].includes(input.status)) return 'active';
  const heartbeatTs = typeof input.heartbeatTs === 'number' ? input.heartbeatTs : 0;
  const staleWindowMs = Math.max(120_000, input.timeoutMs * 4);
  if (heartbeatTs > 0 && input.now - heartbeatTs > staleWindowMs) {
    return 'stale';
  }
  return 'active';
}
