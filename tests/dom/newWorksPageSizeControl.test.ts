/**
 * @file newWorksPageSizeControl.test.ts
 * @description 新作品页「每页数量」选择器接线测试（11-02 G1）
 * @module tests/dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachNewWorksPageSizeControl } from '../../apps/extension/src/dashboard/tabs/newWorksFilterControlsRuntime';

function buildSelect(): HTMLSelectElement {
  const select = document.createElement('select');
  select.id = 'newWorksPageSizeSelect';
  for (const value of ['10', '20', '50', '100']) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  }
  document.body.appendChild(select);
  return select;
}

describe('new works page size control', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('syncs the select to the current page size', () => {
    const select = buildSelect();
    const onPageSizeChange = vi.fn();

    attachNewWorksPageSizeControl({ select, getPageSize: () => 20, onPageSizeChange });

    expect(select.options).toHaveLength(4);
    expect([...select.options].map(option => option.value)).toEqual(['10', '20', '50', '100']);
    expect(select.value).toBe('20');
  });

  it('notifies the clamped size on change', () => {
    const select = buildSelect();
    const onPageSizeChange = vi.fn();

    attachNewWorksPageSizeControl({ select, getPageSize: () => 10, onPageSizeChange });

    select.value = '50';
    select.dispatchEvent(new Event('change'));
    expect(onPageSizeChange).toHaveBeenCalledTimes(1);
    expect(onPageSizeChange).toHaveBeenCalledWith(50);

    select.value = '100';
    select.dispatchEvent(new Event('change'));
    expect(onPageSizeChange).toHaveBeenLastCalledWith(100);
  });

  it('falls back to the default size for an invalid select value', () => {
    const select = buildSelect();
    const onPageSizeChange = vi.fn();

    attachNewWorksPageSizeControl({ select, getPageSize: () => 10, onPageSizeChange });

    (select as HTMLSelectElement & { value: string }).value = '999';
    select.value = '';
    select.dispatchEvent(new Event('change'));
    expect(onPageSizeChange).toHaveBeenCalledWith(10);
  });
});
