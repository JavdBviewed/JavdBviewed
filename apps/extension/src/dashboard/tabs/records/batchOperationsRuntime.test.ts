import { describe, expect, it, vi } from 'vitest';
import { createRecordsBatchOperationsRuntime } from './batchOperationsRuntime';
import type { VideoRecord } from '../../../types';

function record(id: string): VideoRecord {
  return {
    id,
    title: id,
    status: 'viewed',
    createdAt: 1,
    updatedAt: 2,
  };
}

describe('records batch operations runtime', () => {
  it('wires list picker, add-tag, batch actions, and toolbar callbacks', async () => {
    const selectedRecords = new Set(['AAA-001', 'BBB-002']);
    const visibleRecords = [record('AAA-001'), record('BBB-002')];
    const listPickerRuntime = {
      close: vi.fn(),
      ensureController: vi.fn(),
      openSingle: vi.fn(),
      openBatch: vi.fn(),
      executeListChange: vi.fn(),
    };
    const batchAddTagRuntime = {
      executeBatchAddTag: vi.fn(),
    };
    const batchAddTagController = {
      openBatchAddTag: vi.fn(),
    };
    const batchActionsController = {
      handleBatchRefresh: vi.fn(),
      handleBatchDelete: vi.fn(),
      handleBatchModifyStatus: vi.fn(),
    };
    const batchToolbarController = {
      bind: vi.fn(),
    };
    const createListPickerRuntime = vi.fn(() => listPickerRuntime);
    const createBatchAddTagRuntime = vi.fn(() => batchAddTagRuntime);
    const createBatchAddTagController = vi.fn(() => batchAddTagController);
    const createBatchActionsController = vi.fn(() => batchActionsController);
    const createBatchToolbarController = vi.fn(() => batchToolbarController);
    const onSelectAll = vi.fn();
    const onClearSelection = vi.fn();
    const afterMutation = vi.fn();

    const runtime = createRecordsBatchOperationsRuntime({
      selectedRecords,
      getVisibleRecords: () => visibleRecords,
      loadLists: vi.fn(),
      patchList: vi.fn(),
      bulkPatchList: vi.fn(),
      showMessage: vi.fn(),
      render: vi.fn(),
      escapeHtml: (value) => value,
      getSelectedIds: () => Array.from(selectedRecords),
      refreshRecord: vi.fn(),
      deleteRecords: vi.fn(),
      clearSelection: vi.fn(),
      afterMutation,
      toolbarElements: {
        selectAllCheckbox: {} as HTMLInputElement,
        batchActionsBtn: {} as HTMLButtonElement,
        batchActionsDropdown: {} as HTMLElement,
        batchModifyListBtn: {} as HTMLButtonElement,
        batchAddTagBtn: {} as HTMLButtonElement,
        batchRefreshBtn: {} as HTMLButtonElement,
        batchDeleteBtn: {} as HTMLButtonElement,
        cancelBatchBtn: {} as HTMLButtonElement,
      },
      onSelectAll,
      onClearSelection,
      getRecordById: vi.fn(),
      putRecord: vi.fn(),
      updateRecordStatus: vi.fn(),
      createListPickerRuntime,
      createBatchAddTagRuntime,
      createBatchAddTagController,
      createBatchActionsController,
      createBatchToolbarController,
    });

    const addTagOptions = createBatchAddTagController.mock.calls[0][0];
    await addTagOptions.onSubmit(['中文字幕']);
    const actionsOptions = createBatchActionsController.mock.calls[0][0];
    expect(actionsOptions.updateRecordStatus).toBeTypeOf('function');
    actionsOptions.afterMutation();
    const toolbarOptions = createBatchToolbarController.mock.calls[0][0];
    toolbarOptions.onSelectAll();
    toolbarOptions.onClearSelection();
    await toolbarOptions.onOpenBatchListPicker();
    toolbarOptions.onOpenBatchAddTag();
    await toolbarOptions.onBatchRefresh();
    await toolbarOptions.onBatchDelete();
    toolbarOptions.onBatchModifyStatus();

    expect(runtime.listPickerRuntime).toBe(listPickerRuntime);
    expect(runtime.batchToolbarController).toBe(batchToolbarController);
    expect(createListPickerRuntime).toHaveBeenCalledWith(expect.objectContaining({
      selectedRecords,
      getVisibleRecords: expect.any(Function),
    }));
    expect(createBatchAddTagRuntime).toHaveBeenCalledWith(expect.objectContaining({
      getVisibleRecords: expect.any(Function),
      getRecordById: expect.any(Function),
      putRecord: expect.any(Function),
    }));
    expect(batchAddTagRuntime.executeBatchAddTag).toHaveBeenCalledWith(['AAA-001', 'BBB-002'], ['中文字幕']);
    expect(afterMutation).toHaveBeenCalledTimes(1);
    expect(onSelectAll).toHaveBeenCalledTimes(1);
    expect(onClearSelection).toHaveBeenCalledTimes(1);
    expect(listPickerRuntime.openBatch).toHaveBeenCalledTimes(1);
    expect(batchAddTagController.openBatchAddTag).toHaveBeenCalledTimes(1);
    expect(batchActionsController.handleBatchRefresh).toHaveBeenCalledTimes(1);
    expect(batchActionsController.handleBatchDelete).toHaveBeenCalledTimes(1);
    expect(batchActionsController.handleBatchModifyStatus).toHaveBeenCalledTimes(1);
  });
});
