/**
 * Dashboard 标签页打开辅助函数，便于在不挂载 Popup 文档的情况下测试页面生命周期。
 */

export interface DashboardTab {
  id?: number;
  windowId?: number;
  url?: string;
}

export interface DashboardTabsApi {
  query(queryInfo: { url: string }): Promise<DashboardTab[]>;
  update(tabId: number, updateProperties: { active: boolean }): Promise<DashboardTab | undefined>;
  create(createProperties: { url: string; active: boolean }): Promise<DashboardTab | undefined>;
}

export interface DashboardWindowsApi {
  update(windowId: number, updateInfo: { focused: boolean }): Promise<unknown>;
}

export interface OpenDashboardTabOptions {
  dashboardUrl: string;
  tabs: DashboardTabsApi;
  windows?: DashboardWindowsApi;
}

export async function openOrFocusDashboardTab({
  dashboardUrl,
  tabs,
  windows,
}: OpenDashboardTabOptions): Promise<{ action: 'focused' | 'created'; tabId?: number }> {
  const existingTabs = await tabs.query({ url: `${dashboardUrl}*` });
  const existingTab = existingTabs.find((tab) => typeof tab.id === 'number');

  if (existingTab && typeof existingTab.id === 'number') {
    await tabs.update(existingTab.id, { active: true });
    if (windows && typeof existingTab.windowId === 'number') {
      await windows.update(existingTab.windowId, { focused: true });
    }
    return { action: 'focused', tabId: existingTab.id };
  }

  const createdTab = await tabs.create({ url: dashboardUrl, active: true });
  return { action: 'created', tabId: createdTab?.id };
}
