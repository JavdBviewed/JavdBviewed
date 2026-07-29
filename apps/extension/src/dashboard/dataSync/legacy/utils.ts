/**
 * 数据同步工具函数模块
 */

import { getValue } from '../../../utils/storage';
import { STORAGE_KEYS, VIDEO_STATUS } from '../../../utils/config';
import type { VideoRecord } from '../../../types';
import type { SyncStats } from '../types';
import type { SyncType, SyncConfig } from '../../config/syncConfig';
import { DEFAULT_SYNC_CONFIG, getSyncConfig, isSyncTypeSupported, getSyncTypeDisplayName } from '../../config/syncConfig';

/**
 * 根据同步类型过滤数据
 */
export function filterDataByType(records: Record<string, VideoRecord>, type: SyncType): Record<string, VideoRecord> {
    switch (type) {
        case 'all':
            return Object.fromEntries(
                Object.entries(records).filter(([_, record]) => 
                    record.status === VIDEO_STATUS.VIEWED || record.status === VIDEO_STATUS.WANT
                )
            );
        case 'viewed':
            return Object.fromEntries(
                Object.entries(records).filter(([_, record]) => record.status === VIDEO_STATUS.VIEWED)
            );
        case 'want':
            return Object.fromEntries(
                Object.entries(records).filter(([_, record]) => record.status === VIDEO_STATUS.WANT)
            );
        case 'actors':
            // 演员功能暂未实现，返回空对象
            return {};
        default:
            return {};
    }
}

/**
 * 获取同步统计信息
 */
export async function getSyncStats(): Promise<SyncStats> {
    try {
        const records = await getValue<Record<string, VideoRecord>>(STORAGE_KEYS.VIEWED_RECORDS, {});
        
        const totalRecords = Object.keys(records).length;
        const viewedRecords = Object.values(records).filter(r => r.status === VIDEO_STATUS.VIEWED).length;
        const wantRecords = Object.values(records).filter(r => r.status === VIDEO_STATUS.WANT).length;
        const actorsRecords = 0; // 暂未实现
        
        return {
            totalRecords,
            viewedRecords,
            wantRecords,
            actorsRecords
        };
    } catch (error) {
        return {
            totalRecords: 0,
            viewedRecords: 0,
            wantRecords: 0,
            actorsRecords: 0
        };
    }
}

// getSyncTypeDisplayName 已从配置模块导入

/**
 * 验证同步数据
 */
export function validateSyncData(data: Record<string, VideoRecord>): boolean {
    if (!data || typeof data !== 'object') {
        return false;
    }
    
    // 检查数据格式
    for (const [id, record] of Object.entries(data)) {
        if (!record || typeof record !== 'object') {
            return false;
        }
        
        if (!record.id || !record.title || !record.status) {
            return false;
        }
        
        if (record.id !== id) {
            return false;
        }
    }
    
    return true;
}

/**
 * 分批处理数据
 */
export function batchData<T>(data: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < data.length; i += batchSize) {
        batches.push(data.slice(i, i + batchSize));
    }
    return batches;
}

/**
 * 延迟函数
 */
export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 重试函数
 */
export async function retry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    delayMs: number = 1000
): Promise<T> {
    let lastError: Error;
    
    for (let i = 0; i <= maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error as Error;
            if (i < maxRetries) {
                await delay(delayMs * Math.pow(2, i)); // 指数退避
            }
        }
    }
    
    throw lastError!;
}

/**
 * 计算同步进度百分比
 */
export function calculateProgress(current: number, total: number, baseProgress: number = 0, maxProgress: number = 100): number {
    if (total === 0) return maxProgress;
    const range = maxProgress - baseProgress;
    return baseProgress + (current / total) * range;
}

/**
 * 格式化同步结果消息
 */
export function formatSyncResultMessage(
    type: SyncType,
    syncedCount: number,
    skippedCount: number = 0,
    errorCount: number = 0
): string {
    const typeName = getSyncTypeDisplayName(type);
    
    if (syncedCount === 0 && skippedCount === 0 && errorCount === 0) {
        return `没有需要同步的${typeName}`;
    }
    
    let message = `${typeName}同步完成`;
    const parts: string[] = [];
    
    if (syncedCount > 0) {
        parts.push(`成功 ${syncedCount} 条`);
    }
    
    if (skippedCount > 0) {
        parts.push(`跳过 ${skippedCount} 条`);
    }
    
    if (errorCount > 0) {
        parts.push(`失败 ${errorCount} 条`);
    }
    
    if (parts.length > 0) {
        message += `：${parts.join('，')}`;
    }
    
    return message;
}

// getSyncConfig 已从配置模块导入

// isSyncTypeSupported 已从配置模块导入

/**
 * 生成同步请求ID
 */
export function generateSyncRequestId(): string {
    return `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 验证用户权限
 */
export function validateUserPermissions(userProfile: any): boolean {
    return userProfile && 
           userProfile.isLoggedIn && 
           userProfile.email && 
           userProfile.username;
}

/**
 * 清理同步数据
 */
export function sanitizeSyncData(records: Record<string, VideoRecord>): VideoRecord[] {
    return Object.values(records)
        .filter(record => record && record.id && record.title)
        .map(record => ({
            id: record.id,
            title: record.title,
            status: record.status,
            tags: record.tags || [],
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            releaseDate: record.releaseDate,
            javdbUrl: record.javdbUrl,
            javdbImage: record.javdbImage
        }));
}

/**
 * 检查网络连接状态
 */
export function checkNetworkStatus(): boolean {
    return navigator.onLine;
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 生成同步摘要
 */
export function generateSyncSummary(
    type: SyncType,
    stats: SyncStats,
    dataCount: number
): string {
    const typeName = getSyncTypeDisplayName(type);
    return `准备同步${typeName} ${dataCount} 条记录`;
}
