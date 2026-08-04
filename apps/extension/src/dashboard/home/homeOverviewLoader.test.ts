import { describe, expect, it, vi } from 'vitest';
import { loadHomeOverviewData } from './homeOverviewLoader';

describe('loadHomeOverviewData', () => {
  it('loads independent home data in parallel and does not request an all-history range', async () => {
    const gates = [
      Promise.resolve({ total: 3, byStatus: {}, last7Days: 0, last30Days: 0 }),
      Promise.resolve({ total: 4, unread: 1, today: 1, week: 2 }),
      Promise.resolve([{ date: '2026-07-30', tags: { 业余: 1 } }]),
      Promise.resolve([{ date: '2026-07-31', tags: { 美乳: 2 } }]),
      Promise.resolve([{ name: '美乳', count: 2 }]),
      Promise.resolve([{ date: '2026-07-31', total: 3, viewed: 1, browsed: 1, want: 1 }]),
      Promise.resolve([{ date: '2026-07-31', total: 2, female: 1, male: 1, blacklisted: 0 }]),
      Promise.resolve([{ date: '2026-07-31', total: 4, unread: 2 }]),
    ];
    const loaders = {
      viewedStats: vi.fn(() => gates[0]),
      newWorksStats: vi.fn(() => gates[1]),
      previousViews: vi.fn(() => gates[2]),
      currentViews: vi.fn(() => gates[3]),
      tagsTop: vi.fn(() => gates[4]),
      recordsTrend: vi.fn(() => gates[5]),
      actorsTrend: vi.fn(() => gates[6]),
      newWorksTrend: vi.fn(() => gates[7]),
    };

    const result = await loadHomeOverviewData(
      { start: '2026-07-31', end: '2026-07-31' },
      loaders,
    );

    expect(result.viewedStats.total).toBe(3);
    expect(result.tagsTop).toEqual([{ name: '美乳', count: 2 }]);
    expect(result.trends.records).toHaveLength(1);
    expect(loaders.previousViews).toHaveBeenCalledWith('2026-07-30', '2026-07-30');
    expect(loaders.currentViews).toHaveBeenCalledWith('2026-07-31', '2026-07-31');
    expect(loaders.currentViews).not.toHaveBeenCalledWith('1970-01-01', '2999-12-31');
    expect(loaders.recordsTrend).toHaveBeenCalledWith('2026-07-31', '2026-07-31', 'cumulative');
    expect(loaders.actorsTrend).toHaveBeenCalledWith('2026-07-31', '2026-07-31', 'cumulative');
    expect(loaders.newWorksTrend).toHaveBeenCalledWith('2026-07-31', '2026-07-31', 'daily');
  });
});
