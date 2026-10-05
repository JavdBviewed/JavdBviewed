/**
 * 同步管理器工厂和统一接口
 */

import { logAsync } from '../../logger';
import { log } from '../../../utils/logController';
import { viewedSyncManager } from './viewedSync';
import { wantSyncManager } from './wantSync';
import { actorSyncManager } from './actorSync';
import { allSyncManager } from './allSync';
import { listsSyncManager } from './listsSync';
import { seriesSyncManager } from './seriesSync';
import { labelsSyncManager } from './labelsSync';
import { makersSyncManager } from './makersSync';
import { directorsSyncManager } from './directorsSync';
import type { SyncProgress, SyncResult } from '../types';
import type { SyncType, SyncMode } from '../../config/syncConfig';

export interface SyncOptions {
    mode?: SyncMode;
    resumeFromProgress?: boolean; // 是否从上次进度继续
    onProgress?: (progress: SyncProgress) => void;
    onComplete?: (result: SyncResult) => void;
    onError?: (error: Error) => void;
    abortSignal?: AbortSignal;
}

export interface ISyncManager {
    isSyncing(): boolean;
    sync(options?: SyncOptions): Promise<SyncResult>;
    cancel(): void;
}

/**
 * 同步管理器工厂
 */
export class SyncManagerFactory {
    /**
     * 根据同步类型获取对应的同步管理器
     */
    public static getSyncManager(type: SyncType): ISyncManager {
        switch (type) {
            case 'viewed':
                return viewedSyncManager;
            case 'want':
                return wantSyncManager;
            case 'actors':
                return actorSyncManager;
            case 'all':
                return allSyncManager;
            case 'lists':
                return listsSyncManager;
            case 'series':
                return seriesSyncManager;
            case 'labels':
                return labelsSyncManager;
            case 'makers':
                return makersSyncManager;
            case 'directors':
                return directorsSyncManager;
            default:
                throw new Error(`不支持的同步类型: ${type}`);
        }
    }

    /**
     * 检查指定类型是否正在同步
     */
    public static isSyncing(type: SyncType): boolean {
        const manager = this.getSyncManager(type);
        return manager.isSyncing();
    }

    /**
     * 检查是否有任何同步正在进行
     */
    public static isAnySyncing(): boolean {
        return (
            viewedSyncManager.isSyncing() ||
            wantSyncManager.isSyncing() ||
            actorSyncManager.isSyncing() ||
            allSyncManager.isSyncing() ||
            listsSyncManager.isSyncing() ||
            seriesSyncManager.isSyncing() ||
            labelsSyncManager.isSyncing() ||
            makersSyncManager.isSyncing() ||
            directorsSyncManager.isSyncing()
        );
    }

    /**
     * 取消指定类型的同步
     */
    public static cancelSync(type: SyncType): void {
        const manager = this.getSyncManager(type);
        manager.cancel();
        logAsync('INFO', `取消${type}同步`);
    }

    /**
     * 取消所有正在进行的同步
     */
    public static cancelAllSync(): void {
        viewedSyncManager.cancel();
        wantSyncManager.cancel();
        actorSyncManager.cancel();
        allSyncManager.cancel();
        listsSyncManager.cancel();
        seriesSyncManager.cancel();
        labelsSyncManager.cancel();
        makersSyncManager.cancel();
        directorsSyncManager.cancel();
        log.verbose('取消所有同步');
    }

    /**
     * 获取同步类型的显示名称
     */
    public static getSyncTypeDisplayName(type: SyncType): string {
        switch (type) {
            case 'viewed':
                return '已观看';
            case 'want':
                return '想看';
            case 'actors':
                return '演员';
            case 'all':
                return '全部';
            case 'lists':
                return '清单';
            case 'series':
                return '系列';
            case 'labels':
                return '番号';
            case 'makers':
                return '片商';
            case 'directors':
                return '導演';
            default:
                return type;
        }
    }

    /**
     * 执行同步操作的统一入口
     */
    public static async executeSync(
        type: SyncType,
        options: SyncOptions = {}
    ): Promise<SyncResult> {
        const manager = this.getSyncManager(type);
        const displayName = this.getSyncTypeDisplayName(type);

        logAsync('INFO', `开始执行${displayName}同步`, { type, mode: options.mode });

        try {
            const result = await manager.sync(options);
            logAsync('INFO', `${displayName}同步完成`, { type, result });
            return result;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '未知错误';
            logAsync('ERROR', `${displayName}同步失败`, { type, error: errorMessage });
            throw error;
        }
    }
}

// 导出所有同步管理器
export {
    viewedSyncManager,
    wantSyncManager,
    actorSyncManager,
    allSyncManager,
    listsSyncManager,
    seriesSyncManager,
    labelsSyncManager,
    makersSyncManager,
    directorsSyncManager
};
