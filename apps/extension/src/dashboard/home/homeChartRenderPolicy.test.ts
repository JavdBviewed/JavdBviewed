import { describe, expect, it } from 'vitest';
import {
  getHomeEchartsInitOptions,
  HOME_CHART_RENDERER,
  withHomeChartRenderPolicy,
} from './homeChartRenderPolicy';

describe('home chart render policy', () => {
  it('uses SVG and keeps dashboard chart animation disabled', () => {
    expect(withHomeChartRenderPolicy({ autoFit: true, animation: true })).toEqual({
      autoFit: true,
      animation: false,
      renderer: HOME_CHART_RENDERER,
    });
  });

  it('uses the same renderer for the ECharts fallback', () => {
    expect(getHomeEchartsInitOptions()).toEqual({ renderer: 'svg' });
  });
});
