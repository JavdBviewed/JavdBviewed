/**
 * 数据同步API调用模块
 */

import { logAsync } from '../../logger';
import type { VideoRecord, UserProfile } from '../../../types';
import { extractDetailCategoryTagsFromHTML } from '../detailCategoryTags';
import type {
    SyncType,
    SyncRequestData,
    SyncResponseData,
    ApiResponse,
    SyncConfig
} from '../types';
import { SyncCancelledError } from '../types';
import { retry, delay, checkNetworkStatus } from './utils';
import { getSettings, getValue } from '../../../utils/storage';
import { STORAGE_KEYS } from '../../../utils/config';

/**
 * 视频数据接口
 */
interface VideoData {
    urlId: string;
    realId?: string;
}

/**
 * 同步类型配置接口
 */
interface SyncTypeConfig {
    url: string;
    status: 'want' | 'viewed';
    displayName: string;
    countField: 'wantCount' | 'watchedCount';
}

/**
 * API客户端类
 */
export class SyncApiClient {
    private static instance: SyncApiClient;
    private baseUrl = 'https://javdb.com';
    private timeout = 30000;

    private constructor() {}

    public static getInstance(): SyncApiClient {
        if (!SyncApiClient.instance) {
            SyncApiClient.instance = new SyncApiClient();
        }
        return SyncApiClient.instance;
    }

    /**
     * 同步数据到JavDB
     */
    public async syncData(
        type: SyncType,
        records: VideoRecord[],
        userProfile: UserProfile,
        config: SyncConfig,
        onProgress?: (current: number, total: number, stage?: 'pages' | 'details') => void,
        abortSignal?: AbortSignal
    ): Promise<SyncResponseData> {
        // 检查网络连接
        if (!checkNetworkStatus()) {
            throw new Error('网络连接不可用，请检查网络设置');
        }

        // 验证参数
        this.validateSyncParams(type, records, userProfile);

        logAsync('INFO', `开始同步${type}数据`, { 
            recordCount: records.length,
            userEmail: userProfile.email 
        });

        try {
            // 对于想看和已观看类型，使用真实API同步
            if (type === 'want' || type === 'viewed') {
                return await this.syncUserVideos(type, userProfile, config, onProgress, abortSignal);
            }

            // 其他类型使用模拟同步
            return await this.simulateSync(type, records, config, onProgress);
        } catch (error: any) {
            if (error instanceof SyncCancelledError) {
                // 用户取消，记录信息日志
                logAsync('INFO', '同步被用户取消', {
                    type,
                    reason: error.message
                });
            } else {
                // 真正的错误
                logAsync('ERROR', '同步数据失败', {
                    error: error.message,
                    type,
                    recordCount: records.length
                });
            }
            throw error;
        }
    }

    /**
     * 模拟同步过程（未来替换为真实API调用）
     */
    private async simulateSync(
        type: SyncType,
        records: VideoRecord[],
        config: SyncConfig,
        onProgress?: (current: number, total: number) => void
    ): Promise<SyncResponseData> {
        const totalRecords = records.length;
        
        // 检查是否支持该同步类型
        if (type === 'actors') {
            throw new Error('收藏演员功能即将推出，敬请期待');
        }
        
        if (totalRecords === 0) {
            return {
                syncedCount: 0,
                skippedCount: 0,
                errorCount: 0
            };
        }

        let syncedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;
        const errors: Array<{ recordId: string; error: string }> = [];

        // 分批处理数据
        const batchSize = config.batchSize;
        const batches = this.createBatches(records, batchSize);

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex];
            
