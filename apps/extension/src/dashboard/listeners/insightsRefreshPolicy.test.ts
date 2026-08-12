import { describe, expect, it, vi } from 'vitest';
import { shouldRefreshHomeCharts } from './insightsRefreshPolicy';
import { handleInsightsViewsChanged } from './insights';

describe('shouldRefreshHomeCharts', () => {
  it('refreshes only when the home tab is visible', () => {
    expect(shouldRefreshHomeCharts({ activeTabId: 'tab-home', visibilityState: 'visible' })).toBe(true);
  });

  it('does not refresh while another tab is active', () => {
    expect(shouldRefreshHomeCharts({ activeTabId: 'tab-media', visibilityState: 'visible' })).toBe(false);
  });

  it('does not refresh a hidden dashboard page', () => {
    expect(shouldRefreshHomeCharts({ activeTabId: 'tab-home', visibilityState: 'hidden' })).toBe(false);
  });

  it('does not invalidate the home overview while another tab is active', () => {
    const invalidate = vi.fn();
    const schedule = vi.fn();

    handleInsightsViewsChanged(
      { activeTabId: 'tab-media', visibilityState: 'visible' },
      invalidate,
      schedule,
    );

    expect(invalidate).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it('invalidates and schedules an active visible home overview', () => {
    const invalidate = vi.fn();
    const schedule = vi.fn();

    handleInsightsViewsChanged(
      { activeTabId: 'tab-home', visibilityState: 'visible' },
      invalidate,
      schedule,
    );

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledTimes(1);
  });
});
