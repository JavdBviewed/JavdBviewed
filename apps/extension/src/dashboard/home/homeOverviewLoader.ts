import { aggregateMonthly } from '../../features/insights';
import type { ViewsDaily } from '../../types/insights';

export interface HomeChartsRange {
  start: string;
  end: string;
}

export interface HomeOverviewLoaders<ViewedStats = any, NewWorksStats = any> {
  viewedStats: () => Promise<ViewedStats>;
  newWorksStats: () => Promise<NewWorksStats>;
  previousViews: (startDate: string, endDate: string) => Promise<ViewsDaily[]>;
  currentViews: (startDate: string, endDate: string) => Promise<ViewsDaily[]>;
  tagsTop: (limit: number) => Promise<Array<{ name: string; count: number }>>;
  recordsTrend: (startDate: string, endDate: string, mode: 'cumulative' | 'daily') => Promise<any[]>;
  actorsTrend: (startDate: string, endDate: string, mode: 'cumulative' | 'daily') => Promise<any[]>;
  newWorksTrend: (startDate: string, endDate: string, mode: 'cumulative' | 'daily') => Promise<any[]>;
}

export interface HomeOverviewData<ViewedStats = any, NewWorksStats = any> {
  viewedStats: ViewedStats;
  newWorksStats: NewWorksStats;
  insights: ReturnType<typeof aggregateMonthly>;
  tagsTop: Array<{ name: string; count: number }>;
  trends: {
    records: any[];
    actors: any[];
    newWorks: any[];
  };
}

function shiftDate(date: string, deltaDays: number): string {
  const [year, month, day] = String(date || '').split('-').map(Number);
  const value = new Date(year || 1970, (month || 1) - 1, day || 1);
  value.setDate(value.getDate() + deltaDays);
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export async function loadHomeOverviewData<ViewedStats = any, NewWorksStats = any>(
  range: HomeChartsRange,
  loaders: HomeOverviewLoaders<ViewedStats, NewWorksStats>,
): Promise<HomeOverviewData<ViewedStats, NewWorksStats>> {
  const previousStart = shiftDate(range.start, -1);
  const previousEnd = shiftDate(range.end, -1);

  const [viewedStats, newWorksStats, previousViews, currentViews, tagsTop, records, actors, newWorks] =
    await Promise.all([
      loaders.viewedStats(),
      loaders.newWorksStats(),
      loaders.previousViews(previousStart, previousEnd),
      loaders.currentViews(range.start, range.end),
      loaders.tagsTop(50),
      loaders.recordsTrend(range.start, range.end, 'cumulative'),
      loaders.actorsTrend(range.start, range.end, 'cumulative'),
      loaders.newWorksTrend(range.start, range.end, 'daily'),
    ]);

  return {
    viewedStats,
    newWorksStats,
    insights: aggregateMonthly(currentViews || [], { topN: 8, previousDays: previousViews || [] }),
    tagsTop: Array.isArray(tagsTop) ? tagsTop : [],
    trends: { records: records || [], actors: actors || [], newWorks: newWorks || [] },
  };
}
