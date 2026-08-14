/**
 * @file concurrency.ts
 * @description concurrency
 * @module features/records
 */
// src/features/records/content/concurrency.ts

import { STATE, log } from '../../contentState';
import { getValue, setValue } from '../../../utils/storage';
import { dbViewedGet, dbViewedPut, dbLogsAdd } from '../../../platform/storage/dbRuntimeClient';
import type { VideoRecord } from '../../../types';

// 操作队列管理
interface VideoOperation {
    videoId: string;
    operationId: string;
    type: 'process' | 'delayed';
    timestamp: number;
    resolve: () => void;
    reject: (error: any) => void;
}

type StorageWriteOptions = {
    backupToStorage?: boolean;
    verifyAfterWrite?: boolean;
    dbTimeoutBehavior?: 'hard' | 'diagnostic';
};

// 存储操作管理器 - 解决并发存储冲突
class StorageManager {
    private operationQueue: Promise<any> = Promise.resolve();
    private maxRetries = 3;
    private retryDelay = 500;

    private async putRecordInternal(
        record: VideoRecord,
        operationId: string,
        options: StorageWriteOptions = {}
    ): Promise<{ success: boolean; error?: string }> {
        const backupToStorage = options.backupToStorage !== false;
        const verifyAfterWrite = options.verifyAfterWrite !== false;
        let lastError: any;

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                log(`[StorageManager] Attempt ${attempt} to put ${record.id} (operation ${operationId})`);

                log(`[StorageManager] putRecord -> dbViewedPut:start ${record.id} (operation ${operationId})`);
                const result = await dbViewedPut(record, { timeoutBehavior: options.dbTimeoutBehavior });
                log(`[StorageManager] putRecord -> dbViewedPut:done ${record.id} (operation ${operationId})`, { skipped: result?.skipped });

                // 如果记录在回收站中，跳过后续操作
                if (result.skipped) {
                    log(`[StorageManager] Record ${record.id} is in trash, skipping update`);
                    return { success: true };
                }

                log(`[StorageManager] Put record to IDB: ${record.id}`);

                if (backupToStorage) {
                    const currentRecords = await getValue<Record<string, VideoRecord>>('viewed', {});
                    await setValue('viewed', { ...currentRecords, [record.id]: record });
                    log(`[StorageManager] Saved records to storage (backup)`);
                }

                if (verifyAfterWrite) {
                    log(`[StorageManager] putRecord -> verifyGet:start ${record.id} (operation ${operationId})`);
                    const savedRecord = await dbViewedGet(record.id);
                    log(`[StorageManager] putRecord -> verifyGet:done ${record.id} (operation ${operationId})`);
                    if (!savedRecord) {
                        throw new Error(`Record ${record.id} not found after put`);
                    }
                    const success = savedRecord.id === record.id &&
                        savedRecord.status === record.status &&
                        savedRecord.title === record.title;
                    if (!success) {
                        throw new Error(`Put verification failed for ${record.id}`);
                    }
                    STATE.records = { ...STATE.records, [record.id]: savedRecord };
                } else {
                    STATE.records = { ...STATE.records, [record.id]: record };
                }

                log(`[StorageManager] Successfully put ${record.id} (operation ${operationId})`);
                return { success: true };
            } catch (error) {
                lastError = error;
                log(`[StorageManager] Put attempt ${attempt} failed for ${record.id}:`, error);
                if (attempt < this.maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
                }
            }
        }

        log(`[StorageManager] All put attempts failed for ${record.id} (operation ${operationId}):`, lastError);
        return { success: false, error: lastError?.message || 'Unknown error' };
    }

    async putRecord(
        record: VideoRecord,
        operationId: string,
        options: StorageWriteOptions = {}
    ): Promise<{ success: boolean; error?: string }> {
        return this.operationQueue = this.operationQueue.then(async () => {
            return this.putRecordInternal(record, operationId, options);
        });
    }
    async updateRecordDirect(
        videoId: string,
        updateFn: (currentRecord: VideoRecord | undefined) => VideoRecord,
        operationId: string,
        options: { backupToStorage?: boolean; verifyAfterWrite?: boolean } = {}
    ): Promise<{ success: boolean; error?: string; record?: VideoRecord }> {
        return this.operationQueue = this.operationQueue.then(async () => {
            const backupToStorage = options.backupToStorage === true;
            const verifyAfterWrite = options.verifyAfterWrite !== false;
            let lastError: any;

            for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
                try {
                    log(`[StorageManager] Attempt ${attempt} to direct-update ${videoId} (operation ${operationId})`);

                    log(`[StorageManager] addRecord -> existenceGet:start ${videoId} (operation ${operationId})`);
                    const existingRecord = await dbViewedGet(videoId);
                    log(`[StorageManager] addRecord -> existenceGet:done ${videoId} (operation ${operationId}) found=${!!existingRecord}`);
                    const updatedRecord = updateFn(existingRecord);

                    await dbViewedPut(updatedRecord);
                    log(`[StorageManager] Direct-updated record to IDB: ${videoId}`);

                    if (backupToStorage) {
                        const currentRecords = await getValue<Record<string, VideoRecord>>('viewed', {});
                        await setValue('viewed', { ...currentRecords, [videoId]: updatedRecord });
                        log(`[StorageManager] Saved records to storage (backup)`);
                    }

                    let verifiedRecord = updatedRecord;
                    if (verifyAfterWrite) {
                        const savedRecord = await dbViewedGet(videoId);
                        if (!savedRecord) {
                            throw new Error(`Record ${videoId} not found after direct update`);
                        }
                        const success = savedRecord.id === updatedRecord.id &&
                            savedRecord.status === updatedRecord.status &&
                            savedRecord.title === updatedRecord.title;
                        if (!success) {
                            throw new Error(`Direct update verification failed for ${videoId}`);
                        }
                        verifiedRecord = savedRecord;
                    }

                    STATE.records = { ...STATE.records, [videoId]: verifiedRecord };
                    log(`[StorageManager] Successfully direct-updated ${videoId} (operation ${operationId})`);
                    return { success: true, record: verifiedRecord };
                } catch (error) {
                    lastError = error;
                    log(`[StorageManager] Direct update attempt ${attempt} failed for ${videoId}:`, error);
                    if (attempt < this.maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
                    }
                }
            }

            log(`[StorageManager] All direct update attempts failed for ${videoId} (operation ${operationId}):`, lastError);
            return { success: false, error: lastError?.message || 'Unknown error' };
        });
    }

    // 原子性更新记录
    async updateRecord(
        videoId: string,
        updateFn: (currentRecords: Record<string, VideoRecord>) => VideoRecord,
        operationId: string,
        options: { backupToStorage?: boolean; verifyAfterWrite?: boolean } = {}
    ): Promise<{ success: boolean; error?: string }> {
        return this.operationQueue = this.operationQueue.then(async () => {
            const backupToStorage = options.backupToStorage !== false;
            const verifyAfterWrite = options.verifyAfterWrite !== false;
            // 已移除耗时统计，避免未使用变量
            let lastError: any;

            for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
                try {
                    log(`[StorageManager] Attempt ${attempt} to update ${videoId} (operation ${operationId})`);

                    // 1. 从存储读取最新数据
                    const currentRecords = await getValue<Record<string, VideoRecord>>('viewed', {});
                    log(`[StorageManager] Read ${Object.keys(currentRecords).length} records from storage`);

                    // 2. 应用更新函数
                    const updatedRecord = updateFn(currentRecords);
                    const recordsToSave = { ...currentRecords, [videoId]: updatedRecord };

                    // 3. 先写入 IndexedDB，确保主库成功
                    await dbViewedPut(updatedRecord);
                    log(`[StorageManager] Saved record to IDB: ${videoId}`);

                    // 4. 可选同步写入 chrome.storage（备份/兼容）
                    if (backupToStorage) {
                        await setValue('viewed', recordsToSave);
                        log(`[StorageManager] Saved records to storage (backup)`);
                    }

                    if (!verifyAfterWrite) {
                        const savedRecord = await dbViewedGet(videoId);
                        if (!savedRecord) {
                            throw new Error(`Record ${videoId} not found after lightweight save`);
                        }
                        const success = savedRecord.id === updatedRecord.id &&
                          savedRecord.status === updatedRecord.status &&
                          savedRecord.title === updatedRecord.title;
                        if (!success) {
                            throw new Error(`Lightweight record verification failed for ${videoId}`);
                        }
                        STATE.records = { ...STATE.records, [videoId]: savedRecord };
                        log(`[StorageManager] Successfully updated ${videoId} with lightweight verification (operation ${operationId})`);
                        return { success: true };
                    }

                    // 5. 验证保存是否成功（getValue 在迁移后会从 IDB 读取）
                    await new Promise(resolve => setTimeout(resolve, 100)); // 短暂等待确保存储完成
                    const verifyRecords = await getValue<Record<string, VideoRecord>>('viewed', {});
                    const savedRecord = verifyRecords[videoId];

                    if (!savedRecord) {
                        throw new Error(`Record ${videoId} not found after save`);
                    }

                    // 验证关键字段
                    const success = savedRecord.id === updatedRecord.id &&
                                  savedRecord.status === updatedRecord.status &&
                                  savedRecord.title === updatedRecord.title;

                    if (!success) {
                        throw new Error(`Record verification failed for ${videoId}`);
                    }

                    // 6. 更新内存状态
                    STATE.records = verifyRecords;
                    log(`[StorageManager] Successfully updated ${videoId} (operation ${operationId})`);

                    // 7. 记录成功的 DB 操作日志
                    try {
                        await dbLogsAdd({
                            timestamp: new Date().toISOString(),
                            level: 'INFO',
                            message: `[DB] viewed put ok: updated record ${videoId}`,
                            data: { videoId, operationId, attempt, action: 'update' }
                        });
                    } catch {} // 日志失败不影响主流程

                    // 记录成功操作（将在后面定义concurrencyMonitor）
                    // concurrencyMonitor.recordOperation(operationId, videoId, 'update', attempt, true, duration);

                    return { success: true };

                } catch (error) {
                    lastError = error;
                    log(`[StorageManager] Attempt ${attempt} failed for ${videoId}:`, error);

                    if (attempt < this.maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
                    }
                }
            }

            // 记录失败操作（将在后面定义concurrencyMonitor）
            // concurrencyMonitor.recordOperation(operationId, videoId, 'update', this.maxRetries, false, duration);

            log(`[StorageManager] All attempts failed for ${videoId} (operation ${operationId}):`, lastError);
            return { success: false, error: lastError?.message || 'Unknown error' };
        });
    }

    // 原子性添加新记录
    async addRecord(
        videoId: string,
        newRecord: VideoRecord,
        operationId: string
    ): Promise<{ success: boolean; error?: string; alreadyExists?: boolean }> {
        return this.operationQueue = this.operationQueue.then(async () => {
            let lastError: any;

            for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
                try {
                    log(`[StorageManager] Attempt ${attempt} to add ${videoId} (operation ${operationId})`);

                    // 1. 单条检查是否已存在
                    const existingRecord = await dbViewedGet(videoId);

                    // 2. 检查是否已存在
                    if (existingRecord) {
                        log(`[StorageManager] Record ${videoId} already exists, skipping add`);
                        STATE.records = { ...STATE.records, [videoId]: existingRecord };

                        // 记录为成功操作（虽然是重复）
                        // concurrencyMonitor.recordOperation(operationId, videoId, 'add', attempt, true, duration);

                        return { success: true, alreadyExists: true };
                    }

                    log(`[StorageManager] addRecord -> putRecord:start ${videoId} (operation ${operationId})`);
                    const putResult = await this.putRecordInternal(newRecord, operationId, {
                        backupToStorage: false,
                        verifyAfterWrite: true,
                    });
                    log(`[StorageManager] addRecord -> putRecord:done ${videoId} (operation ${operationId}) success=${putResult.success}`);
                    if (!putResult.success) {
                        throw new Error(putResult.error || `Record ${videoId} put failed`);
                    }

                    log(`[StorageManager] Successfully added ${videoId} (operation ${operationId})`);

                    // 7. 记录成功的 DB 操作日志
                    try {
                        await dbLogsAdd({
                            timestamp: new Date().toISOString(),
                            level: 'INFO',
                            message: `[DB] viewed put ok: added new record ${videoId}`,
                            data: { videoId, operationId, attempt, action: 'add' }
                        });
                    } catch {} // 日志失败不影响主流程

                    // 记录成功操作
                    // concurrencyMonitor.recordOperation(operationId, videoId, 'add', attempt, true, duration);

                    return { success: true, alreadyExists: false };

                } catch (error) {
                    lastError = error;
                    log(`[StorageManager] Attempt ${attempt} failed for ${videoId}:`, error);

                    if (attempt < this.maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
                    }
                }
            }

            // 记录失败操作
            // concurrencyMonitor.recordOperation(operationId, videoId, 'add', this.maxRetries, false, duration);

            log(`[StorageManager] All attempts failed for ${videoId} (operation ${operationId}):`, lastError);
            return { success: false, error: lastError?.message || 'Unknown error' };
        });
    }
}

