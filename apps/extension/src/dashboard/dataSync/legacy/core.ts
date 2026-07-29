/**
 * 数据同步核心逻辑模块
 */

import { getValue } from '../../../utils/storage';
import { STORAGE_KEYS } from '../../../utils/config';
import { logAsync } from '../../logger';
import { showMessage } from '../../ui/toast';
import { userService } from '../../services/userService';
import type { VideoRecord, UserProfile } from '../../../types';
import { SyncStatus } from '../types';
import type {
    SyncType,
    SyncContext,
    SyncProgress,
    SyncResult,
    SyncConfig
} from '../types';
import { SyncCancelledError } from '../types';
import {
    filterDataByType,
    getSyncStats,
    validateSyncData,
    sanitizeSyncData,
    formatSyncResultMessage,
    validateUserPermissions,
    generateSyncRequestId
} from './utils';
import {
    getSyncConfig,
    isSyncTypeSupported,
    getSyncTypeDisplayName
} from '../../config/syncConfig';
import { getApiClient } from './api';

/**
 * 同步管理器类
 */
export class SyncManager {
    private static instance: SyncManager;
    private currentStatus: SyncStatus = SyncStatus.IDLE;
    private currentContext: SyncContext | null = null;
    private abortController: AbortController | null = null;

    private constructor() {}

    public static getInstance(): SyncManager {
        if (!SyncManager.instance) {
            SyncManager.instance = new SyncManager();
        }
        return SyncManager.instance;
    }

    /**
     * 执行同步操作
     */
    public async sync(
        type: SyncType,
        config?: Partial<SyncConfig>,
        onProgress?: (progress: SyncProgress) => void,
        onComplete?: (result: SyncResult) => void,
        onError?: (error: Error) => void
    ): Promise<SyncResult> {
        // 检查是否已在同步中
        if (this.currentStatus === SyncStatus.SYNCING) {
            const error = new Error('正在同步中，请稍候...');
            onError?.(error);
            throw error;
        }

        // 检查同步类型是否支持
        if (!isSyncTypeSupported(type)) {
            const error = new Error(`${getSyncTypeDisplayName(type)}功能即将推出`);
            onError?.(error);
            throw error;
        }

        const requestId = generateSyncRequestId();
        logAsync('INFO', `开始同步操作`, { type, requestId, config });

        try {
            // 设置同步状态
            this.currentStatus = SyncStatus.SYNCING;
            this.abortController = new AbortController();
            logAsync('INFO', '同步状态已设置为SYNCING');

            // 验证用户登录状态
            logAsync('INFO', '开始验证用户登录状态...');
            const userProfile = await this.validateUser();
            logAsync('INFO', '用户验证完成', {
                email: userProfile.email,
                isLoggedIn: userProfile.isLoggedIn
            });

            // 对于想看和已观看同步，直接从服务器获取，不需要本地数据
            let dataToSync: Record<string, VideoRecord> = {};

            if (type === 'want' || type === 'viewed') {
                const syncTypeName = type === 'want' ? '想看' : '已观看';
                logAsync('INFO', `${syncTypeName}同步模式：跳过本地数据获取，直接从服务器同步`);
                // 想看和已观看同步不需要本地数据，直接从服务器获取
                dataToSync = {};
            } else {
                // 其他类型需要获取本地数据
                logAsync('INFO', '开始获取本地数据...');
                const localRecords = await this.getLocalData();
                dataToSync = filterDataByType(localRecords, type);
                logAsync('INFO', '本地数据获取完成', {
                    totalRecords: Object.keys(localRecords).length,
                    filteredRecords: Object.keys(dataToSync).length,
                    syncType: type
                });

                // 验证数据
                logAsync('INFO', '开始验证数据格式...');
                if (!validateSyncData(dataToSync)) {
                    throw new Error('本地数据格式错误，无法进行同步');
                }
                logAsync('INFO', '数据格式验证通过');
            }

            // 获取同步统计
            logAsync('INFO', '开始获取同步统计...');
            const stats = await getSyncStats();
            logAsync('INFO', '同步统计获取完成', stats);

            // 创建同步上下文
            logAsync('INFO', '创建同步上下文...');
            const syncConfig = getSyncConfig(config);
            this.currentContext = {
                type,
                config: syncConfig,
                data: dataToSync,
                stats,
                onProgress,
                onComplete,
                onError
            };
            logAsync('INFO', '同步上下文创建完成', {
                type,
                configBatchSize: syncConfig.batchSize,
                dataCount: Object.keys(dataToSync).length
            });

            // 执行同步
            logAsync('INFO', '开始执行同步...');
            const result = await this.performSync(this.currentContext);
            logAsync('INFO', '同步执行完成', result);

            // 更新状态
            this.currentStatus = result.success ? SyncStatus.SUCCESS : SyncStatus.ERROR;
            
            // 调用完成回调
            onComplete?.(result);
            
            logAsync('INFO', '同步操作完成', { type, result, requestId });
            return result;

        } catch (error: any) {
            this.currentStatus = SyncStatus.ERROR;

            if (error instanceof SyncCancelledError) {
                // 用户取消，记录信息日志
                logAsync('INFO', '同步操作被用户取消', { type, reason: error.message, requestId });
            } else {
                // 真正的错误
                logAsync('ERROR', '同步操作失败', { type, error: error.message, requestId });
            }

            const result: SyncResult = {
                success: false,
                message: error.message
            };

            onError?.(error);
            return result;
        } finally {
            // 清理状态
            this.cleanup();
        }
    }

