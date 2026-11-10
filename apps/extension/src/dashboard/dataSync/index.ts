/**
 * 数据同步模块主入口文件
 */

import { mountMediaMetadataBatches, unmountMediaMetadataBatches } from '../../apps/dashboard/components/mountMediaMetadataBatches';
import { logAsync } from '../logger';
import { log } from '../../utils/logController';
import { showMessage } from '../ui/toast';
import { SyncUI } from './ui';
import { SyncManagerFactory } from './syncers';
import type { SyncType } from './types';
import type { SyncMode } from '../config/syncConfig';
import { SyncCancelledError } from './types';
import { userService } from '../services/userService';
import { on } from '../services/eventBus';
import { requireAuthIfRestricted } from '../../features/privacy';

// 全局初始化标志
let isDataSyncInitialized = false;
let areEventsInitialized = false;

// 导出公共接口
export { SyncStatus } from './types';
export type { SyncType, SyncProgress, SyncResult } from './types';
export { SyncManagerFactory } from './syncers';
export { getApiClient } from './api';

/**
 * 初始化数据同步功能
 */
export async function initDataSyncSection(): Promise<void> {
    if (isDataSyncInitialized) {
        // logAsync('DEBUG', '数据同步功能已初始化，跳过重复初始化');
        return;
    }

    try {
        // logAsync('INFO', '初始化数据同步功能');

        // 初始化UI
        const ui = SyncUI.getInstance();
        await ui.init();
        mountMediaMetadataBatches();

        // 绑定同步事件
        bindSyncEvents();

        // 绑定事件总线监听器
        bindEventBusListeners();

        isDataSyncInitialized = true;
        // logAsync('INFO', '数据同步功能初始化完成');
    } catch (error: any) {
        logAsync('ERROR', '数据同步功能初始化失败', { error: error.message });
    }
}

/**
 * 刷新数据同步区域
 */
export async function refreshDataSyncSection(): Promise<void> {
    try {
        const ui = SyncUI.getInstance();
        await ui.refresh();
    } catch (error: any) {
        logAsync('ERROR', '刷新数据同步区域失败', { error: error.message });
    }
}

/**
 * 绑定同步事件
 */
function bindSyncEvents(): void {
    if (areEventsInitialized) {
        return; // 防止重复绑定事件
    }

    // 监听同步请求事件
    document.addEventListener('sync-requested', handleSyncRequest as EventListener);

    // 监听取消同步事件
    document.addEventListener('sync-cancel-requested', handleCancelSyncRequest as EventListener);

    // 监听页面卸载事件，清理资源
    window.addEventListener('beforeunload', cleanup);

    areEventsInitialized = true;
}

/**
 * 绑定事件总线监听器
 */
function bindEventBusListeners(): void {
    // 监听数据同步刷新请求
    on('data-sync-refresh-requested', () => {
        // logAsync('DEBUG', '收到数据同步刷新请求');
        refreshDataSyncSection();
    });

    // 监听用户登录状态变化
    on('user-login-status-changed', () => {
        // logAsync('DEBUG', '用户登录状态变化', { isLoggedIn });
        const ui = SyncUI.getInstance();
        ui.checkUserLoginStatus();
    });

    // 监听用户退出登录
    on('user-logout', () => {
        // logAsync('DEBUG', '用户退出登录，重置同步状态');
        resetSyncState();
    });
}

// handleActorGenderSyncRequest 函数已移除，性别信息现在直接从分类页面获取

/**
 * 处理同步请求
 */
