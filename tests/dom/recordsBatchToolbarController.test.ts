/**
 * @file recordsBatchToolbarController.test.ts
 * @description records batch toolbar controller 测试
 * @module tests/dom
 */
import { describe, expect, it, vi } from 'vitest';
import { createRecordsBatchToolbarController } from '../../apps/extension/src/dashboard/tabs/records/batchToolbarController';

function setupDom() {
  document.body.innerHTML = `
    <input id="selectAllCheckbox" type="checkbox" />
    <button id="batchActionsBtn"></button>
    <div id="batchActionsDropdown" style="display:none"></div>
    <button id="batchModifyListBtn"></button>
    <button id="batchAddTagBtn"></button>
    <button id="batchModifyStatusBtn"></button>
    <button id="batchRefreshBtn"></button>
    <button id="batchDeleteBtn"></button>
    <button id="cancelBatchBtn"></button>
  `;

  return {
    selectAllCheckbox: document.getElementById('selectAllCheckbox') as HTMLInputElement,
    batchActionsBtn: document.getElementById('batchActionsBtn') as HTMLButtonElement,
    batchActionsDropdown: document.getElementById('batchActionsDropdown') as HTMLDivElement,
    batchModifyListBtn: document.getElementById('batchModifyListBtn') as HTMLButtonElement,
    batchAddTagBtn: document.getElementById('batchAddTagBtn') as HTMLButtonElement,
    batchModifyStatusBtn: document.getElementById('batchModifyStatusBtn') as HTMLButtonElement,
    batchRefreshBtn: document.getElementById('batchRefreshBtn') as HTMLButtonElement,
    batchDeleteBtn: document.getElementById('batchDeleteBtn') as HTMLButtonElement,
    cancelBatchBtn: document.getElementById('cancelBatchBtn') as HTMLButtonElement,
  };
}

describe('records batch toolbar controller', () => {
  it('binds select all and cancel selection callbacks', () => {
    const elements = setupDom();
    const onSelectAll = vi.fn();
    const onClearSelection = vi.fn();
    createRecordsBatchToolbarController({
      ...elements,
      onSelectAll,
      onClearSelection,
      onBatchRefresh: vi.fn(),
      onBatchDelete: vi.fn(),
      onOpenBatchListPicker: vi.fn(),
      onOpenBatchAddTag: vi.fn(),
      onBatchModifyStatus: vi.fn(),
    }).bind();

    elements.selectAllCheckbox.dispatchEvent(new Event('change'));
    elements.cancelBatchBtn.click();

    expect(onSelectAll).toHaveBeenCalledTimes(1);
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  it('toggles the actions dropdown and closes it from document click', () => {
    const elements = setupDom();
    createRecordsBatchToolbarController({
      ...elements,
      onSelectAll: vi.fn(),
      onClearSelection: vi.fn(),
      onBatchRefresh: vi.fn(),
      onBatchDelete: vi.fn(),
      onOpenBatchListPicker: vi.fn(),
      onOpenBatchAddTag: vi.fn(),
      onBatchModifyStatus: vi.fn(),
    }).bind();

    elements.batchActionsBtn.click();
    expect(elements.batchActionsDropdown.style.display).toBe('block');

    document.body.click();
    expect(elements.batchActionsDropdown.style.display).toBe('none');
  });

  it('hides dropdown before running batch action callbacks', () => {
    const elements = setupDom();
    elements.batchActionsDropdown.style.display = 'block';
    const callbacks = {
      onBatchRefresh: vi.fn(),
      onBatchDelete: vi.fn(),
      onOpenBatchListPicker: vi.fn(),
      onOpenBatchAddTag: vi.fn(),
      onBatchModifyStatus: vi.fn(),
    };
    createRecordsBatchToolbarController({
      ...elements,
      onSelectAll: vi.fn(),
      onClearSelection: vi.fn(),
      ...callbacks,
    }).bind();

    elements.batchRefreshBtn.click();
    elements.batchDeleteBtn.click();
    elements.batchModifyListBtn.click();
    elements.batchAddTagBtn.click();
    elements.batchModifyStatusBtn.click();

    expect(elements.batchActionsDropdown.style.display).toBe('none');
    expect(callbacks.onBatchRefresh).toHaveBeenCalledTimes(1);
    expect(callbacks.onBatchDelete).toHaveBeenCalledTimes(1);
    expect(callbacks.onOpenBatchListPicker).toHaveBeenCalledTimes(1);
    expect(callbacks.onOpenBatchAddTag).toHaveBeenCalledTimes(1);
    expect(callbacks.onBatchModifyStatus).toHaveBeenCalledTimes(1);
  });
});
