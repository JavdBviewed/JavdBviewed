import type { NewWorkRecord } from '../../types';

export const MAX_NEW_WORKS_BATCH_OPEN_COUNT = 6;
export const DEFAULT_NEW_WORKS_PAGE_SIZE = MAX_NEW_WORKS_BATCH_OPEN_COUNT;
export const UNREAD_NEW_WORKS_PAGE_SIZE = MAX_NEW_WORKS_BATCH_OPEN_COUNT;
export const MAX_UNREAD_BATCH_OPEN_COUNT = MAX_NEW_WORKS_BATCH_OPEN_COUNT;
export const UNREAD_BATCH_OPEN_COOLDOWN_MS = 15_000;
export const NEW_WORKS_BATCH_OPEN_PERFORMANCE_NOTICE =
    '批量打开多个影片页会同时运行增强任务，可能提高浏览器的 CPU 和内存占用；设备性能或网络较弱时建议分批打开。';

export function getNewWorksPageSize(_filter: string): number {
    return MAX_NEW_WORKS_BATCH_OPEN_COUNT;
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
