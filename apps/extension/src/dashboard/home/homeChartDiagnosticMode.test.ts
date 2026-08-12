import { describe, expect, it } from 'vitest';

import {
  getHomeChartDiagnosticConfig,
  getHomeChartRenderPlan,
  shouldRenderHomeChart,
} from './homeChartDiagnosticMode';

describe('home chart diagnostic mode', () => {
  it('defaults to all charts with the automatic renderer', () => {
    expect(getHomeChartDiagnosticConfig(undefined)).toEqual({
      mode: 'all',
      renderer: 'auto',
    });
  });

  it('parses a chart group and renderer from the probe value', () => {
    expect(getHomeChartDiagnosticConfig('trends:echarts')).toEqual({
      mode: 'trends',
      renderer: 'echarts',
    });
    expect(getHomeChartDiagnosticConfig('summary:g2plot')).toEqual({
      mode: 'summary',
      renderer: 'g2plot',
    });
  });

  it('rejects unsupported probe values instead of changing normal behavior', () => {
    expect(getHomeChartDiagnosticConfig('unknown:renderer')).toEqual({
      mode: 'all',
      renderer: 'auto',
    });
  });

  it('selects only the requested chart group', () => {
    expect(shouldRenderHomeChart({ mode: 'none', renderer: 'auto' }, 'status')).toBe(false);
    expect(shouldRenderHomeChart({ mode: 'trends', renderer: 'auto' }, 'recordsTrend')).toBe(true);
    expect(shouldRenderHomeChart({ mode: 'trends', renderer: 'auto' }, 'tagsTop')).toBe(false);
    expect(shouldRenderHomeChart({ mode: 'single-status', renderer: 'auto' }, 'status')).toBe(true);
    expect(shouldRenderHomeChart({ mode: 'single-status', renderer: 'auto' }, 'bars')).toBe(false);
  });

  it('builds a renderer-aware plan without changing the default all-chart behavior', () => {
    expect(getHomeChartRenderPlan(getHomeChartDiagnosticConfig('none:echarts'))).toEqual({
      renderer: 'echarts',
      enabled: {
        status: false,
        bars: false,
        tags: false,
        change: false,
        newTags: false,
        recordsTrend: false,
        actorsTrend: false,
        newWorksTrend: false,
      },
      needs: {
        statusStats: false,
        newWorksStats: false,
        tagsTop: false,
        trends: false,
        insights: false,
      },
    });
    const trendsPlan = getHomeChartRenderPlan(getHomeChartDiagnosticConfig('trends:g2plot'));
    expect(trendsPlan.enabled).toEqual({
      status: false,
      bars: false,
      tags: false,
      change: false,
      newTags: false,
      recordsTrend: true,
      actorsTrend: true,
      newWorksTrend: true,
    });
    expect(trendsPlan.needs).toEqual({
      statusStats: false,
      newWorksStats: false,
      tagsTop: false,
      trends: true,
      insights: false,
    });
  });
});
