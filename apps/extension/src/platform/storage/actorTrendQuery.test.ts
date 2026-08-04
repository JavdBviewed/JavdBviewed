import { describe, expect, it, vi } from 'vitest';
import { loadActorsForTrend } from './actorTrendQuery';

describe('loadActorsForTrend', () => {
  it('reads bounded actor rows from date indexes instead of scanning the object store', async () => {
    const createdIndex = { getAll: vi.fn(async () => [{ id: 'created', createdAt: 10, gender: 'female' }]) };
    const updatedIndex = { getAll: vi.fn(async () => [{ id: 'updated', updatedAt: 20, gender: 'male' }]) };
    const store = {
      index: vi.fn((name: string) => name === 'by_createdAt' ? createdIndex : updatedIndex),
    };
    const db = { transaction: vi.fn(() => ({ store })) };
    const upperBound = vi.fn((value: number) => ({ upperBound: value }));

    const rows = await loadActorsForTrend(db as any, 100, upperBound);

    expect(db.transaction).toHaveBeenCalledWith('actors');
    expect(store.index).toHaveBeenCalledWith('by_createdAt');
    expect(store.index).toHaveBeenCalledWith('by_updatedAt');
    expect(createdIndex.getAll).toHaveBeenCalledWith({ upperBound: 100 });
    expect(updatedIndex.getAll).toHaveBeenCalledWith({ upperBound: 100 });
    expect(rows.map((row) => row.id)).toEqual(['created', 'updated']);
  });
});