    /**
     * 执行具体的同步逻辑
     */
    private async performSync(context: SyncContext): Promise<SyncResult> {
        const { type, data, config, onProgress } = context;
        logAsync('INFO', 'performSync开始', { type, dataCount: Object.keys(data).length });

        // 对于想看和已观看同步，直接调用API，不需要检查本地数据
        if (type === 'want' || type === 'viewed') {
            const syncTypeName = type === 'want' ? '想看' : '已观看';
            logAsync('INFO', `${syncTypeName}同步：直接调用API获取服务器数据`);

            // 更新进度：准备阶段（不显示具体数字）
            onProgress?.({
                percentage: 0,
                message: `准备同步${syncTypeName}列表...`
            });

            try {
                // 获取用户信息
                logAsync('INFO', `获取用户信息用于${syncTypeName}同步...`);
                const userProfile = await userService.getUserProfile();
                if (!userProfile) {
                    throw new Error('无法获取用户信息');
                }
                logAsync('INFO', '用户信息获取成功', {
                    email: userProfile.email,
                    isLoggedIn: userProfile.isLoggedIn
                });

                // 直接调用API进行同步
                logAsync('INFO', `调用API客户端进行${syncTypeName}同步`);
                const apiClient = getApiClient();
                const syncResponse = await apiClient.syncData(
                    type,
                    [], // 想看和已观看同步不需要本地数据
                    userProfile,
                    config,
                    (current: number, total: number, stage?: 'pages' | 'details') => {
                        // 每个阶段都是独立的0-100%进度
                        const percentage = (current / total) * 100;
                        let message: string;

                        if (stage === 'pages') {
                            message = `获取${syncTypeName}列表 (${current}/${total}页)...`;
                            logAsync('INFO', `页面获取进度: ${current}/${total} (${percentage.toFixed(1)}%)`);
                        } else if (stage === 'details') {
                            message = `同步${syncTypeName}视频 (${current}/${total})...`;
                            logAsync('INFO', `详情获取进度: ${current}/${total} (${percentage.toFixed(1)}%)`);
                        } else {
                            message = `同步进度 (${current}/${total})...`;
                            logAsync('INFO', `同步进度: ${current}/${total} (${percentage.toFixed(1)}%)`);
                        }

                        onProgress?.({
                            percentage,
                            message,
                            current,
                            total,
                            stage
                        });
                    },
                    this.abortController?.signal
                );
                logAsync('INFO', '想看同步API调用完成', syncResponse);

                // 更新进度：完成
                onProgress?.({
                    percentage: 100,
                    message: '想看同步完成',
                    current: syncResponse.syncedCount,
                    total: syncResponse.syncedCount
                });

                // 格式化结果消息
                const message = formatSyncResultMessage(
                    type,
                    syncResponse.syncedCount,
                    syncResponse.skippedCount,
                    syncResponse.errorCount
                );

                return {
                    success: true,
                    message,
                    syncedCount: syncResponse.syncedCount,
                    skippedCount: syncResponse.skippedCount,
                    errorCount: syncResponse.errorCount,
                    details: syncResponse.errors ?
                        `错误详情：${syncResponse.errors.map(e => e.error).join(', ')}` :
                        undefined
                };

            } catch (error: any) {
                if (error instanceof SyncCancelledError) {
                    logAsync('INFO', '用户取消了想看同步', { reason: error.message });
                    throw error; // 直接抛出，不包装
                } else {
                    logAsync('ERROR', '想看同步失败', { error: error.message });
                    throw new Error(`想看同步失败: ${error.message}`);
                }
            }
        }

        // 其他类型的同步逻辑
        const dataArray = sanitizeSyncData(data);
        const totalCount = dataArray.length;
        logAsync('INFO', '数据清理完成', {
            originalCount: Object.keys(data).length,
            sanitizedCount: totalCount,
            type
        });

        // 检查是否有数据需要同步
        if (totalCount === 0) {
            const message = `没有需要同步的${getSyncTypeDisplayName(type)}`;
            logAsync('INFO', '没有数据需要同步', { type, message });
            return {
                success: true,
                message,
                syncedCount: 0
            };
        }

        logAsync('INFO', `准备同步${totalCount}条${getSyncTypeDisplayName(type)}数据`);

        // 更新进度：准备阶段
        onProgress?.({
            percentage: 0,
            message: '准备同步...',
            current: 0,
            total: totalCount
        });

        try {
            // 获取用户信息
            logAsync('INFO', '获取用户信息用于同步...');
            const userProfile = await userService.getUserProfile();
            if (!userProfile) {
                throw new Error('无法获取用户信息');
            }
            logAsync('INFO', '用户信息获取成功', {
                email: userProfile.email,
                isLoggedIn: userProfile.isLoggedIn
            });

            // 更新进度：开始同步
            onProgress?.({
                percentage: 10,
                message: '开始同步...',
                current: 0,
                total: totalCount
            });

            // 调用API进行同步
            logAsync('INFO', '调用API客户端进行同步', { type, totalCount });
            const apiClient = getApiClient();
            const syncResponse = await apiClient.syncData(
                type,
                dataArray,
                userProfile,
                config,
                (current, total) => {
                    // API进度回调，映射到40%-90%的进度范围
                    const percentage = 40 + (current / total) * 50;
                    logAsync('INFO', `同步进度更新: ${current}/${total} (${percentage.toFixed(1)}%)`);
                    onProgress?.({
                        percentage,
                        message: '同步中...',
                        current,
                        total
                    });
                }
            );
            logAsync('INFO', 'API同步调用完成', syncResponse);

            // 更新进度：完成
            onProgress?.({
                percentage: 100,
                message: '同步完成',
                current: totalCount,
                total: totalCount
            });

            // 格式化结果消息
            const message = formatSyncResultMessage(
                type,
                syncResponse.syncedCount,
                syncResponse.skippedCount,
                syncResponse.errorCount
            );

            return {
                success: true,
                message,
                syncedCount: syncResponse.syncedCount,
                skippedCount: syncResponse.skippedCount,
                errorCount: syncResponse.errorCount,
                details: syncResponse.errors ? 
                    `错误详情：${syncResponse.errors.map(e => e.error).join(', ')}` : 
                    undefined
            };

        } catch (error: any) {
            if (error instanceof SyncCancelledError) {
                // 用户取消，直接抛出，不包装
                throw error;
            } else {
                throw new Error(`同步失败: ${error.message}`);
            }
        }
    }

