import type { NewWorkRecord } from '../../types';

export const DEFAULT_NEW_WORKS_PAGE_SIZE = 20;
export const UNREAD_NEW_WORKS_PAGE_SIZE = 10;
export const MAX_NEW_WORKS_BATCH_OPEN_COUNT = 6;
export const MAX_UNREAD_BATCH_OPEN_COUNT = MAX_NEW_WORKS_BATCH_OPEN_COUNT;
export const UNREAD_BATCH_OPEN_COOLDOWN_MS = 15_000;

export function getNewWorksPageSize(filter: string): number {
    return filter === 'unread' ? UNREAD_NEW_WORKS_PAGE_SIZE : DEFAULT_NEW_WORKS_PAGE_SIZE;
}

export function pickUnreadBatchOpenTargets(
    works: NewWorkRecord[],
    limit: number = MAX_UNREAD_BATCH_OPEN_COUNT,
): NewWorkRecord[] {
    return works.filter(work => !work.isRead).slice(0, limit);
}

export function getUnreadBatchOpenCooldownRemaining(
    lastBatchOpenAt: number,
    now: number = Date.now(),
): number {
    if (lastBatchOpenAt <= 0) return 0;
    return Math.max(0, UNREAD_BATCH_OPEN_COOLDOWN_MS - (now - lastBatchOpenAt));
}

export function getUnreadBatchOpenCooldownSeconds(
    lastBatchOpenAt: number,
    now: number = Date.now(),
): number {
    const remainingMs = getUnreadBatchOpenCooldownRemaining(lastBatchOpenAt, now);
    return Math.ceil(remainingMs / 1000);
}