// 单例存储管理器
export const storageManager = new StorageManager();

// 并发操作统计
interface ConcurrencyStats {
    totalOperations: number;
    successfulOperations: number;
    failedOperations: number;
    retriedOperations: number;
    averageRetries: number;
}

class ConcurrencyMonitor {
    private stats: ConcurrencyStats = {
        totalOperations: 0,
        successfulOperations: 0,
        failedOperations: 0,
        retriedOperations: 0,
        averageRetries: 0
    };

    private operationHistory: Array<{
        operationId: string;
        videoId: string;
        type: 'add' | 'update';
        attempts: number;
        success: boolean;
        timestamp: number;
        duration: number;
    }> = [];

    recordOperation(
        operationId: string,
        videoId: string,
        type: 'add' | 'update',
        attempts: number,
        success: boolean,
        duration: number
    ): void {
        this.stats.totalOperations++;
        if (success) {
            this.stats.successfulOperations++;
        } else {
            this.stats.failedOperations++;
        }

        if (attempts > 1) {
            this.stats.retriedOperations++;
        }

        this.operationHistory.push({
            operationId,
            videoId,
            type,
            attempts,
            success,
            timestamp: Date.now(),
            duration
        });

        // 保持历史记录在合理范围内
        if (this.operationHistory.length > 1000) {
            this.operationHistory.splice(0, 500);
        }

        // 更新平均重试次数
        const totalRetries = this.operationHistory.reduce((sum, op) => sum + (op.attempts - 1), 0);
        this.stats.averageRetries = totalRetries / this.stats.totalOperations;
    }

