import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNewWorksAllResultsSelectionRuntime } from '../../apps/extension/src/dashboard/tabs/newWorksAllResultsSelectionRuntime';
import type { NewWorksFilters } from '../../apps/extension/src/dashboard/tabs/newWorksFilterTypes';

const filters: NewWorksFilters = { search: 'Alice', filter: 'unread', sort: 'actorName_asc' };

function setup(getNewWorks: (query: NewWorksFilters & { page: number; pageSize: number; includeStats: false }) => Promise<{ works: Array<{ id: string }>; total: number }>) {
  document.body.innerHTML = `
    <button id="selectAllResultsBtn"></button><button id="batchOpenSelectedBtn"></button>
    <button id="batchDeleteSelectedBtn"></button><span id="selectedCountLabel"></span>
    <ul><li class="new-work-item" data-work-id="one"><input type="checkbox"></li></ul>
  `;
  const selectedWorks = new Set<string>();
  const showMessage = vi.fn();
  const runtime = createNewWorksAllResultsSelectionRuntime({ selectedWorks, getNewWorks, showMessage });
  runtime.setAvailable(101);
  const button = document.getElementById('selectAllResultsBtn') as HTMLButtonElement;
  return { runtime, selectedWorks, showMessage, button };
}

describe('all matching new works selection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('selects every matching page, counts IDs, and toggles back to deselect without another query', async () => {
    const getNewWorks = vi.fn(async ({ page }: { page: number }) => ({
      works: Array.from({ length: page === 2 ? 1 : 100 }, (_, index) => ({ id: page === 2 ? 'last' : index === 0 ? 'one' : `id-${index}` })),
      total: 101,
    }));
    const { runtime, selectedWorks, button } = setup(getNewWorks);

    await runtime.toggle(filters);
    expect(getNewWorks).toHaveBeenCalledWith({ ...filters, page: 1, pageSize: 100, includeStats: false });
    expect(getNewWorks).toHaveBeenCalledWith({ ...filters, page: 2, pageSize: 100, includeStats: false });
    expect(selectedWorks.size).toBe(101);
    expect(document.getElementById('selectedCountLabel')?.textContent).toBe('已选 101');
    expect(document.querySelector<HTMLInputElement>('[data-work-id="one"] input')?.checked).toBe(true);
    expect(button.textContent).toContain('取消全选结果');

    await runtime.toggle(filters);
    expect(selectedWorks.size).toBe(0);
    expect(getNewWorks).toHaveBeenCalledTimes(2);
    expect(button.textContent).toContain('全选结果');
    expect(document.querySelector<HTMLInputElement>('[data-work-id="one"] input')?.checked).toBe(false);
  });

  it('leaves prior selection intact on partial pages and permits retry', async () => {
    const getNewWorks = vi.fn().mockResolvedValueOnce({ works: [{ id: 'one' }], total: 101 })
      .mockResolvedValueOnce({ works: [], total: 0 });
    const { runtime, selectedWorks, button, showMessage } = setup(getNewWorks);
    selectedWorks.add('existing');

    await runtime.toggle(filters);
    expect([...selectedWorks]).toEqual(['existing']);
    expect(showMessage).toHaveBeenCalledWith('全选结果失败，请重试', 'error');
    expect(button.disabled).toBe(false);

    await runtime.toggle(filters);
    expect([...selectedWorks]).toEqual(['existing']);
    expect(button.disabled).toBe(false);
  });

  it('does not commit an earlier page when a later page rejects', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: `id-${index}` }));
    const getNewWorks = vi.fn().mockResolvedValueOnce({ works: firstPage, total: 101 })
      .mockRejectedValueOnce(new Error('unavailable'));
    const { runtime, selectedWorks, button, showMessage } = setup(getNewWorks);
    selectedWorks.add('existing');
    await runtime.toggle(filters);
    expect(getNewWorks).toHaveBeenCalledTimes(2);
    expect([...selectedWorks]).toEqual(['existing']);
    expect(button.disabled).toBe(false);
    expect(showMessage).toHaveBeenCalledWith('全选结果失败，请重试', 'error');
  });

  it('discards an in-flight result after invalidation and allows a new selection', async () => {
    let resolveFirst: ((value: { works: Array<{ id: string }>; total: number }) => void) | undefined;
    const getNewWorks = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
      .mockResolvedValue({ works: [{ id: 'new' }], total: 1 });
    const { runtime, selectedWorks, button } = setup(getNewWorks);
    runtime.setAvailable(1);
    const pending = runtime.toggle(filters);
    expect(button.disabled).toBe(true);
    runtime.invalidate();
    selectedWorks.clear();
    expect(button.disabled).toBe(false);
    resolveFirst?.({ works: [{ id: 'old' }], total: 1 });
    await pending;
    expect(selectedWorks.size).toBe(0);
    runtime.setAvailable(1);
    await runtime.toggle({ ...filters, search: 'Bob' });
    expect([...selectedWorks]).toEqual(['new']);
  });

  it('does not overwrite a manual change while retrieving multiple pages', async () => {
    let resolveSecond: ((value: { works: Array<{ id: string }>; total: number }) => void) | undefined;
    const getNewWorks = vi.fn().mockResolvedValueOnce({ works: Array.from({ length: 100 }, (_, i) => ({ id: `id-${i}` })), total: 101 })
      .mockImplementationOnce(() => new Promise(resolve => { resolveSecond = resolve; }));
    const { runtime, selectedWorks, button } = setup(getNewWorks);
    const pending = runtime.toggle(filters);
    await vi.waitFor(() => expect(resolveSecond).toBeDefined());
    selectedWorks.add('manual');
    runtime.onSelectionChanged();
    resolveSecond?.({ works: [{ id: 'last' }], total: 101 });
    await pending;
    expect([...selectedWorks]).toEqual(['manual']);
    expect(button.disabled).toBe(false);
  });

  it('keeps the action disabled until a complete list result is available', () => {
    const { runtime, button } = setup(vi.fn());
    runtime.setAvailable(undefined);
    expect(button.disabled).toBe(true);
    runtime.setAvailable(0);
    expect(button.disabled).toBe(true);
    runtime.setAvailable(1);
    expect(button.disabled).toBe(false);
  });

  it('keeps all-results selection across pagination loading, but invalidates a changed total', async () => {
    const { runtime, selectedWorks, button } = setup(vi.fn(async () => ({ works: [{ id: 'one' }], total: 1 })));
    runtime.setAvailable(1);
    await runtime.toggle(filters);
    expect([...selectedWorks]).toEqual(['one']);
    runtime.setAvailable(undefined);
    expect(button.disabled).toBe(true);
    runtime.setAvailable(1);
    expect(button.textContent).toContain('取消全选结果');
    await runtime.toggle(filters);
    expect(selectedWorks.size).toBe(0);

    await runtime.toggle(filters);
    runtime.setAvailable(undefined);
    runtime.setAvailable(2);
    expect(button.textContent).toContain('全选结果');
    expect(button.textContent).not.toContain('取消全选结果');
  });

  it('drops the all-selected toggle when a batch operation removes some selected IDs', async () => {
    const { runtime, selectedWorks, button } = setup(vi.fn(async () => ({ works: [{ id: 'one' }], total: 1 })));
    runtime.setAvailable(1);
    await runtime.toggle(filters);
    selectedWorks.delete('one');
    runtime.onSelectionChanged();
    expect(button.textContent).toContain('全选结果');
    expect(button.textContent).not.toContain('取消全选结果');
  });

  it('does not select a partial set when a later page has a duplicate ID or changed total', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: `id-${index}` }));
    const getNewWorks = vi.fn().mockResolvedValueOnce({ works: firstPage, total: 101 })
      .mockResolvedValueOnce({ works: [{ id: 'id-0' }], total: 101 })
      .mockResolvedValueOnce({ works: firstPage, total: 101 })
      .mockResolvedValueOnce({ works: [{ id: 'last' }], total: 102 });
    const { runtime, selectedWorks, showMessage } = setup(getNewWorks);
    selectedWorks.add('existing');
    await runtime.toggle(filters);
    await runtime.toggle(filters);
    expect([...selectedWorks]).toEqual(['existing']);
    expect(showMessage).toHaveBeenCalledTimes(2);
  });

  it('uses a single snapshot of search and filters across pages even if caller mutates the filters', async () => {
    const mutableFilters = { ...filters };
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: `id-${index}` }));
    const getNewWorks = vi.fn(async ({ page }: { page: number }) => {
      if (page === 1) mutableFilters.search = 'Bob';
      return { works: page === 1 ? firstPage : [{ id: 'last' }], total: 101 };
    });
    const { runtime } = setup(getNewWorks);
    await runtime.toggle(mutableFilters);
    expect(getNewWorks).toHaveBeenNthCalledWith(2, { ...filters, page: 2, pageSize: 100, includeStats: false });
  });

  it('cancels a pending selection when the list begins reloading', async () => {
    let resolveFetch: ((value: { works: Array<{ id: string }>; total: number }) => void) | undefined;
    const { runtime, selectedWorks, button } = setup(vi.fn(() => new Promise(resolve => { resolveFetch = resolve; })));
    const pending = runtime.toggle(filters);
    runtime.setAvailable(undefined);
    runtime.setAvailable(1);
    resolveFetch?.({ works: [{ id: 'one' }], total: 1 });
    await pending;
    expect(selectedWorks.size).toBe(0);
    expect(button.textContent).toContain('全选结果');
    expect(button.disabled).toBe(false);
  });

  it('refuses a changed total compared with the visible list and keeps earlier selection', async () => {
    const { runtime, selectedWorks, showMessage } = setup(vi.fn(async () => ({ works: [{ id: 'one' }], total: 1 })));
    selectedWorks.add('existing');
    await runtime.toggle(filters);
    expect([...selectedWorks]).toEqual(['existing']);
    expect(showMessage).toHaveBeenCalledWith('全选结果失败，请重试', 'error');
  });
});
