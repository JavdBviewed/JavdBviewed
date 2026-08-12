import type { NewWorkRecord } from '../../types';
import type { NewWorksStats } from '../../types';
import type { NewWorksFilters } from './newWorksFilterTypes';
import {
  buildNewWorkItemHtml,
  buildNewWorksEmptyHtml,
  buildNewWorksErrorHtml,
  buildNewWorksLoadingHtml,
  buildNewWorksPaginationHtml,
} from './newWorksListViewModel';

export interface NewWorksListRuntimeHandlers {
  markWorksAsRead(workIds: string[]): Promise<void>;
  visitWork(workId: string): Promise<void>;
  deleteWorks(workIds: string[]): Promise<void>;
  updateBatchOperations(): void;
}

export interface RenderNewWorksListResult {
  works: NewWorkRecord[];
  total: number;
  stats?: NewWorksStats;
}

export interface RenderNewWorksListRuntimeDeps extends NewWorksListRuntimeHandlers {
  getNewWorks(query: NewWorksFilters & { page: number; pageSize: number }): Promise<RenderNewWorksListResult>;
  setPage(page: number): void;
  render(): Promise<void>;
  updateBatchOpenUnreadButton(): void;
  logInfo(message: string, data?: unknown): void;
  logWarn(message: string): void;
  logError(message: string, error: unknown): void;
}

export interface RenderNewWorksListRuntimeInput {
  filters: NewWorksFilters;
  page: number;
  pageSize: number;
  selectedWorks: Set<string>;
  deps: RenderNewWorksListRuntimeDeps;
  doc?: Document;
}

export async function renderNewWorksListRuntime(input: RenderNewWorksListRuntimeInput): Promise<RenderNewWorksListResult | undefined> {
  const { filters, page, pageSize, selectedWorks, deps, doc = document } = input;
  const container = doc.getElementById('newWorksList');
  if (!container) {
    deps.logWarn('未找到新作品列表容器');
    return undefined;
  }

  try {
    deps.logInfo('开始渲染新作品列表，当前过滤条件:', filters);
    container.innerHTML = buildNewWorksLoadingHtml();

    const result = await deps.getNewWorks({
      ...filters,
      page,
      pageSize,
    });

    deps.logInfo('获取到新作品数据:', result);

    if (result.works.length === 0) {
      deps.logInfo('没有新作品数据，显示空状态');
      container.innerHTML = buildNewWorksEmptyHtml();
      renderNewWorksPagination({ total: 0, page, pageSize, deps, doc });
      return result;
    }

    deps.logInfo(`开始渲染 ${result.works.length} 个新作品`);
    container.innerHTML = result.works
      .map(work => buildNewWorkItemHtml(work, { selected: selectedWorks.has(work.id) }))
      .join('');
    renderNewWorksPagination({ total: result.total, page, pageSize, deps, doc });
    deps.updateBatchOpenUnreadButton();
    attachNewWorkItemListeners(selectedWorks, deps, doc);
    deps.logInfo('新作品列表渲染完成');
    return result;
  } catch (error) {
    deps.logError('渲染新作品列表失败:', error);
    container.innerHTML = buildNewWorksErrorHtml();
    return undefined;
  }
}

interface RenderNewWorksPaginationInput {
  total: number;
  page: number;
  pageSize: number;
  deps: Pick<RenderNewWorksListRuntimeDeps, 'setPage' | 'render'>;
  doc: Document;
}

function renderNewWorksPagination(input: RenderNewWorksPaginationInput): void {
  const { total, page, pageSize, deps, doc } = input;
  const container = doc.getElementById('newWorksPagination');
  if (!container) return;

  const paginationHtml = buildNewWorksPaginationHtml({
    total,
    currentPage: page,
    pageSize,
  });
  container.innerHTML = paginationHtml;
  if (!paginationHtml) return;

  container.querySelectorAll('.page-button').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn as HTMLElement;
      if (target.hasAttribute('disabled')) return;

      const nextPage = parseInt(target.dataset.page || '1');
      deps.setPage(nextPage);
      deps.render();
    });
  });
}

export function syncNewWorksBatchOperations(selectedWorks: Set<string>, doc: Document = document): void {
  const count = selectedWorks.size;
  const label = doc.getElementById('selectedCountLabel');
  if (label) {
    label.textContent = `已选 ${count}`;
  }

  const batchOpenSelectedBtn = doc.getElementById('batchOpenSelectedBtn') as HTMLButtonElement | null;
  if (batchOpenSelectedBtn) {
    batchOpenSelectedBtn.disabled = count === 0;
  }

  const batchDeleteSelectedBtn = doc.getElementById('batchDeleteSelectedBtn') as HTMLButtonElement | null;
  if (batchDeleteSelectedBtn) {
    batchDeleteSelectedBtn.disabled = count === 0;
  }

  const clearSelectionBtn = doc.getElementById('clearSelectionBtn') as HTMLButtonElement | null;
  if (clearSelectionBtn) {
    clearSelectionBtn.disabled = false;
  }
}

export function selectAllCurrentNewWorksPage(selectedWorks: Set<string>, doc: Document = document): void {
  const items = Array.from(doc.querySelectorAll('.new-work-item')) as HTMLElement[];
  items.forEach(item => {
    const id = item.getAttribute('data-work-id');
    if (!id) return;

    selectedWorks.add(id);
    item.classList.add('selected');
    const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    if (checkbox) {
      checkbox.checked = true;
    }
  });
}

export function clearNewWorksSelection(selectedWorks: Set<string>, doc: Document = document): void {
  selectedWorks.clear();
  const checkboxes = Array.from(doc.querySelectorAll('.new-work-item input[type="checkbox"]')) as HTMLInputElement[];
  checkboxes.forEach(checkbox => {
    checkbox.checked = false;
  });
  doc.querySelectorAll('.new-work-item.selected').forEach(item => {
    item.classList.remove('selected');
  });
}

export function attachNewWorkItemListeners(
  selectedWorks: Set<string>,
  handlers: NewWorksListRuntimeHandlers,
  doc: Document = document,
): void {
  const workItems = doc.querySelectorAll('.new-work-item');

  workItems.forEach(item => {
    const workId = item.getAttribute('data-work-id');
    if (!workId) return;

    const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    checkbox?.addEventListener('change', event => {
      event.stopPropagation();
      if (checkbox.checked) {
        selectedWorks.add(workId);
        item.classList.add('selected');
      } else {
        selectedWorks.delete(workId);
        item.classList.remove('selected');
      }
      handlers.updateBatchOperations();
    });

    item.addEventListener('click', async event => {
      const target = event.target as HTMLElement;
      const actionBtn = target.closest ? target.closest('.new-work-action-btn') : null;
      if (actionBtn) {
        const action = (actionBtn as HTMLElement).getAttribute('data-action');
        if (action === 'mark-read') {
          await handlers.markWorksAsRead([workId]);
        } else if (action === 'visit') {
          await handlers.visitWork(workId);
        } else if (action === 'delete') {
          await handlers.deleteWorks([workId]);
        }
        return;
      }

      const checkboxTarget = target.closest ? target.closest('.new-work-checkbox') : null;
      if (checkboxTarget) return;

      if (selectedWorks.has(workId)) {
        selectedWorks.delete(workId);
        if (checkbox) {
          checkbox.checked = false;
        }
        item.classList.remove('selected');
      } else {
        selectedWorks.add(workId);
        if (checkbox) {
          checkbox.checked = true;
        }
        item.classList.add('selected');
      }
      handlers.updateBatchOperations();
    });
  });

  handlers.updateBatchOperations();
}
