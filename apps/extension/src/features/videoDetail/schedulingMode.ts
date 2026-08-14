import type { GlobalTaskVisibilityPolicy } from '../../shared/taskCenterTypes';

export type VideoEnhancementSchedulingMode = 'smart' | 'immediate';

export function normalizeVideoEnhancementSchedulingMode(value: unknown): VideoEnhancementSchedulingMode {
  return value === 'immediate' ? 'immediate' : 'smart';
}

export function getAutomaticHeavyTaskVisibilityPolicy(
  mode: VideoEnhancementSchedulingMode,
): GlobalTaskVisibilityPolicy {
  return mode === 'immediate' ? 'background_allowed' : 'background_throttled';
}

export function getUserTriggeredHeavyTaskScheduling(): {
  phase: 'high';
  priority: number;
  visibilityPolicy: GlobalTaskVisibilityPolicy;
} {
  return {
    phase: 'high',
    priority: 10,
    visibilityPolicy: 'foreground_first',
  };
}
