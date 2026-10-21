/**
 * @file navModel.ts
 * @description Dashboard 9C 导航分组模型与 hash 解析
 * @module dashboard/tabs
 */

export type DashboardNavItem = {
  id: string;
  label: string;
  tabId: string;
  subPath?: string;
};

export type DashboardNavGroup = {
  id: string;
  label: string;
  defaultItemId: string;
  items: readonly DashboardNavItem[];
};

export type DashboardNavState = {
  groupId: string;
  itemId: string;
  tabId: string;
  subPath?: string;
};

export type DashboardNavHashTarget = {
  tabId: string;
  subPath?: string;
};

export const DASHBOARD_NAV_GROUPS: readonly DashboardNavGroup[] = [
  {
    id: 'home',
    label: '首页',
    defaultItemId: 'home-overview',
    items: [
      { id: 'home-overview', label: '首页总览', tabId: 'tab-home' },
    ],
  },
  {
    id: 'library',
    label: '信息库',
    defaultItemId: 'records',
    items: [
      { id: 'records', label: '番号库', tabId: 'tab-records' },
      { id: 'actors', label: '演员库', tabId: 'tab-actors' },
      { id: 'new-works', label: '新作品', tabId: 'tab-new-works' },
      { id: 'lists', label: '收藏中心', tabId: 'tab-lists' },
      { id: 'recycle-bin', label: '回收站', tabId: 'tab-recycle-bin' },
    ],
  },
  {
    id: 'media',
    label: '媒体库',
    defaultItemId: 'media-library',
    items: [
      // 单一入口：来源筛选放在页面内，不再占用二级子菜单高度
      { id: 'media-library', label: '媒体库', tabId: 'tab-media' },
    ],
  },
  {
    id: 'sync',
    label: '任务与备份',
    defaultItemId: 'sync',
    items: [
      { id: 'sync', label: '数据同步', tabId: 'tab-sync' },
      { id: 'drive115-tasks', label: '115任务', tabId: 'tab-drive115-tasks' },
      { id: 'backup', label: '备份与恢复', tabId: 'tab-backup' },
    ],
  },
  {
    id: 'analysis',
    label: '报告与日志',
    defaultItemId: 'insights',
    items: [
      { id: 'insights', label: '报告', tabId: 'tab-insights' },
      { id: 'logs', label: '日志', tabId: 'tab-logs' },
    ],
  },
  {
    id: 'settings',
    label: '设置',
    defaultItemId: 'settings-center',
    items: [
      { id: 'settings-center', label: '设置中心', tabId: 'tab-settings' },
    ],
  },
];

function toNavState(group: DashboardNavGroup, item: DashboardNavItem, subPath?: string): DashboardNavState {
  const state: DashboardNavState = {
    groupId: group.id,
    itemId: item.id,
    tabId: item.tabId,
  };

  if (subPath) {
    state.subPath = subPath;
  }

  return state;
}

function findDefaultItem(group: DashboardNavGroup): DashboardNavItem | null {
  return group.items.find(item => item.id === group.defaultItemId) ?? group.items[0] ?? null;
}

function findGroupById(groupId: string): DashboardNavGroup | null {
  return DASHBOARD_NAV_GROUPS.find(group => group.id === groupId) ?? null;
}

function findStateByTabId(tabId: string, subPath?: string): DashboardNavState | null {
  for (const group of DASHBOARD_NAV_GROUPS) {
    const item = group.items.find(candidate => candidate.tabId === tabId);
    if (item) {
      return toNavState(group, item, subPath);
    }
  }

  return null;
}

function findMediaState(subPath?: string): DashboardNavState {
  const mediaGroup = findGroupById('media');
  if (!mediaGroup) {
    return getDefaultNavState();
  }

  const item = findDefaultItem(mediaGroup);
  if (!item) {
    return getDefaultNavState();
  }

  // 兼容旧 hash（#tab-media/emby 等）：导航高亮仍落在单一媒体库入口，subPath 留给页内筛选
  return toNavState(mediaGroup, item, subPath);
}

function normalizeHash(hash: string | null | undefined): string {
  if (!hash) {
    return '';
  }

  return hash.trim().replace(/^#/, '').replace(/^\//, '');
}

export function getDefaultNavState(): DashboardNavState {
  const homeGroup = findGroupById('home');
  if (!homeGroup) {
    return {
      groupId: 'home',
      itemId: 'home-overview',
      tabId: 'tab-home',
    };
  }

  const defaultItem = findDefaultItem(homeGroup);
  if (!defaultItem) {
    return {
      groupId: 'home',
      itemId: 'home-overview',
      tabId: 'tab-home',
    };
  }

  return toNavState(homeGroup, defaultItem);
}

export function resolveDashboardNavState(hash: string | null | undefined): DashboardNavState {
  const normalized = normalizeHash(hash);
  if (!normalized) {
    return getDefaultNavState();
  }

  const [tabId = '', subPath] = normalized.split('/');
  if (!tabId) {
    return getDefaultNavState();
  }

  if (tabId === 'tab-media') {
    return findMediaState(subPath);
  }

  if (tabId === 'tab-settings') {
    return findStateByTabId(tabId, subPath) ?? getDefaultNavState();
  }

  return findStateByTabId(tabId) ?? getDefaultNavState();
}

export function buildDashboardNavHash(target: DashboardNavHashTarget): string {
  if (target.subPath) {
    return `#${target.tabId}/${target.subPath}`;
  }

  return `#${target.tabId}`;
}