    getStats(): ConcurrencyStats {
        return { ...this.stats };
    }

    getRecentOperations(limit: number = 50): typeof this.operationHistory {
        return this.operationHistory.slice(-limit);
    }

    logStats(): void {
        log('[ConcurrencyMonitor] Current stats:', this.stats);

        const recentFailures = this.operationHistory
            .slice(-20)
            .filter(op => !op.success);

        if (recentFailures.length > 0) {
            log('[ConcurrencyMonitor] Recent failures:', recentFailures);
        }
    }
}

export const concurrencyMonitor = new ConcurrencyMonitor();

// 现在重新启用StorageManager中的监控调用
// 修改StorageManager的方法来使用监控
const originalStorageManager = storageManager;

// 重写updateRecord方法以包含监控
const originalUpdateRecord = originalStorageManager.updateRecord.bind(originalStorageManager);
(originalStorageManager as any).updateRecord = async function(
    videoId: string,
    updateFn: (currentRecords: Record<string, VideoRecord>) => VideoRecord,
    operationId: string
): Promise<{ success: boolean; error?: string }> {
    const startTime = Date.now();
    const result = await originalUpdateRecord(videoId, updateFn, operationId);
    const duration = Date.now() - startTime;

    // 估算重试次数（简化版本）
    const attempts = result.success ? 1 : 3;
    concurrencyMonitor.recordOperation(operationId, videoId, 'update', attempts, result.success, duration);

    return result;
};

