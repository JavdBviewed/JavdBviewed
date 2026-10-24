import { hideRecordsProgressModal, showRecordsProgressModal, updateRecordsProgressModal } from './progressModalController';
import type { VideoStatus } from '../../../types';

type MessageType = 'info' | 'warn' | 'warning' | 'error' | 'success';

/**
 * 批量修改状态的 4 个存储态选项（本线本地常量，不依赖跨线字典模块）。
 * 派生态（已入库/真实已看）=资料库同步自动判定的筛选维度，不可手设，不进选项。
 */
export const BATCH_STATUS_OPTIONS: ReadonlyArray<{ value: VideoStatus; label: string }> = [
  { value: 'untracked', label: '未标记' },
  { value: 'viewed', label: '已观看' },
  { value: 'browsed', label: '已浏览' },
  { value: 'want', label: '想看' },
];

export function isBatchStoredStatus(value: string): value is VideoStatus {
  return BATCH_STATUS_OPTIONS.some(option => option.value === value);
}

export interface BatchModifyStatusItemError {
  recordId: string;
  message: string;
}

export interface BatchModifyStatusResult {
  successCount: number;
  failCount: number;
  errors: BatchModifyStatusItemError[];
}

export interface ExecuteBatchModifyStatusOptions {
  recordIds: string[];
  status: string;
  updateRecordStatus: (recordId: string, status: VideoStatus) => Promise<void>;
  onProgress?: (completed: number, total: number) => void;
  delayMs?: number;
}

/**
 * 批量修改状态纯模型：值域校验（只收 4 存储态，传派生值=抛错）+ per-item 失败隔离 + 结果汇总。
 */
export async function executeBatchModifyStatus(options: ExecuteBatchModifyStatusOptions): Promise<BatchModifyStatusResult> {
  if (!isBatchStoredStatus(options.status)) {
    throw new Error(`非法的状态值：${options.status}`);
  }

  let successCount = 0;
  const errors: BatchModifyStatusItemError[] = [];

  for (const recordId of options.recordIds) {
    try {
      await options.updateRecordStatus(recordId, options.status);
      successCount++;
    } catch (error: any) {
      errors.push({ recordId, message: error?.message ?? String(error) });
    }
    options.onProgress?.(successCount + errors.length, options.recordIds.length);
    await delay(options.delayMs ?? 0);
  }

  return { successCount, failCount: errors.length, errors };
}

export interface CreateRecordsBatchActionsControllerOptions {
  getSelectedIds: () => string[];
  refreshRecord: (recordId: string) => Promise<void>;
  deleteRecords: (recordIds: string[]) => Promise<void>;
  updateRecordStatus: (recordId: string, status: VideoStatus) => Promise<void>;
  clearSelection: () => void;
  afterMutation: () => void;
  showMessage: (message: string, type: MessageType) => void;
  delayMs?: number;
}

export interface RecordsBatchActionsController {
  handleBatchRefresh: () => Promise<void>;
  handleBatchDelete: () => Promise<void>;
  handleBatchModifyStatus: () => void;
}

function showCustomConfirm(title: string, message: string, onConfirm: () => void, onCancel?: () => void): void {
  const modal = document.createElement('div');
  modal.className = 'custom-confirm-modal';
  modal.innerHTML = `
    <div class="custom-confirm-overlay"></div>
    <div class="custom-confirm-content">
      <div class="custom-confirm-header">
        <h3>${title}</h3>
      </div>
      <div class="custom-confirm-body">
        <p>${message}</p>
      </div>
      <div class="custom-confirm-footer">
        <button class="custom-confirm-cancel">取消</button>
        <button class="custom-confirm-ok">确定</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const overlay = modal.querySelector('.custom-confirm-overlay') as HTMLElement;
  const cancelBtn = modal.querySelector('.custom-confirm-cancel') as HTMLButtonElement;
  const okBtn = modal.querySelector('.custom-confirm-ok') as HTMLButtonElement;

  const closeModal = () => {
    modal.remove();
  };

  overlay.addEventListener('click', () => {
    closeModal();
    onCancel?.();
  });

  cancelBtn.addEventListener('click', () => {
    closeModal();
    onCancel?.();
  });

  okBtn.addEventListener('click', () => {
    closeModal();
    onConfirm();
  });

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeModal();
      onCancel?.();
      document.removeEventListener('keydown', handleKeydown);
    }
  };
  document.addEventListener('keydown', handleKeydown);
}

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 批量修改状态确认 modal（body 级动态，与 showCustomConfirm 同模式）。
 * 摘要随 radio 变化：「已选 N 项 → 状态 X」；未选择时确定钮禁用。
 */
function showBatchStatusModal(count: number, onConfirm: (status: VideoStatus) => void, onCancel?: () => void): void {
  const modal = document.createElement('div');
  modal.className = 'batch-status-modal';
  modal.innerHTML = `
    <div class="batch-status-overlay"></div>
    <div class="batch-status-content">
      <div class="batch-status-header">
        <h3>批量修改状态</h3>
      </div>
      <div class="batch-status-body">
        ${BATCH_STATUS_OPTIONS.map(option => `
          <label class="batch-status-option">
            <input type="radio" name="batchStatusRadio" value="${option.value}">
            <span>${option.label}</span>
          </label>`).join('')}
        <p class="batch-status-summary">已选 ${count} 项</p>
      </div>
      <div class="batch-status-footer">
        <button class="batch-status-cancel">取消</button>
        <button class="batch-status-ok" disabled>确定</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const summary = modal.querySelector('.batch-status-summary') as HTMLElement;
  const okBtn = modal.querySelector('.batch-status-ok') as HTMLButtonElement;

  const closeModal = () => {
    modal.remove();
    document.removeEventListener('keydown', handleKeydown);
  };

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeModal();
      onCancel?.();
    }
  };
  document.addEventListener('keydown', handleKeydown);

  modal.querySelectorAll<HTMLInputElement>('.batch-status-option input[type="radio"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const option = BATCH_STATUS_OPTIONS.find(item => item.value === radio.value);
      if (!option) return;
      summary.textContent = `已选 ${count} 项 → 状态 ${option.label}`;
      okBtn.disabled = false;
    });
  });

  modal.querySelector('.batch-status-overlay')?.addEventListener('click', () => {
    closeModal();
    onCancel?.();
  });
  modal.querySelector('.batch-status-cancel')?.addEventListener('click', () => {
    closeModal();
    onCancel?.();
  });
  okBtn.addEventListener('click', () => {
    const selected = Array.from(modal.querySelectorAll<HTMLInputElement>('.batch-status-option input[type="radio"]'))
      .find(radio => radio.checked);
    const status = selected?.value as VideoStatus | undefined;
    closeModal();
    if (status) onConfirm(status);
  });
}

