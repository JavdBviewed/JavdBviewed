export const HOME_CHART_RENDERER = 'svg' as const;

export type HomeChartOptions = Record<string, unknown>;

/**
 * Keep the chart API and layout unchanged while avoiding a Canvas backing
 * surface for the default dashboard renderer.
 */
export function withHomeChartRenderPolicy<T extends HomeChartOptions>(options: T): T & {
  animation: false;
  renderer: typeof HOME_CHART_RENDERER;
} {
  return {
    ...options,
    animation: false,
    renderer: HOME_CHART_RENDERER,
  } as T & {
    animation: false;
    renderer: typeof HOME_CHART_RENDERER;
  };
}

export function getHomeEchartsInitOptions(): { renderer: typeof HOME_CHART_RENDERER } {
  return { renderer: HOME_CHART_RENDERER };
}
