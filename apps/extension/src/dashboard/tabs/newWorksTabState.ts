import {
  NEW_WORKS_PAGE_SIZE_DEFAULT,
  clampNewWorksPageSize,
  getUnreadBatchOpenCooldownRemaining,
  getUnreadBatchOpenCooldownSeconds,
} from './newWorksBatchOpenPolicy';
import type { NewWorksFilters } from './newWorksFilterTypes';

export interface NewWorksTabStateOptions {
  now?: () => number;
}

export interface NewWorksTabState {
  filters: NewWorksFilters;
  selectedWorks: Set<string>;
  getPage(): number;
  setPage(page: number): void;
  getPageSize(): number;
  setPageSize(size: number): void;
  isLoading(): boolean;
  setLoading(loading: boolean): void;
  clearSelection(): void;
  startUnreadBatchOpenCooldown(): void;
  getUnreadBatchOpenCooldownRemaining(now?: number): number;
  getUnreadBatchOpenCooldownSeconds(now?: number): number;
}

export function createNewWorksTabState(options: NewWorksTabStateOptions = {}): NewWorksTabState {
  const now = options.now || Date.now;
  let page = 1;
  let pageSize = NEW_WORKS_PAGE_SIZE_DEFAULT;
  let loading = false;
  let lastUnreadBatchOpenAt = 0;

  const filters: NewWorksFilters = {
    search: '',
    filter: 'unread',
    sort: 'discoveredAt_desc',
  };
  const selectedWorks = new Set<string>();

  return {
    filters,
    selectedWorks,
    getPage: () => page,
    setPage: value => {
      page = value;
    },
    getPageSize: () => pageSize,
    setPageSize: value => {
      pageSize = clampNewWorksPageSize(value);
    },
    isLoading: () => loading,
    setLoading: value => {
      loading = value;
    },
    clearSelection: () => {
      selectedWorks.clear();
    },
    startUnreadBatchOpenCooldown: () => {
      lastUnreadBatchOpenAt = now();
    },
    getUnreadBatchOpenCooldownRemaining: (currentNow = now()) => (
      getUnreadBatchOpenCooldownRemaining(lastUnreadBatchOpenAt, currentNow)
    ),
    getUnreadBatchOpenCooldownSeconds: (currentNow = now()) => (
      getUnreadBatchOpenCooldownSeconds(lastUnreadBatchOpenAt, currentNow)
    ),
  };
}
