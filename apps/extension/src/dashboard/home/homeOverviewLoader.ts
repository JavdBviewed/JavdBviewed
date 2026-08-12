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

export interface HomeOverviewTrendData {
  insights: ReturnType<typeof aggregateMonthly>;
  trends: {
    records: any[];
    actors: any[];
    newWorks: any[];
  };
}

export interface HomeOverviewSummaryData<ViewedStats = any, NewWorksStats = any> {
  viewedStats: ViewedStats;
  newWorksStats: NewWorksStats;
  tagsTop: Array<{ name: string; count: number }>;
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
  const stages = loadHomeOverviewStages(range, loaders);
  const [trendData, summaryData] = await Promise.all([stages.trends, stages.summary]);

  return {
    ...summaryData,
    insights: trendData.insights,
    trends: trendData.trends,
  };
}

export function loadHomeOverviewStages<ViewedStats = any, NewWorksStats = any>(
  range: HomeChartsRange,
  loaders: HomeOverviewLoaders<ViewedStats, NewWorksStats>,
): {
  trends: Promise<HomeOverviewTrendData>;
  summary: Promise<HomeOverviewSummaryData<ViewedStats, NewWorksStats>>;
} {
  const previousStart = shiftDate(range.start, -1);
  const previousEnd = shiftDate(range.end, -1);

  const trends = Promise.all([
    loaders.previousViews(previousStart, previousEnd),
    loaders.currentViews(range.start, range.end),
    loaders.recordsTrend(range.start, range.end, 'cumulative'),
    loaders.actorsTrend(range.start, range.end, 'cumulative'),
    loaders.newWorksTrend(range.start, range.end, 'daily'),
  ]).then(([previousViews, currentViews, records, actors, newWorks]) => ({
    insights: aggregateMonthly(currentViews || [], { topN: 8, previousDays: previousViews || [] }),
    trends: { records: records || [], actors: actors || [], newWorks: newWorks || [] },
  }));

  const summary = Promise.all([
    loaders.viewedStats(),
    loaders.newWorksStats(),
    loaders.tagsTop(50),
  ]).then(([viewedStats, newWorksStats, tagsTop]) => ({
    viewedStats,
    newWorksStats,
    tagsTop: Array.isArray(tagsTop) ? tagsTop : [],
  }));

  return { trends, summary };
}
