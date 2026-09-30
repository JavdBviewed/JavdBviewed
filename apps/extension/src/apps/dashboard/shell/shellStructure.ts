/**
 * @file shellStructure.ts
 * @description Dashboard 外壳结构契约：稳定 DOM id 列表（可无 React 单测）
 * @module apps/dashboard/shell
 */
import { DASHBOARD_TAB_CONTENT_IDS } from '../../../dashboard/tabs/tabContentIds';

export type ShellStructure = {
  mainTabsId: string;
  sectionNavId: string;
  userMenuRootId: string;
  starBtnId: string;
  tabContentIds: readonly string[];
  hasTopbar: boolean;
  hasBrandText: boolean;
};

/**
 * 返回外壳必须提供的宿主 id（与 initTabs 约定一致）
 */
export function getDashboardShellStructure(): ShellStructure {
  return {
    mainTabsId: 'dashboard-main-tabs',
    sectionNavId: 'dashboard-section-nav',
    userMenuRootId: 'dashboard-user-menu-root',
    starBtnId: 'topbar-star-btn',
    tabContentIds: DASHBOARD_TAB_CONTENT_IDS,
    hasTopbar: true,
    hasBrandText: true,
  };
}

/**
 * 检查文档中是否缺少外壳必需节点
 *
 * @param doc - document 或任意 ParentNode
 * @returns 缺失的 id 列表
 */
export function assertShellHostsPresent(doc: ParentNode): string[] {
  const structure = getDashboardShellStructure();
  const missing: string[] = [];
  const required = [
    structure.mainTabsId,
    structure.sectionNavId,
    structure.userMenuRootId,
    structure.starBtnId,
    ...structure.tabContentIds,
  ];
  for (const id of required) {
    if (!doc.querySelector(`#${id}`)) missing.push(id);
  }
  return missing;
}
