/**
 * @file newWorksFilterControlsRuntime.test.ts
 * @description new works filter controls runtime 测试
 * @module tests/dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachNewWorksFilterControls } from '../../apps/extension/src/dashboard/tabs/newWorksFilterControlsRuntime';
import type { NewWorksFilters } from '../../apps/extension/src/dashboard/tabs/newWorksFilterTypes';

function renderControls() {
  document.body.innerHTML = `
    <input id="newWorksSearchInput">
    <select id="newWorksFilterSelect">
      <option value="all">all</option>
      <option value="unread">unread</option>
    </select>
    <select id="newWorksSortSelect">
      <option value="discoveredAt_desc">discoveredAt_desc</option>
      <option value="releaseDate_desc">releaseDate_desc</option>
    </select>
  `;
}

describe('new works filter controls runtime', () => {
  beforeEach(() => {
    renderControls();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('updates search filter, resets page and calls debounced render on input', () => {
    const filters: NewWorksFilters = {
      search: '',
      filter: 'unread',
      sort: 'discoveredAt_desc',
    };
    const setPage = vi.fn();
    const debounceRender = vi.fn();

    attachNewWorksFilterControls(filters, {
      setPage,
      render: vi.fn(),
      debounceRender,
    });

    const input = document.getElementById('newWorksSearchInput') as HTMLInputElement;
    input.value = 'Alice';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(filters.search).toBe('Alice');
    expect(setPage).toHaveBeenCalledWith(1);
    expect(debounceRender).toHaveBeenCalledTimes(1);
  });

  it('initializes filter select and renders after filter change', () => {
    const filters: NewWorksFilters = {
      search: '',
      filter: 'unread',
      sort: 'discoveredAt_desc',
    };
    const setPage = vi.fn();
    const render = vi.fn();

    attachNewWorksFilterControls(filters, {
      setPage,
      render,
      debounceRender: vi.fn(),
    });

    const select = document.getElementById('newWorksFilterSelect') as HTMLSelectElement;
    expect(select.value).toBe('unread');

    select.value = 'all';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(filters.filter).toBe('all');
    expect(setPage).toHaveBeenCalledWith(1);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('updates sort and renders first page on sort change', () => {
    const filters: NewWorksFilters = {
      search: '',
      filter: 'unread',
      sort: 'discoveredAt_desc',
    };
    const setPage = vi.fn();
    const render = vi.fn();

    attachNewWorksFilterControls(filters, {
      setPage,
      render,
      debounceRender: vi.fn(),
    });

    const select = document.getElementById('newWorksSortSelect') as HTMLSelectElement;
    select.value = 'releaseDate_desc';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(filters.sort).toBe('releaseDate_desc');
    expect(setPage).toHaveBeenCalledWith(1);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('clears selection immediately when search or status changes, including before debounced rendering', () => {
    const filters: NewWorksFilters = { search: '', filter: 'unread', sort: 'discoveredAt_desc' };
    const selected = new Set(['one']);
    const clearSelection = vi.fn(() => selected.clear());
    attachNewWorksFilterControls(filters, {
      setPage: vi.fn(), render: vi.fn(), debounceRender: vi.fn(), clearSelection,
    });
    const input = document.getElementById('newWorksSearchInput') as HTMLInputElement;
    input.value = 'Alice';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(clearSelection).toHaveBeenCalledTimes(1);
    expect(selected.size).toBe(0);

    selected.add('two');
    const select = document.getElementById('newWorksFilterSelect') as HTMLSelectElement;
    select.value = 'all';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(clearSelection).toHaveBeenCalledTimes(2);
    expect(selected.size).toBe(0);
  });

  it('disables all-results selection while a new search is pending', () => {
    const filters: NewWorksFilters = { search: '', filter: 'unread', sort: 'discoveredAt_desc' };
    const setAllResultsAvailable = vi.fn();
    attachNewWorksFilterControls(filters, {
      setPage: vi.fn(), render: vi.fn(), debounceRender: vi.fn(),
      clearSelection: vi.fn(), setAllResultsAvailable,
    });
    const input = document.getElementById('newWorksSearchInput') as HTMLInputElement;
    input.value = 'Alice';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(setAllResultsAvailable).toHaveBeenCalledWith(undefined);
  });
});
