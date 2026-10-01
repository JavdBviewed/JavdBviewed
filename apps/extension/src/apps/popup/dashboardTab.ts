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
  update(tabId: number, updateProperties: { active?: boolean; url?: string }): Promise<DashboardTab | undefined>;
  create(createProperties: { url: string; active: boolean }): Promise<DashboardTab | undefined>;
}

export interface DashboardWindowsApi {
  update(windowId: number, updateInfo: { focused: boolean }): Promise<unknown>;
}

export interface DashboardTabMessagingApi {
  sendMessage(tabId: number, message: { type: string; hash: string }): Promise<unknown>;
}

/** 「更多过滤」深链消息类型（接收端=apps/dashboard/bootstrap.ts 的 runtime.onMessage，字面量须与接收端一致）。 */
export const DASHBOARD_DEEP_LINK_MESSAGE_TYPE = 'dashboard-deep-link';
const DEEP_LINK_ATTEMPTS = 3;
const DEEP_LINK_RETRY_DELAY_MS = 200;

export interface OpenDashboardTabOptions {
  dashboardUrl: string;
  /** 深链 hash（如 '#tab-settings/enhancement-settings/list'）。已有 tab：focus 后经 tabs.sendMessage 由 dashboard 监听器设 hash，接收端未就绪时 tabs.update(url+hash) 重载兜底（再失败降级仅 focus）；新建 tab：直接拼入 url。 */
  hash?: string;
  tabs: DashboardTabsApi;
  windows?: DashboardWindowsApi;
  sendMessage?: DashboardTabMessagingApi['sendMessage'];
}

type OpenDashboardTabResult = { action: 'focused' | 'created'; tabId?: number; hashApplied?: boolean };

const activeOpenRequests = new Map<string, Promise<OpenDashboardTabResult>>();

async function applyHashByMessage(
  tabId: number,
  hash: string,
  sendMessage: DashboardTabMessagingApi['sendMessage'],
): Promise<boolean> {
  for (let attempt = 0; attempt < DEEP_LINK_ATTEMPTS; attempt += 1) {
    try {
      await sendMessage(tabId, { type: DASHBOARD_DEEP_LINK_MESSAGE_TYPE, hash });
      return true;
    } catch (error) {
      if (attempt === DEEP_LINK_ATTEMPTS - 1) {
        console.warn('[DashboardTab] Dashboard deep-link listener unreachable, falling back to tab reload:', error);
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, DEEP_LINK_RETRY_DELAY_MS));
    }
  }
  return false;
}

async function openOrFocusDashboardTabOnce({
  dashboardUrl,
  tabs,
  windows,
  hash,
  sendMessage,
}: OpenDashboardTabOptions): Promise<OpenDashboardTabResult> {
  const existingTabs = await tabs.query({ url: `${dashboardUrl}*` });
  const existingTab = existingTabs.find((tab) => typeof tab.id === 'number');

  if (existingTab && typeof existingTab.id === 'number') {
    await tabs.update(existingTab.id, { active: true });
    if (windows && typeof existingTab.windowId === 'number') {
      await windows.update(existingTab.windowId, { focused: true });
    }
    const result: OpenDashboardTabResult = { action: 'focused', tabId: existingTab.id };
    if (hash && sendMessage) {
      if (await applyHashByMessage(existingTab.id, hash, sendMessage)) {
        result.hashApplied = true;
      } else {
        try {
          await tabs.update(existingTab.id, { url: `${dashboardUrl}${hash}` });
          result.hashApplied = true;
        } catch (error) {
          console.warn('[DashboardTab] Failed to reload focused tab with hash, degrading to focus-only:', error);
          result.hashApplied = false;
        }
      }
    }
    return result;
  }

  const createdTab = await tabs.create({ url: hash ? `${dashboardUrl}${hash}` : dashboardUrl, active: true });
  return { action: 'created', tabId: createdTab?.id };
}

export function openOrFocusDashboardTab(options: OpenDashboardTabOptions): Promise<OpenDashboardTabResult> {
  const activeRequest = activeOpenRequests.get(options.dashboardUrl);
  if (activeRequest) {
    return activeRequest;
  }

  const request = openOrFocusDashboardTabOnce(options);
  activeOpenRequests.set(options.dashboardUrl, request);
  const clearRequest = (): void => {
    if (activeOpenRequests.get(options.dashboardUrl) === request) {
      activeOpenRequests.delete(options.dashboardUrl);
    }
  };
  void request.then(clearRequest, clearRequest);
  return request;
}
