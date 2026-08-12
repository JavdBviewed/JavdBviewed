import { describe, expect, it, vi } from 'vitest';
import { createRecordsMultiSelectFilterController } from './multiSelectFilterController';

function createElements() {
  return {
    filterInput: { value: '' } as HTMLInputElement,
    dropdown: { style: { display: 'none' } } as HTMLElement,
    searchInput: { value: '' } as HTMLInputElement,
    optionList: { innerHTML: '<div class="tag-option">占位</div>' } as HTMLElement,
    selectedContainer: { innerHTML: '' } as HTMLElement,
  };
}

describe('records multi-select filter controller', () => {
  it('clears rendered options without changing selected state', () => {
    const elements = createElements();
    const selected = new Set(['tag-1']);
    const controller = createRecordsMultiSelectFilterController({
      elements,
      selected,
      emptyText: '选择标签',
      selectedText: (count) => `已选择 ${count}`,
      optionAttribute: 'data-tag',
      removeAttribute: 'data-tag',
      getItems: () => [{ id: 'tag-1', name: '标签 1' }],
      onChange: vi.fn(),
    });

    controller.clearRenderedOptions();

    expect(elements.optionList.innerHTML).toBe('');
    expect(selected).toEqual(new Set(['tag-1']));
  });
});
