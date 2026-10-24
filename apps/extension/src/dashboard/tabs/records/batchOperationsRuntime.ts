import type { ListRecord, VideoRecord, VideoStatus } from '../../../types';
import {
  createRecordsBatchActionsController,
  type RecordsBatchActionsController,
} from './batchActionsController';
import {
  createRecordsBatchAddTagController,
  type RecordsBatchAddTagController,
} from './batchAddTagController';
import {
  createRecordsBatchAddTagRuntime,
  type RecordsBatchAddTagRuntime,
} from './batchAddTagRuntime';
import {
  createRecordsBatchToolbarController,
  type CreateRecordsBatchToolbarControllerOptions,
  type RecordsBatchToolbarController,
} from './batchToolbarController';
import {
  createRecordsListPickerRuntime,
  type RecordsBulkPatchListResult,
  type RecordsListPickerRuntime,
} from './listPickerRuntime';

type MessageType = 'info' | 'warn' | 'warning' | 'error' | 'success';

type CreateListPickerRuntime = typeof createRecordsListPickerRuntime;
type CreateBatchAddTagRuntime = typeof createRecordsBatchAddTagRuntime;
type CreateBatchAddTagController = typeof createRecordsBatchAddTagController;
type CreateBatchActionsController = typeof createRecordsBatchActionsController;
type CreateBatchToolbarController = typeof createRecordsBatchToolbarController;

export interface CreateRecordsBatchOperationsRuntimeOptions {
  selectedRecords: Set<string>;
  getVisibleRecords: () => VideoRecord[];
  loadLists: () => Promise<ListRecord[]>;
  patchList: (videoId: string, listId: string, action: 'add' | 'remove') => Promise<unknown>;
  bulkPatchList: (videoIds: string[], listId: string, action: 'add' | 'remove') => Promise<RecordsBulkPatchListResult>;
  showMessage: (message: string, type: MessageType) => void;
  render: () => void;
  escapeHtml: (value: string) => string;
  getSelectedIds: () => string[];
  refreshRecord: (recordId: string) => Promise<void>;
  deleteRecords: (recordIds: string[]) => Promise<void>;
  clearSelection: () => void;
  afterMutation: () => void;
  toolbarElements: Pick<
    CreateRecordsBatchToolbarControllerOptions,
    | 'selectAllCheckbox'
    | 'batchActionsBtn'
    | 'batchActionsDropdown'
    | 'batchModifyListBtn'
    | 'batchAddTagBtn'
    | 'batchModifyStatusBtn'
    | 'batchRefreshBtn'
    | 'batchDeleteBtn'
    | 'cancelBatchBtn'
  >;
  onSelectAll: () => void;
  onClearSelection: () => void;
  getRecordById: (id: string) => Promise<VideoRecord | undefined>;
  putRecord: (record: VideoRecord) => Promise<unknown>;
  updateRecordStatus: (recordId: string, status: VideoStatus) => Promise<void>;
  createListPickerRuntime?: CreateListPickerRuntime;
  createBatchAddTagRuntime?: CreateBatchAddTagRuntime;
  createBatchAddTagController?: CreateBatchAddTagController;
  createBatchActionsController?: CreateBatchActionsController;
  createBatchToolbarController?: CreateBatchToolbarController;
}

export interface RecordsBatchOperationsRuntime {
  listPickerRuntime: RecordsListPickerRuntime;
  batchToolbarController: RecordsBatchToolbarController;
  batchAddTagRuntime: RecordsBatchAddTagRuntime;
  batchAddTagController: RecordsBatchAddTagController;
  batchActionsController: RecordsBatchActionsController;
}

export function createRecordsBatchOperationsRuntime(
  options: CreateRecordsBatchOperationsRuntimeOptions,
): RecordsBatchOperationsRuntime {
  const createListPickerRuntime = options.createListPickerRuntime || createRecordsListPickerRuntime;
  const createBatchAddTagRuntime = options.createBatchAddTagRuntime || createRecordsBatchAddTagRuntime;
  const createBatchAddTagController = options.createBatchAddTagController || createRecordsBatchAddTagController;
  const createBatchActionsController = options.createBatchActionsController || createRecordsBatchActionsController;
  const createBatchToolbarController = options.createBatchToolbarController || createRecordsBatchToolbarController;

  const listPickerRuntime = createListPickerRuntime({
    selectedRecords: options.selectedRecords,
    getVisibleRecords: options.getVisibleRecords,
    loadLists: options.loadLists,
    patchList: options.patchList,
    bulkPatchList: options.bulkPatchList,
    showMessage: options.showMessage,
    render: options.render,
    escapeHtml: options.escapeHtml,
  });

  const batchAddTagRuntime = createBatchAddTagRuntime({
    getVisibleRecords: options.getVisibleRecords,
    getRecordById: options.getRecordById,
    putRecord: options.putRecord,
    showMessage: options.showMessage,
    render: options.render,
  });

  const batchAddTagController = createBatchAddTagController({
    getSelectedCount: () => options.selectedRecords.size,
    showMessage: options.showMessage,
    onSubmit: async (tags) => {
      await batchAddTagRuntime.executeBatchAddTag(Array.from(options.selectedRecords), tags);
    },
  });

  const batchActionsController = createBatchActionsController({
    getSelectedIds: options.getSelectedIds,
    refreshRecord: options.refreshRecord,
    deleteRecords: options.deleteRecords,
    updateRecordStatus: options.updateRecordStatus,
    clearSelection: options.clearSelection,
    afterMutation: options.afterMutation,
    showMessage: options.showMessage,
  });

  const batchToolbarController = createBatchToolbarController({
    ...options.toolbarElements,
    onSelectAll: options.onSelectAll,
    onClearSelection: options.onClearSelection,
    onBatchRefresh: () => batchActionsController.handleBatchRefresh(),
    onBatchDelete: () => batchActionsController.handleBatchDelete(),
    onOpenBatchListPicker: () => listPickerRuntime.openBatch(),
    onOpenBatchAddTag: () => batchAddTagController.openBatchAddTag(),
    onBatchModifyStatus: () => batchActionsController.handleBatchModifyStatus(),
  });

  return {
    listPickerRuntime,
    batchToolbarController,
    batchAddTagRuntime,
    batchAddTagController,
    batchActionsController,
  };
}
