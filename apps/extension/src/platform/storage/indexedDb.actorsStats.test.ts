import { beforeEach, describe, expect, it, vi } from 'vitest';

const initDB = vi.fn();

vi.mock('./indexedDbConnection', () => ({
  initDB,
  resetDBConnection: vi.fn(),
}));

describe('actorsStats', () => {
  beforeEach(() => {
    vi.resetModules();
    initDB.mockReset();
    vi.stubGlobal('IDBKeyRange', {
      only: (value: unknown) => {
        if (typeof value === 'boolean') throw new DOMException('The parameter is not a valid key.');
        return { type: 'only', value };
      },
      lowerBound: (value: unknown) => ({ type: 'lowerBound', value }),
    });
  });

  it('uses actor indexes for group counts and tolerates boolean blacklist fields', async () => {
    const count = vi.fn(async (range?: { value?: unknown; type?: string }) => {
      if (!range) return 100;
      if (range.type === 'lowerBound') return 11;
      if (range.value === true) return 9;
      return 0;
    });
    const index = vi.fn((name: string) => ({
      count: async (range?: { value?: unknown; type?: string }) => {
        if (range?.type === 'lowerBound') return 11;
        if (name === 'by_gender') {
          return ({ female: 70, male: 25, unknown: 5 } as Record<string, number>)[String(range?.value)] ?? 0;
        }
        if (name === 'by_category') {
          return ({ censored: 60, uncensored: 30, western: 7, unknown: 3 } as Record<string, number>)[String(range?.value)] ?? 0;
        }
        if (name === 'by_blacklisted') return 0;
        return 0;
      },
    }));
    const getAll = vi.fn(async () => Array.from({ length: 100 }, (_, index) => ({
      gender: index < 70 ? 'female' : index < 95 ? 'male' : 'unknown',
      category: index < 60 ? 'censored' : index < 90 ? 'uncensored' : index < 97 ? 'western' : 'unknown',
      blacklisted: index < 9,
      createdAt: index < 11 ? 1_001 : 0,
      updatedAt: index < 11 ? 1_001 : 0,
    })));
    initDB.mockResolvedValue({
      transaction: () => ({
        store: {
          count,
          getAll,
          index,
        },
      }),
    });
    vi.spyOn(Date, 'now').mockReturnValue(604_801_000);

    const { actorsStats } = await import('./indexedDb');
    const result = await actorsStats();

    expect(result).toEqual({
      total: 100,
      byGender: { female: 70, male: 25, unknown: 5 },
      byCategory: { censored: 60, uncensored: 30, western: 7, unknown: 3 },
      blacklisted: 9,
      recentlyAdded: 11,
      recentlyUpdated: 11,
    });
    expect(getAll).toHaveBeenCalledTimes(1);
  });
});
