import type {
  MediaCleanupCopyEntry,
  MediaCleanupItem,
} from '../../../../features/mediaCleanup/mediaCleanupModel';

export const CLEANUP_PAGE_SIZE = 24;

export type MediaCleanupTitleGroup = {
  item: MediaCleanupItem;
  copies: MediaCleanupCopyEntry[];
};

export type CleanupTitleSelectionState = {
  selectedCount: number;
  totalCount: number;
  isSelected: boolean;
  isPartial: boolean;
};

export function selectionKey(titleId: string, copyId: string): string {
  return `${titleId}\u0000${copyId}`;
}

export function getTitleSelectionState(
  selected: ReadonlySet<string>,
  item: MediaCleanupItem,
  copies: readonly MediaCleanupCopyEntry[],
): CleanupTitleSelectionState {
  const selectedCount = copies.filter((copy) => selected.has(selectionKey(item.titleId, copy.copyId))).length;
  const totalCount = copies.length;
  return {
    selectedCount,
    totalCount,
    isSelected: totalCount > 0 && selectedCount === totalCount,
    isPartial: selectedCount > 0 && selectedCount < totalCount,
  };
}

export function setTitleSelection(
  selected: ReadonlySet<string>,
  item: MediaCleanupItem,
  copies: readonly MediaCleanupCopyEntry[],
  shouldSelect: boolean,
): Set<string> {
  const next = new Set(selected);
  for (const copy of copies) {
    const key = selectionKey(item.titleId, copy.copyId);
    if (shouldSelect) next.add(key);
    else next.delete(key);
  }
  return next;
}

export function setPageSelection(
  selected: ReadonlySet<string>,
  items: readonly MediaCleanupTitleGroup[],
  shouldSelect: boolean,
): Set<string> {
  return items.reduce(
    (next, group) => setTitleSelection(next, group.item, group.copies, shouldSelect),
    new Set(selected),
  );
}

export function getCleanupPage<T>(
  items: readonly T[],
  requestedPage: number,
  pageSize = CLEANUP_PAGE_SIZE,
): { items: T[]; page: number; totalPages: number; totalItems: number } {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.max(1, Math.min(Math.floor(requestedPage) || 1, totalPages));
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page,
    totalPages,
    totalItems,
  };
}