async function handleSyncRequest(event: Event): Promise<void> {
    const customEvent = event as CustomEvent;
    const { type, mode } = customEvent.detail as { type: SyncType; mode?: SyncMode };

    if (!type) {
        showMessage('同步类型无效', 'error');
        return;
    }

    const ui = SyncUI.getInstance();
    // 受限拦截：actors → 'actor-sync'；其他 → 'data-sync'
    const feature: any = (type === 'actors') ? 'actor-sync' : 'data-sync';
    await requireAuthIfRestricted(feature, async () => {
        try {
            // 检查是否已在同步中
            if (SyncManagerFactory.isSyncing(type)) {
                showMessage(`${SyncManagerFactory.getSyncTypeDisplayName(type)}同步正在进行中，请稍候...`, 'warn');
                return;
            }

            // 检查是否有未完成的同步（want、viewed、lists 类型）
            if ((type === 'want' || type === 'viewed' || type === 'lists') && mode !== 'force') {
                const { hasUnfinishedSync, getSavedSyncProgress } = await import('./progressManager');
                const userProfile = await userService.getUserProfile();
                
                logAsync('INFO', '检查是否有未完成的同步', { 
                    type, 
                    userEmail: userProfile?.email,
                    mode 
                });
                
                if (userProfile && await hasUnfinishedSync(type, userProfile.email)) {
                    const savedProgress = await getSavedSyncProgress(type, userProfile.email);
                    logAsync('INFO', '发现未完成的同步', { savedProgress });
                    
                    if (savedProgress) {
                        // 显示确认对话框
                        const shouldResume = await showResumeConfirmDialog(type, savedProgress);
                        
                        logAsync('INFO', '用户选择', { shouldResume });
                        
                        if (shouldResume === null) {
                            // 用户取消
                            logAsync('INFO', '用户取消了恢复对话框');
                            return;
                        }
                        
                        if (shouldResume) {
                            // 继续上次同步
                            logAsync('INFO', '用户选择继续上次同步', { type, progress: savedProgress });
                            await executeSyncWithResume(type, mode, savedProgress, ui);
                            return;
                        } else {
                            // 重新开始同步，清除进度
                            const { clearSyncProgress } = await import('./progressManager');
                            await clearSyncProgress();
                            logAsync('INFO', '用户选择重新开始同步，已清除进度', { type });
                        }
                    }
                } else {
                    logAsync('INFO', '没有发现未完成的同步', { type, userEmail: userProfile?.email });
                }
            }

            // 设置UI状态
            ui.setSyncMode(mode || 'full'); // 先设置同步模式
            ui.setButtonLoadingState(type, true);
            ui.setAllButtonsDisabled(true);
            ui.showSyncProgress(true);

            // 特殊处理演员强制更新
            const modeStr = String(mode || '');
            if (type === 'actors' && modeStr === 'force') {
                // 演员强制更新，使用专门的强制更新方法
                const actorManager = SyncManagerFactory.getSyncManager('actors') as any;
                await actorManager.forceUpdate({
                    // 进度回调
                    onProgress: (progress: any) => {
                        ui.updateProgress(progress);
                    },
                    // 完成回调
                    onComplete: (result: any) => {
                        ui.showSyncProgress(false);
                        if (result.success) {
                            ui.showSuccess(result.message, result.details, result);
                            showMessage(result.message, 'success');
                        } else {
                            ui.showError(result.message);
                            showMessage(result.message, 'error');
                        }
                    },
                    // 错误回调
                    onError: (error: Error) => {
                        ui.showSyncProgress(false);
                        ui.showError(error.message);
                        showMessage(error.message, 'error');
                    }
                });
                return;
            }

            // 执行标准同步
            await SyncManagerFactory.executeSync(type, {
                mode,
                // 进度回调
                onProgress: (progress) => {
                    ui.updateProgress(progress);
                },
                // 完成回调
                onComplete: (result) => {
                    ui.showSyncProgress(false);
                    if (result.success) {
                        ui.showSuccess(result.message, result.details, result);
                        showMessage(result.message, 'success');
                    } else {
                        ui.showError(result.message);
                        showMessage(result.message, 'error');
                    }
                },
                // 错误回调
                onError: (error) => {
                    ui.showSyncProgress(false);
                    ui.showError(error.message);
                    showMessage(error.message, 'error');
                }
            });

        } catch (error: any) {
            if (error instanceof SyncCancelledError) {
                // 用户取消同步，显示信息而不是错误
                logAsync('INFO', '同步被用户取消', { type, reason: error.message });
                ui.showSyncProgress(false);
                showMessage('同步已取消', 'info');
            } else {
                // 真正的错误
                logAsync('ERROR', '同步请求处理失败', { type, error: error.message });
                ui.showSyncProgress(false);
                ui.showError(error.message);
                showMessage(error.message, 'error');
            }
        } finally {
            // 恢复UI状态
            ui.setButtonLoadingState(type, false);
            ui.setAllButtonsDisabled(false);
        }
    }, { title: '需要密码验证', message: '执行数据同步前需要完成密码验证。' });
}

