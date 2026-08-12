import type { NewWorksStats } from '../../types';
import type { NewWorksFilters } from './newWorksFilterTypes';
import {
  buildManageSubscriptionsButtonHtml,
  buildNewWorksStatsHtml,
} from './newWorksStatsViewModel';

export type { NewWorksFilters } from './newWorksFilterTypes';

export interface NewWorksStatsRuntimeDeps {
  setPage(page: number): void;
  render(): void;
  openSubscriptionManager(): void;
  doc?: Document;
}

export interface RenderNewWorksStatsRuntimeDeps extends NewWorksStatsRuntimeDeps {
  getStats(): Promise<NewWorksStats>;
  updateLastCheckTimeDisplay(lastCheckTime?: number): void;
  logInfo(message: string, data?: unknown): void;
  logWarn(message: string): void;
  logError(message: string, error: unknown): void;
}

export interface RenderNewWorksStatsRuntimeInput {
  filters: NewWorksFilters;
  stats?: NewWorksStats;
  deps: RenderNewWorksStatsRuntimeDeps;
}

export async function renderNewWorksStatsRuntime(input: RenderNewWorksStatsRuntimeInput): Promise<void> {
  const { filters, deps } = input;
  const doc = deps.doc || document;
  const container = doc.getElementById('newWorksStatsContainer');
  if (!container) {
    deps.logWarn('未找到统计信息容器');
    return;
  }

  try {
    deps.logInfo('开始获取新作品统计信息');
    const stats = input.stats ?? await deps.getStats();
    deps.logInfo('获取到统计信息:', stats);

    container.innerHTML = buildNewWorksStatsHtml(stats);
    attachNewWorksStatsCardListeners(container, filters, deps);

    const manageBtn = doc.getElementById('manageSubscriptionsBtn');
    if (manageBtn) {
      manageBtn.innerHTML = buildManageSubscriptionsButtonHtml(stats.totalSubscriptions);
    }

    deps.updateLastCheckTimeDisplay(stats.lastCheckTime);
    deps.logInfo('统计信息渲染完成');
  } catch (error) {
    deps.logError('渲染统计信息失败:', error);
    container.innerHTML = '<div class="error-message">加载统计信息失败</div>';
  }
}

export function attachNewWorksStatsCardListeners(
  container: HTMLElement,
  filters: NewWorksFilters,
  deps: NewWorksStatsRuntimeDeps,
): void {
  const doc = deps.doc || document;
  container.querySelectorAll('.stat-card.clickable').forEach(card => {
    card.addEventListener('click', () => {
      const filterType = card.getAttribute('data-filter');
      if (!filterType) return;

      const searchInput = doc.getElementById('newWorksSearchInput') as HTMLInputElement | null;
      const filterSelect = doc.getElementById('newWorksFilterSelect') as HTMLSelectElement | null;
      const sortSelect = doc.getElementById('newWorksSortSelect') as HTMLSelectElement | null;

      if (searchInput) {
        searchInput.value = '';
        filters.search = '';
      }

      if (filterType === 'all' || filterType === 'active') {
        deps.openSubscriptionManager();
        return;
      }

      if (filterType === 'allWorks') {
        if (filterSelect) filterSelect.value = 'all';
        filters.filter = 'all';
        if (sortSelect) sortSelect.value = 'discoveredAt_desc';
        filters.sort = 'discoveredAt_desc';
      } else if (filterType === 'unread') {
        if (filterSelect) filterSelect.value = 'unread';
        filters.filter = 'unread';
        if (sortSelect) sortSelect.value = 'discoveredAt_desc';
        filters.sort = 'discoveredAt_desc';
      } else if (filterType === 'today') {
        if (filterSelect) filterSelect.value = 'all';
        filters.filter = 'all';
        if (sortSelect) sortSelect.value = 'discoveredAt_desc';
        filters.sort = 'discoveredAt_desc';
      }

      deps.setPage(1);
      deps.render();

      container.querySelectorAll('.stat-card').forEach(item => item.classList.remove('active'));
      card.classList.add('active');
    });
  });
}
