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
  onSelectionChanged?(): void;
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
  setAllResultsAvailable?(total: number | undefined): void;
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
    deps.setAllResultsAvailable?.(undefined);
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
      renderNewWorksCounts(filters, 0, doc);
      renderNewWorksPagination({ total: 0, page, pageSize, deps, doc });
      deps.setAllResultsAvailable?.(0);
      return result;
    }

    deps.logInfo(`开始渲染 ${result.works.length} 个新作品`);
    container.innerHTML = result.works
      .map(work => buildNewWorkItemHtml(work, { selected: selectedWorks.has(work.id) }))
      .join('');
    renderNewWorksCounts(filters, result.total, doc);
    renderNewWorksPagination({ total: result.total, page, pageSize, deps, doc });
    deps.updateBatchOpenUnreadButton();
    attachNewWorkItemListeners(selectedWorks, deps, doc);
    deps.setAllResultsAvailable?.(result.total);
    deps.logInfo('新作品列表渲染完成');
    return result;
  } catch (error) {
    deps.logError('渲染新作品列表失败:', error);
    container.innerHTML = buildNewWorksErrorHtml();
    deps.setAllResultsAvailable?.(undefined);
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

// 11-02 G2/G3：搜索结果计数（仅搜索非空时显示）+ 分页旁总数（恒显，空态含 0）
function renderNewWorksCounts(filters: NewWorksFilters, total: number, doc: Document): void {
  const searchCount = doc.getElementById('newWorksSearchCount');
  if (searchCount) {
    if (filters.search.trim() !== '') {
      searchCount.innerHTML = `共 <span class="count-number">${total}</span> 条结果`;
      searchCount.style.display = 'flex';
    } else {
      searchCount.style.display = 'none';
    }
  }
  const totalCount = doc.getElementById('newWorksTotalCount');
  if (totalCount) {
    totalCount.textContent = `共 ${total} 条`;
  }
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
      handlers.onSelectionChanged?.();
      handlers.updateBatchOperations();
    });

    // L-3（cycle-5 S1-A）：hover 放大预览懒实例化——首次悬停才创建大预览 img（复用已下载的同 URL 封面），
    // 之后常驻；替代旧版初始 HTML 双 <img> 同 URL（每项预建 560~820px 宽图层）。
    const coverWrap = item.querySelector('.new-work-cover-wrap') as HTMLElement | null;
    if (coverWrap) {
      coverWrap.addEventListener('mouseenter', () => {
        if (coverWrap.querySelector('.new-work-cover-preview')) return;
        const cover = coverWrap.querySelector('img.new-work-cover') as HTMLImageElement | null;
        const src = cover?.getAttribute('src');
        if (!src) return;
        const preview = doc.createElement('img');
        preview.className = 'new-work-cover-preview';
        preview.src = src;
        preview.alt = cover?.alt || '';
        preview.addEventListener('load', () => coverWrap.classList.add('new-work-cover-preview-ready'), { once: true });
        coverWrap.appendChild(preview);
      });
    }

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
      handlers.onSelectionChanged?.();
      handlers.updateBatchOperations();
    });
  });

  handlers.updateBatchOperations();
}