/**
 * 处理取消同步请求
 */
async function handleCancelSyncRequest(): Promise<void> {
    try {
        logAsync('INFO', '收到取消同步请求');
        const success = await cancelCurrentSync();

        if (success) {
            showMessage('同步已取消', 'info');
        } else {
            showMessage('取消同步失败', 'error');
        }
    } catch (error: any) {
        logAsync('ERROR', '处理取消同步请求失败', { error: error.message });
        showMessage('取消同步失败', 'error');
    }
}

/**
 * 取消当前同步操作
 */
export async function cancelCurrentSync(): Promise<boolean> {
    try {
        // 取消所有正在进行的同步
        SyncManagerFactory.cancelAllSync();

        // 重置UI状态
        const ui = SyncUI.getInstance();
        ui.reset();

        return true;
    } catch (error: any) {
        logAsync('ERROR', '取消同步失败', { error: error.message });
        return false;
    }
}

/**
 * 获取同步状态
 */
export function getSyncStatus() {
    return {
        isAnySyncing: SyncManagerFactory.isAnySyncing(),
        syncingTypes: {
            viewed: SyncManagerFactory.isSyncing('viewed'),
            want: SyncManagerFactory.isSyncing('want'),
            actors: SyncManagerFactory.isSyncing('actors'),
            all: SyncManagerFactory.isSyncing('all')
        }
    };
}

/**
 * 重置同步状态
 */
export function resetSyncState(): void {
    try {
        const ui = SyncUI.getInstance();

        // 取消所有同步
        SyncManagerFactory.cancelAllSync();

        // 重置UI
        ui.reset();

        log.verbose('同步状态已重置');
    } catch (error: any) {
        logAsync('ERROR', '重置同步状态失败', { error: error.message });
    }
}

/**
 * 获取同步统计信息
 */
export async function getSyncStatistics() {
    try {
        // 这里可以添加统计信息的获取逻辑
        // 暂时返回基本状态
        return getSyncStatus();
    } catch (error: any) {
        logAsync('ERROR', '获取同步统计失败', { error: error.message });
        return null;
    }
}

/**
 * 检查同步功能可用性
 */
export async function checkSyncAvailability(): Promise<{
    available: boolean;
    reason?: string;
}> {
    try {
        // 检查用户登录状态
        const userProfile = await userService.getUserProfile();

        if (!userProfile || !userProfile.isLoggedIn) {
            return {
                available: false,
                reason: '用户未登录'
            };
        }

        // 检查网络连接
        if (!navigator.onLine) {
            return {
                available: false,
                reason: '网络连接不可用'
            };
        }

        return {
            available: true
        };
    } catch (error: any) {
        return {
            available: false,
            reason: error.message
        };
    }
}

/**
 * 清理资源
 */
function cleanup(): void {
    unmountMediaMetadataBatches();
    try {
        // 移除事件监听器
        document.removeEventListener('sync-requested', handleSyncRequest as EventListener);
        // handleActorGenderSyncRequest 函数已移除，性别信息现在直接从分类页面获取
        window.removeEventListener('beforeunload', cleanup);

        // 重置状态
        resetSyncState();

        logAsync('INFO', '数据同步模块资源已清理');
    } catch (error: any) {
        logAsync('ERROR', '清理数据同步模块资源失败', { error: error.message });
    }
}

/**
 * 模块信息
 */
export const MODULE_INFO = {
    name: 'DataSync',
    version: '1.0.0',
    description: 'JavDB数据同步模块',
    author: 'JavDB Extension Team'
};

// 默认导出主要功能
export default {
    init: initDataSyncSection,
    refresh: refreshDataSyncSection,
    cancel: cancelCurrentSync,
    getStatus: getSyncStatus,
    reset: resetSyncState,
    getStats: getSyncStatistics,
    checkAvailability: checkSyncAvailability
};

