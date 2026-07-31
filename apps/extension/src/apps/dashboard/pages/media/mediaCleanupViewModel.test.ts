import { describe, expect, it } from 'vitest';
import type { MediaCleanupCopyEntry, MediaCleanupItem } from '../../../../features/mediaCleanup/mediaCleanupModel';
import {
  CLEANUP_PAGE_SIZE,
  getCleanupPage,
  getTitleSelectionState,
  selectionKey,
  setPageSelection,
  setTitleSelection,
} from './mediaCleanupViewModel';

function copy(copyId: string): MediaCleanupCopyEntry {
  return {
    copyId,
    source: copyId.startsWith('115:') ? '115' : 'emby',
    status: 'pending',
    lastFoundAt: 100,
    updatedAt: 100,
  };
}

function item(titleId: string, copies: MediaCleanupCopyEntry[]): MediaCleanupItem {
  return {
    id: titleId,
    titleId,
    code: titleId,
    title: titleId,
    reason: 'watched',
    addedAt: 100,
    updatedAt: 100,
    copies: Object.fromEntries(copies.map((entry) => [entry.copyId, entry])),
  };
}

describe('mediaCleanupViewModel', () => {
  it('selects every source file when a film card is checked', () => {
    const title = item('AAA-001', [copy('emby:item-1'), copy('115:file-1')]);
    const selected = setTitleSelection(new Set(), title, Object.values(title.copies), true);

    expect(selected).toEqual(new Set([
      selectionKey('AAA-001', 'emby:item-1'),
      selectionKey('AAA-001', '115:file-1'),
    ]));
    expect(getTitleSelectionState(selected, title, Object.values(title.copies))).toEqual({
      selectedCount: 2,
      totalCount: 2,
      isSelected: true,
      isPartial: false,
    });
  });

  it('marks a film card as partial when one source file is cleared', () => {
    const title = item('AAA-001', [copy('emby:item-1'), copy('115:file-1')]);
    const selected = new Set([selectionKey('AAA-001', 'emby:item-1')]);

    expect(getTitleSelectionState(selected, title, Object.values(title.copies))).toEqual({
      selectedCount: 1,
      totalCount: 2,
      isSelected: false,
      isPartial: true,
    });
  });

  it('selects only the visible page while preserving existing cross-page selections', () => {
    const titles = Array.from({ length: CLEANUP_PAGE_SIZE + 1 }, (_, index) => ({
      item: item(`AAA-${index}`, [copy(`emby:item-${index}`)]),
      copies: [copy(`emby:item-${index}`)],
    }));
    const firstPage = getCleanupPage(titles, 1);
    const secondPage = getCleanupPage(titles, 2);
    const selected = setPageSelection(new Set(), firstPage.items, true);
    const withSecond = setPageSelection(selected, secondPage.items, true);

    expect(firstPage.items).toHaveLength(CLEANUP_PAGE_SIZE);
    expect(secondPage.items).toHaveLength(1);
    expect(withSecond).toHaveLength(CLEANUP_PAGE_SIZE + 1);
  });
});
