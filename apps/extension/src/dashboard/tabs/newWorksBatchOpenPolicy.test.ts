import { describe, expect, it } from 'vitest';
import {
    DEFAULT_NEW_WORKS_PAGE_SIZE,
    MAX_UNREAD_BATCH_OPEN_COUNT,
    MAX_NEW_WORKS_BATCH_OPEN_COUNT,
    UNREAD_BATCH_OPEN_COOLDOWN_MS,
    UNREAD_NEW_WORKS_PAGE_SIZE,
    getNewWorksPageSize,
    getUnreadBatchOpenCooldownRemaining,
    getUnreadBatchOpenCooldownSeconds,
    pickUnreadBatchOpenTargets,
} from './newWorksBatchOpenPolicy';
import type { NewWorkRecord } from '../../types';

function makeWork(index: number, isRead: boolean): NewWorkRecord {
    return {
        id: `work-${index}`,
        actorId: `actor-${index}`,
        actorName: `actor-${index}`,
        title: `title-${index}`,
        javdbUrl: `https://example.com/${index}`,
        tags: [],
        discoveredAt: Date.now(),
        isRead,
    };
}

describe('new works batch open policy', () => {
    it('uses the six-item batch size for every new works page', () => {
        expect(getNewWorksPageSize('unread')).toBe(MAX_NEW_WORKS_BATCH_OPEN_COUNT);
        expect(getNewWorksPageSize('all')).toBe(MAX_NEW_WORKS_BATCH_OPEN_COUNT);
        expect(UNREAD_NEW_WORKS_PAGE_SIZE).toBe(MAX_NEW_WORKS_BATCH_OPEN_COUNT);
        expect(DEFAULT_NEW_WORKS_PAGE_SIZE).toBe(MAX_NEW_WORKS_BATCH_OPEN_COUNT);
    });

    it('picks only unread targets up to the batch limit', () => {
        const works = Array.from({ length: 15 }, (_, index) => makeWork(index + 1, false));
        const targets = pickUnreadBatchOpenTargets(works);

        expect(targets).toHaveLength(MAX_UNREAD_BATCH_OPEN_COUNT);
        expect(MAX_NEW_WORKS_BATCH_OPEN_COUNT).toBe(6);
        expect(targets.map(work => work.id)).toEqual(works.slice(0, 6).map(work => work.id));

        const mixedWorks = [makeWork(1, true), makeWork(2, false), makeWork(3, false)];
        expect(pickUnreadBatchOpenTargets(mixedWorks).map(work => work.id)).toEqual(['work-2', 'work-3']);
    });

    it('computes cooldown remaining and display seconds', () => {
        const now = 100_000;
        const lastBatchOpenAt = now - 4_000;

        expect(getUnreadBatchOpenCooldownRemaining(lastBatchOpenAt, now)).toBe(UNREAD_BATCH_OPEN_COOLDOWN_MS - 4_000);
        expect(getUnreadBatchOpenCooldownSeconds(lastBatchOpenAt, now)).toBe(11);
        expect(getUnreadBatchOpenCooldownRemaining(now - 20_000, now)).toBe(0);
        expect(getUnreadBatchOpenCooldownSeconds(0, now)).toBe(0);
    });
});
