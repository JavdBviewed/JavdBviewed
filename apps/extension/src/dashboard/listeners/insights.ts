// src/dashboard/listeners/insights.ts

import { initOrUpdateHomeCharts, invalidateHomeOverview } from '../home/charts';
import { shouldRefreshHomeCharts } from './insightsRefreshPolicy';

export function createInsightsRefreshScheduler(
  refresh: () => void | Promise<void>,
  delayMs = 250,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let refreshPromise: Promise<void> | null = null;
  let dirty = false;

  const schedule = (): void => {
    dirty = true;
    if (timer || refreshPromise) return;
    timer = setTimeout(() => {
      timer = null;
      if (!dirty || refreshPromise) return;
      dirty = false;
      refreshPromise = Promise.resolve()
        .then(() => refresh())
        .catch(() => {})
        .finally(() => {
          refreshPromise = null;
          if (dirty) schedule();
        });
    }, Math.max(0, delayMs));
  };

  return schedule;
}

export type InsightsViewsChangedContext = {
  activeTabId: string | null;
  visibilityState: DocumentVisibilityState;
};

export function handleInsightsViewsChanged(
  context: InsightsViewsChangedContext,
  invalidate: () => void,
  schedule: () => void,
): void {
  if (!shouldRefreshHomeCharts(context)) return;
  invalidate();
  schedule();
}

export function bindInsightsListeners(): void {
  try {
    const W: any = window as any;
    if (!W.__INSIGHTS_CHANGED_BOUND__) {
      const scheduleRefresh = createInsightsRefreshScheduler(() => initOrUpdateHomeCharts());
      chrome.runtime.onMessage.addListener((msg: any) => {
        try {
          if (msg && msg.type === 'DB:INSIGHTS_VIEWS_CHANGED') {
            const activeTabId = document.querySelector<HTMLElement>('.tab-content.active')?.id ?? null;
            handleInsightsViewsChanged(
              { activeTabId, visibilityState: document.visibilityState },
              invalidateHomeOverview,
              scheduleRefresh,
            );
          }
        } catch {}
      });
      W.__INSIGHTS_CHANGED_BOUND__ = true;
    }
  } catch {}
}
