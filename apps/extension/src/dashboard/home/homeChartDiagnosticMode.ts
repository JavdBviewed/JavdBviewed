/**
 * @file homeChartDiagnosticMode.ts
 * @description 首页图表性能对照用的只读诊断配置，不影响普通首页行为。
 * @module dashboard/home
 */

export type HomeChartDiagnosticGroup =
  | 'all'
  | 'none'
  | 'trends'
  | 'summary'
  | 'single-status'
  | 'single-bars'
  | 'single-tags'
  | 'single-change'
  | 'single-new-tags';

export type HomeChartDiagnosticRenderer = 'auto' | 'g2plot' | 'echarts';

export type HomeChartDiagnosticConfig = {
  mode: HomeChartDiagnosticGroup;
  renderer: HomeChartDiagnosticRenderer;
};

export type HomeChartRenderPlan = {
  renderer: HomeChartDiagnosticRenderer;
  enabled: Record<HomeChartKey, boolean>;
  needs: {
    statusStats: boolean;
    newWorksStats: boolean;
    tagsTop: boolean;
    trends: boolean;
    insights: boolean;
  };
};

const DEFAULT_CONFIG: HomeChartDiagnosticConfig = {
  mode: 'all',
  renderer: 'auto',
};

const VALID_MODES = new Set<HomeChartDiagnosticGroup>([
  'all',
  'none',
  'trends',
  'summary',
  'single-status',
  'single-bars',
  'single-tags',
  'single-change',
  'single-new-tags',
]);

const VALID_RENDERERS = new Set<HomeChartDiagnosticRenderer>(['auto', 'g2plot', 'echarts']);

export function getHomeChartDiagnosticConfig(value: string | undefined): HomeChartDiagnosticConfig {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (!normalized) return { ...DEFAULT_CONFIG };
  const [rawMode, rawRenderer = 'auto'] = normalized.split(':', 2);
  if (!VALID_MODES.has(rawMode as HomeChartDiagnosticGroup)
    || !VALID_RENDERERS.has(rawRenderer as HomeChartDiagnosticRenderer)) {
    return { ...DEFAULT_CONFIG };
  }
  return {
    mode: rawMode as HomeChartDiagnosticGroup,
    renderer: rawRenderer as HomeChartDiagnosticRenderer,
  };
}

export function readHomeChartDiagnosticConfig(): HomeChartDiagnosticConfig {
  try {
    const value = new URLSearchParams(window.location.search).get('perfHomeCharts') ?? undefined;
    return getHomeChartDiagnosticConfig(value);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export type HomeChartKey =
  | 'status'
  | 'bars'
  | 'tags'
  | 'change'
  | 'newTags'
  | 'recordsTrend'
  | 'actorsTrend'
  | 'newWorksTrend';

export function shouldRenderHomeChart(
  config: HomeChartDiagnosticConfig,
  key: HomeChartKey,
): boolean {
  if (config.mode === 'all') return true;
  if (config.mode === 'none') return false;
  if (config.mode === 'trends') return key.endsWith('Trend');
  if (config.mode === 'summary') return !key.endsWith('Trend');
  const singleKey: Record<Exclude<HomeChartDiagnosticGroup, 'all' | 'none' | 'trends' | 'summary'>, HomeChartKey> = {
    'single-status': 'status',
    'single-bars': 'bars',
    'single-tags': 'tags',
    'single-change': 'change',
    'single-new-tags': 'newTags',
  };
  return singleKey[config.mode] === key;
}

export function getHomeChartRenderPlan(config: HomeChartDiagnosticConfig): HomeChartRenderPlan {
  const keys: HomeChartKey[] = [
    'status',
    'bars',
    'tags',
    'change',
    'newTags',
    'recordsTrend',
    'actorsTrend',
    'newWorksTrend',
  ];
  const enabled = keys.reduce<Record<HomeChartKey, boolean>>((result, key) => {
    result[key] = shouldRenderHomeChart(config, key);
    return result;
  }, {
    status: false,
    bars: false,
    tags: false,
    change: false,
    newTags: false,
    recordsTrend: false,
    actorsTrend: false,
    newWorksTrend: false,
  });
  return {
    renderer: config.renderer,
    enabled,
    needs: {
      statusStats: enabled.status,
      newWorksStats: enabled.bars,
      tagsTop: enabled.tags,
      trends: enabled.recordsTrend || enabled.actorsTrend || enabled.newWorksTrend,
      insights: enabled.change || enabled.newTags,
    },
  };
}
