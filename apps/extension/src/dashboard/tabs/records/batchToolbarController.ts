export interface CreateRecordsBatchToolbarControllerOptions {
  selectAllCheckbox: HTMLInputElement;
  batchActionsBtn?: HTMLButtonElement | null;
  batchActionsDropdown?: HTMLElement | null;
  batchModifyListBtn?: HTMLButtonElement | null;
  batchAddTagBtn?: HTMLButtonElement | null;
  batchModifyStatusBtn?: HTMLButtonElement | null;
  batchRefreshBtn?: HTMLButtonElement | null;
  batchDeleteBtn?: HTMLButtonElement | null;
  cancelBatchBtn?: HTMLButtonElement | null;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBatchRefresh: () => void | Promise<void>;
  onBatchDelete: () => void | Promise<void>;
  onOpenBatchListPicker: () => void | Promise<void>;
  onOpenBatchAddTag: () => void;
  onBatchModifyStatus: () => void | Promise<void>;
}

export interface RecordsBatchToolbarController {
  bind: () => void;
}

function hideDropdown(dropdown?: HTMLElement | null): void {
  if (dropdown) dropdown.style.display = 'none';
}

function bindDropdownAction(
  button: HTMLButtonElement | null | undefined,
  dropdown: HTMLElement | null | undefined,
  callback: () => void | Promise<void>,
): void {
  button?.addEventListener('click', () => {
    hideDropdown(dropdown);
    void callback();
  });
}

export function createRecordsBatchToolbarController(
  options: CreateRecordsBatchToolbarControllerOptions,
): RecordsBatchToolbarController {
  const bind = () => {
    options.selectAllCheckbox.addEventListener('change', options.onSelectAll);

    options.batchActionsBtn?.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!options.batchActionsDropdown) return;
      const isOpen = options.batchActionsDropdown.style.display !== 'none';
      options.batchActionsDropdown.style.display = isOpen ? 'none' : 'block';
    });

    document.addEventListener('click', () => hideDropdown(options.batchActionsDropdown));

    bindDropdownAction(options.batchRefreshBtn, options.batchActionsDropdown, options.onBatchRefresh);
    bindDropdownAction(options.batchDeleteBtn, options.batchActionsDropdown, options.onBatchDelete);
    bindDropdownAction(options.batchModifyListBtn, options.batchActionsDropdown, options.onOpenBatchListPicker);
    bindDropdownAction(options.batchAddTagBtn, options.batchActionsDropdown, options.onOpenBatchAddTag);
    bindDropdownAction(options.batchModifyStatusBtn, options.batchActionsDropdown, options.onBatchModifyStatus);
    options.cancelBatchBtn?.addEventListener('click', options.onClearSelection);
  };

  return { bind };
}
