export interface RecordsMultiSelectFilterItem {
  id: string;
  name: string;
  badgeHtml?: string;
}

export interface RecordsMultiSelectFilterElements {
  filterInput: HTMLInputElement | null;
  dropdown: HTMLElement | null;
  searchInput: HTMLInputElement | null;
  optionList: HTMLElement | null;
  selectedContainer: HTMLElement | null;
}

export interface RecordsMultiSelectFilterController {
  render(): void;
  refresh(): void;
  clearRenderedOptions(): void;
  filter(searchTerm: string): void;
  bind(): void;
}

export interface RecordsMultiSelectFilterControllerOptions {
  elements: RecordsMultiSelectFilterElements;
  selected: Set<string>;
  emptyText: string;
  selectedText: (count: number) => string;
  optionAttribute: string;
  removeAttribute: string;
  getItems: () => RecordsMultiSelectFilterItem[];
  onBeforeOpen?: () => void;
  onAfterToggleDropdown?: () => void;
  onChange: () => void;
  escapeHtml?: (value: string) => string;
  isTokenBackedItem?: (id: string) => boolean;
  onRemoveTokenBackedItem?: (id: string) => boolean;
}

const defaultEscapeHtml = (value: string): string =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function normalizeAttributeName(attribute: string): string {
  return attribute.startsWith('data-') ? attribute : `data-${attribute}`;
}

export function createRecordsMultiSelectFilterController(options: RecordsMultiSelectFilterControllerOptions): RecordsMultiSelectFilterController {
  const {
    elements,
    selected,
    emptyText,
    selectedText,
    getItems,
    onBeforeOpen,
    onAfterToggleDropdown,
    onChange,
    isTokenBackedItem,
    onRemoveTokenBackedItem,
  } = options;
  const optionAttribute = normalizeAttributeName(options.optionAttribute);
  const removeAttribute = normalizeAttributeName(options.removeAttribute);
  const escapeHtml = options.escapeHtml || defaultEscapeHtml;

  const updateSelectedDisplay = () => {
    if (!elements.selectedContainer) return;
    elements.selectedContainer.innerHTML = Array.from(selected).map((id) => {
      const item = getItems().find((candidate) => candidate.id === id);
      return `
        <div class="selected-tag">
          <span>${escapeHtml(String(item?.name || id))}</span>
          <span class="remove-tag" ${removeAttribute}="${escapeHtml(id)}">×</span>
        </div>
      `;
    }).join('');
  };

  const updateInputText = () => {
    if (!elements.filterInput) return;
    const count = selected.size;
    elements.filterInput.value = count > 0 ? selectedText(count) : emptyText;
  };

  const refresh = () => {
    if (elements.optionList) {
      const options = elements.optionList.querySelectorAll('.tag-option');
      options.forEach((option) => {
        const id = option.getAttribute(optionAttribute);
        const checkbox = option.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        if (!id) return;
        const isSelected = selected.has(id);
        option.classList.toggle('selected', isSelected);
        if (checkbox) checkbox.checked = isSelected;
      });
    }
    updateSelectedDisplay();
    updateInputText();
  };

  const render = () => {
    if (!elements.optionList || !elements.selectedContainer || !elements.filterInput) return;
    const query = String(elements.searchInput?.value || '').trim().toLowerCase();
    const items = getItems()
      .filter((item) => !query || item.name.toLowerCase().includes(query) || item.id.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name));

    elements.optionList.innerHTML = items.map((item) => `
      <div class="tag-option ${selected.has(item.id) ? 'selected' : ''}" ${optionAttribute}="${escapeHtml(item.id)}">
        <input type="checkbox" ${selected.has(item.id) ? 'checked' : ''}>
        <span>${escapeHtml(item.name)}</span>${item.badgeHtml || ''}
      </div>
    `).join('');

    updateSelectedDisplay();
    updateInputText();
  };

  const filter = (searchTerm: string) => {
    if (!elements.optionList) return;
    const query = String(searchTerm || '').toLowerCase();
    const rows = elements.optionList.querySelectorAll('.tag-option');
    rows.forEach((row) => {
      const name = row.querySelector('span')?.textContent || '';
      const id = row.getAttribute(optionAttribute) || '';
      const matches = name.toLowerCase().includes(query) || id.toLowerCase().includes(query);
      (row as HTMLElement).style.display = matches ? 'flex' : 'none';
    });
  };

  const clearRenderedOptions = () => {
    if (elements.optionList) elements.optionList.innerHTML = '';
  };

  const notifyChange = () => {
    refresh();
    onChange();
  };

  const bind = () => {
    elements.filterInput?.addEventListener('click', () => {
      if (!elements.dropdown) return;
      elements.dropdown.style.display = elements.dropdown.style.display === 'none' ? 'block' : 'none';
      if (elements.dropdown.style.display === 'block') {
        onBeforeOpen?.();
        render();
        try { elements.searchInput?.focus(); } catch {}
      }
      onAfterToggleDropdown?.();
    });

    elements.searchInput?.addEventListener('input', (event) => {
      filter((event.target as HTMLInputElement).value);
    });

    elements.optionList?.addEventListener('click', (event) => {
      const option = (event.target as HTMLElement).closest('.tag-option') as HTMLElement | null;
      if (!option) return;
      const id = option.getAttribute(optionAttribute);
      if (!id) return;
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      notifyChange();
    });

    elements.selectedContainer?.addEventListener('click', (event) => {
      const removeButton = (event.target as HTMLElement).closest('.remove-tag') as HTMLElement | null;
      if (!removeButton) return;
      const id = removeButton.getAttribute(removeAttribute);
      if (!id) return;
      if (isTokenBackedItem?.(id) && onRemoveTokenBackedItem?.(id)) return;
      selected.delete(id);
      notifyChange();
    });
  };

  return {
    render,
    refresh,
    clearRenderedOptions,
    filter,
    bind,
  };
}
