/**
 * @file recordsRenderCoordinator.test.ts
 * @description records render coordinator 测试
 * @module tests/dom
 */
import { describe, expect, it, vi } from 'vitest';
import { createRecordsRenderCoordinator } from '../../apps/extension/src/dashboard/tabs/records/renderCoordinator';

describe('records render coordinator', () => {
  it('runs server mode render flow when IDB is enabled', async () => {
    const videoList = document.createElement('ul');
    const renderServerPage = vi.fn().mockResolvedValue(undefined);
    const updateStats = vi.fn();
    const coordinator = createRecordsRenderCoordinator({
      videoList,
      shouldUseIDB: () => true,
      setServerModeActive: vi.fn(),
      renderServerPage,
      updateFilteredRecords: vi.fn(),
      renderVideoList: vi.fn(),
      renderPagination: vi.fn(),
      updateStats,
    });

    coordinator.render();
    await Promise.resolve();

    expect(videoList.innerHTML).toContain('加载中');
    expect(renderServerPage).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(updateStats).toHaveBeenCalledTimes(1));
  });

  it('runs local mode render flow when IDB is disabled', () => {
    const videoList = document.createElement('ul');
    const updateFilteredRecords = vi.fn();
    const renderVideoList = vi.fn();
    const renderPagination = vi.fn();
    const updateStats = vi.fn();
    const setServerModeActive = vi.fn();
    const coordinator = createRecordsRenderCoordinator({
      videoList,
      shouldUseIDB: () => false,
      setServerModeActive,
      renderServerPage: vi.fn(),
      updateFilteredRecords,
      renderVideoList,
      renderPagination,
      updateStats,
      showLoading: vi.fn(),
    });

    coordinator.render();

    expect(setServerModeActive).toHaveBeenCalledWith(false);
    expect(updateFilteredRecords).toHaveBeenCalledTimes(1);
    expect(renderVideoList).toHaveBeenCalledTimes(1);
    expect(renderPagination).toHaveBeenCalledTimes(1);
    expect(updateStats).toHaveBeenCalledTimes(1);
  });
});
