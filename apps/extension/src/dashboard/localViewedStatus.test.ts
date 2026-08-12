import { describe, expect, it } from 'vitest';
import { readViewedStatusesWithReader } from './localViewedStatus';

describe('Dashboard 本地观看状态读取', () => {
  it('只读取去重后的番号并过滤已删除记录', async () => {
    const calls: string[] = [];
    const result = await readViewedStatusesWithReader(
      ['A', 'A', 'B', 'C'],
      {
        get: async (id) => {
          calls.push(id);
          if (id === 'B') return { id, status: 'viewed', deletedAt: 1 };
          return { id, status: id === 'A' ? 'want' : 'browsed' };
        },
      },
    );

    expect(calls).toEqual(['A', 'B', 'C']);
    expect(result).toEqual([
      { id: 'A', status: 'want' },
      { id: 'C', status: 'browsed' },
    ]);
  });
});
