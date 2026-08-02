/**
 * @file bootstrap.ts
 * @description bootstrap
 * @module apps/dashboard
 */
// @ts-nocheck

import { initializeGlobalState, STATE, cleanupSearchEngines } from '../../dashboard/state';
import { initTabs } from '../../dashboard/tabs/navigation';
import { ensureModalsMounted } from '../../dashboard/modals/init';
// initAdvancedSettingsTab 已迁移到模块化设置系统
// initLogsTab 已迁移到模块化设置系统
// initAISettingsTab 已迁移到模块化设置系统
// initializeNetworkTestTab 已迁移到模块化设置系统
// drive115 功能已迁移到模块化设置系统
import { initModal } from '../../dashboard/import';
// import { logAsync } from './logger';
// import { showMessage } from './ui/toast';
// import { VIDEO_STATUS } from '../utils/config';
// import { showWebDAVRestoreModal } from './webdavRestore';
// import { setValue, getValue } from '../utils/storage';
// import { STORAGE_KEYS } from '../utils/config';
import { initDashboardUserMenu } from '../../dashboard/userMenu';
import { initDashboardLastPageResume } from '../../dashboard/lastPage';
// import { initDataSyncSection } from './dataSync';
import '../../dashboard/ui/dataViewModal'; // 确保 dataViewModal 被初始化
import { ensureMounted } from '../../dashboard/loaders/partialsLoader';
import { bindInsightsListeners } from '../../dashboard/listeners/insights';
import { initTopbarIcons } from '../../dashboard/topbar/icons';
import { initVersionBadge } from '../../dashboard/topbar/versionChecker';
import { initBackupActions, updateSyncStatus as updateSyncStatusModule } from '../../dashboard/backup/actions';
import { runQASelfCheck as runQASelfCheckModule } from '../../dashboard/qa/selfCheck';
import { bindUiListeners } from '../../dashboard/listeners/ui';
import { refreshHomeOverview, bindHomeChartsRangeControls, bindHomeRefreshButton } from '../../dashboard/home/charts';
import { STORAGE_KEYS } from '../../utils/config';
import { getSettings } from '../../utils/storage';
import { handleCloudflareVerification } from '../../dashboard/dataSync/cloudflareVerification';
import { mountDashboardReleaseAnnouncement } from './releaseAnnouncementBootstrap';
import { reportDashboardOpenTelemetry } from './telemetryDashboardOpen';
import { installDashboardConsoleProxy } from './consoleBootstrap';
import { initializeDashboardPrivacy, registerDashboardPrivacyLockHandler } from './privacyBootstrap';
import {
    initializeDashboardThemeEarly,
    initializeDashboardThemeForDom,
    mountDashboardThemeSwitcher,
} from './themeBootstrap';
import { mountDashboardShell } from './shell/mountDashboardShell';

initializeDashboardThemeEarly();
installDashboardConsoleProxy();

// 首页聚合工具已迁移到 ./home/charts

// 监听 Insights 变更，自动刷新首页图表
bindInsightsListeners();
// 监听 UI 级消息（toast等）
bindUiListeners();

// 监听来自 background 的 Cloudflare 验证请求
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'cloudflare-verification-request') {
        const url = message.url;
        
        // 处理验证
        handleCloudflareVerification(url).then((result) => {
            sendResponse(result);
        }).catch((error) => {
            sendResponse({ success: false, error: error.message || '验证失败' });
        });
        
        return true; // 保持消息通道开启
    }
});

// 首页 ECharts 兜底渲染已迁移到 ./home/charts

