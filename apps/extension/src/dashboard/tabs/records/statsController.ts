import type { VideoRecord } from '../../../types';
import type { RecordsAdvancedCondition } from './advancedConditionModel';

interface RecordsStats {
  total: number;
  viewed: number;
  browsed: number;
  want: number;
  thisWeek: number;
  thisMonth: number;
}

interface ServerRecordsStats {
  total?: number;
  byStatus?: Partial<Record<string, number>>;
  last7Days?: number;
  last30Days?: number;
}

export interface CreateRecordsStatsControllerOptions {
  container: HTMLElement | null;
  searchInput: HTMLInputElement;
  filterSelect: HTMLSelectElement;
  selectedTags: Set<string>;
  tokenSelectedTags: Set<string>;
  selectedListIds: Set<string>;
  tokenSelectedListIds: Set<string>;
  refreshTagsFilter: () => void;
  refreshListsFilter: () => void;
  setAdvancedConditions: (conditions: RecordsAdvancedCondition[]) => void;
  renderAdvancedConditions: () => void;
  onFilterApplied: () => void;
  getRecords: () => VideoRecord[];
  isServerModeActive: () => boolean;
  loadServerStats: () => Promise<ServerRecordsStats>;
  isActive?: () => boolean;
  now?: () => number;
}

export interface RecordsStatsController {
  updateStats: () => Promise<void>;
}

function buildMemoryStats(records: VideoRecord[], now: number): RecordsStats {
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const oneMonthAgo = now - 30 * 24 * 60 * 60 * 1000;

  return {
    total: records.length,
    viewed: records.filter(record => record.status === 'viewed').length,
    browsed: records.filter(record => record.status === 'browsed').length,
    want: records.filter(record => record.status === 'want').length,
    thisWeek: records.filter(record => record.createdAt && record.createdAt >= oneWeekAgo).length,
    thisMonth: records.filter(record => record.createdAt && record.createdAt >= oneMonthAgo).length,
  };
}

function buildServerStats(serverStats: ServerRecordsStats): RecordsStats {
  return {
    total: serverStats.total || 0,
    viewed: serverStats.byStatus?.viewed ?? 0,
    browsed: serverStats.byStatus?.browsed ?? 0,
    want: serverStats.byStatus?.want ?? 0,
    thisWeek: serverStats.last7Days || 0,
    thisMonth: serverStats.last30Days || 0,
  };
}

function renderStatsCards(container: HTMLElement, stats: RecordsStats, activeFilter: string | null): void {
  const activeClass = (filter: string) => filter === activeFilter ? ' active' : '';
  const ariaPressed = (filter: string) => String(filter === activeFilter);
  container.innerHTML = `
    <div class="stat-card new-works-stat clickable${activeClass('all')}" data-filter="all" title="点击查看所有番号" role="button" tabindex="0" aria-pressed="${ariaPressed('all')}">
      <div class="stat-value">${stats.total}</div>
      <div class="stat-label">总番号数</div>
    </div>
    <div class="stat-card new-works-stat clickable${activeClass('viewed')}" data-filter="viewed" title="点击查看已观看" role="button" tabindex="0" aria-pressed="${ariaPressed('viewed')}">
      <div class="stat-value">${stats.viewed}</div>
      <div class="stat-label">已观看</div>
    </div>
    <div class="stat-card new-works-stat clickable${activeClass('browsed')}" data-filter="browsed" title="点击查看已浏览" role="button" tabindex="0" aria-pressed="${ariaPressed('browsed')}">
      <div class="stat-value">${stats.browsed}</div>
      <div class="stat-label">已浏览</div>
    </div>
    <div class="stat-card new-works-stat clickable${activeClass('want')}" data-filter="want" title="点击查看我想看" role="button" tabindex="0" aria-pressed="${ariaPressed('want')}">
      <div class="stat-value">${stats.want}</div>
      <div class="stat-label">我想看</div>
    </div>
    <div class="stat-card new-works-stat clickable${activeClass('thisWeek')}" data-filter="thisWeek" title="点击查看本周新增" role="button" tabindex="0" aria-pressed="${ariaPressed('thisWeek')}">
      <div class="stat-value">${stats.thisWeek}</div>
      <div class="stat-label">本周新增</div>
    </div>
    <div class="stat-card new-works-stat clickable${activeClass('thisMonth')}" data-filter="thisMonth" title="点击查看本月新增" role="button" tabindex="0" aria-pressed="${ariaPressed('thisMonth')}">
      <div class="stat-value">${stats.thisMonth}</div>
      <div class="stat-label">本月新增</div>
    </div>
  `;
}

export function createRecordsStatsController(options: CreateRecordsStatsControllerOptions): RecordsStatsController {
  const now = options.now || Date.now;
  let activeFilter: string | null = null;

  const clearQuickFilters = () => {
    options.searchInput.value = '';
    options.selectedTags.clear();
    options.tokenSelectedTags.clear();
    options.selectedListIds.clear();
    options.tokenSelectedListIds.clear();
    options.refreshTagsFilter();
    options.refreshListsFilter();
  };

  const clearAdvancedConditions = () => {
    options.setAdvancedConditions([]);
    options.renderAdvancedConditions();
  };

  const setRecentCondition = (range: 'week' | 'month') => {
    const delta = range === 'week' ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
    const idPrefix = range === 'week' ? 'cond_week' : 'cond_month';
    options.setAdvancedConditions([{
      id: `${idPrefix}_${Date.now()}`,
      field: 'createdAt',
      op: 'gte',
      value: String(now() - delta),
    }]);
    options.renderAdvancedConditions();
  };

  const applyFilter = (filterType: string, card: Element) => {
    activeFilter = filterType;
    clearQuickFilters();

    if (filterType === 'all') {
      options.filterSelect.value = 'all';
      clearAdvancedConditions();
    } else if (filterType === 'viewed' || filterType === 'browsed' || filterType === 'want') {
      options.filterSelect.value = filterType;
      clearAdvancedConditions();
    } else if (filterType === 'thisWeek') {
      options.filterSelect.value = 'all';
      setRecentCondition('week');
    } else if (filterType === 'thisMonth') {
      options.filterSelect.value = 'all';
      setRecentCondition('month');
    }

    options.container?.querySelectorAll<HTMLElement>('.stat-card').forEach(item => {
      item.classList.remove('active');
      item.setAttribute('aria-pressed', 'false');
    });
    card.classList.add('active');
    if (card instanceof HTMLElement) {
      card.setAttribute('aria-pressed', 'true');
    }
    options.onFilterApplied();
  };

  const bindCards = () => {
    options.container?.querySelectorAll('.stat-card.clickable').forEach((card) => {
      const activate = () => {
        const filterType = card.getAttribute('data-filter');
        if (!filterType) return;
        applyFilter(filterType, card);
      };
      card.addEventListener('click', activate);
      card.addEventListener('keydown', (event) => {
        const keyboardEvent = event as KeyboardEvent;
        if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ') return;
        keyboardEvent.preventDefault();
        activate();
      });
    });
  };

  const updateStats = async () => {
    const container = options.container;
    if (!container) return;

    let stats: RecordsStats;
    if (options.isServerModeActive()) {
      try {
        stats = buildServerStats(await options.loadServerStats());
      } catch {
        stats = buildMemoryStats(options.getRecords(), now());
      }
    } else {
      stats = buildMemoryStats(options.getRecords(), now());
    }

    if (options.isActive && !options.isActive()) return;
    renderStatsCards(container, stats, activeFilter);
    bindCards();
  };

  return { updateStats };
}
