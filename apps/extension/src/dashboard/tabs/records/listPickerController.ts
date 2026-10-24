import type { ListRecord, VideoRecord } from '../../../types';
import { isVideoListRecord } from '../../../shared/utils/listRecordHelpers';

export interface RecordsListPickerElements {
  panel: HTMLElement;
  listEl: HTMLElement;
  titleEl?: HTMLElement | null;
  batchFooter?: HTMLElement | null;
}

export interface RecordsListPickerCallbacks {
  selectedRecords: Set<string>;
  getVisibleRecords: () => VideoRecord[];
  loadLists: () => Promise<ListRecord[]>;
  onExecuteListChange: (videoIds: string[], listId: string, action: 'add' | 'remove') => Promise<void>;
  escapeHtml: (value: string) => string;
}

export interface CreateRecordsListPickerControllerOptions extends RecordsListPickerElements, RecordsListPickerCallbacks {}

export interface RecordsListPickerController {
  openSingleRecordPicker: (record: VideoRecord) => Promise<void>;
  openBatchListPicker: () => Promise<void>;
}

function buildListPickerHtml(
  lists: ListRecord[],
  currentListIds: Set<string>,
  escapeHtml: (value: string) => string,
  recordId?: string,
): string {
  if (lists.length === 0) {
    return '<div class="list-picker-empty">暂无清单</div>';
  }

  return lists.map((list) => {
    const badge = list.source === 'local'
      ? '<span class="list-source-badge list-source-local">本地</span>'
      : '<span class="list-source-badge list-source-javdb">JavDB</span>';
    const isSelected = currentListIds.has(String(list.id));
    const recordAttr = recordId ? ` data-record-id="${escapeHtml(recordId)}"` : '';
    const selectedClass = isSelected ? 'selected' : '';
    const actions = recordId
      ? ''
      : `
        <div class="list-picker-item-actions">
          <button class="batch-list-add-btn button-like" data-list-id="${escapeHtml(list.id)}">添加</button>
          <button class="batch-list-remove-btn button-like" data-list-id="${escapeHtml(list.id)}">移除</button>
        </div>
      `;

    return `<div class="list-picker-item ${selectedClass}" data-list-id="${escapeHtml(list.id)}"${recordAttr}>
      <i class="fas ${isSelected ? 'fa-check-square' : 'fa-square'}"></i>
      <span>${escapeHtml(String(list.name || list.id))}</span>${badge}
      ${actions}
    </div>`;
  }).join('');
}

async function syncRecordListIds(
  records: VideoRecord[],
  recordIds: string[],
  listId: string,
  action: 'add' | 'remove',
): Promise<void> {
  const visibleById = new Map(records.map((record) => [record.id, record]));
  for (const recordId of recordIds) {
    const record = visibleById.get(recordId);
    if (!record) continue;
    const ids = new Set<string>(Array.isArray(record.listIds) ? record.listIds : []);
    if (action === 'add') {
      ids.add(listId);
    } else {
      ids.delete(listId);
    }
    record.listIds = Array.from(ids);
  }
}

export function createRecordsListPickerController(
  options: CreateRecordsListPickerControllerOptions,
): RecordsListPickerController {
  const openPicker = async (
    mode: 'single' | 'batch',
    record?: VideoRecord,
  ): Promise<void> => {
    const lists = (await options.loadLists()).filter(isVideoListRecord);
    const selectedIds = mode === 'single' && record ? new Set<string>(Array.isArray(record.listIds) ? record.listIds : []) : new Set<string>();
    const titleText = mode === 'single'
      ? `添加到清单：${record?.id || ''}`
      : `批量修改清单（已选 ${options.selectedRecords.size} 项）`;

    if (options.titleEl) {
      options.titleEl.textContent = titleText;
    }
    if (options.batchFooter) {
      options.batchFooter.style.display = mode === 'single' ? 'none' : '';
    }

    options.listEl.innerHTML = buildListPickerHtml(
      lists,
      mode === 'single' ? selectedIds : new Set<string>(),
      options.escapeHtml,
      mode === 'single' ? record?.id : undefined,
    );

    if (mode === 'single') {
      options.listEl.querySelectorAll('.list-picker-item').forEach((item) => {
        item.addEventListener('click', async () => {
          const listId = (item as HTMLElement).getAttribute('data-list-id') || '';
          const currentRecordId = (item as HTMLElement).getAttribute('data-record-id') || record?.id || '';
          const action: 'add' | 'remove' = item.classList.contains('selected') ? 'remove' : 'add';
          await options.onExecuteListChange([currentRecordId], listId, action);
          item.classList.toggle('selected', action === 'add');
          const icon = item.querySelector('i');
          if (icon) icon.className = `fas ${action === 'add' ? 'fa-check-square' : 'fa-square'}`;
        });
      });
    } else {
      options.listEl.querySelectorAll('.batch-list-add-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const listId = (btn as HTMLElement).getAttribute('data-list-id') || '';
          await options.onExecuteListChange(Array.from(options.selectedRecords), listId, 'add');
          await syncRecordListIds(options.getVisibleRecords(), Array.from(options.selectedRecords), listId, 'add');
        });
      });
      options.listEl.querySelectorAll('.batch-list-remove-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const listId = (btn as HTMLElement).getAttribute('data-list-id') || '';
          await options.onExecuteListChange(Array.from(options.selectedRecords), listId, 'remove');
          await syncRecordListIds(options.getVisibleRecords(), Array.from(options.selectedRecords), listId, 'remove');
        });
      });
    }

  };

  return {
    openSingleRecordPicker: (record: VideoRecord) => openPicker('single', record),
    openBatchListPicker: () => openPicker('batch'),
  };
}
