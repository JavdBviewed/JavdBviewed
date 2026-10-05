import { logAsync } from '../../logger';
import { userService } from '../../services/userService';
import { log } from '../../../utils/logController';
import { getApiClient } from '../api';
import { getSyncConfig } from '../../config/syncConfig';
import type { SyncProgress, SyncResult } from '../types';

export interface MakersSyncOptions {
    onProgress?: (progress: SyncProgress) => void;
    onComplete?: (result: SyncResult) => void;
    onError?: (error: Error) => void;
    abortSignal?: AbortSignal;
}

export class MakersSyncManager {
    private isRunning = false;
    private abortController: AbortController | null = null;

    public isSyncing(): boolean { return this.isRunning; }

    public async sync(options: MakersSyncOptions = {}): Promise<SyncResult> {
        if (this.isRunning) throw new Error('片商同步正在进行中，请等待完成');

        this.isRunning = true;
        this.abortController = new AbortController();
        const startTime = Date.now();
        let result: SyncResult = { success: false, message: '同步失败', syncedCount: 0, skippedCount: 0, errorCount: 0 };

        try {
            logAsync('INFO', '开始同步收藏片商');
            const userProfile = await userService.getUserProfile();
            if (!userProfile?.isLoggedIn) throw new Error('用户未登录，请先登录 JavDB 账号');

            options.onProgress?.({ percentage: 0, message: '准备同步收藏片商...', stage: 'preparing' });

            const apiClient = getApiClient();
            const syncResponse = await apiClient.syncData(
                'makers', [], userProfile,
                getSyncConfig({ mode: 'full' }),
                (p) => options.onProgress?.({ percentage: p.percentage ?? 0, message: p.message || '同步片商中...', current: p.current, total: p.total, stage: p.stage }),
                this.abortController.signal
            );

            result = {
                success: true,
                message: syncResponse.message || `片商同步完成：${syncResponse.syncedCount} 个`,
                syncedCount: syncResponse.syncedCount,
                skippedCount: syncResponse.skippedCount,
                errorCount: syncResponse.errorCount,
            };
            options.onProgress?.({ percentage: 100, message: '片商同步完成', stage: 'complete' });
            logAsync('INFO', '片商同步完成', result);
            options.onComplete?.(result);
        } catch (error: any) {
            const msg = error instanceof Error ? error.message : '未知错误';
            const isCancelled = msg.includes('取消') || msg.includes('abort');
            result = { success: false, message: isCancelled ? '片商同步已取消' : `片商同步失败：${msg}`, syncedCount: 0, skippedCount: 0, errorCount: isCancelled ? 0 : 1 };
            if (!isCancelled) logAsync('ERROR', '片商同步失败', { error: msg });
            options.onError?.(error instanceof Error ? error : new Error(msg));
        } finally {
            result.duration = Date.now() - startTime;
            this.isRunning = false;
            this.abortController = null;
        }
        return result;
    }

    public cancel(): void {
        if (this.abortController) {
            this.abortController.abort();
            log.verbose('片商同步取消请求已发送');
        }
    }
}

export const makersSyncManager = new MakersSyncManager();
