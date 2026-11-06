import type { NewWorksFilters } from './newWorksFilterTypes';
import { syncNewWorksBatchOperations } from './newWorksListRuntime';

const FETCH_PAGE_SIZE = 100;

interface AllResultsSelectionDeps {
  selectedWorks: Set<string>;
  getNewWorks(query: NewWorksFilters & { page: number; pageSize: number; includeStats: false }): Promise<{ works: Array<{ id: string }>; total: number }>;
  showMessage(message: string, type: 'error'): void;
  doc?: Document;
}

export function createNewWorksAllResultsSelectionRuntime(deps: AllResultsSelectionDeps) {
  const doc = deps.doc ?? document;
  let generation = 0;
  let loading = false;
  let available = false;
  let availableTotal: number | undefined;
  let selectedResultIds: Set<string> | undefined;
  let selectedCriteria = '';

  const button = (): HTMLButtonElement | null => doc.getElementById('selectAllResultsBtn') as HTMLButtonElement | null;
  const updateButton = (): void => {
    const target = button();
    if (!target) return;
    target.disabled = loading || !available;
    target.innerHTML = loading
      ? '<i class="fas fa-spinner fa-spin"></i> 正在选择...'
      : selectedResultIds
        ? '<i class="fas fa-minus-square"></i> 取消全选结果'
        : '<i class="fas fa-check-double"></i> 全选结果';
  };
  const syncVisibleSelection = (): void => {
    doc.querySelectorAll<HTMLElement>('.new-work-item').forEach(item => {
      const selected = deps.selectedWorks.has(item.getAttribute('data-work-id') ?? '');
      item.classList.toggle('selected', selected);
      const checkbox = item.querySelector<HTMLInputElement>('input[type="checkbox"]');
      if (checkbox) checkbox.checked = selected;
    });
    syncNewWorksBatchOperations(deps.selectedWorks, doc);
  };
  const invalidate = (): void => {
    generation += 1;
    loading = false;
    selectedResultIds = undefined;
    selectedCriteria = '';
    updateButton();
  };

  return {
    async toggle(filters: NewWorksFilters): Promise<void> {
      if (loading || !available) return;
      const snapshot = { ...filters };
      const criteria = JSON.stringify(snapshot);
      if (selectedResultIds && selectedCriteria === criteria) {
        for (const id of selectedResultIds) deps.selectedWorks.delete(id);
        selectedResultIds = undefined;
        selectedCriteria = '';
        syncVisibleSelection();
        updateButton();
        return;
      }

      const request = ++generation;
      const expectedTotal = availableTotal;
      loading = true;
      updateButton();
      try {
        const ids = new Set<string>();
        let total: number | undefined;
        for (let page = 1; total === undefined || ids.size < total; page += 1) {
          const result = await deps.getNewWorks({ ...snapshot, page, pageSize: FETCH_PAGE_SIZE, includeStats: false });
          if (request !== generation) return;
          if (!Number.isSafeInteger(result.total) || result.total < 0 || (total !== undefined && total !== result.total)) {
            throw new Error('新作品结果总数变化');
          }
          if (result.total !== expectedTotal) throw new Error('新作品列表已变化');
          total = result.total;
          const expectedLength = Math.min(FETCH_PAGE_SIZE, Math.max(0, total - (page - 1) * FETCH_PAGE_SIZE));
          if (result.works.length !== expectedLength) throw new Error('新作品结果不完整');
          for (const work of result.works) {
            if (!work.id || ids.has(work.id)) throw new Error('新作品结果有重复或无效 ID');
            ids.add(work.id);
          }
        }
        if (request !== generation) return;
        for (const id of ids) deps.selectedWorks.add(id);
        selectedResultIds = ids;
        selectedCriteria = criteria;
        syncVisibleSelection();
      } catch (error) {
        if (request === generation) {
          console.error('全选新作品结果失败:', error);
          deps.showMessage('全选结果失败，请重试', 'error');
        }
      } finally {
        if (request === generation) {
          loading = false;
          updateButton();
        }
      }
    },
    invalidate,
    onSelectionChanged: invalidate,
    setAvailable(total: number | undefined): void {
      if (total === undefined && loading) {
        generation += 1;
        loading = false;
      }
      available = total !== undefined && total > 0;
      availableTotal = total;
      if (selectedResultIds && total !== undefined && total !== selectedResultIds.size) {
        selectedResultIds = undefined;
        selectedCriteria = '';
      }
      updateButton();
    },
  };
}
