import type { ListRecord, VideoRecord } from '../../../types';
import {
  createRecordsListPickerController,
  type RecordsListPickerController,
} from './listPickerController';

type MessageType = 'info' | 'warn' | 'warning' | 'error' | 'success';

export interface RecordsBulkPatchListResult {
  successCount: number;
  failCount: number;
}

export interface CreateRecordsListPickerRuntimeOptions {
  selectedRecords: Set<string>;
  getVisibleRecords: () => VideoRecord[];
  loadLists: () => Promise<ListRecord[]>;
  patchList: (videoId: string, listId: string, action: 'add' | 'remove') => Promise<unknown>;
  bulkPatchList: (videoIds: string[], listId: string, action: 'add' | 'remove') => Promise<RecordsBulkPatchListResult>;
  showMessage: (message: string, type: MessageType) => void;
  render: () => void;
  escapeHtml: (value: string) => string;
  documentRef?: Document;
}

export interface RecordsListPickerRuntime {
  close: () => void;
  ensureController: () => RecordsListPickerController | null;
  openSingle: (record: VideoRecord) => Promise<void>;
  openBatch: () => Promise<void>;
  executeListChange: (videoIds: string[], listId: string, action: 'add' | 'remove') => Promise<void>;
}

function syncVisibleRecordListIds(records: VideoRecord[], videoIds: string[], listId: string, action: 'add' | 'remove'): void {
  for (const id of videoIds) {
    const record = records.find(item => item.id === id);
    if (!record) continue;

    const ids = new Set<string>(Array.isArray(record.listIds) ? record.listIds : []);
    if (action === 'add') ids.add(listId); else ids.delete(listId);
    record.listIds = Array.from(ids);
  }
}

/**
 * 清单浮层 body 级动态 modal（10-24）。
 * 根因说明（防回退）：祖先 .tab-content { contain: layout style }（cycle-9 A1 性能决策，不可动）
 * 会改变 position:fixed 后代的包含块，使放在 tab 容器内的静态浮层退化成「页面底部内嵌」形态。
 * 因此浮层不得以静态节点回归 records.html，必须构建后挂 document.body，close 时整体 remove。
 */
function buildListPickerModal(documentRef: Document): HTMLElement {
  const modal = documentRef.createElement('div');
  modal.className = 'list-picker-panel';
  modal.innerHTML = `
    <div class="list-picker-backdrop"></div>
    <div class="list-picker-content">
      <div class="list-picker-header">
        <span class="list-picker-title">选择清单</span>
        <button class="list-picker-close" type="button"><i class="fas fa-times"></i></button>
      </div>
      <div class="list-picker-list"></div>
      <div class="list-picker-footer list-picker-batch-footer" style="display:none;">
        <button class="list-picker-done button-like button-primary" type="button">完成</button>
      </div>
    </div>
  `;
  return modal;
}

export function createRecordsListPickerRuntime(options: CreateRecordsListPickerRuntimeOptions): RecordsListPickerRuntime {
  const documentRef = options.documentRef || document;
  let modalEl: HTMLElement | null = null;
  let controller: RecordsListPickerController | null = null;
  let keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  const close = () => {
    if (modalEl) {
      modalEl.remove();
      modalEl = null;
    }
    if (keydownHandler) {
      documentRef.removeEventListener('keydown', keydownHandler);
      keydownHandler = null;
    }
    controller = null;
  };

  // 每次 open 绑定动态 DOM 的三条关闭路径（Esc / 背景 / 关闭钮）+ batch「完成」钮
  const bindModalClosePaths = (modal: HTMLElement) => {
    const onClose = () => close();
    modal.querySelector('.list-picker-backdrop')?.addEventListener('click', onClose);
    modal.querySelector('.list-picker-close')?.addEventListener('click', onClose);
    modal.querySelector('.list-picker-done')?.addEventListener('click', onClose);
    keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    documentRef.addEventListener('keydown', keydownHandler);
  };

  const executeListChange = async (videoIds: string[], listId: string, action: 'add' | 'remove') => {
    const actionText = action === 'add' ? '添加' : '移除';
    try {
      if (videoIds.length === 1) {
        await options.patchList(videoIds[0], listId, action);
      } else {
        const result = await options.bulkPatchList(videoIds, listId, action);
        const message = result.failCount > 0
          ? `${actionText}完成：成功 ${result.successCount} 条，失败 ${result.failCount} 条`
          : `已${actionText} ${result.successCount} 条视频到清单`;
        options.showMessage(message, result.failCount > 0 ? 'warning' : 'success');
      }

      syncVisibleRecordListIds(options.getVisibleRecords(), videoIds, listId, action);
      options.render();
    } catch {
      options.showMessage(videoIds.length === 1 ? '操作失败' : `批量${actionText}清单失败`, 'error');
    }
  };

  const ensureController = (): RecordsListPickerController | null => {
    if (controller && modalEl && modalEl.isConnected) return controller;
    close();

    const modal = buildListPickerModal(documentRef);
    documentRef.body.appendChild(modal);
    modalEl = modal;
    bindModalClosePaths(modal);

    controller = createRecordsListPickerController({
      panel: modal,
      listEl: modal.querySelector('.list-picker-list') as HTMLElement,
      titleEl: modal.querySelector('.list-picker-title') as HTMLElement,
      batchFooter: modal.querySelector('.list-picker-batch-footer') as HTMLElement,
      selectedRecords: options.selectedRecords,
      getVisibleRecords: options.getVisibleRecords,
      loadLists: options.loadLists,
      escapeHtml: options.escapeHtml,
      onExecuteListChange: executeListChange,
    });
    return controller;
  };

  return {
    close,
    ensureController,
    openSingle: async (record) => {
      await ensureController()?.openSingleRecordPicker(record);
    },
    openBatch: async () => {
      if (options.selectedRecords.size === 0) return;
      await ensureController()?.openBatchListPicker();
    },
    executeListChange,
  };
}
