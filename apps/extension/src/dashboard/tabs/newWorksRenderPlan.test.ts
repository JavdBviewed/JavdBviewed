import { describe, expect, it, vi } from 'vitest';

import { renderNewWorksPage } from './newWorksRenderPlan';

describe('new works render plan', () => {
  it('reuses the list query statistics instead of starting a second statistics query', async () => {
    const stats = {
      totalSubscriptions: 2,
      activeSubscriptions: 2,
      totalNewWorks: 12,
      unreadWorks: 4,
      todayDiscovered: 1,
    };
    const events: string[] = [];
    const renderList = vi.fn(async () => {
      events.push('list');
      return { stats };
    });
    const renderStats = vi.fn(async (receivedStats) => {
      events.push('stats');
      expect(receivedStats).toBe(stats);
    });

    await renderNewWorksPage({
      renderList,
      renderStats,
      options: { renderList: true, renderStats: true },
    });

    expect(events).toEqual(['list', 'stats']);
    expect(renderList).toHaveBeenCalledTimes(1);
    expect(renderStats).toHaveBeenCalledTimes(1);
  });

  it('schedules statistics after the first list instead of blocking activation', async () => {
    const events: string[] = [];
    let scheduledStats: (() => void) | undefined;
    const renderList = vi.fn(async () => {
      events.push('list');
      return undefined;
    });
    const renderStats = vi.fn(async () => {
      events.push('stats');
    });

    await renderNewWorksPage({
      renderList,
      renderStats,
      scheduleStats: (callback) => {
        scheduledStats = callback;
      },
      options: { renderList: true, renderStats: true },
    });

    expect(events).toEqual(['list']);
    scheduledStats?.();
    await Promise.resolve();
    expect(events).toEqual(['list', 'stats']);
  });
});