            try {
                // 模拟网络延迟
                await delay(100 + Math.random() * 200);
                
                // 模拟批量同步
                const batchResult = await this.simulateBatchSync(batch, config);
                
                syncedCount += batchResult.syncedCount;
                skippedCount += batchResult.skippedCount;
                errorCount += batchResult.errorCount;
                
                if (batchResult.errors) {
                    errors.push(...batchResult.errors);
                }
                
                // 更新进度
                const processedCount = (batchIndex + 1) * batchSize;
                const currentProgress = Math.min(processedCount, totalRecords);
                onProgress?.(currentProgress, totalRecords);
                
            } catch (error: any) {
                logAsync('ERROR', `批次${batchIndex + 1}同步失败`, { error: error.message });
                
                // 将整个批次标记为错误
                batch.forEach(record => {
                    errors.push({
                        recordId: record.id,
                        error: error.message
                    });
                });
                errorCount += batch.length;
            }
        }

        const result: SyncResponseData = {
            syncedCount,
            skippedCount,
            errorCount
        };

        if (errors.length > 0) {
            result.errors = errors;
        }

        logAsync('INFO', '同步完成', result);
        return result;
    }

    /**
     * 模拟批量同步
     */
    private async simulateBatchSync(
        batch: VideoRecord[],
        config: SyncConfig
    ): Promise<SyncResponseData> {
        // 模拟网络请求
        await delay(50 + Math.random() * 100);
        
        // 模拟一些记录同步成功，一些跳过，一些失败
        const syncedCount = Math.floor(batch.length * 0.8); // 80%成功
        const skippedCount = Math.floor(batch.length * 0.15); // 15%跳过
        const errorCount = batch.length - syncedCount - skippedCount; // 剩余失败
        
        const errors: Array<{ recordId: string; error: string }> = [];
        
        // 为失败的记录生成错误信息
        for (let i = syncedCount + skippedCount; i < batch.length; i++) {
            errors.push({
                recordId: batch[i].id,
                error: '网络超时或服务器错误'
            });
        }
        
        return {
            syncedCount,
            skippedCount,
            errorCount,
            errors: errors.length > 0 ? errors : undefined
        };
    }

    /**
     * 创建数据批次
     */
    private createBatches<T>(data: T[], batchSize: number): T[][] {
        const batches: T[][] = [];
        for (let i = 0; i < data.length; i += batchSize) {
            batches.push(data.slice(i, i + batchSize));
        }
        return batches;
    }

    /**
     * 验证同步参数
     */
    private validateSyncParams(
        type: SyncType,
        records: VideoRecord[],
        userProfile: UserProfile
    ): void {
        if (!type) {
            throw new Error('同步类型不能为空');
        }

        if (!Array.isArray(records)) {
            throw new Error('记录数据格式错误');
        }

        if (!userProfile || !userProfile.isLoggedIn) {
            throw new Error('用户未登录，无法进行同步');
        }

        if (!userProfile.email || !userProfile.username) {
            throw new Error('用户信息不完整，无法进行同步');
        }
    }

    /**
     * 测试API连接
     */
    public async testConnection(): Promise<boolean> {
        try {
            // 模拟连接测试
            await delay(500);
            return checkNetworkStatus();
        } catch (error) {
            return false;
        }
    }

    /**
     * 获取同步状态
     */
    public async getSyncStatus(requestId: string): Promise<ApiResponse> {
        try {
            // 模拟获取同步状态
            await delay(100);
            return {
                success: true,
                data: {
                    status: 'completed',
                    progress: 100
                }
            };
        } catch (error: any) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 取消同步操作
     */
    public async cancelSync(requestId: string): Promise<boolean> {
        try {
            // 模拟取消同步
            await delay(100);
            logAsync('INFO', '同步操作已取消', { requestId });
            return true;
        } catch (error: any) {
            logAsync('ERROR', '取消同步失败', { error: error.message, requestId });
            return false;
        }
    }

    /**
     * 获取同步类型配置
     */
    private async getSyncTypeConfig(type: 'want' | 'viewed'): Promise<SyncTypeConfig> {
        const settings = await getSettings();

        switch (type) {
            case 'want':
                return {
                    url: settings.dataSync.urls.wantWatch,
                    status: 'want',
                    displayName: '想看',
                    countField: 'wantCount'
                };
            case 'viewed':
                return {
                    url: settings.dataSync.urls.watchedVideos,
                    status: 'viewed',
                    displayName: '已观看',
                    countField: 'watchedCount'
                };
            default:
                throw new Error(`不支持的同步类型: ${type}`);
        }
    }

    /**
     * 设置API配置
     */
    public setConfig(config: { baseUrl?: string; timeout?: number }): void {
        if (config.baseUrl) {
            this.baseUrl = config.baseUrl;
        }
        if (config.timeout) {
            this.timeout = config.timeout;
        }
    }

    /**
     * 获取API配置
     */
    public getConfig(): { baseUrl: string; timeout: number } {
        return {
            baseUrl: this.baseUrl,
            timeout: this.timeout
        };
    }

    /**
     * 通用的用户视频同步函数（想看/已观看）
     */
    private async syncUserVideos(
        type: 'want' | 'viewed',
        userProfile: UserProfile,
        config: SyncConfig,
        onProgress?: (current: number, total: number, stage?: 'pages' | 'details') => void,
        abortSignal?: AbortSignal
    ): Promise<SyncResponseData> {
        // 获取同步类型配置
        const syncConfig = await this.getSyncTypeConfig(type);
        logAsync('INFO', `开始同步${syncConfig.displayName}视频列表`, {
            userEmail: userProfile.email,
            type,
            url: syncConfig.url
        });

        try {
            // 1. 刷新用户账号信息，获取视频数量
            logAsync('INFO', '正在刷新用户账号信息...');
            const refreshedProfile = await this.refreshUserProfile();

            logAsync('INFO', '用户账号信息刷新结果', {
                success: !!refreshedProfile,
                hasServerStats: !!(refreshedProfile?.serverStats),
                profile: refreshedProfile ? {
                    email: refreshedProfile.email,
                    username: refreshedProfile.username,
                    isLoggedIn: refreshedProfile.isLoggedIn
                } : null
            });

            if (!refreshedProfile || !refreshedProfile.serverStats) {
                throw new Error('无法获取用户账号信息或统计数据');
            }

            // 根据同步类型获取对应的数量
            const videoCount = refreshedProfile.serverStats[syncConfig.countField] || 0;
            logAsync('INFO', `用户${syncConfig.displayName}统计`, {
                [syncConfig.countField]: videoCount,
                wantCount: refreshedProfile.serverStats.wantCount,
                watchedCount: refreshedProfile.serverStats.watchedCount,
                listsCount: refreshedProfile.serverStats.listsCount
            });

            if (videoCount === 0) {
                logAsync('INFO', `用户没有${syncConfig.displayName}的视频`);
                return { syncedCount: 0, skippedCount: 0, errorCount: 0 };
            }

            // 2. 计算页数（每页20个）
            const totalPages = Math.ceil(videoCount / 20);
            logAsync('INFO', `用户有${videoCount}个${syncConfig.displayName}视频，共${totalPages}页`);

            // 3. 获取所有视频的ID列表
            logAsync('INFO', `开始获取${syncConfig.displayName}视频ID列表...`);
            const videoIds = await this.fetchAllVideoIds(
                type,
                totalPages,
                config,
                (current, total, stage) => onProgress?.(current, total, stage),
                abortSignal
            );
            logAsync('INFO', `获取到${videoIds.length}个${syncConfig.displayName}视频ID`, {
                videoIds: videoIds.slice(0, 10), // 只显示前10个ID作为示例
                totalCount: videoIds.length
            });

            if (videoIds.length === 0) {
                logAsync('WARN', `没有获取到任何${syncConfig.displayName}视频ID`);
                return { syncedCount: 0, skippedCount: 0, errorCount: 0 };
            }

            // 4. 获取详情页数据并保存
            const settings = await getSettings();
            const requestInterval = settings.dataSync.requestInterval * 1000; // 转换为毫秒
            logAsync('INFO', '开始获取视频详情', {
                requestInterval: settings.dataSync.requestInterval,
                batchSize: settings.dataSync.batchSize,
                maxRetries: settings.dataSync.maxRetries
            });

            let syncedCount = 0;
            let errorCount = 0;
            const errors: Array<{ recordId: string; error: string }> = [];

            for (let i = 0; i < videoIds.length; i++) {
                // 检查是否已取消
                if (abortSignal?.aborted) {
                    throw new SyncCancelledError('用户取消了同步操作');
                }

                const urlVideoId = videoIds[i]; // 这是从URL中获取的ID
                logAsync('INFO', `处理视频 ${i + 1}/${videoIds.length}: ${urlVideoId}`);

                try {
                    // 获取详情页数据
                    logAsync('INFO', `开始获取视频详情: ${urlVideoId}`);
                    const videoData = await this.fetchVideoDetail(urlVideoId);

                    if (videoData) {
                        // 使用从详情页提取的真正ID，如果没有则使用URL ID
                        const realVideoId = videoData.id || urlVideoId;

                        logAsync('INFO', `视频详情获取成功`, {
                            urlVideoId,
                            realVideoId,
                            title: videoData.title?.substring(0, 50),
                            tagsCount: videoData.tags?.length || 0,
                            hasReleaseDate: !!videoData.releaseDate,
                            hasImage: !!videoData.javdbImage
                        });

                        // 保存到本地存储，使用真正的视频ID和对应的状态，传入URL ID用于构建正确的javdbUrl
                        await this.saveVideoRecord(realVideoId, videoData, syncConfig.status, urlVideoId);
                        syncedCount++;
                        logAsync('INFO', `成功同步${syncConfig.displayName}视频 ${realVideoId} (URL ID: ${urlVideoId})`);
                    } else {
                        errorCount++;
                        errors.push({ recordId: urlVideoId, error: '无法获取视频详情' });
                        logAsync('ERROR', `视频详情获取失败: ${urlVideoId}`);
                    }
                } catch (error: any) {
                    errorCount++;
                    errors.push({ recordId: urlVideoId, error: error.message });
                    logAsync('ERROR', `同步视频 ${urlVideoId} 失败`, { error: error.message });
                }

                // 更新进度（详情获取进度）
                onProgress?.(i + 1, videoIds.length, 'details');

                // 请求间隔
                if (i < videoIds.length - 1) {
                    logAsync('INFO', `等待 ${requestInterval}ms 后继续下一个视频...`);
                    await delay(requestInterval);
                }
            }

            logAsync('INFO', '想看视频同步完成', {
                syncedCount,
                errorCount,
                total: videoIds.length
            });

            return {
                syncedCount,
                skippedCount: 0,
                errorCount,
                errors: errors.length > 0 ? errors : undefined
            };

        } catch (error: any) {
            if (error instanceof SyncCancelledError) {
                // 用户取消，记录信息日志
                logAsync('INFO', '想看同步被用户取消', { reason: error.message });
            } else {
                // 真正的错误
                logAsync('ERROR', '同步想看视频失败', { error: error.message });
            }
            throw error;
        }
    }

    /**
     * 刷新用户账号信息
     */
    private async refreshUserProfile(): Promise<UserProfile | null> {
        try {
            logAsync('INFO', '发送用户信息刷新请求到background script');

            // 发送消息到background script获取用户信息
            return new Promise((resolve) => {
                chrome.runtime.sendMessage({ type: 'fetch-user-profile' }, (response) => {
                    logAsync('INFO', '收到background script响应', {
                        success: response?.success,
                        hasProfile: !!response?.profile,
                        error: response?.error
                    });

                    if (response?.success) {
                        logAsync('INFO', '用户信息刷新成功', {
                            email: response.profile?.email,
                            username: response.profile?.username,
                            isLoggedIn: response.profile?.isLoggedIn,
                            hasServerStats: !!response.profile?.serverStats
                        });
                        resolve(response.profile);
                    } else {
                        logAsync('ERROR', '用户信息刷新失败', { error: response?.error });
                        resolve(null);
                    }
                });
            });
        } catch (error: any) {
            logAsync('ERROR', '刷新用户账号信息异常', { error: error.message });
            return null;
        }
    }

    /**
     * 获取所有视频的ID列表（通用函数）
     */
    private async fetchAllVideoIds(
        type: 'want' | 'viewed',
        totalPages: number,
        config: SyncConfig,
        onProgress?: (current: number, total: number, stage?: 'pages' | 'details') => void,
        abortSignal?: AbortSignal
    ): Promise<string[]> {
        const allVideoIds: string[] = [];
        const syncConfig = await this.getSyncTypeConfig(type);
        logAsync('INFO', `开始获取${syncConfig.displayName}视频ID，总共${totalPages}页`);

        // 增量同步相关变量
        const isIncrementalMode = config.mode === 'incremental';
        let existingRecordsCount = 0;
        let shouldStopIncremental = false;
        const incrementalTolerance = config.incrementalTolerance || 20;

        // 如果是增量同步，先获取本地已存在的记录
        let localRecords: Record<string, any> = {};
        if (isIncrementalMode) {
            try {
                localRecords = await getValue<Record<string, any>>(STORAGE_KEYS.VIEWED_RECORDS, {});
                logAsync('INFO', `增量同步模式：本地已有${Object.keys(localRecords).length}条记录`);
            } catch (error: any) {
                logAsync('WARN', '获取本地记录失败，将使用全量同步模式', { error: error.message });
            }
        }

        for (let page = 1; page <= totalPages; page++) {
            try {
                // 检查是否已取消
                if (abortSignal?.aborted) {
                    logAsync('INFO', `同步在第${page}页被取消`);
                    throw new SyncCancelledError('用户取消了同步操作');
                }

                logAsync('INFO', `正在获取第${page}页${syncConfig.displayName}视频...`);
                const videoData = await this.fetchVideoDataFromPage(type, page);
                const videoIds = videoData.map(v => v.urlId);

                // 增量同步逻辑：检查当前页面的视频是否已存在
                if (isIncrementalMode && !shouldStopIncremental) {
                    const existingInCurrentPage: string[] = [];

                    for (const video of videoData) {
                        let isExisting = false;

                        // 优先使用真实番号进行比对
                        if (video.realId) {
                            isExisting = !!localRecords[video.realId];
                            if (isExisting) {
                                logAsync('INFO', `通过真实番号找到已存在记录: ${video.realId} (${video.urlId})`);
                            }
                        }

                        // 如果没有真实番号或通过真实番号没找到，回退到javdbUrl比对
                        if (!isExisting) {
                            const existingRecord = Object.values(localRecords).find((record: any) => {
                                if (record.javdbUrl) {
                                    const urlParts = record.javdbUrl.split('/');
                                    const lastPart = urlParts[urlParts.length - 1];
                                    return lastPart === video.urlId;
                                }
                                return false;
                            });
                            isExisting = !!existingRecord;
                            if (isExisting) {
                                logAsync('INFO', `通过javdbUrl找到已存在记录: ${video.urlId}`);
                            }
                        }

                        if (isExisting) {
                            existingInCurrentPage.push(video.urlId);
                        }
                    }
                    existingRecordsCount += existingInCurrentPage.length;

                    logAsync('INFO', `第${page}页中有${existingInCurrentPage.length}个已存在的视频`, {
                        page,
                        existingInCurrentPage: existingInCurrentPage.slice(0, 5),
                        totalExistingCount: existingRecordsCount
                    });

                    // 如果当前页面有已存在的记录，检查是否应该停止
                    if (existingInCurrentPage.length > 0) {
                        // 添加当前页面的所有视频ID
                        allVideoIds.push(...videoIds);

                        // 检查是否达到容忍度
                        if (existingRecordsCount >= incrementalTolerance) {
                            shouldStopIncremental = true;
                            logAsync('INFO', `增量同步：已遇到${existingRecordsCount}个已存在记录，达到容忍度${incrementalTolerance}，停止获取更多页面`);
                        }
                    } else {
                        // 当前页面没有已存在的记录，继续添加
                        allVideoIds.push(...videoIds);
                    }
                } else if (!isIncrementalMode) {
                    // 全量同步
                    allVideoIds.push(...videoIds);
                }
                // 如果是增量同步且已决定停止，则不添加视频ID

                // 更新进度（页面获取进度）
                onProgress?.(page, totalPages, 'pages');

                logAsync('INFO', `获取第${page}页${syncConfig.displayName}视频完成`, {
                    page,
                    totalPages,
                    currentPageCount: videoIds.length,
                    totalCount: allVideoIds.length,
                    videoIds: videoIds.slice(0, 5) // 显示前5个ID作为示例
                });

                // 如果是增量同步且应该停止，则跳出循环
                if (isIncrementalMode && shouldStopIncremental) {
                    logAsync('INFO', `增量同步提前结束，已获取${page}页，共${allVideoIds.length}个视频ID`);
                    break;
                }

                // 页面间隔
                if (page < totalPages) {
                    logAsync('INFO', `等待1秒后获取下一页...`);
                    await delay(1000); // 页面间隔1秒
                }
            } catch (error: any) {
                logAsync('ERROR', `获取第${page}页${syncConfig.displayName}视频失败`, {
                    page,
                    totalPages,
                    error: error.message
                });

                // 如果是增量同步且应该停止，则跳出循环
                if (isIncrementalMode && shouldStopIncremental) {
                    logAsync('INFO', `增量同步在错误后提前结束，已获取${page}页，共${allVideoIds.length}个视频ID`);
                    break;
                }
                // 继续处理下一页
            }
        }

        const finalMessage = isIncrementalMode && shouldStopIncremental
            ? `增量同步完成（提前结束）`
            : `所有页面获取完成`;

        logAsync('INFO', finalMessage, {
            totalPages,
            actualPagesProcessed: isIncrementalMode && shouldStopIncremental ? 'early_stop' : totalPages,
            totalVideoIds: allVideoIds.length,
            uniqueIds: [...new Set(allVideoIds)].length,
            syncMode: config.mode || 'full',
            existingRecordsFound: isIncrementalMode ? existingRecordsCount : 'N/A'
        });

        return [...new Set(allVideoIds)]; // 去重
    }

    /**
     * 从指定页面获取视频数据列表（包含URL ID和真实番号）
     */
    private async fetchVideoDataFromPage(type: 'want' | 'viewed', page: number): Promise<VideoData[]> {
        // 获取同步类型配置
        const syncConfig = await this.getSyncTypeConfig(type);
        const url = `${syncConfig.url}?page=${page}`;
        logAsync('INFO', `请求${syncConfig.displayName}视频页面`, { page, url, baseUrl: syncConfig.url });

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'zh-CN,zh;q=0.8,en-US;q=0.5,en;q=0.3',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'DNT': '1',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1'
                },
                credentials: 'include'
            });

            logAsync('INFO', `${syncConfig.displayName}视频页面响应`, {
                page,
                status: response.status,
                statusText: response.statusText,
                ok: response.ok
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const html = await response.text();
            logAsync('INFO', `${syncConfig.displayName}视频页面HTML获取成功`, {
                page,
                htmlLength: html.length,
                hasVideoContent: html.includes('/v/'),
                hasMovieList: html.includes('movie-list')
            });

            const videoData = this.parseVideoDataFromHTML(html);
            logAsync('INFO', `${syncConfig.displayName}视频页面解析完成`, {
                page,
                videoCount: videoData.length,
                withRealId: videoData.filter(v => v.realId).length,
                videoData: videoData.slice(0, 3) // 显示前3个作为示例
            });

            return videoData;

        } catch (error: any) {
            logAsync('ERROR', `获取${syncConfig.displayName}视频页面失败`, { page, url, error: error.message });
            throw error;
        }
    }

    /**
     * 从指定页面获取视频ID列表（保持兼容性）
     */
    private async fetchVideoIdsFromPage(type: 'want' | 'viewed', page: number): Promise<string[]> {
        // 获取同步类型配置
        const syncConfig = await this.getSyncTypeConfig(type);
        const url = `${syncConfig.url}?page=${page}`;
        logAsync('INFO', `请求${syncConfig.displayName}视频页面`, { page, url, baseUrl: syncConfig.url });

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'zh-CN,zh;q=0.8,en-US;q=0.5,en;q=0.3',
                    'Accept-Encoding': 'gzip, deflate',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1'
                },
                credentials: 'include'
            });

            logAsync('INFO', `想看视频页面响应`, {
                page,
                status: response.status,
                statusText: response.statusText,
                ok: response.ok
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const html = await response.text();
            logAsync('INFO', `${syncConfig.displayName}视频页面HTML获取成功`, {
                page,
                htmlLength: html.length,
                hasVideoContent: html.includes('/v/'),
                hasMovieList: html.includes('movie-list')
            });

            const videoData = this.parseVideoDataFromHTML(html);
            const videoIds = videoData.map(v => v.urlId);
            logAsync('INFO', `${syncConfig.displayName}视频页面解析完成`, {
                page,
                videoCount: videoIds.length,
                withRealId: videoData.filter(v => v.realId).length,
                videoIds: videoIds.slice(0, 3) // 显示前3个作为示例
            });

            return videoIds;

        } catch (error: any) {
            logAsync('ERROR', `获取${syncConfig.displayName}视频页面失败`, { page, url, error: error.message });
            throw error;
        }
    }

    /**
     * 从页面HTML中解析视频数据（URL ID和真实番号）
     */
    private parseVideoDataFromHTML(html: string): VideoData[] {
        const videoData: VideoData[] = [];

        try {
            logAsync('INFO', '开始解析视频页面HTML', {
                htmlLength: html.length,
                hasVideoLinks: html.includes('/v/'),
                hasMovieList: html.includes('movie-list'),
                hasVideoItems: html.includes('class="item"')
            });

            // 方法1：尝试同时获取URL ID和真实番号
            const itemRegex = /<a[^>]*href="\/v\/([a-zA-Z0-9\-_]+)"[^>]*>[\s\S]*?<div class="video-title"[^>]*>[\s\S]*?<strong[^>]*>([^<]+)<\/strong>[\s\S]*?<\/a>/g;
            let itemMatch;
            const processedUrlIds = new Set<string>();

            while ((itemMatch = itemRegex.exec(html)) !== null) {
                const urlId = itemMatch[1];
                const realId = itemMatch[2]?.trim();

                if (urlId && !processedUrlIds.has(urlId)) {
                    processedUrlIds.add(urlId);
                    videoData.push({ urlId, realId });
                    logAsync('INFO', `找到视频: ${urlId} -> ${realId || '未知番号'}`);
                }
            }

            // 方法2：如果方法1没有找到足够的数据，回退到简单的URL ID匹配
            if (videoData.length === 0) {
                logAsync('INFO', '使用备用解析方法（仅URL ID）');
                const videoLinkRegex = /href="\/v\/([a-zA-Z0-9\-_]+)"(?![^>]*reviews)/g;
                let match;
                while ((match = videoLinkRegex.exec(html)) !== null) {
                    const urlId = match[1];
                    if (urlId && urlId.length >= 2 && !processedUrlIds.has(urlId)) {
                        processedUrlIds.add(urlId);
                        videoData.push({ urlId });
                        logAsync('INFO', `找到URL ID: ${urlId}`);
                    }
                }
            }

            logAsync('INFO', `HTML解析完成`, {
                totalMatches: videoData.length,
                withRealId: videoData.filter(v => v.realId).length,
                onlyUrlId: videoData.filter(v => !v.realId).length,
                videoData: videoData.slice(0, 5) // 显示前5个
            });

            return videoData;

        } catch (error: any) {
            logAsync('ERROR', '解析视频页面HTML失败', { error: error.message });
            return [];
        }
    }

    /**
     * 从页面HTML中解析视频ID（保持兼容性）
     */
    private parseVideoIdsFromHTML(html: string): string[] {
        const videoData = this.parseVideoDataFromHTML(html);
        return videoData.map(v => v.urlId);
    }

    /**
     * 原始的解析方法（已废弃，保留用于参考）
     */
    private parseVideoIdsFromHTMLOld(html: string): string[] {
        const videoIds: string[] = [];

        try {
            logAsync('INFO', '开始解析想看页面HTML', {
                htmlLength: html.length,
                hasVideoLinks: html.includes('/v/'),
                hasMovieList: html.includes('movie-list'),
                hasVideoItems: html.includes('class="item"')
            });

            // 使用更宽松的正则表达式，支持更多字符格式的视频ID
            // 匹配 href="/v/videoId" 但不匹配 href="/v/videoId/reviews/..." 等
            // 支持字母、数字、连字符、下划线等字符
            const videoLinkRegex = /href="\/v\/([a-zA-Z0-9\-_]+)"(?![^>]*reviews)/g;
            let match;
            let matchCount = 0;

            while ((match = videoLinkRegex.exec(html)) !== null) {
                matchCount++;
                const urlVideoId = match[1]; // 这是URL中的ID，可能不是真正的视频ID
                // 确保ID不为空且格式合理
                if (urlVideoId && urlVideoId.length >= 2 && !videoIds.includes(urlVideoId)) {
                    videoIds.push(urlVideoId);
                    logAsync('INFO', `找到URL视频ID: ${urlVideoId}`, { index: videoIds.length });
                } else if (urlVideoId) {
                    logAsync('INFO', `跳过无效ID: ${urlVideoId}`, { reason: '格式不正确或太短' });
                }
            }

            logAsync('INFO', `HTML解析完成`, {
                totalMatches: matchCount,
                uniqueVideoIds: videoIds.length,
                videoIds: videoIds.slice(0, 5) // 显示前5个
            });

            // 如果没有找到视频ID，尝试其他解析方法
            if (videoIds.length === 0) {
                logAsync('WARN', '未找到视频ID，尝试其他解析方法');

                // 检查是否有错误信息
                if (html.includes('登录') || html.includes('login')) {
                    logAsync('ERROR', 'HTML内容显示需要登录');
                }

                if (html.includes('没有找到') || html.includes('暂无')) {
                    logAsync('INFO', 'HTML内容显示没有想看视频');
                }

                // 输出HTML片段用于调试
                const htmlSnippet = html.substring(0, 1000);
                logAsync('INFO', 'HTML片段（前1000字符）', { htmlSnippet });
            }

            return videoIds;

        } catch (error: any) {
            logAsync('ERROR', '解析想看视频ID失败', { error: error.message });
            return [];
        }
    }

    /**
     * 获取视频详情页数据
     */
    private async fetchVideoDetail(videoId: string): Promise<Partial<VideoRecord> | null> {
        const url = `${this.baseUrl}/v/${videoId}`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'zh-CN,zh;q=0.8,en-US;q=0.5,en;q=0.3',
                    'Accept-Encoding': 'gzip, deflate',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1'
                },
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const html = await response.text();
            return this.parseVideoDetailFromHTML(html, videoId);

        } catch (error: any) {
            logAsync('ERROR', `获取视频详情失败`, { videoId, error: error.message });
            return null;
        }
    }

    /**
     * 智能提取视频ID，借鉴content script的逻辑
     */
    private extractVideoId(rawText: string): string | null {
        if (!rawText) return null;

        // 移除所有空格
        const trimmed = rawText.trim();

        // 常见的视频ID格式正则表达式
        const patterns = [
            // 标准格式: ABC-123, ABCD-123, etc.
            /^([A-Z]{2,6}-\d{2,6})/i,
            // 数字格式: 123456_01, 072625_01, etc.
            /^(\d{4,8}_\d{1,3})/,
            // 其他格式: FC2-PPV-123456, etc.
            /^(FC2-PPV-\d+)/i,
            // 纯数字格式: 123456789
            /^(\d{6,12})/,
            // 带字母的数字格式: 1pondo-123456_01
            /^([a-z0-9]+-\d+_\d+)/i,
        ];

        // 尝试每个模式
        for (const pattern of patterns) {
            const match = trimmed.match(pattern);
            if (match) {
                const extracted = match[1].toUpperCase();
                logAsync('INFO', `提取到视频ID: "${extracted}" 从原始文本: "${rawText}"`);
                return extracted;
            }
        }

        // 如果没有匹配到模式，尝试提取第一个单词（去掉中文字符）
        const firstWord = trimmed.split(/\s+/)[0];
        if (firstWord) {
            // 移除所有非ASCII字符（中文、日文等）
            const cleanId = firstWord.replace(/[^\x00-\x7F]/g, '').toUpperCase();
            if (cleanId.length >= 3) { // 至少3个字符才认为是有效ID
                logAsync('INFO', `备用提取视频ID: "${cleanId}" 从原始文本: "${rawText}"`);
                return cleanId;
            }
        }

        logAsync('WARN', `无法提取视频ID 从原始文本: "${rawText}"`);
        return null;
    }

    /**
     * 从详情页HTML中提取真正的视频ID
     */
    private extractVideoIdFromDetailHTML(html: string): string | null {
        let videoId: string | null = null;

        try {
            // 方法1: 从页面标题中获取 (新的页面结构)
            const titleRegex = /<h2[^>]*class="[^"]*title[^"]*is-4[^"]*"[^>]*>[\s\S]*?<strong[^>]*>([^<]+)<\/strong>/;
            const titleMatch = html.match(titleRegex);
            if (titleMatch) {
                const rawText = titleMatch[1].trim();
                if (rawText) {
                    videoId = this.extractVideoId(rawText);
                    logAsync('INFO', `从标题提取ID: "${rawText}" -> "${videoId}"`);
                }
            }

            // 方法2: 从panel-block中获取 (旧的页面结构)
            if (!videoId) {
                const panelBlockRegex = /<div[^>]*class="[^"]*panel-block[^"]*first-block[^"]*"[^>]*>[\s\S]*?<div[^>]*class="[^"]*title[^"]*is-4[^"]*"[^>]*>([^<]+)<\/div>/;
                const panelMatch = html.match(panelBlockRegex);
                if (panelMatch) {
                    const rawText = panelMatch[1].trim();
                    if (rawText) {
                        videoId = this.extractVideoId(rawText);
                        logAsync('INFO', `从panel-block提取ID: "${rawText}" -> "${videoId}"`);
                    }
                }
            }

            // 方法3: 从URL中提取（作为最后的备选）
            if (!videoId) {
                const urlRegex = /\/v\/([^\/\?"]+)/;
                const urlMatch = html.match(urlRegex);
                if (urlMatch) {
                    const rawUrlId = urlMatch[1];
                    videoId = this.extractVideoId(rawUrlId);
                    logAsync('INFO', `从URL提取ID: "${rawUrlId}" -> "${videoId}"`);
                }
            }

            return videoId;

        } catch (error: any) {
            logAsync('ERROR', '从详情页HTML提取视频ID失败', { error: error.message });
            return null;
        }
    }

    /**
     * 从详情页HTML中解析视频数据
     */
    private parseVideoDetailFromHTML(html: string, urlVideoId: string): Partial<VideoRecord> | null {
        try {
            // 首先提取真正的视频ID
            const realVideoId = this.extractVideoIdFromDetailHTML(html);
            const videoId = realVideoId || urlVideoId; // 如果提取失败，使用URL中的ID作为备选

            logAsync('INFO', `视频ID解析结果`, {
                urlVideoId,
                realVideoId,
                finalVideoId: videoId
            });

            // 解析标题
            const titleMatch = html.match(/<title>([^|]+)/);
            const title = titleMatch ? titleMatch[1].trim() : '';

            // 解析发布日期
            let releaseDate: string | undefined;

            // 方法1: 查找包含"日期"的panel-block
            const panelBlockRegex = /<div[^>]*class="[^"]*panel-block[^"]*"[^>]*>[\s\S]*?<strong[^>]*>[^<]*日期[^<]*<\/strong>[\s\S]*?<span[^>]*class="[^"]*value[^"]*"[^>]*>([^<]+)<\/span>/g;
            let match = panelBlockRegex.exec(html);
            if (match) {
                releaseDate = match[1].trim();
            }

            // 方法2: 如果没找到，尝试其他模式
            if (!releaseDate) {
                const dateRegex = /日期[^>]*>[\s\S]*?(\d{4}-\d{2}-\d{2})/;
                const dateMatch = html.match(dateRegex);
                if (dateMatch) {
                    releaseDate = dateMatch[1];
                }
            }

            // 解析标签：只读取详情页“類別/类别/Category”区块，避免把列表页默认导航标签写入记录。
            const tags = extractDetailCategoryTagsFromHTML(html);

            // 解析封面图片
            let javdbImage: string | undefined;
            const coverImageRegex = /<img[^>]*class="[^"]*video-cover[^"]*"[^>]*src="([^"]+)"/;
            const coverMatch = html.match(coverImageRegex);
            if (coverMatch) {
                javdbImage = coverMatch[1];
            }

            // 如果没找到，尝试从fancybox链接获取
            if (!javdbImage) {
                const fancyboxRegex = /<a[^>]*data-fancybox="gallery"[^>]*href="([^"]+)"/;
                const fancyboxMatch = html.match(fancyboxRegex);
                if (fancyboxMatch) {
                    javdbImage = fancyboxMatch[1];
                }
            }

            logAsync('INFO', `解析视频详情完成`, {
                urlVideoId,
                realVideoId,
                finalVideoId: videoId,
                title: title.substring(0, 50),
                releaseDate,
                tagsCount: tags.length,
                hasImage: !!javdbImage
            });

            return {
                id: videoId, // 返回真正的视频ID
                title,
                tags,
                releaseDate,
                javdbImage,
            };

        } catch (error: any) {
            logAsync('ERROR', `解析视频详情HTML失败`, { urlVideoId, error: error.message });
            return null;
        }
    }

    /**
     * 保存视频记录到本地存储
     */
    private async saveVideoRecord(
        videoId: string,
        videoData: Partial<VideoRecord>,
        status: 'want' | 'viewed' | 'browsed',
        urlVideoId?: string
    ): Promise<void> {
        try {
            const { getValue, setValue } = await import('../../../utils/storage');
            const { STORAGE_KEYS } = await import('../../../utils/config');

            // 获取现有记录
            const existingRecords = await getValue<Record<string, VideoRecord>>(STORAGE_KEYS.VIEWED_RECORDS, {});

            // 创建新记录
            const now = Date.now();

            // 构建javdbUrl，优先使用原始的URL ID
            let javdbUrl = `${this.baseUrl}/v/${videoId}`;
            if (urlVideoId) {
                // 如果提供了URL ID，使用URL ID构建URL
                javdbUrl = `${this.baseUrl}/v/${urlVideoId}`;
            } else if (videoData.javdbUrl) {
                javdbUrl = videoData.javdbUrl;
            }

            const newRecord: VideoRecord = {
                id: videoId,
                title: videoData.title || '',
                status: status,
                tags: videoData.tags || [],
                createdAt: now,
                updatedAt: now,
                releaseDate: videoData.releaseDate,
                javdbUrl: javdbUrl,
                javdbImage: videoData.javdbImage
            };

            // 保存记录
            existingRecords[videoId] = newRecord;
            await setValue(STORAGE_KEYS.VIEWED_RECORDS, existingRecords);

            logAsync('INFO', `视频记录已保存`, {
                videoId,
                status,
                title: videoData.title?.substring(0, 30),
                javdbUrl
            });

        } catch (error: any) {
            logAsync('ERROR', `保存视频记录失败`, { videoId, error: error.message });
            throw error;
        }
    }
}

/**
 * 获取API客户端实例
 */
export function getApiClient(): SyncApiClient {
    return SyncApiClient.getInstance();
}
