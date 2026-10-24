/**
 * @file recordsListPickerController.test.ts
 * @description records list picker controller 测试
 * @module tests/dom
 */
import { describe, expect, it, vi } from 'vitest';
import { createRecordsListPickerController } from '../../apps/extension/src/dashboard/tabs/records/listPickerController';
import type { ListRecord, VideoRecord } from '../../apps/extension/src/types';

function createRecord(overrides: Partial<VideoRecord> = {}): VideoRecord {
  return {
    id: 'ABC-123',
    title: '测试影片',
    status: 'viewed',
    createdAt: 1,
    updatedAt: 2,
    listIds: ['list-1'],
    ...overrides,
  };
}

function createList(overrides: Partial<ListRecord> = {}): ListRecord {
  return {
    id: 'list-1',
    name: '清单一',
    type: 'mine',
    source: 'javdb',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function setupDom() {
  document.body.innerHTML = `
    <div id="listPickerPanel"></div>
    <div id="listPickerTitle"></div>
    <div id="listPickerList"></div>
    <div id="listPickerBatchFooter"></div>
  `;

  return {
    panel: document.getElementById('listPickerPanel') as HTMLDivElement,
    titleEl: document.getElementById('listPickerTitle') as HTMLDivElement,
    listEl: document.getElementById('listPickerList') as HTMLDivElement,
    batchFooter: document.getElementById('listPickerBatchFooter') as HTMLDivElement,
  };
}

describe('records list picker controller', () => {
  it('renders the single record list picker and toggles list actions', async () => {
    const elements = setupDom();
    const onExecuteListChange = vi.fn().mockResolvedValue(undefined);
    const controller = createRecordsListPickerController({
      ...elements,
      selectedRecords: new Set<string>(),
      getVisibleRecords: () => [createRecord()],
      loadLists: vi.fn().mockResolvedValue([
        createList(),
        createList({ id: 'list-2', name: '清单二', source: 'local' }),
      ]),
      onExecuteListChange,
      escapeHtml: (value) => value,
    });

    await controller.openSingleRecordPicker(createRecord());

    expect(elements.titleEl.textContent).toBe('添加到清单：ABC-123');
    expect(elements.batchFooter.style.display).toBe('none');
    const selectedItem = elements.listEl.querySelector('.list-picker-item.selected') as HTMLElement;
    expect(selectedItem?.getAttribute('data-list-id')).toBe('list-1');

    selectedItem.click();
    expect(onExecuteListChange).toHaveBeenCalledWith(['ABC-123'], 'list-1', 'remove');
  });

  it('renders the batch list picker and delegates add actions with selected records', async () => {
    const elements = setupDom();
    const onExecuteListChange = vi.fn().mockResolvedValue(undefined);
    const controller = createRecordsListPickerController({
      ...elements,
      selectedRecords: new Set<string>(['AAA-001', 'AAA-002']),
      getVisibleRecords: () => [createRecord({ id: 'AAA-001' }), createRecord({ id: 'AAA-002' })],
      loadLists: vi.fn().mockResolvedValue([
        createList(),
        createList({ id: 'list-2', name: '清单二', source: 'local' }),
      ]),
      onExecuteListChange,
      escapeHtml: (value) => value,
    });

    await controller.openBatchListPicker();

    expect(elements.titleEl.textContent).toBe('批量修改清单（已选 2 项）');
    expect(elements.batchFooter.style.display).toBe('');
    const addButton = elements.listEl.querySelector('.batch-list-add-btn') as HTMLButtonElement;

    addButton.click();
    expect(onExecuteListChange).toHaveBeenCalledWith(['AAA-001', 'AAA-002'], 'list-1', 'add');
  });
});