    /**
     * 验证用户登录状态
     */
    private async validateUser(): Promise<UserProfile> {
        const userProfile = await userService.getUserProfile();

        if (!validateUserPermissions(userProfile)) {
            throw new Error('请先登录 JavDB 账号');
        }

        return userProfile!;
    }

    /**
     * 获取本地数据
     */
    private async getLocalData(): Promise<Record<string, VideoRecord>> {
        try {
            const records = await getValue<Record<string, VideoRecord>>(
                STORAGE_KEYS.VIEWED_RECORDS, 
                {}
            );
            return records;
        } catch (error: any) {
            throw new Error(`获取本地数据失败: ${error.message}`);
        }
    }

    /**
     * 取消当前同步操作
     */
    public async cancelSync(): Promise<boolean> {
        if (this.currentStatus !== SyncStatus.SYNCING) {
            return false;
        }

        try {
            // 取消网络请求
            this.abortController?.abort();
            
            // 重置状态
            this.currentStatus = SyncStatus.IDLE;
            this.cleanup();
            
            logAsync('INFO', '同步操作已取消');
            showMessage('同步操作已取消', 'info');
            return true;
        } catch (error: any) {
            logAsync('ERROR', '取消同步失败', { error: error.message });
            return false;
        }
    }

    /**
     * 获取当前同步状态
     */
    public getCurrentStatus(): SyncStatus {
        return this.currentStatus;
    }

    /**
     * 获取当前同步上下文
     */
    public getCurrentContext(): SyncContext | null {
        return this.currentContext;
    }

    /**
     * 检查是否正在同步
     */
    public isSyncing(): boolean {
        return this.currentStatus === SyncStatus.SYNCING;
    }

    /**
     * 重置同步状态
     */
    public reset(): void {
        this.currentStatus = SyncStatus.IDLE;
        this.cleanup();
    }

    /**
     * 清理资源
     */
    private cleanup(): void {
        this.currentContext = null;
        this.abortController = null;
    }

    /**
     * 获取同步统计信息
     */
    public async getStats() {
        return await getSyncStats();
    }
}

/**
 * 获取同步管理器实例
 */
export function getSyncManager(): SyncManager {
    return SyncManager.getInstance();
}
