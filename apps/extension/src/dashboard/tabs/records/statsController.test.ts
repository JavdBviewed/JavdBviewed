import { describe, expect, it, vi } from 'vitest';
import { createRecordsStatsController } from './statsController';

describe('records stats controller', () => {
  it('does not write completed stats into a hidden records tab', async () => {
    let resolveStats: ((value: { total: number }) => void) | null = null;
    let active = true;
    const container = {
      innerHTML: '<div class="loading"></div>',
      querySelectorAll: vi.fn(() => []),
    } as unknown as HTMLElement;
    const controller = createRecordsStatsController({
      container,
      searchInput: { value: '' } as HTMLInputElement,
      filterSelect: { value: 'all' } as HTMLSelectElement,
      selectedTags: new Set(),
      tokenSelectedTags: new Set(),
      selectedListIds: new Set(),
      tokenSelectedListIds: new Set(),
      refreshTagsFilter: vi.fn(),
      refreshListsFilter: vi.fn(),
      setAdvancedConditions: vi.fn(),
      renderAdvancedConditions: vi.fn(),
      onFilterApplied: vi.fn(),
      getRecords: () => [],
      isServerModeActive: () => true,
      loadServerStats: vi.fn(() => new Promise((resolve) => {
        resolveStats = resolve;
      })),
      isActive: () => active,
    });

    const pending = controller.updateStats();
    active = false;
    resolveStats?.({ total: 14_719 });
    await pending;

    expect(container.innerHTML).toBe('<div class="loading"></div>');
  });
});
