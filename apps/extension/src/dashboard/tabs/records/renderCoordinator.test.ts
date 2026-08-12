import { describe, expect, it, vi } from 'vitest';
import { createRecordsRenderCoordinator } from './renderCoordinator';

describe('records render coordinator', () => {
  it('does not continue the stats refresh after the tab becomes hidden', async () => {
    let active = true;
    let resolvePage: (() => void) | null = null;
    const updateStats = vi.fn();
    const renderServerPage = vi.fn(() => new Promise<void>((resolve) => {
      resolvePage = resolve;
    }));
    const coordinator = createRecordsRenderCoordinator({
      videoList: { innerHTML: '' } as HTMLElement,
      shouldUseIDB: () => true,
      setServerModeActive: vi.fn(),
      renderServerPage,
      updateFilteredRecords: vi.fn(),
      renderVideoList: vi.fn(),
      renderPagination: vi.fn(),
      updateStats,
      isActive: () => active,
    });

    coordinator.render();
    active = false;
    resolvePage?.();
    await vi.waitFor(() => expect(renderServerPage).toHaveBeenCalledTimes(1));
    await Promise.resolve();

    expect(updateStats).not.toHaveBeenCalled();
  });

  it('defers stats refresh until the completed page has an idle turn', async () => {
    let resolvePage: (() => void) | null = null;
    let runScheduledStats: (() => void) | null = null;
    const updateStats = vi.fn();
    const renderServerPage = vi.fn(() => new Promise<void>((resolve) => {
      resolvePage = resolve;
    }));
    const scheduleStats = vi.fn((callback: () => void) => {
      runScheduledStats = callback;
    });
    const coordinator = createRecordsRenderCoordinator({
      videoList: { innerHTML: '' } as HTMLElement,
      shouldUseIDB: () => true,
      setServerModeActive: vi.fn(),
      renderServerPage,
      updateFilteredRecords: vi.fn(),
      renderVideoList: vi.fn(),
      renderPagination: vi.fn(),
      updateStats,
      scheduleStats,
    });

    coordinator.render();
    resolvePage?.();
    await vi.waitFor(() => expect(scheduleStats).toHaveBeenCalledTimes(1));

    expect(updateStats).not.toHaveBeenCalled();
    runScheduledStats?.();
    await Promise.resolve();
    expect(updateStats).toHaveBeenCalledTimes(1);
  });
});