/**
 * 显示恢复同步确认对话框
 */
async function showResumeConfirmDialog(type: SyncType, progress: any): Promise<boolean | null> {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'cloudflare-verification-modal';
        modal.innerHTML = `
            <div class="verification-overlay"></div>
            <div class="verification-content" style="max-width: 500px;">
                <div class="verification-header">
                    <h3><i class="fas fa-history"></i> 发现未完成的同步</h3>
                </div>
                <div class="verification-body">
                    <div class="verification-info">
                        <p class="verification-main-text">检测到上次同步未完成</p>
                        <div style="text-align: left; margin: 20px 0; padding: 15px; background: #f8f9fa; border-radius: 8px; font-size: 14px;">
                            <div style="margin-bottom: 8px;"><strong>同步类型：</strong>${type === 'want' ? '想看' : '已观看'}</div>
                            <div style="margin-bottom: 8px;"><strong>进度：</strong>第 ${progress.currentPage}/${progress.totalPages} 页</div>
                            <div style="margin-bottom: 8px;"><strong>已同步：</strong>${progress.syncedCount} 个视频</div>
                            <div style="margin-bottom: 8px;"><strong>新增：</strong>${progress.newRecords} 个，<strong>更新：</strong>${progress.updatedRecords} 个</div>
                            <div><strong>时间：</strong>${formatTimestamp(progress.timestamp)}</div>
                        </div>
                        <p class="verification-sub-text" style="color: #6c757d;">
                            是否要从上次中断的位置继续同步？
                        </p>
                    </div>
                </div>
                <div class="verification-footer">
                    <button class="verification-cancel-btn" style="background: #6c757d;">重新开始</button>
                    <button class="verification-complete-btn">继续同步</button>
                </div>
            </div>
        `;

        const cancelBtn = modal.querySelector('.verification-cancel-btn') as HTMLButtonElement;
        const continueBtn = modal.querySelector('.verification-complete-btn') as HTMLButtonElement;

        const cleanup = () => {
            modal.remove();
        };

        cancelBtn.addEventListener('click', () => {
            cleanup();
            resolve(false); // 重新开始
        });

        continueBtn.addEventListener('click', () => {
            cleanup();
            resolve(true); // 继续同步
        });

        // ESC键取消
        const handleKeydown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                cleanup();
                document.removeEventListener('keydown', handleKeydown);
                resolve(null); // 取消
            }
        };
        document.addEventListener('keydown', handleKeydown);

        document.body.appendChild(modal);
    });
}

/**
 * 格式化时间戳
 */
function formatTimestamp(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 1000 / 60);
    const hours = Math.floor(minutes / 60);
    
    if (minutes < 1) {
        return '刚刚';
    } else if (minutes < 60) {
        return `${minutes} 分钟前`;
    } else if (hours < 24) {
        return `${hours} 小时前`;
    } else {
        const date = new Date(timestamp);
        return date.toLocaleString('zh-CN');
    }
}

/**
 * 执行带恢复的同步
 */
async function executeSyncWithResume(type: SyncType, mode: SyncMode | undefined, savedProgress: any, ui: SyncUI): Promise<void> {
    // 设置UI状态
    ui.setSyncMode(mode || 'full');
    ui.setButtonLoadingState(type, true);
    ui.setAllButtonsDisabled(true);
    ui.showSyncProgress(true);

    // 执行同步，传入 resumeFromProgress 标志
    await SyncManagerFactory.executeSync(type, {
        mode,
        resumeFromProgress: true, // 标记为恢复模式
        // 进度回调
        onProgress: (progress) => {
            ui.updateProgress(progress);
        },
        // 完成回调
        onComplete: (result) => {
            ui.showSyncProgress(false);
            if (result.success) {
                ui.showSuccess(result.message, result.details, result);
                showMessage(result.message, 'success');
            } else {
                ui.showError(result.message);
                showMessage(result.message, 'error');
            }
        },
        // 错误回调
        onError: (error) => {
            ui.showSyncProgress(false);
            ui.showError(error.message);
            showMessage(error.message, 'error');
        }
    });
}
