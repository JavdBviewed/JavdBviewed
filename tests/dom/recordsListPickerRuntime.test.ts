/**
 * @file recordsListPickerRuntime.test.ts
 * @description records list picker runtime 测试（10-24：浮层改 body 级动态 modal）
 * @module tests/dom
 */
import { describe, expect, it, vi } from 'vitest';
import { createRecordsListPickerRuntime } from '../../apps/extension/src/dashboard/tabs/records/listPickerRuntime';
import type { ListRecord, VideoRecord } from '../../apps/extension/src/types';

function createRecord(overrides: Partial<VideoRecord> = {}): VideoRecord {
  return {
    id: 'ABC-123',
    title: '测试影片',
    status: 'viewed',
    listIds: ['list-1'],
    createdAt: 1,
    updatedAt: 2,
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

/** 模拟真实页面结构：tab 内容容器（含 contain:layout 的前置条件），浮层不得挂在其内。 */
function setupDom() {
  document.body.innerHTML = '<div class="tab-content"><div class="video-list-container"></div></div>';
}

function baseOptions(overrides: Record<string, unknown> = {}) {
  return {
    selectedRecords: new Set<string>(),
    getVisibleRecords: () => [] as VideoRecord[],
    loadLists: vi.fn().mockResolvedValue([] as ListRecord[]),
    patchList: vi.fn().mockResolvedValue(undefined),
    bulkPatchList: vi.fn(),
    showMessage: vi.fn(),
    render: vi.fn(),
    escapeHtml: (value: string) => value,
    ...overrides,
  };
}

describe('records list picker runtime', () => {
  it('builds the modal at document.body level, outside the tab container', async () => {
    setupDom();
    const runtime = createRecordsListPickerRuntime(baseOptions({
      getVisibleRecords: () => [createRecord()],
      loadLists: vi.fn().mockResolvedValue([createList()]),
    }));

    await runtime.openSingle(createRecord());

    const modal = document.body.querySelector('.list-picker-panel') as HTMLElement;
    expect(modal).toBeTruthy();
    expect(modal.parentElement).toBe(document.body);
    expect(document.querySelector('.tab-content')?.contains(modal)).toBe(false);
    expect(modal.querySelector('.list-picker-title')?.textContent).toBe('添加到清单：ABC-123');
    expect(modal.querySelector('.list-picker-item.selected')?.getAttribute('data-list-id')).toBe('list-1');
  });

  it('renders the batch picker with the footer done button visible', async () => {
    setupDom();
    const runtime = createRecordsListPickerRuntime(baseOptions({
      selectedRecords: new Set(['AAA-001', 'AAA-002']),
      loadLists: vi.fn().mockResolvedValue([createList()]),
    }));

    await runtime.openBatch();

    const modal = document.body.querySelector('.list-picker-panel') as HTMLElement;
    expect(modal.querySelector('.list-picker-title')?.textContent).toBe('批量修改清单（已选 2 项）');
    const footer = modal.querySelector('.list-picker-batch-footer') as HTMLElement;
    expect(footer.style.display).not.toBe('none');
    expect(modal.querySelector('.list-picker-done')).toBeTruthy();
  });

  it('close removes the modal from body with no DOM residue', async () => {
    setupDom();
    const runtime = createRecordsListPickerRuntime(baseOptions({
      loadLists: vi.fn().mockResolvedValue([createList()]),
    }));

    await runtime.openSingle(createRecord());
    expect(document.body.querySelector('.list-picker-panel')).toBeTruthy();

    runtime.close();

    expect(document.body.querySelector('.list-picker-panel')).toBeNull();
  });

  it('closes through the three close paths: Esc / backdrop / close button', async () => {
    // Esc 键
    setupDom();
    let runtime = createRecordsListPickerRuntime(baseOptions({
      loadLists: vi.fn().mockResolvedValue([createList()]),
    }));
    await runtime.openSingle(createRecord());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.body.querySelector('.list-picker-panel')).toBeNull();

    // 背景遮罩
    setupDom();
    runtime = createRecordsListPickerRuntime(baseOptions({
      loadLists: vi.fn().mockResolvedValue([createList()]),
    }));
    await runtime.openSingle(createRecord());
    (document.body.querySelector('.list-picker-backdrop') as HTMLElement).click();
    expect(document.body.querySelector('.list-picker-panel')).toBeNull();

    // 头部关闭钮
    setupDom();
    runtime = createRecordsListPickerRuntime(baseOptions({
      loadLists: vi.fn().mockResolvedValue([createList()]),
    }));
    await runtime.openSingle(createRecord());
    (document.body.querySelector('.list-picker-close') as HTMLElement).click();
    expect(document.body.querySelector('.list-picker-panel')).toBeNull();
  });

  it('closes through the batch footer done button', async () => {
    setupDom();
    const runtime = createRecordsListPickerRuntime(baseOptions({
      selectedRecords: new Set(['AAA-001']),
      loadLists: vi.fn().mockResolvedValue([createList()]),
    }));

    await runtime.openBatch();
    (document.body.querySelector('.list-picker-done') as HTMLElement).click();

    expect(document.body.querySelector('.list-picker-panel')).toBeNull();
  });

  it('applies single list changes to DB and visible records', async () => {
    setupDom();
    const visibleRecord = createRecord({ listIds: ['list-1'] });
    const patchList = vi.fn().mockResolvedValue(undefined);
    const render = vi.fn();
    const runtime = createRecordsListPickerRuntime(baseOptions({
      getVisibleRecords: () => [visibleRecord],
      patchList,
      render,
    }));

    await runtime.executeListChange(['ABC-123'], 'list-2', 'add');

    expect(patchList).toHaveBeenCalledWith('ABC-123', 'list-2', 'add');
    expect(visibleRecord.listIds).toEqual(['list-1', 'list-2']);
    expect(render).toHaveBeenCalled();
  });

  it('applies batch list changes and reports partial failures', async () => {
    setupDom();
    const first = createRecord({ id: 'A', listIds: [] });
    const second = createRecord({ id: 'B', listIds: ['list-1'] });
    const showMessage = vi.fn();
    const runtime = createRecordsListPickerRuntime(baseOptions({
      selectedRecords: new Set(['A', 'B']),
      getVisibleRecords: () => [first, second],
      bulkPatchList: vi.fn().mockResolvedValue({ successCount: 1, failCount: 1 }),
      showMessage,
    }));

    await runtime.executeListChange(['A', 'B'], 'list-1', 'remove');

    expect(showMessage).toHaveBeenCalledWith('移除完成：成功 1 条，失败 1 条', 'warning');
    expect(first.listIds).toEqual([]);
    expect(second.listIds).toEqual([]);
  });
});