export function createRecordsBatchActionsController(
  options: CreateRecordsBatchActionsControllerOptions,
): RecordsBatchActionsController {
  const performBatchRefresh = async (selectedIds: string[]) => {
    const progressModal = showRecordsProgressModal('正在刷新源数据...', selectedIds.length);

    try {
      let completed = 0;
      const errors: string[] = [];

      for (const recordId of selectedIds) {
        try {
          await options.refreshRecord(recordId);
          completed++;
          updateRecordsProgressModal(progressModal, completed, selectedIds.length, `已完成 ${completed}/${selectedIds.length}`);
          await delay(options.delayMs ?? 1000);
        } catch (error: any) {
          errors.push(`${recordId}: ${error.message}`);
          console.error(`[Records] 刷新记录 ${recordId} 失败:`, error);
        }
      }

      hideRecordsProgressModal(progressModal);
      options.clearSelection();
      options.afterMutation();

      if (errors.length > 0) {
        options.showMessage(`刷新完成，但有 ${errors.length} 个失败`, 'warn');
        console.log('[Records] 刷新失败的项目:', errors);
      } else {
        options.showMessage(`成功刷新了 ${completed} 个视频的源数据！`, 'success');
      }
    } catch (error: any) {
      hideRecordsProgressModal(progressModal);
      console.error('[Records] 批量刷新失败:', error);
      options.showMessage(`批量刷新失败: ${error.message}`, 'error');
      options.afterMutation();
    }
  };

  const performBatchModifyStatus = async (selectedIds: string[], status: VideoStatus) => {
    const progressModal = showRecordsProgressModal('正在修改状态...', selectedIds.length);

    try {
      const result = await executeBatchModifyStatus({
        recordIds: selectedIds,
        status,
        updateRecordStatus: options.updateRecordStatus,
        onProgress: (completed, total) => updateRecordsProgressModal(progressModal, completed, total, `已完成 ${completed}/${total}`),
        delayMs: options.delayMs ?? 1000,
      });

      hideRecordsProgressModal(progressModal);
      options.clearSelection();
      options.afterMutation();

      if (result.failCount > 0) {
        options.showMessage(`状态修改完成，但有 ${result.failCount} 个失败`, 'warn');
        console.log('[Records] 修改状态失败的项目:', result.errors);
      } else {
        options.showMessage(`成功修改了 ${result.successCount} 个视频的状态！`, 'success');
      }
    } catch (error: any) {
      hideRecordsProgressModal(progressModal);
      console.error('[Records] 批量修改状态失败:', error);
      options.showMessage(`批量修改状态失败: ${error.message}`, 'error');
    }
  };

  const performBatchDelete = async (selectedIds: string[]) => {
    try {
      await options.deleteRecords(selectedIds);
      options.clearSelection();
      options.afterMutation();
      options.showMessage(`成功删除了 ${selectedIds.length} 个视频记录！`, 'success');
    } catch (error: any) {
      console.error('[Records] 批量删除失败:', error);
      options.showMessage(`批量删除失败: ${error.message}`, 'error');
      options.afterMutation();
    }
  };

  return {
    handleBatchRefresh: async () => {
      const selectedIds = options.getSelectedIds();
      if (selectedIds.length === 0) return;

      showCustomConfirm(
        '批量刷新确认',
        `确定要刷新 ${selectedIds.length} 个视频的源数据吗？\n\n这将重新获取视频的详细信息，可能需要一些时间。`,
        () => {
          void performBatchRefresh(selectedIds);
        },
      );
    },
    handleBatchDelete: async () => {
      const selectedIds = options.getSelectedIds();
      if (selectedIds.length === 0) return;

      showCustomConfirm(
        '批量删除确认',
        `确定要删除 ${selectedIds.length} 个视频记录吗？\n\n删除后可在回收站中恢复（保留30天）。`,
        () => {
          void performBatchDelete(selectedIds);
        },
      );
    },
    handleBatchModifyStatus: () => {
      const selectedIds = options.getSelectedIds();
      if (selectedIds.length === 0) return;

      showBatchStatusModal(selectedIds.length, (status) => {
        void performBatchModifyStatus(selectedIds, status);
      });
    },
  };
}
