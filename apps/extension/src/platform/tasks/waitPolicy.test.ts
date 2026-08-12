import { describe, expect, it } from 'vitest';
import { isDeferredTaskWaitReason, isTaskLeaseAvailabilityWaitReason } from './waitPolicy';

describe('task wait policy', () => {
  it('keeps scheduler budget denials in the deferred state', () => {
    expect(isDeferredTaskWaitReason('global-priority-reserve')).toBe(true);
    expect(isDeferredTaskWaitReason('global-budget')).toBe(true);
    expect(isDeferredTaskWaitReason('background-page-budget')).toBe(true);
    expect(isDeferredTaskWaitReason('source-page-heavy-budget')).toBe(true);
  });

  it('does not classify a lease timeout as deferred', () => {
    expect(isDeferredTaskWaitReason('lease-timeout')).toBe(false);
  });

  it('distinguishes capacity waits from a hidden tab', () => {
    expect(isTaskLeaseAvailabilityWaitReason('source-page-heavy-budget')).toBe(true);
    expect(isTaskLeaseAvailabilityWaitReason('higher-priority-wait')).toBe(true);
    expect(isTaskLeaseAvailabilityWaitReason('tab-hidden')).toBe(false);
  });
});
