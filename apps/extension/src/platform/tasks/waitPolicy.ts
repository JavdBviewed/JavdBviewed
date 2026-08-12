export function isDeferredTaskWaitReason(reason: string): boolean {
  return reason === 'tab-hidden'
    || reason === 'higher-priority-wait'
    || reason === 'global-priority-reserve'
    || reason === 'global-budget'
    || reason === 'background-global-budget'
    || reason === 'page-budget'
    || reason === 'background-page-budget'
    || reason === 'source-page-heavy-budget'
    || reason.startsWith('bucket:');
}

/**
 * Capacity denials mean that another managed task is making progress. They
 * can wait longer than an individual task execution, unlike hidden tabs.
 */
export function isTaskLeaseAvailabilityWaitReason(reason: string): boolean {
  return reason === 'higher-priority-wait'
    || reason === 'global-priority-reserve'
    || reason === 'global-budget'
    || reason === 'background-global-budget'
    || reason === 'page-budget'
    || reason === 'background-page-budget'
    || reason === 'source-page-heavy-budget'
    || reason.startsWith('bucket:');
}
