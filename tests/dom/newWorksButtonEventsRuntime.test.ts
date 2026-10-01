/**
 * @file newWorksButtonEventsRuntime.test.ts
 * @description new works button events runtime 测试
 * @module tests/dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachNewWorksButtonEvents } from '../../apps/extension/src/dashboard/tabs/newWorksButtonEventsRuntime';

function renderButtons() {
  document.body.innerHTML = `
    <button id="checkNowBtn"></button>
    <button id="syncStatusBtn"></button>
    <button id="addSubscriptionBtn"></button>
    <button id="manageSubscriptionsBtn"></button>
    <button id="cleanupReadWorksBtn"></button>
    <button id="batchOpenUnreadBtn"></button>
    <button id="selectAllCurrentPageBtn"></button>
    <button id="clearSelectionBtn"></button>
    <button id="batchOpenSelectedBtn"></button>
    <button id="batchDeleteSelectedBtn"></button>
  `;
}

function handlers(overrides: Partial<Parameters<typeof attachNewWorksButtonEvents>[0]> = {}) {
  return {
    checkNow: vi.fn(),
    syncStatus: vi.fn(async () => undefined),
    setupSyncHelp: vi.fn(),
    setupCheckNowHelp: vi.fn(),
    addSubscription: vi.fn(),
    manageSubscriptions: vi.fn(),
    confirmCleanupRead: vi.fn(async () => true),
    cleanupReadWorks: vi.fn(async () => 3),
    render: vi.fn(async () => undefined),
    showMessage: vi.fn(),
    logError: vi.fn(),
    batchOpenUnread: vi.fn(async () => undefined),
    updateBatchOpenUnreadButton: vi.fn(),
    selectAllCurrentPage: vi.fn(),
    clearSelection: vi.fn(),
    batchOpenSelected: vi.fn(async () => undefined),
    batchDeleteSelected: vi.fn(async () => undefined),
    ...overrides,
  };
}

async function flushAsyncClick() {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

describe('new works button events runtime', () => {
  beforeEach(() => {
    renderButtons();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('routes toolbar and batch buttons to handlers', async () => {
    const runtime = handlers();

    attachNewWorksButtonEvents(runtime);

    document.getElementById('checkNowBtn')?.click();
    document.getElementById('syncStatusBtn')?.click();
    document.getElementById('addSubscriptionBtn')?.click();
    document.getElementById('manageSubscriptionsBtn')?.click();
    document.getElementById('batchOpenUnreadBtn')?.click();
    document.getElementById('selectAllCurrentPageBtn')?.click();
    document.getElementById('clearSelectionBtn')?.click();
    document.getElementById('batchOpenSelectedBtn')?.click();
    document.getElementById('batchDeleteSelectedBtn')?.click();
    await flushAsyncClick();

    expect(runtime.checkNow).toHaveBeenCalledTimes(1);
    expect(runtime.syncStatus).toHaveBeenCalledTimes(1);
    expect(runtime.setupSyncHelp).toHaveBeenCalledTimes(1);
    expect(runtime.setupCheckNowHelp).toHaveBeenCalledTimes(1);
    expect(runtime.addSubscription).toHaveBeenCalledTimes(1);
    expect(runtime.manageSubscriptions).toHaveBeenCalledTimes(1);
    expect(runtime.batchOpenUnread).toHaveBeenCalledTimes(1);
    expect(runtime.updateBatchOpenUnreadButton).toHaveBeenCalledTimes(1);
    expect(runtime.selectAllCurrentPage).toHaveBeenCalledTimes(1);
    expect(runtime.clearSelection).toHaveBeenCalledTimes(1);
    expect(runtime.batchOpenSelected).toHaveBeenCalledTimes(1);
    expect(runtime.batchDeleteSelected).toHaveBeenCalledTimes(1);
  });

  it('cleans read works after confirmation and shows success', async () => {
    const runtime = handlers();

    attachNewWorksButtonEvents(runtime);
    document.getElementById('cleanupReadWorksBtn')?.click();
    await flushAsyncClick();

    expect(runtime.confirmCleanupRead).toHaveBeenCalledTimes(1);
    expect(runtime.cleanupReadWorks).toHaveBeenCalledTimes(1);
    expect(runtime.render).toHaveBeenCalledTimes(1);
    expect(runtime.showMessage).toHaveBeenCalledWith('已清理 3 条已读作品', 'success');
  });

  it('skips cleanup when cancelled and reports cleanup failures', async () => {
    const cancelled = handlers({
      confirmCleanupRead: vi.fn(async () => false),
    });
    attachNewWorksButtonEvents(cancelled);
    document.getElementById('cleanupReadWorksBtn')?.click();
    await flushAsyncClick();

    expect(cancelled.cleanupReadWorks).not.toHaveBeenCalled();

    renderButtons();
    const failed = handlers({
      cleanupReadWorks: vi.fn(async () => { throw new Error('fail'); }),
    });
    attachNewWorksButtonEvents(failed);
    document.getElementById('cleanupReadWorksBtn')?.click();
    await flushAsyncClick();

    expect(failed.logError).toHaveBeenCalledWith('清理已读失败:', expect.any(Error));
    expect(failed.showMessage).toHaveBeenCalledWith('清理已读失败，请重试', 'error');
  });
});
