import { describe, expect, it } from 'vitest';
import {
  getAutomaticHeavyTaskVisibilityPolicy,
  getUserTriggeredHeavyTaskScheduling,
  normalizeVideoEnhancementSchedulingMode,
} from './schedulingMode';

describe('video enhancement scheduling mode', () => {
  it('normalizes missing and invalid values to smart', () => {
    expect(normalizeVideoEnhancementSchedulingMode(undefined)).toBe('smart');
    expect(normalizeVideoEnhancementSchedulingMode('invalid')).toBe('smart');
  });

  it('allows smart heavy tasks to prewarm slowly in the background and keeps immediate tasks fully eligible', () => {
    expect(getAutomaticHeavyTaskVisibilityPolicy('smart')).toBe('background_throttled');
    expect(getAutomaticHeavyTaskVisibilityPolicy('immediate')).toBe('background_allowed');
  });

  it('always promotes user-triggered heavy work to the visible high-priority lane', () => {
    expect(getUserTriggeredHeavyTaskScheduling()).toEqual({
      phase: 'high',
      priority: 10,
      visibilityPolicy: 'foreground_first',
    });
  });
});
