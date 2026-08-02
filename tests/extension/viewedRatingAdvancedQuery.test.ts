import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type TestRecord = {
  id: string;
  title: string;
  status: 'viewed';
  rating?: number;
  userRating?: number;
  createdAt: number;
  updatedAt: number;
};

function createCursor(records: TestRecord[]): { value: TestRecord; continue: () => Promise<unknown> } | null {
  let index = 0;
  const next = (): { value: TestRecord; continue: () => Promise<unknown> } | null => {
    if (index >= records.length) return null;
    const cursor = {
      value: records[index],
      continue: async (): Promise<unknown> => {
        index += 1;
        return next();
      },
    };
    return cursor;
  };
  return next();
}

describe('viewedQuery rating advanced conditions', () => {
  const mockDB = {
    transaction: vi.fn(),
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.doUnmock('../../apps/extension/src/platform/storage/indexedDbConnection');
    vi.doUnmock('../../apps/extension/src/platform/storage/indexedDb');
  });

  it('uses the same rated and unrated semantics as local filtering', async () => {
    const records: TestRecord[] = [
      { id: 'R-8', title: '已评分', status: 'viewed', rating: 8.5, userRating: 4, createdAt: 1, updatedAt: 1 },
      { id: 'R-0', title: '未评分', status: 'viewed', rating: 0, userRating: 0, createdAt: 2, updatedAt: 2 },
    ];
    mockDB.transaction.mockReturnValue({
      store: {
        openCursor: vi.fn().mockImplementation(() => Promise.resolve(createCursor(records))),
      },
    });

    vi.doMock('../../apps/extension/src/platform/storage/indexedDbConnection', () => ({
      initDB: vi.fn(() => Promise.resolve(mockDB)),
      resetDBConnection: vi.fn(),
    }));

    const { viewedQuery } = await import('../../apps/extension/src/platform/storage/indexedDb');
    const rated = await viewedQuery({
      adv: [{ field: 'rating', op: 'gte', value: '8' }],
      orderBy: 'id',
      order: 'asc',
    });
    const unrated = await viewedQuery({
      adv: [{ field: 'userRating', op: 'empty' }],
      orderBy: 'id',
      order: 'asc',
    });

    expect(rated.items.map(item => item.id)).toEqual(['R-8']);
    expect(unrated.items.map(item => item.id)).toEqual(['R-0']);
  });
});
