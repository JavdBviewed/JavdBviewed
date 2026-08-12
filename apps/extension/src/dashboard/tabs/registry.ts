// src/dashboard/tabs/registry.ts
// 集中管理各 Tab 的初始化逻辑，并使用动态 import 进行代码分割
import { recordTabActivationPhase } from './tabActivationPerformance';

export async function initializeTabById(tabId: string | null | undefined): Promise<void> {
  if (!tabId) return;
  try {
    switch (tabId) {
      case 'tab-records': {
        const { initRecordsTab } = await import('./records');
        await initRecordsTab();
        break;
      }
      case 'tab-lists': {
        const { listsTab } = await import('./lists');
        if (!listsTab.isInitialized) await listsTab.initialize();
        break;
      }
      case 'tab-actors': {
        const { actorsTab } = await import('./actors');
        if (!actorsTab.isInitialized) await actorsTab.initActorsTab();
        break;
      }
      case 'tab-new-works': {
        recordTabActivationPhase(tabId, 'module-load-start');
        const { newWorksTab } = await import('./newWorks');
        recordTabActivationPhase(tabId, 'module-load-complete');
        if (!newWorksTab.isInitialized) await newWorksTab.initialize();
        break;
      }
      case 'tab-sync': {
        const { syncTab } = await import('./sync');
        await syncTab.initSyncTab();
        break;
      }
      case 'tab-backup': {
        const { initBackupTab } = await import('./backup');
        initBackupTab();
        break;
      }
      case 'tab-logs': {
        const { logsTab } = await import('./logs');
        if (!logsTab.isInitialized) await logsTab.initialize();
        break;
      }
      case 'tab-drive115-tasks': {
        let mgr = (window as any).drive115TasksManager;
        if (!mgr) {
          const { Drive115TasksManager } = await import('./drive115Tasks');
          mgr = new Drive115TasksManager();
          (window as any).drive115TasksManager = mgr;
        }
        await mgr.initialize();
        break;
      }
      case 'tab-recycle-bin': {
        const { initRecycleBinTab } = await import('./recycleBin');
        await initRecycleBinTab();
        break;
      }
      case 'tab-media': {
        const { initMediaTab } = await import('./media');
        await initMediaTab();
        break;
      }
      case 'tab-insights': {
        const { insightsTab } = await import('./insights');
        if (!insightsTab.isInitialized) await insightsTab.initialize();
        break;
      }
      case 'tab-settings': {
        const { initSettingsTab } = await import('./settings');
        await initSettingsTab();
        break;
      }
      default:
        break;
    }
  } catch (error) {
    console.error('[tabs/registry] initializeTabById failed for', tabId, error);
  }
}

// 仅预取模块代码，不执行初始化，用于悬停预取
export async function prefetchModuleById(tabId: string | null | undefined): Promise<void> {
  if (!tabId) return;
  try {
    switch (tabId) {
      case 'tab-records':
        await import('./records');
        break;
      case 'tab-lists':
        await import('./lists');
        break;
      case 'tab-actors':
        await import('./actors');
        break;
      case 'tab-new-works':
        await import('./newWorks');
        break;
      case 'tab-sync':
        await import('./sync');
        break;
      case 'tab-backup':
        await import('./backup');
        break;
      case 'tab-logs':
        await import('./logs');
        break;
      case 'tab-drive115-tasks':
        await import('./drive115Tasks');
        break;
      case 'tab-recycle-bin':
        await import('./recycleBin');
        break;
      case 'tab-media':
        await import('./media');
        break;
      case 'tab-insights':
        await import('./insights');
        break;
      case 'tab-settings':
        await import('./settings');
        break;
      default:
        break;
    }
  } catch (error) {
    console.warn('[tabs/registry] prefetchModuleById failed for', tabId, error);
  }
}
