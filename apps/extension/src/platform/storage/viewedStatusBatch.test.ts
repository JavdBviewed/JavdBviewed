import { describe, expect, it } from 'vitest';
import { chunkViewedStatusIds } from './viewedStatusBatch';

describe('观看状态批量读取分批策略', () => {
  it('按固定批大小切分主键并保持原顺序', () => {
    expect(chunkViewedStatusIds(['A', 'B', 'C', 'D', 'E'], 2)).toEqual([
      ['A', 'B'],
      ['C', 'D'],
      ['E'],
    ]);
  });

  it('先去重，再切分，避免同一请求重复读取', () => {
    expect(chunkViewedStatusIds(['A', 'A', '', 'B', 'C'], 2)).toEqual([
      ['A', 'B'],
      ['C'],
    ]);
  });
});
