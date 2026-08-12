import { beforeEach, describe, expect, it, vi } from 'vitest';

const initDB = vi.fn();

vi.mock('./indexedDbConnection', () => ({
  initDB,
  resetDBConnection: vi.fn(),
}));

describe('newWorksQuery', () => {
  beforeEach(() => {
    vi.resetModules();
    initDB.mockReset();
  });

  it('returns a discovered-time page without reading every new-work row', async () => {
    const getAll = vi.fn(async () => {
      throw new Error('default pagination must not read the full newWorks store');
    });
    const count = vi.fn(async () => 4);
    const rows = [
      { id: 'work-4', discoveredAt: 400 },
      { id: 'work-3', discoveredAt: 300 },
      { id: 'work-2', discoveredAt: 200 },
      { id: 'work-1', discoveredAt: 100 },
    ];
    const openCursor = vi.fn(async (_range: unknown, direction: string) => {
      const ordered = direction === 'prev' ? rows : [...rows].reverse();
      let position = 0;
      const cursor = {
        get value() {
          return ordered[position];
        },
        continue: async () => {
          position += 1;
          return position < ordered.length ? cursor : null;
        },
      };
      return cursor;
    });
    const discoveredAtIndex = { count, openCursor };
    initDB.mockResolvedValue({
      getAll,
      transaction: () => ({
        store: {
          index: (name: string) => {
            if (name !== 'by_discoveredAt') throw new Error(`unexpected index ${name}`);
            return discoveredAtIndex;
          },
        },
      }),
    });

    const { newWorksQuery } = await import('./indexedDb');
    const result = await newWorksQuery({
      filter: 'all',
      sort: 'discoveredAt',
      order: 'desc',
      offset: 1,
      limit: 2,
    });

    expect(result).toEqual({
      total: 4,
      items: [rows[1], rows[2]],
    });
    expect(openCursor).toHaveBeenCalledWith(undefined, 'prev');
    expect(getAll).not.toHaveBeenCalled();
  });
});