// 重写addRecord方法以包含监控
const originalAddRecord = originalStorageManager.addRecord.bind(originalStorageManager);
(originalStorageManager as any).addRecord = async function(
    videoId: string,
    newRecord: VideoRecord,
    operationId: string
): Promise<{ success: boolean; error?: string; alreadyExists?: boolean }> {
    const startTime = Date.now();
    const result = await originalAddRecord(videoId, newRecord, operationId);
    const duration = Date.now() - startTime;

    // 估算重试次数（简化版本）
    const attempts = result.success ? 1 : 3;
    concurrencyMonitor.recordOperation(operationId, videoId, 'add', attempts, result.success, duration);

    return result;
};

// 定期输出统计信息 - 已禁用以避免控制台噪音
// 如需调试，可手动调用 concurrencyMonitor.logStats()
// setInterval(() => {
//     const stats = concurrencyMonitor.getStats();
//     if (stats.totalOperations > 0) {
//         concurrencyMonitor.logStats();
//     }
// }, 30000); // 每30秒输出一次统计

class ConcurrencyManager {
    private operationQueue: Map<string, VideoOperation> = new Map();
    private activeOperations: Set<string> = new Set();
    private maxConcurrentOperations = 3; // 最大并发操作数

    // 生成唯一的操作ID来跟踪操作
    generateOperationId(): string {
        return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    }

