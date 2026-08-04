import { describe, expect, it } from 'vitest';
import { buildHomeStatusData } from './homeChartData';

describe('buildHomeStatusData', () => {
  it('builds the three status slices with theme-aware colors', () => {
    expect(buildHomeStatusData(
      { byStatus: { viewed: 2, browsed: 3, want: 4 } },
      { success: '#0a0', info: '#0bb', warning: '#f90' },
      false,
    )).toEqual([
      { name: '已观看', value: 2, color: '#0a0' },
      { name: '已浏览', value: 3, color: '#0bb' },
      { name: '想看', value: 4, color: '#f90' },
    ]);
  });
});
