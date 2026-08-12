export interface HomeChartsRefreshContext {
  activeTabId: string | null;
  visibilityState: DocumentVisibilityState;
}

export function shouldRefreshHomeCharts(context: HomeChartsRefreshContext): boolean {
  return context.activeTabId === 'tab-home' && context.visibilityState === 'visible';
}