    // 检查视频是否正在被处理
    isVideoBeingProcessed(videoId: string): boolean {
        return STATE.processingVideos.has(videoId) || this.operationQueue.has(videoId);
    }

    // 开始处理视频（改进版本）
    async startProcessingVideo(videoId: string, type: 'process' | 'delayed' = 'process'): Promise<string | null> {
        // 检查是否已经在处理
        if (this.isVideoBeingProcessed(videoId)) {
            log(`Video ${videoId} is already being processed or queued, skipping...`);
            return null;
        }

        // 检查并发限制
        if (this.activeOperations.size >= this.maxConcurrentOperations) {
            log(`Max concurrent operations reached, queueing ${videoId}...`);
            return this.queueOperation(videoId, type);
        }

        return this.executeOperation(videoId, type);
    }

    // 队列操作
    private queueOperation(videoId: string, type: 'process' | 'delayed'): Promise<string> {
        return new Promise((resolve, reject) => {
            const operationId = this.generateOperationId();
            const operation: VideoOperation = {
                videoId,
                operationId,
                type,
                timestamp: Date.now(),
                resolve: () => resolve(operationId),
                reject
            };

            this.operationQueue.set(videoId, operation);
            log(`Queued operation ${operationId} for video ${videoId}`);
        });
    }

    // 执行操作
    private executeOperation(videoId: string, type: 'process' | 'delayed'): string {
        const operationId = this.generateOperationId();
        
        STATE.processingVideos.add(videoId);
        this.activeOperations.add(operationId);
        
        log(`Started processing video: ${videoId} (operation: ${operationId}, type: ${type})`);
        return operationId;
    }

    // 完成处理视频
    finishProcessingVideo(videoId: string, operationId?: string): void {
        STATE.processingVideos.delete(videoId);
        STATE.lastProcessedVideo = videoId;
        
        if (operationId) {
            this.activeOperations.delete(operationId);
        }
        
        log(`Finished processing video: ${videoId} (operation: ${operationId})`);

        // 处理队列中的下一个操作
        this.processNextInQueue();
    }

    // 处理队列中的下一个操作
    private processNextInQueue(): void {
        if (this.operationQueue.size === 0 || this.activeOperations.size >= this.maxConcurrentOperations) {
            return;
        }

        // 获取最早的操作
        let earliestOperation: VideoOperation | null = null;
        let earliestKey: string | null = null;

        for (const [key, operation] of this.operationQueue.entries()) {
            if (!earliestOperation || operation.timestamp < earliestOperation.timestamp) {
                earliestOperation = operation;
                earliestKey = key;
            }
        }

        if (earliestOperation && earliestKey) {
            this.operationQueue.delete(earliestKey);
            this.executeOperation(earliestOperation.videoId, earliestOperation.type);
            earliestOperation.resolve();
        }
    }

    // 清理过期的操作（防止内存泄漏）
    cleanupExpiredOperations(): void {
        const now = Date.now();
        const maxAge = 5 * 60 * 1000; // 5分钟

        for (const [key, operation] of this.operationQueue.entries()) {
            if (now - operation.timestamp > maxAge) {
                log(`Cleaning up expired operation for video ${operation.videoId}`);
                operation.reject(new Error('Operation expired'));
                this.operationQueue.delete(key);
            }
        }
    }

    // 获取当前状态信息
    getStatus(): { active: number; queued: number; processing: string[] } {
        return {
            active: this.activeOperations.size,
            queued: this.operationQueue.size,
            processing: Array.from(STATE.processingVideos)
        };
    }
}

// 单例实例
export const concurrencyManager = new ConcurrencyManager();

// 定期清理过期操作
setInterval(() => {
    concurrencyManager.cleanupExpiredOperations();
}, 60000); // 每分钟清理一次

// 兼容性函数（保持向后兼容）
export function isVideoBeingProcessed(videoId: string): boolean {
    return concurrencyManager.isVideoBeingProcessed(videoId);
}

export function startProcessingVideo(videoId: string): Promise<string | null> {
    return concurrencyManager.startProcessingVideo(videoId);
}

export function finishProcessingVideo(videoId: string, operationId?: string): void {
    concurrencyManager.finishProcessingVideo(videoId, operationId);
}

export function generateOperationId(): string {
    return concurrencyManager.generateOperationId();
}
