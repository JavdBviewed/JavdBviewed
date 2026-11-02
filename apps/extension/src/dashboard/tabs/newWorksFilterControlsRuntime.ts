import type { NewWorksFilters, NewWorksFilterValue } from './newWorksFilterTypes';
import { clampNewWorksPageSize } from './newWorksBatchOpenPolicy';

export interface NewWorksFilterControlsDeps {
  setPage(page: number): void;
  render(): void;
  debounceRender(): void;
  doc?: Document;
}

export function attachNewWorksFilterControls(
  filters: NewWorksFilters,
  deps: NewWorksFilterControlsDeps,
): void {
  const doc = deps.doc || document;

  const searchInput = doc.getElementById('newWorksSearchInput') as HTMLInputElement | null;
  if (searchInput) {
    searchInput.addEventListener('input', event => {
      filters.search = (event.target as HTMLInputElement).value;
      deps.setPage(1);
      deps.debounceRender();
    });
  }

  const filterSelect = doc.getElementById('newWorksFilterSelect') as HTMLSelectElement | null;
  if (filterSelect) {
    filterSelect.value = filters.filter;
    filterSelect.addEventListener('change', event => {
      filters.filter = (event.target as HTMLSelectElement).value as NewWorksFilterValue;
      deps.setPage(1);
      deps.render();
    });
  }

  const sortSelect = doc.getElementById('newWorksSortSelect') as HTMLSelectElement | null;
  if (sortSelect) {
    sortSelect.addEventListener('change', event => {
      filters.sort = (event.target as HTMLSelectElement).value;
      deps.setPage(1);
      deps.render();
    });
  }
}

export interface NewWorksPageSizeControlDeps {
  select: HTMLSelectElement;
  getPageSize(): number;
  onPageSizeChange(size: number): void;
}

// 11-02 G1：每页数量选择器接线（change → 夹取后回调，调用方负责落盘 + 回 1 页 + 重渲染）
export function attachNewWorksPageSizeControl(deps: NewWorksPageSizeControlDeps): void {
  deps.select.value = String(clampNewWorksPageSize(deps.getPageSize()));
  deps.select.addEventListener('change', () => {
    deps.onPageSizeChange(clampNewWorksPageSize(parseInt(deps.select.value, 10)));
  });
}
