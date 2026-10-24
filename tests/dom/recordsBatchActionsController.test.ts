/**
 * @file recordsBatchActionsController.test.ts
 * @description records batch actions controller 测试
 * @module tests/dom
 */
import { describe, expect, it, vi } from 'vitest';
import { createRecordsBatchActionsController } from '../../apps/extension/src/dashboard/tabs/records/batchActionsController';

async function waitFor(assertion: () => void, attempts = 20): Promise<void> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  throw lastError;
}

describe('records batch actions controller', () => {
  it('confirms and performs batch delete', () => {
    const deleteRecords = vi.fn().mockResolvedValue(undefined);
    const showMessage = vi.fn();
    const controller = createRecordsBatchActionsController({
      getSelectedIds: () => ['AAA-001', 'AAA-002'],
      refreshRecord: vi.fn(),
      deleteRecords,
      updateRecordStatus: vi.fn().mockResolvedValue(undefined),
      clearSelection: vi.fn(),
      afterMutation: vi.fn(),
      showMessage,
    });

    void controller.handleBatchDelete();

    const modal = document.querySelector('.custom-confirm-modal') as HTMLElement;
    expect(modal.textContent).toContain('批量删除确认');
    (modal.querySelector('.custom-confirm-ok') as HTMLButtonElement).click();

    expect(deleteRecords).toHaveBeenCalledWith(['AAA-001', 'AAA-002']);
  });

  it('shows progress while refreshing selected records', async () => {
    const refreshRecord = vi.fn().mockResolvedValue(undefined);
    const clearSelection = vi.fn();
    const afterMutation = vi.fn();
    const showMessage = vi.fn();
    const controller = createRecordsBatchActionsController({
      getSelectedIds: () => ['AAA-001', 'AAA-002'],
      refreshRecord,
      deleteRecords: vi.fn(),
      updateRecordStatus: vi.fn().mockResolvedValue(undefined),
      clearSelection,
      afterMutation,
      delayMs: 0,
      showMessage,
    });

    void controller.handleBatchRefresh();
    (document.querySelector('.custom-confirm-ok') as HTMLButtonElement).click();

    await waitFor(() => expect(clearSelection).toHaveBeenCalledTimes(1));
    expect(refreshRecord).toHaveBeenCalledTimes(2);
    expect(clearSelection).toHaveBeenCalledTimes(1);
    expect(afterMutation).toHaveBeenCalledTimes(1);
    expect(showMessage).toHaveBeenCalledWith('成功刷新了 2 个视频的源数据！', 'success');
    expect(document.querySelector('.batch-progress')).toBeNull();
  });

  it('opens the batch status modal and writes the selected status per item', async () => {
    const updateRecordStatus = vi.fn().mockResolvedValue(undefined);
    const clearSelection = vi.fn();
    const afterMutation = vi.fn();
    const showMessage = vi.fn();
    const controller = createRecordsBatchActionsController({
      getSelectedIds: () => ['AAA-001', 'AAA-002'],
      refreshRecord: vi.fn(),
      deleteRecords: vi.fn(),
      updateRecordStatus,
      clearSelection,
      afterMutation,
      delayMs: 0,
      showMessage,
    });

    void controller.handleBatchModifyStatus();

    const modal = document.querySelector('.batch-status-modal') as HTMLElement;
    expect(modal).toBeTruthy();
    const radios = Array.from(modal.querySelectorAll<HTMLInputElement>('.batch-status-option input[type="radio"]'));
    expect(radios).toHaveLength(4);
    expect(radios.map(radio => radio.value)).toEqual(['untracked', 'viewed', 'browsed', 'want']);
    const okBtn = modal.querySelector('.batch-status-ok') as HTMLButtonElement;
    expect(okBtn.disabled).toBe(true);

    radios[1].checked = true;
    radios[1].dispatchEvent(new Event('change'));
    expect(okBtn.disabled).toBe(false);
    const summary = modal.querySelector('.batch-status-summary') as HTMLElement;
    expect(summary.textContent).toContain('已选 2 项');
    expect(summary.textContent).toContain('已观看');

    okBtn.click();
    await waitFor(() => expect(clearSelection).toHaveBeenCalledTimes(1));
    expect(updateRecordStatus).toHaveBeenCalledTimes(2);
    expect(updateRecordStatus).toHaveBeenCalledWith('AAA-001', 'viewed');
    expect(updateRecordStatus).toHaveBeenCalledWith('AAA-002', 'viewed');
    expect(afterMutation).toHaveBeenCalledTimes(1);
    expect(showMessage).toHaveBeenCalledWith('成功修改了 2 个视频的状态！', 'success');
    expect(document.querySelector('.batch-status-modal')).toBeNull();
  });

  it('isolates batch status write failures and reports a summary', async () => {
    const updateRecordStatus = vi.fn(async (id: string) => {
      if (id === 'BAD-002') throw new Error('boom');
    });
    const showMessage = vi.fn();
    const controller = createRecordsBatchActionsController({
      getSelectedIds: () => ['AAA-001', 'BAD-002'],
      refreshRecord: vi.fn(),
      deleteRecords: vi.fn(),
      updateRecordStatus,
      clearSelection: vi.fn(),
      afterMutation: vi.fn(),
      delayMs: 0,
      showMessage,
    });

    void controller.handleBatchModifyStatus();
    const radios = Array.from(document.querySelectorAll<HTMLInputElement>('.batch-status-option input[type="radio"]'));
    radios[0].checked = true;
    radios[0].dispatchEvent(new Event('change'));
    (document.querySelector('.batch-status-ok') as HTMLButtonElement).click();

    await waitFor(() => expect(showMessage).toHaveBeenCalled());
    expect(updateRecordStatus).toHaveBeenCalledTimes(2);
    expect(showMessage).toHaveBeenCalledWith('状态修改完成，但有 1 个失败', 'warn');
  });

  it('does not open the batch status modal when nothing is selected', () => {
    const controller = createRecordsBatchActionsController({
      getSelectedIds: () => [],
      refreshRecord: vi.fn(),
      deleteRecords: vi.fn(),
      updateRecordStatus: vi.fn(),
      clearSelection: vi.fn(),
      afterMutation: vi.fn(),
      showMessage: vi.fn(),
    });

    void controller.handleBatchModifyStatus();

    expect(document.querySelector('.batch-status-modal')).toBeNull();
  });

  it('cancels the batch status modal without writing', () => {
    const updateRecordStatus = vi.fn();
    const controller = createRecordsBatchActionsController({
      getSelectedIds: () => ['AAA-001'],
      refreshRecord: vi.fn(),
      deleteRecords: vi.fn(),
      updateRecordStatus,
      clearSelection: vi.fn(),
      afterMutation: vi.fn(),
      showMessage: vi.fn(),
    });

    void controller.handleBatchModifyStatus();
    (document.querySelector('.batch-status-cancel') as HTMLButtonElement).click();

    expect(document.querySelector('.batch-status-modal')).toBeNull();
    expect(updateRecordStatus).not.toHaveBeenCalled();
  });
});