document.addEventListener('DOMContentLoaded', async () => {
    // 添加全局事件委托来处理设置页面的返回按钮
    document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const backBtn = target.closest('[data-action="back-to-settings"]');
        if (backBtn) {
            console.log('[SETTINGS] 点击返回设置按钮');
            console.log('[SETTINGS] 当前 URL:', window.location.href);
            
            e.preventDefault();
            e.stopPropagation();
            
            // 直接修改 location.hash，这会自动触发 hashchange 事件
            console.log('[SETTINGS] 准备跳转到: /dashboard/dashboard.html#tab-settings');
            window.location.hash = '#tab-settings';
        }
    }, true); // 使用捕获阶段
    
    await initializeDashboardThemeForDom();

    // W2: React shell owns chrome layout (topbar + tab hosts). Less dual-track than skeleton partials.
    // layout.css 已由 dashboard.css @import，勿再 ensureStylesLoaded 二次注入（会改变 cascade / 加重闪变）。
    try {
        mountDashboardShell('#app-root');
        console.log('[Dashboard] React shell mounted');
    } catch (error) {
        console.error('[Dashboard] React shell mount failed, falling back to HTML skeleton', error);
        try {
            await ensureMounted('#app-root', 'layout/skeleton.html');
            await ensureMounted('#layout-topbar-root', 'layout/topbar.html');
            await ensureMounted('#layout-tabs-nav-root', 'layout/tabs-nav.html');
        } catch {}
    }

    registerDashboardPrivacyLockHandler();

    await initializeGlobalState();
    reportDashboardOpenTelemetry();

    try {
        if (!(window as any).__SETTINGS_ON_CHANGED_BOUND__) {
            chrome.storage.onChanged.addListener((changes, areaName) => {
                try {
                    if (areaName !== 'local') return;
                    if (!changes || !changes[STORAGE_KEYS.SETTINGS]) return;
                    getSettings().then((s) => {
                        try { STATE.settings = s; } catch {}
                        try { updateSyncStatusModule(); } catch {}
                    }).catch(() => {});
                } catch {}
            });
            (window as any).__SETTINGS_ON_CHANGED_BOUND__ = true;
        }
    } catch {}
    // Modals 常驻挂载
    try { await ensureModalsMounted(); } catch {}

    // 日志控制器已在模块加载时自动初始化，这里无需重复初始化

    // 清理搜索引擎配置中的测试数据
    await cleanupSearchEngines();

    // QA 自检（开发期）：检查基础样式与模态框唯一性/挂载状态
    try { runQASelfCheckModule(); } catch {}

    await initializeDashboardPrivacy();

    initTopbarIcons();
    mountDashboardThemeSwitcher();
    
    // 初始化版本检测和显示（异步，不阻塞页面）
    initVersionBadge().catch(error => {
        console.error('Failed to initialize version badge:', error);
    });

    // 通过统一路由按需初始化 115 服务

    // 监听首页初始化事件（由 navigation.ts 触发），集中处理首页的概览与图表
    try {
        if (!(window as any).__HOME_INIT_REQUIRED_BOUND__) {
            window.addEventListener('home:init-required' as any, async () => {
                try { bindHomeChartsRangeControls(); } catch {}
                try { await refreshHomeOverview(); } catch {}
                try { bindHomeRefreshButton(); } catch {}
            });
            (window as any).__HOME_INIT_REQUIRED_BOUND__ = true;
        }
    } catch {}

    await initTabs();
    // initActorsTab(); // 延迟初始化，仅在用户点击“演员库”标签页时加载
    // initNewWorksTab(); // 延迟初始化，仅在用户点击“新作”标签页时加载
    // initSyncTab(); // lazy: moved to tab click and hash init
    // initSettingsTab(); // lazy: moved to tab click and hash init
    // initAdvancedSettingsTab(); // 已迁移到模块化设置系统
    // initAISettingsTab(); // 已迁移到模块化设置系统
    // initDrive115Tab(); // 已迁移到模块化设置系统
    // initLogsTab(); // 已迁移到模块化设置系统
    initBackupActions(document);
    initDashboardUserMenu();
    void initDashboardLastPageResume();
    // initDataSyncSection(); // 移除重复调用，由 initSyncTab 处理
    initModal();
    updateSyncStatusModule();
    mountDashboardReleaseAnnouncement().catch(error => {
        console.warn('[Dashboard] 发布提示弹窗挂载失败:', error);
    });
    try {
        if (!(window as any).__HOME_TAB_SHOW_BOUND__) {
            window.addEventListener('tab:show' as any, async (e: any) => {
                const id = e?.detail?.tabId;
                if (id === 'tab-home') {
                    try { bindHomeChartsRangeControls(); } catch {}
                }
            });
            (window as any).__HOME_TAB_SHOW_BOUND__ = true;
        }
    } catch {}
});

/**
 * 初始化演员库标签页
 */
async function initActorsTab(): Promise<void> {
    try {
        const { actorsTab } = await import('../../dashboard/tabs/actors');
        await actorsTab.initActorsTab();
    } catch (error) {
        console.error('初始化演员库标签页失败:', error);
    }
}

/**
 * 初始化新作标签页
 */
async function initNewWorksTab(): Promise<void> {
    try {
        const { newWorksTab } = await import('../../dashboard/tabs/newWorks');
        await newWorksTab.initialize();
    } catch (error) {
        console.error('初始化新作标签页失败:', error);
    }
}

/**
 * 初始化数据同步标签页
 */
async function initSyncTab(): Promise<void> {
    try {
        const { syncTab } = await import('../../dashboard/tabs/sync');
        await syncTab.initSyncTab();
    } catch (error) {
        console.error('初始化数据同步标签页失败:', error);
    }
}
