import { describe, expect, it } from 'vitest';
import {
    DEFAULT_NEW_WORKS_PAGE_SIZE,
    MAX_UNREAD_BATCH_OPEN_COUNT,
    MAX_NEW_WORKS_BATCH_OPEN_COUNT,
    UNREAD_BATCH_OPEN_COOLDOWN_MS,
    UNREAD_NEW_WORKS_PAGE_SIZE,
    getNewWorksPageSize,
    clampNewWorksPageSize,
    getUnreadBatchOpenCooldownRemaining,
    getUnreadBatchOpenCooldownSeconds,
    NEW_WORKS_PAGE_SIZE_DEFAULT,
    NEW_WORKS_PAGE_SIZE_OPTIONS,
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
    it('keeps the six-item batch size for the batch-open domain', () => {
        expect(MAX_NEW_WORKS_BATCH_OPEN_COUNT).toBe(6);
        expect(UNREAD_NEW_WORKS_PAGE_SIZE).toBe(MAX_NEW_WORKS_BATCH_OPEN_COUNT);
        expect(DEFAULT_NEW_WORKS_PAGE_SIZE).toBe(MAX_NEW_WORKS_BATCH_OPEN_COUNT);
    });

    it('defaults the list page size to ten and passes valid sizes through', () => {
        expect(NEW_WORKS_PAGE_SIZE_OPTIONS).toEqual([10, 20, 50, 100]);
        expect(NEW_WORKS_PAGE_SIZE_DEFAULT).toBe(10);
        expect(getNewWorksPageSize('unread')).toBe(NEW_WORKS_PAGE_SIZE_DEFAULT);
        expect(getNewWorksPageSize('all')).toBe(NEW_WORKS_PAGE_SIZE_DEFAULT);
        for (const size of [10, 20, 50, 100]) {
            expect(getNewWorksPageSize('all', size)).toBe(size);
        }
    });

    it('clamps the page size to the option set and falls back to ten', () => {
        expect(clampNewWorksPageSize(10)).toBe(10);
        expect(clampNewWorksPageSize(20)).toBe(20);
        expect(clampNewWorksPageSize(50)).toBe(50);
        expect(clampNewWorksPageSize(100)).toBe(100);
        for (const invalid of [5, 1000, 0, NaN]) {
            expect(clampNewWorksPageSize(invalid)).toBe(NEW_WORKS_PAGE_SIZE_DEFAULT);
            expect(getNewWorksPageSize('all', invalid)).toBe(NEW_WORKS_PAGE_SIZE_DEFAULT);
        }
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
