/**
 * 数据同步API调用模块
 */

import { logAsync } from '../logger';
import type { VideoRecord, UserProfile, ListRecord } from '../../types';
import type {
    SyncType,
    SyncResponseData,
    SyncConfig
} from './types';
import { SyncCancelledError } from './types';
import {
    type CollectionListType,
    normalizeCollectionRecord,
} from '../../shared/utils/listRecordHelpers';
import { getSettings, getValue, setValue } from '../../utils/storage';
import { STORAGE_KEYS } from '../../utils/config';
import { dbViewedPut } from '../dbClient';
import { isCloudflareChallenge, handleCloudflareVerification } from './cloudflareVerification';
import { saveSyncProgress, getSavedSyncProgress, clearSyncProgress } from './progressManager';
import type { SavedSyncProgress } from '../config/syncConfig';
import { getJavDBRoute } from '../../features/routeManagement';

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
    url?: string;
    status?: 'want' | 'viewed';
    displayName: string;
    countField?: 'wantCount' | 'watchedCount';
}

interface ListPageItem {
    id: string;
    name: string;
    moviesCount?: number;
    clickedCount?: number;
}

/**
 * API客户端类
 */
export class ApiClient {
    private timeout: number;
    private retryCount: number;
    private retryDelay: number;

    constructor(config: {
        timeout?: number;
        retryCount?: number;
        retryDelay?: number;
    } = {}) {
        this.timeout = config.timeout ?? 30000;
        this.retryCount = config.retryCount ?? 3;
        this.retryDelay = config.retryDelay ?? 1000;
    }

    private getOriginFromUrl(url: string): string {
        try {
            const u = new URL(String(url));
            return u.origin;
        } catch {
            // 如果解析失败，返回空字符串，让调用方使用 getPreferredJavdbOrigin
            return '';
        }
    }

    private async getPreferredJavdbOrigin(): Promise<string> {
        try {
            const settings = await getSettings();
            const urls: any = settings?.dataSync?.urls || {};
            const candidate = String(urls.wantWatch || urls.watchedVideos || urls.collectionActors || '').trim();
            if (candidate) {
                const origin = this.getOriginFromUrl(candidate);
                if (origin) return origin;
            }
        } catch {
            // ignore
        }
        // 使用动态线路管理器获取当前 JavDB 线路
        return await getJavDBRoute();
    }

    /**
     * 同步数据到服务器
     */
    async syncData(
        type: SyncType,
        localData: VideoRecord[],
        userProfile: UserProfile,
        config: SyncConfig,
        onProgress?: (progress: any) => void,
        abortSignal?: AbortSignal
    ): Promise<SyncResponseData> {
        const typeConfig = await this.getSyncTypeConfig(type);
        
        logAsync('INFO', `开始${typeConfig.displayName}同步`, {
            type,
            localDataCount: localData.length,
            mode: config.mode
        });

        try {
            // 检查取消信号
            if (abortSignal?.aborted) {
                throw new SyncCancelledError('同步已取消');
            }

            // 模拟API调用 - 实际实现中这里会调用真实的API
            const result = await this.performSync(
                type,
                localData,
                userProfile,
                config,
                onProgress,
                abortSignal
            );

            logAsync('INFO', `${typeConfig.displayName}同步完成`, result);
            return result;

        } catch (error) {
            if (error instanceof SyncCancelledError) {
                throw error;
            }
            
            const errorMessage = error instanceof Error ? error.message : '未知错误';
            logAsync('ERROR', `${typeConfig.displayName}同步失败`, { error: errorMessage });
            throw new Error(`${typeConfig.displayName}同步失败: ${errorMessage}`);
        }
    }

    /**
     * 执行实际的同步操作
     */
    private async performSync(
        type: SyncType,
        _localData: VideoRecord[],
        userProfile: UserProfile,
        config: SyncConfig,
        onProgress?: (progress: any) => void,
        abortSignal?: AbortSignal
    ): Promise<SyncResponseData> {
        // 对于想看和已观看类型，使用真实API同步
        if (type === 'want' || type === 'viewed') {
            return await this.syncUserVideos(type, userProfile, config, onProgress, abortSignal);
        }

        if (type === 'lists') {
            return await this.syncUserLists(userProfile, config, onProgress, abortSignal);
        }

        if (type === 'series') {
            return await this.syncUserSeries(userProfile, onProgress, abortSignal);
        }

        if (type === 'labels') {
            return await this.syncUserLabels(userProfile, onProgress, abortSignal);
        }

        // 其他类型暂时返回空结果
        return {
            success: true,
            syncedCount: 0,
            skippedCount: 0,
            errorCount: 0,
            newRecords: 0,
            updatedRecords: 0,
            message: `${type} 类型同步暂未实现`
        };
    }

    /**
     * 同步用户视频（想看/已观看）
     */
    private async syncUserVideos(
        type: 'want' | 'viewed',
        userProfile: UserProfile,
        config: SyncConfig,
        onProgress?: (progress: any) => void,
        abortSignal?: AbortSignal
    ): Promise<SyncResponseData> {
        // 获取同步类型配置
        const syncConfig = await this.getSyncTypeConfig(type);
        if (!syncConfig.url || !syncConfig.countField || !syncConfig.status) {
            throw new Error('同步配置无效');
        }
        logAsync('INFO', `开始同步${syncConfig.displayName}视频列表`, {
            userEmail: userProfile.email,
            type,
            url: syncConfig.url,
            resumeMode: config.resumeFromProgress
        });

        try {
            // 1. 刷新用户账号信息，获取视频数量
            logAsync('INFO', '正在刷新用户账号信息...');
            const refreshedProfile = await this.refreshUserProfile();

            if (!refreshedProfile || !refreshedProfile.serverStats) {
                throw new Error('无法获取用户账号信息或统计数据');
            }

            // 根据同步类型获取对应的数量
            const videoCount = refreshedProfile.serverStats[syncConfig.countField] || 0;
            logAsync('INFO', `用户${syncConfig.displayName}统计`, {
                [syncConfig.countField]: videoCount,
                wantCount: refreshedProfile.serverStats.wantCount,
                watchedCount: refreshedProfile.serverStats.watchedCount
            });

            if (videoCount === 0) {
                logAsync('INFO', `用户没有${syncConfig.displayName}的视频`);
                return {
                    success: true,
                    syncedCount: 0,
                    skippedCount: 0,
                    errorCount: 0,
                    newRecords: 0,
                    updatedRecords: 0,
                    message: `没有找到${syncConfig.displayName}视频`
                };
            }

            // 2. 计算页数（每页20个）
            const totalPages = Math.ceil(videoCount / 20);
            logAsync('INFO', `用户有${videoCount}个${syncConfig.displayName}视频，共${totalPages}页`);

            // 3. 初始化同步状态
            const settings = await getSettings();
            const requestInterval = settings.dataSync.requestInterval * 1000; // 转换为毫秒

            let syncedCount = 0;
            let errorCount = 0;
            let newRecords = 0;
            let updatedRecords = 0;
            let processedVideos = 0; // 已处理的视频总数
            let startPage = 1;
            let startVideoIndex = 0;

            // 检查是否有保存的进度
            let savedProgress: SavedSyncProgress | null = null;
            if (config.resumeFromProgress) {
                savedProgress = await getSavedSyncProgress(type, userProfile.email);
                if (savedProgress) {
                    // 恢复进度
                    startPage = savedProgress.currentPage;
                    startVideoIndex = savedProgress.currentVideoIndex;
                    syncedCount = savedProgress.syncedCount;
                    errorCount = savedProgress.errorCount;
                    newRecords = savedProgress.newRecords;
                    updatedRecords = savedProgress.updatedRecords;
                    processedVideos = syncedCount + errorCount;
                    
                    logAsync('INFO', `从上次进度继续同步`, {
                        startPage,
                        startVideoIndex,
                        syncedCount,
                        errorCount,
                        processedVideos
                    });
                }
            }

            // 增量同步相关变量
            const isIncrementalMode = config.mode === 'incremental';
            let existingRecordsCount = 0;
            let shouldStopIncremental = false;
            const incrementalTolerance = config.incrementalTolerance || 20;

            // 如果是增量同步，先获取本地已存在的记录
            let localRecords: Record<string, any> = {};
            if (isIncrementalMode) {
                try {
                    // 所有视频记录都存储在同一个键中，通过status字段区分
                    const allRecords = await getValue<Record<string, VideoRecord>>(STORAGE_KEYS.VIEWED_RECORDS, {});
                    // 过滤出对应类型的记录
                    localRecords = Object.fromEntries(
                        Object.entries(allRecords).filter(([_, record]) => record.status === type)
                    );
                    logAsync('INFO', `增量同步模式：本地已有${Object.keys(localRecords).length}条${type}记录`);
                } catch (error: any) {
                    logAsync('WARN', '获取本地记录失败，将使用全量同步模式', { error: error.message });
                }
            }

            // 4. 分页处理：获取一页就立即同步这一页的视频
            logAsync('INFO', `开始分页处理${syncConfig.displayName}视频...`, {
                startPage,
                totalPages,
                startVideoIndex
            });

            for (let page = startPage; page <= totalPages; page++) {
                try {
                    // 检查是否已取消
                    if (abortSignal?.aborted) {
                        logAsync('INFO', `同步在第${page}页被取消，保存进度`);
                        // 保存当前进度
                        await saveSyncProgress({
                            type,
                            userEmail: userProfile.email,
                            currentPage: page,
                            currentVideoIndex: startVideoIndex,
                            totalPages,
                            videoCount,
                            syncedCount,
                            errorCount,
                            newRecords,
                            updatedRecords,
                            timestamp: Date.now(),
                            mode: config.mode || 'full'
                        });
                        throw new SyncCancelledError('用户取消了同步操作');
                    }

                    // 4.1 获取当前页的视频数据
                    logAsync('INFO', `正在获取第${page}页${syncConfig.displayName}视频...`);
                    const videoData = await this.fetchVideoDataFromPage(type, page);

                    // 更新页面进度
                    onProgress?.({
                        current: page,
                        total: totalPages,
                        percentage: Math.round((page / totalPages) * 100),
                        message: `获取${syncConfig.displayName}列表 (${page}/${totalPages}页)...`,
                        stage: 'pages'
                    });

                    logAsync('INFO', `获取第${page}页${syncConfig.displayName}视频完成`, {
                        page,
                        totalPages,
                        currentPageCount: videoData.length,
                        videoData: videoData.slice(0, 3) // 显示前3个作为示例
                    });

                    // 4.2 立即处理当前页的每个视频
                    // 如果是恢复的第一页，从保存的索引开始
                    const startIdx = (page === startPage) ? startVideoIndex : 0;
                    
                    for (let i = startIdx; i < videoData.length; i++) {
                        // 检查是否已取消
                        if (abortSignal?.aborted) {
                            logAsync('INFO', `同步在视频 ${i} 被取消，保存进度`);
                            // 保存当前进度
                            await saveSyncProgress({
                                type,
                                userEmail: userProfile.email,
                                currentPage: page,
                                currentVideoIndex: i,
                                totalPages,
                                videoCount,
                                syncedCount,
                                errorCount,
                                newRecords,
                                updatedRecords,
                                timestamp: Date.now(),
                                mode: config.mode || 'full'
                            });
                            throw new SyncCancelledError('用户取消了同步操作');
                        }

                        const video = videoData[i];
                        const urlVideoId = video.urlId;

                        try {
                            // 增量同步检查
                            if (isIncrementalMode && localRecords[urlVideoId]) {
                                existingRecordsCount++;
                                logAsync('INFO', `增量同步：跳过已存在的视频 ${urlVideoId}`, {
                                    existingRecordsCount,
                                    incrementalTolerance
                                });

                                // 检查是否超过容忍度
                                if (existingRecordsCount >= incrementalTolerance) {
                                    shouldStopIncremental = true;
                                    logAsync('INFO', `增量同步：达到容忍度${incrementalTolerance}，准备停止同步`);
                                    break;
                                }
                                continue;
                            }

                            // 获取视频详情页面
                            const videoDetail = await this.fetchVideoDetail(urlVideoId);

                            if (videoDetail) {
                                // 使用从详情页提取的真正ID，如果没有则使用URL ID
                                const realVideoId = videoDetail.id || urlVideoId;

                                // 检查是否为新记录
                                const existingRecords = await getValue<Record<string, VideoRecord>>(STORAGE_KEYS.VIEWED_RECORDS, {});
                                const isNewRecord = !existingRecords[realVideoId];

                                // 保存到本地存储，传入URL ID用于构建正确的javdbUrl
                                await this.saveVideoRecord(realVideoId, videoDetail, syncConfig.status, urlVideoId);
                                syncedCount++;

                                if (isNewRecord) {
                                    newRecords++;
                                } else {
                                    updatedRecords++;
                                }

                                logAsync('INFO', `成功同步${syncConfig.displayName}视频 ${realVideoId}`);
                                
                                // 通知UI添加到已获取列表
                                this.notifyVideoFetched(syncedCount, videoDetail.title || realVideoId, true);
                            } else {
                                errorCount++;
                                logAsync('ERROR', `视频详情获取失败: ${urlVideoId}`);
                                
                                // 通知UI添加失败项
                                this.notifyVideoFetched(syncedCount + errorCount, `${urlVideoId} (获取失败)`, false);
                            }
                        } catch (error: any) {
                            errorCount++;
                            logAsync('ERROR', `同步视频 ${urlVideoId} 失败`, { error: error.message });
                        }

                        // 更新视频处理进度
                        processedVideos++;
                        const detailProgress = Math.round((processedVideos / videoCount) * 100);
                        onProgress?.({
                            current: processedVideos,
                            total: videoCount,
                            percentage: detailProgress,
                            message: `同步${syncConfig.displayName}视频 (${processedVideos}/${videoCount})...`,
                            stage: 'details'
                        });

                        // 请求间隔
                        if (i < videoData.length - 1 || page < totalPages) {
                            await this.delay(requestInterval);
                        }
                    }

                    // 如果是增量同步且应该停止，则跳出页面循环
                    if (isIncrementalMode && shouldStopIncremental) {
                        logAsync('INFO', `增量同步提前结束，已处理${page}页，共${processedVideos}个视频`);
                        break;
                    }

                    // 页面间隔
                    if (page < totalPages) {
                        logAsync('INFO', `等待1秒后获取下一页...`);
                        await this.delay(1000); // 页面间隔1秒
                    }

                } catch (error: any) {
                    logAsync('ERROR', `处理第${page}页${syncConfig.displayName}视频失败`, {
                        page,
                        totalPages,
                        error: error.message
                    });

                    // 如果是取消错误，直接抛出
                    if (error instanceof SyncCancelledError) {
                        throw error;
                    }

                    // 如果是验证错误，保存进度后抛出
                    if (error.message && error.message.includes('Cloudflare')) {
                        logAsync('INFO', '遇到Cloudflare验证，保存进度');
                        await saveSyncProgress({
                            type,
                            userEmail: userProfile.email,
                            currentPage: page,
                            currentVideoIndex: 0,
                            totalPages,
                            videoCount,
                            syncedCount,
                            errorCount,
                            newRecords,
                            updatedRecords,
                            timestamp: Date.now(),
                            mode: config.mode || 'full'
                        });
                        throw error;
                    }

                    // 其他错误继续处理下一页
                    errorCount++;
                }
            }

            // 同步完成，清除保存的进度
            await clearSyncProgress();
            logAsync('INFO', '同步完成，已清除保存的进度');

            const result = {
                success: true,
                syncedCount,
                skippedCount: 0,
                errorCount,
                newRecords,
                updatedRecords,
                message: `同步完成：新增 ${newRecords}，更新 ${updatedRecords}`
            };

            logAsync('INFO', `${syncConfig.displayName}视频同步完成`, result);
            return result;

        } catch (error: any) {
            if (error instanceof SyncCancelledError) {
                logAsync('INFO', `${syncConfig.displayName}同步被用户取消`, { reason: error.message });
            } else {
                logAsync('ERROR', `同步${syncConfig.displayName}视频失败`, { error: error.message });
            }
            throw error;
        }
    }

    /**
     * 获取同步类型配置
     */
    private async getSyncTypeConfig(type: SyncType): Promise<SyncTypeConfig> {
        // 获取用户设置的URL
        const settings = await getValue<any>('settings', {});
        const dataSyncUrls = settings.dataSync?.urls || {};
        
        // 获取当前 JavDB 线路
        const javdbRoute = await getJavDBRoute();

        const configs: Record<SyncType, SyncTypeConfig> = {
            viewed: {
                url: dataSyncUrls.watchedVideos || `${javdbRoute}/users/watched_videos`,
                status: 'viewed',
                displayName: '已观看',
                countField: 'watchedCount'
            },
            want: {
                url: dataSyncUrls.wantWatch || `${javdbRoute}/users/want_watch_videos`,
                status: 'want',
                displayName: '想看',
                countField: 'wantCount'
            },
            actors: {
                url: dataSyncUrls.collectionActors || `${javdbRoute}/users/collection_actors`,
                status: 'viewed', // 演员同步使用viewed状态
                displayName: '演员',
                countField: 'watchedCount'
            },
            'actors-gender': {
                url: dataSyncUrls.collectionActors || `${javdbRoute}/users/collection_actors`,
                status: 'viewed',
                displayName: '演员性别',
                countField: 'watchedCount'
            },
            all: {
                url: dataSyncUrls.wantWatch || `${javdbRoute}/users/want_watch_videos`,
                status: 'viewed',
                displayName: '全部',
                countField: 'watchedCount'
            },
            lists: {
                url: `${javdbRoute}/users/lists`,
                displayName: '清单'
            },
            series: {
                url: `${javdbRoute}/users/collection_series`,
                displayName: '系列'
            },
            labels: {
                url: `${javdbRoute}/users/collection_codes`,
                displayName: '番号'
            }
        };

        const config = configs[type];
        const defaultUrl = (() => {
            switch (type) {
                case 'want':
                    return `${javdbRoute}/users/want_watch_videos`;
                case 'viewed':
                    return `${javdbRoute}/users/watched_videos`;
                case 'actors':
                    return `${javdbRoute}/users/collection_actors`;
                case 'actors-gender':
                    return `${javdbRoute}/users/collection_actors`;
                case 'all':
                    return `${javdbRoute}/users/want_watch_videos`;
                case 'lists':
                    return `${javdbRoute}/users/lists`;
                default:
                    return config?.url;
            }
        })();
        logAsync('INFO', `获取同步配置: ${type}`, {
            url: config.url,
            displayName: config.displayName,
            isCustomUrl: config.url !== defaultUrl
        });

        return config;
    }

    /**
     * 延迟函数
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 带重试与超时的请求封装（支持 Cloudflare 验证）
     */
    private async fetchWithRetry(url: string, init: RequestInit = {}): Promise<Response> {
        const maxAttempts = Math.max(1, this.retryCount);
        let lastError: any = null;
        
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                const signal = init.signal ?? AbortSignal.timeout(this.timeout);
                const res = await fetch(url, { ...init, signal });
                
                // 检查是否为 Cloudflare 验证页面
                if (res.ok || res.status === 403 || res.status === 503) {
                    const contentType = res.headers.get('content-type') || '';
                    if (contentType.includes('text/html')) {
                        const html = await res.text();
                        
                        // 检测 Cloudflare 验证
                        if (isCloudflareChallenge(html)) {
                            logAsync('WARN', 'Cloudflare 人机验证触发', { url, attempt });
                            
                            // 显示验证窗口
                            const verificationResult = await handleCloudflareVerification(url);
                            
                            if (!verificationResult.success) {
                                throw new Error(verificationResult.error || 'Cloudflare 验证失败');
                            }
                            
                            // 验证成功，重新请求
                            logAsync('INFO', 'Cloudflare 验证成功，重新请求', { url });
                            const retryRes = await fetch(url, { ...init, signal });
                            
                            // 再次检查是否还是验证页面
                            if (retryRes.ok || retryRes.status === 403 || retryRes.status === 503) {
                                const retryContentType = retryRes.headers.get('content-type') || '';
                                if (retryContentType.includes('text/html')) {
                                    const retryHtml = await retryRes.text();
                                    if (isCloudflareChallenge(retryHtml)) {
                                        throw new Error('验证后仍然遇到 Cloudflare 挑战，请稍后重试');
                                    }
                                    // 返回包含HTML的响应（需要重新构造）
                                    return new Response(retryHtml, {
                                        status: retryRes.status,
                                        statusText: retryRes.statusText,
                                        headers: retryRes.headers
                                    });
                                }
                            }
                            
                            return retryRes;
                        }
                        
                        // 不是验证页面，返回包含HTML的响应
                        return new Response(html, {
                            status: res.status,
                            statusText: res.statusText,
                            headers: res.headers
                        });
                    }
                }
                
                // 对 5xx/429 进行重试，其余错误直接返回
                if (!res.ok && (res.status >= 500 || res.status === 429)) {
                    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
                }
                
                return res;
            } catch (err) {
                lastError = err;
                if (attempt < maxAttempts - 1) {
                    await this.delay(this.retryDelay);
                    continue;
                }
                throw err;
            }
        }
        throw lastError;
    }

    // 已移除未使用的网络连通性检查方法（checkNetworkStatus），避免 TS6133 未使用告警

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
     * 从指定页面获取视频数据列表（包含URL ID和真实番号）
     */
    private async fetchVideoDataFromPage(type: 'want' | 'viewed', page: number): Promise<VideoData[]> {
        // 获取同步类型配置
        const syncConfig = await this.getSyncTypeConfig(type);
        const url = `${syncConfig.url}?page=${page}`;
        logAsync('INFO', `请求${syncConfig.displayName}视频页面`, { page, url, baseUrl: syncConfig.url });

        try {
            const response = await this.fetchWithRetry(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'zh-CN,zh;q=0.8,en-US;q=0.5,en;q=0.3',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'DNT': '1',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Cache-Control': 'max-age=0'
                }
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
                const hrefRegex = /href="\/v\/([a-zA-Z0-9\-_]+)"(?![^>]*reviews)/g;
                let hrefMatch;
                while ((hrefMatch = hrefRegex.exec(html)) !== null) {
                    const urlId = hrefMatch[1];
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
     * 获取视频详情
     */
    private async fetchVideoDetail(urlVideoId: string): Promise<Partial<VideoRecord> | null> {
        const origin = await this.getPreferredJavdbOrigin();
        const detailUrl = `${origin}/v/${urlVideoId}`;
        logAsync('INFO', `获取视频详情: ${urlVideoId}`, { detailUrl });

        try {
            const response = await this.fetchWithRetry(detailUrl, {
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
                logAsync('ERROR', `视频详情页面请求失败: ${urlVideoId}`, {
                    status: response.status,
                    statusText: response.statusText
                });
                return null;
            }

            const html = await response.text();
            
            // 检查是否为验证页面
            if (isCloudflareChallenge(html)) {
                logAsync('WARN', `视频详情页面是验证页面，跳过保存: ${urlVideoId}`);
                return null;
            }
            
            logAsync('INFO', `视频详情页面HTML获取成功: ${urlVideoId}`, {
                htmlLength: html.length,
                hasTitle: html.includes('<title>'),
                hasVideoInfo: html.includes('video-meta')
            });

            // 解析视频详情
            const videoData = this.parseVideoDetailFromHTML(html, urlVideoId);

            if (videoData) {
                logAsync('INFO', `视频详情解析成功: ${urlVideoId}`, {
                    realId: videoData.id,
                    title: videoData.title?.substring(0, 50),
                    tagsCount: videoData.tags?.length || 0,
                    hasReleaseDate: !!videoData.releaseDate,
                    hasImage: !!videoData.javdbImage
                });
            } else {
                logAsync('WARN', `视频详情解析失败: ${urlVideoId}`);
            }

            return videoData;

        } catch (error: any) {
            logAsync('ERROR', `获取视频详情异常: ${urlVideoId}`, { error: error.message });
            return null;
        }
    }

    /**
     * 从HTML中解析视频详情
     */
    private parseVideoDetailFromHTML(html: string, urlVideoId: string): Partial<VideoRecord> | null {
        try {
            // 首先检查是否为验证页面（双重保险）
            if (isCloudflareChallenge(html)) {
                logAsync('WARN', `解析时检测到验证页面，拒绝解析: ${urlVideoId}`);
                return null;
            }
            
            // 检查是否有正常的视频内容
            const hasVideoContent = html.includes('video-meta') || 
                                   html.includes('video-detail') || 
                                   html.includes('panel-block');
            
            if (!hasVideoContent) {
                logAsync('WARN', `页面缺少视频内容，可能不是有效的详情页: ${urlVideoId}`);
                return null;
            }
            
            // 首先提取真正的视频ID
            const realVideoId = this.extractVideoIdFromDetailHTML(html);
            const videoId = realVideoId || urlVideoId; // 如果提取失败，使用URL中的ID作为备选

            logAsync('INFO', `视频ID解析结果`, {
                urlVideoId,
                realVideoId,
                finalVideoId: videoId
            });

            // 解析标题 - 优化逻辑，移除视频ID前缀
            let title = '';

            // 方法1: 从页面标题中获取并移除ID前缀
            const titleMatch = html.match(/<title>([^|]+)/);
            if (titleMatch) {
                const rawTitle = titleMatch[1].trim();
                
                // 检查标题是否包含验证相关关键词
                if (rawTitle.includes('Security Verification') || 
                    rawTitle.includes('Cloudflare')) {
                    logAsync('WARN', `标题包含验证关键词，拒绝解析: ${urlVideoId}`, { title: rawTitle });
                    return null;
                }
                
                // 移除视频ID前缀（如 "DVAJ-700 " -> ""）
                const titleWithoutId = rawTitle.replace(/^[A-Z0-9\-]+\s+/, '');
                title = titleWithoutId || rawTitle; // 如果移除后为空，使用原标题

                logAsync('INFO', `标题解析: "${rawTitle}" -> "${title}"`);
            }

            // 方法2: 如果标题为空，尝试从其他地方获取
            if (!title) {
                // 尝试从h2标题获取
                const h2TitleMatch = html.match(/<h2[^>]*class="[^"]*title[^"]*"[^>]*>[\s\S]*?<strong[^>]*>([^<]+)<\/strong>/);
                if (h2TitleMatch) {
                    const h2Title = h2TitleMatch[1].trim();
                    const titleWithoutId = h2Title.replace(/^[A-Z0-9\-]+\s+/, '');
                    title = titleWithoutId || h2Title;
                    logAsync('INFO', `从H2标题解析: "${h2Title}" -> "${title}"`);
                }
            }

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
            const tags = this.extractDetailCategoryTags(html);

            if (tags.length === 0) {
                logAsync('WARN', `未找到任何标签: ${urlVideoId}`);
            } else {
                logAsync('INFO', `标签解析完成: [${tags.join(', ')}]`);
            }

            // 解析封面图片 - 参考刷新源数据的完善逻辑
            let javdbImage: string | undefined;

            // 方法1：优先查找jdbstatic.com的封面图片（最可靠）
            const jdbstaticCoverMatch = html.match(/(?:data-fancybox="gallery"\s+href|<img[^>]*src)="(https:\/\/[^"]*\.jdbstatic\.com\/covers\/[^"]+)"/);
            if (jdbstaticCoverMatch) {
                javdbImage = jdbstaticCoverMatch[1];
                logAsync('INFO', `找到jdbstatic封面图片: ${javdbImage}`);
            }

            // 方法2：如果没找到，尝试video-cover类的img标签
            if (!javdbImage) {
                const coverImageRegex = /<img[^>]*class="[^"]*video-cover[^"]*"[^>]*src="([^"]+)"/;
                const coverMatch = html.match(coverImageRegex);
                if (coverMatch) {
                    javdbImage = coverMatch[1];
                    logAsync('INFO', `找到video-cover图片: ${javdbImage}`);
                }
            }

            // 方法3：尝试从fancybox链接获取
            if (!javdbImage) {
                const fancyboxRegex = /<a[^>]*data-fancybox="gallery"[^>]*href="([^"]+)"/;
                const fancyboxMatch = html.match(fancyboxRegex);
                if (fancyboxMatch) {
                    javdbImage = fancyboxMatch[1];
                    logAsync('INFO', `找到fancybox图片: ${javdbImage}`);
                }
            }

            // 方法4：尝试其他可能的封面图片模式
            if (!javdbImage) {
                // 尝试查找column-video-cover区域内的图片
                const columnCoverMatch = html.match(/<div[^>]*class="[^"]*column-video-cover[^"]*"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/);
                if (columnCoverMatch) {
                    javdbImage = columnCoverMatch[1];
                    logAsync('INFO', `找到column-video-cover图片: ${javdbImage}`);
                }
            }

            // 方法5：最后尝试任何包含cover关键词的图片
            if (!javdbImage) {
                const anyCoverMatch = html.match(/<img[^>]*(?:class="[^"]*cover[^"]*"|alt="[^"]*cover[^"]*")[^>]*src="([^"]+)"/i);
                if (anyCoverMatch) {
                    javdbImage = anyCoverMatch[1];
                    logAsync('INFO', `找到cover关键词图片: ${javdbImage}`);
                }
            }

            if (!javdbImage) {
                logAsync('WARN', `未找到封面图片: ${urlVideoId}`);
            }

            // 从页面中推断 origin（兼容镜像站），避免写死 javdb.com
            const inferredOrigin = (() => {
                try {
                    const m1 = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i);
                    const m2 = html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["'][^>]*>/i);
                    const url = (m1 && m1[1]) || (m2 && m2[1]) || '';
                    if (url) return this.getOriginFromUrl(url);
                } catch {}
                return 'https://javdb.com';
            })();

            const videoData: Partial<VideoRecord> = {
                id: videoId, // 返回真正的视频ID
                title,
                tags,
                releaseDate,
                javdbUrl: `${inferredOrigin}/v/${urlVideoId}`,
                javdbImage
            };

            logAsync('INFO', `视频详情解析结果: ${urlVideoId}`, {
                realId: realVideoId,
                finalVideoId: videoId,
                title: title.substring(0, 50),
                tagsCount: tags.length,
                hasReleaseDate: !!releaseDate,
                hasImage: !!javdbImage
            });

            return videoData;

        } catch (error: any) {
            logAsync('ERROR', `解析视频详情HTML失败: ${urlVideoId}`, { error: error.message });
            return null;
        }
    }

    private extractDetailCategoryTags(html: string): string[] {
        const tags: string[] = [];
        const panelBlockRegex = /<div\b([^>]*)class=["'][^"']*panel-block[^"']*["']([^>]*)>([\s\S]*?)<\/div>/gi;
        let blockMatch: RegExpExecArray | null;

        while ((blockMatch = panelBlockRegex.exec(html)) !== null) {
            const blockAttrs = `${blockMatch[1] || ''} ${blockMatch[2] || ''}`;
            const blockHtml = blockMatch[3] || '';
            const isGenreBlock = /class=["'][^"']*genre[^"']*["']/i.test(blockAttrs);
            const labelText = this.stripHtmlTags(blockHtml.match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i)?.[1] || '');
            const isCategoryLabel = /類別|类别|Category/i.test(labelText);

            if (!isGenreBlock && !isCategoryLabel) continue;

            const valueHtml = blockHtml.match(/<span\b[^>]*class=["'][^"']*value[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || blockHtml;
            const links = valueHtml.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
            for (const linkMatch of links) {
                const href = linkMatch[1] || '';
                if (!this.isNativeCategoryHref(href)) continue;
                const tag = this.stripHtmlTags(linkMatch[2] || '').trim();
                if (tag && !tags.includes(tag)) {
                    tags.push(tag);
                    logAsync('INFO', `找到标签: ${tag}`);
                }
            }

            if (tags.length > 0) {
                logAsync('INFO', `详情类别区块解析成功，找到${tags.length}个标签`);
                return tags;
            }
        }

        return tags;
    }

    private isNativeCategoryHref(href: string): boolean {
        const rawHref = String(href || '').trim();
        if (!rawHref) return false;

        try {
            const url = new URL(rawHref, 'https://javdb.com');
            return url.pathname.startsWith('/tags') || url.pathname.startsWith('/genres');
        } catch {
            return rawHref.startsWith('/tags') || rawHref.startsWith('/genres');
        }
    }

    private stripHtmlTags(html: string): string {
        return String(html || '')
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .trim();
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
     * 保存视频记录到本地存储
     */
    private async saveVideoRecord(
        videoId: string,
        videoData: Partial<VideoRecord>,
        status: VideoRecord['status'],
        urlVideoId?: string
    ): Promise<void> {
        try {
            // 获取现有记录（在 IDB 模式下这里会从 IDB 组装，注意可能较慢）
            const existingRecords = await getValue<Record<string, VideoRecord>>(STORAGE_KEYS.VIEWED_RECORDS, {});

            // 创建新记录
            const now = Date.now();

            // 构建javdbUrl，始终使用 javdb.com 作为持久化存储的域名
            // 显示时会通过 RouteManager 动态替换为当前选择的线路
            let javdbUrl = `https://javdb.com/v/${videoId}`;
            if (urlVideoId) {
                // 如果提供了URL ID，使用URL ID构建URL
                javdbUrl = `https://javdb.com/v/${urlVideoId}`;
            }
            // 注意：不使用 videoData.javdbUrl，因为它可能包含动态线路域名

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

            // 主写入：IndexedDB（Dashboard 默认使用 IDB 查询/分页）
            try {
                await dbViewedPut(newRecord);
            } catch (e: any) {
                logAsync('WARN', '写入 IndexedDB 失败（将继续写入 storage 作为兜底）', { videoId, error: e?.message });
            }

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

    private async isIDBMigrated(): Promise<boolean> {
        try {
            return await new Promise<boolean>((resolve) => {
                chrome.storage.local.get([STORAGE_KEYS.IDB_MIGRATED], (r) => resolve(!!r[STORAGE_KEYS.IDB_MIGRATED]));
            });
        } catch {
            return false;
        }
    }

    private async sendDbMessage<T = any>(type: string, payload?: any): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            try {
                chrome.runtime.sendMessage({ type, payload }, (resp) => {
                    const lastErr = chrome.runtime.lastError;
                    if (lastErr) {
                        reject(new Error(lastErr.message || 'runtime error'));
                        return;
                    }
                    if (!resp || resp.success !== true) {
                        reject(new Error(resp?.error || 'db error'));
                        return;
                    }
                    resolve(resp as T);
                });
            } catch (e: any) {
                reject(e);
            }
        });
    }

    private parseListsFromHTML(html: string): ListPageItem[] {
        const items: ListPageItem[] = [];
        try {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const nodes = Array.from(doc.querySelectorAll('#lists li.list-item, li.list-item'));
            for (const li of nodes) {
                let id = '';
                const rawId = String((li as HTMLElement).id || '').trim();
                if (rawId.startsWith('list-')) {
                    id = rawId.slice('list-'.length).trim();
                }
                if (!id) {
                    const a = li.querySelector('a[href*="/lists/"]') as HTMLAnchorElement | null;
                    const href = a?.getAttribute('href') || '';
                    const m = href.match(/\/lists\/([^/?#]+)/);
                    if (m) id = String(m[1] || '').trim();
                }

                const name = String(
                    li.querySelector('.list-name')?.textContent ||
                    li.querySelector('.name')?.textContent ||
                    li.querySelector('a[title]')?.getAttribute('title') ||
                    li.querySelector('a')?.textContent ||
                    ''
                ).trim();
                const metaRaw = String(li.querySelector('.meta')?.textContent || li.textContent || '')
                    .replace(/\s+/g, ' ')
                    .replace(/，/g, ',')
                    .trim();

                let moviesCount: number | undefined;
                let clickedCount: number | undefined;

                const mc = metaRaw.match(/(\d+)\s*部影片/) || metaRaw.match(/(\d+)\s*(?:videos?|影片|部)/i);
                if (mc) moviesCount = Number(mc[1]);
                const cc = metaRaw.match(/點擊了\s*(\d+)\s*次/) || metaRaw.match(/(?:点击|點擊|clicks?)\s*(?:了)?\s*(\d+)\s*次?/i);
                if (cc) clickedCount = Number(cc[1]);
                if (!cc) {
                    const cc2 = metaRaw.match(/(\d+)\s*次/);
                    if (cc2) clickedCount = Number(cc2[1]);
                }

                if (id && name) {
                    items.push({ id, name, moviesCount, clickedCount });
                }
            }

            if (items.length > 0) {
                return items;
            }

            const emptyHints = [
                '.lists-empty-tip',
                '.lists-empty',
                '.empty',
                '.empty-state',
                '.section-container .message',
                '.section-container .notification'
            ];
            const hasEmptyState = emptyHints.some((selector) => !!doc.querySelector(selector));
            if (hasEmptyState) {
                return [];
            }
        } catch {
            return items;
        }
        return items;
    }

    private parseUrlVideoIdsFromListHTML(html: string): string[] {
        const ids: string[] = [];
        const seen = new Set<string>();
        const hrefRegex = /href="\/v\/([a-zA-Z0-9\-_]+)"(?![^>]*reviews)/g;
        let m: RegExpExecArray | null;
        while ((m = hrefRegex.exec(html)) !== null) {
            const urlId = m[1];
            if (urlId && !seen.has(urlId)) {
                seen.add(urlId);
                ids.push(urlId);
            }
        }
        return ids;
    }

    private async syncUserLists(
        userProfile: UserProfile,
        _config: SyncConfig,
        onProgress?: (progress: any) => void,
        abortSignal?: AbortSignal
    ): Promise<SyncResponseData> {
        const settings = await getSettings();
        const requestInterval = settings.dataSync.requestInterval * 1000;

        const origin = this.getOriginFromUrl(String(settings?.dataSync?.urls?.wantWatch || settings?.dataSync?.urls?.watchedVideos || 'https://javdb.com'));

        const now = Date.now();
        let syncedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;
        let newRecords = 0;
        let updatedRecords = 0;

        await this.isIDBMigrated();
        const seenListIds = new Set<string>();

        const listRecords: ListRecord[] = [];
        const listIndex: Array<{ id: string; moviesCount?: number }> = [];

        const fetchListIndex = async (type: 'mine' | 'favorite', baseUrl: string): Promise<void> => {
            for (let page = 1; page <= 50; page++) {
                if (abortSignal?.aborted) throw new SyncCancelledError('同步已取消');
                const url = `${baseUrl}?page=${page}`;
                const res = await this.fetchWithRetry(url, {
                    method: 'GET',
                    credentials: 'include'
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
                const html = await res.text();
                const items = this.parseListsFromHTML(html);
                if (items.length === 0) {
                    if (page === 1) {
                        logAsync('INFO', '清单首页为空', { type, url });
                    }
                    break;
                }
                for (const it of items) {
                    if (seenListIds.has(it.id)) continue;
                    seenListIds.add(it.id);
                    listIndex.push({ id: it.id, moviesCount: it.moviesCount });
                    listRecords.push({
                        id: it.id,
                        name: it.name,
                        type,
                        source: 'javdb',
                        url: `${origin}/lists/${it.id}`,
                        moviesCount: it.moviesCount,
                        clickedCount: it.clickedCount,
                        createdAt: now,
                        updatedAt: now
                    });
                    
                    logAsync('INFO', `解析到清单: ${it.name}`, { 
                        id: it.id, 
                        type,
                        moviesCount: it.moviesCount,
                        clickedCount: it.clickedCount
                    });
                }

                onProgress?.({
                    percentage: 0,
                    message: `获取清单列表（${type === 'mine' ? '我的' : '收藏'}）第 ${page} 页...`,
                    stage: 'pages'
                });

                await this.delay(500);
            }
        };

        logAsync('INFO', '开始同步清单列表', { user: userProfile.username });
        await fetchListIndex('mine', `${origin}/users/lists`);
        await fetchListIndex('favorite', `${origin}/users/favorite_lists`);

        // === 预检查：比对本地和远程清单（只比对 JavDB 清单，本地清单不参与） ===
        let oldLists: ListRecord[] = [];
        try {
            const resp = await this.sendDbMessage<{ success: true; records: ListRecord[] }>('DB:LISTS_GET_ALL_NORMALIZED', {});
            oldLists = ((resp as any).records || []);
        } catch (e: any) {
            logAsync('WARN', '获取旧清单列表失败', { error: e?.message });
        }

        // 只对 JavDB 清单（mine/favorite）做增删比对，本地清单和 series/label 不受影响
        const oldJavdbLists = oldLists.filter(l => (!l.source || l.source === 'javdb') && l.type !== 'series' && l.type !== 'label');
        const oldListMap = new Map(oldJavdbLists.map(l => [l.id, l]));
        const newListMap = new Map(listRecords.map(l => [l.id, l]));

        // 分类清单
        const listsToAdd: ListRecord[] = [];      // 新增的清单
        const listsToUpdate: ListRecord[] = [];   // 已存在的清单
        const listsToDelete: ListRecord[] = [];   // 要删除的清单

        for (const newList of listRecords) {
            if (!oldListMap.has(newList.id)) {
                listsToAdd.push(newList);
            } else {
                listsToUpdate.push(newList);
            }
        }

        for (const oldList of oldJavdbLists) {
            if (!newListMap.has(oldList.id)) {
                listsToDelete.push(oldList);
            }
        }

        // === 用户确认：显示变更详情 ===
        if (!_config.resumeFromProgress && (listsToAdd.length > 0 || listsToDelete.length > 0)) {
            const changeDetails = this.buildListChangeDetails(listsToAdd, listsToUpdate, listsToDelete);
            
            // 动态导入 confirmModal
            const { showConfirm } = await import('../components/confirmModal');
            
            const confirmed = await showConfirm({
                title: '清单同步确认',
                message: changeDetails,
                confirmText: '确认同步',
                cancelText: '取消',
                type: listsToDelete.length > 0 ? 'warning' : 'info',
                isHtml: true,
                className: 'list-sync-confirm-modal'
            });

            if (!confirmed) {
                logAsync('INFO', '用户取消了清单同步');
                return {
                    success: false,
                    syncedCount: 0,
                    skippedCount: 0,
                    errorCount: 0,
                    newRecords: 0,
                    updatedRecords: 0,
                    message: '用户取消了同步操作'
                };
            }
        }

        // === 执行清单更新（增量 upsert，保留本地清单） ===
        try {
            // 只删除已从 JavDB 移除的清单（source === 'javdb'），本地清单不受影响
            if (listsToDelete.length > 0) {
                const javdbListsToDelete = listsToDelete.filter(l => !l.source || l.source === 'javdb');
                logAsync('INFO', `准备删除 ${javdbListsToDelete.length} 个 JavDB 清单`, {
                    listIds: javdbListsToDelete.map(l => l.id)
                });
                for (const listToDelete of javdbListsToDelete) {
                    // 先级联清理所有视频中对该清单 ID 的引用
                    try {
                        await this.sendDbMessage('DB:VIEWED_BULK_PATCH_LIST', {
                            videoIds: 'all',
                            listId: listToDelete.id,
                            action: 'remove'
                        });
                    } catch (e: any) {
                        logAsync('WARN', '级联清理清单 listIds 失败', { listId: listToDelete.id, error: e?.message });
                    }
                    // 再删除清单记录
                    await this.sendDbMessage('DB:LISTS_DELETE', { id: listToDelete.id });
                }
            }

            // 写入所有 JavDB 清单（新增+更新）
            await this.sendDbMessage('DB:LISTS_BULK_PUT', { records: listRecords });

            logAsync('INFO', `清单列表已更新（增量）`, {
                added: listsToAdd.length,
                updated: listsToUpdate.length,
                deleted: listsToDelete.length,
                total: listRecords.length
            });
        } catch (e: any) {
            logAsync('WARN', '写入 lists 表失败（不阻断清单影片同步）', { error: e?.message });
        }

        if (listIndex.length === 0) {
            return {
                success: true,
                syncedCount: 0,
                skippedCount: 0,
                errorCount: 0,
                newRecords: 0,
                updatedRecords: 0,
                message: '没有找到任何清单'
            };
        }

        // 轻量同步：只收集各清单的影片 URL ID，不拉取影片详情
        const syncedJavdbListIds = new Set(listIndex.map(l => l.id));
        const listToUrlIds = new Map<string, string[]>();

        let processedLists = 0;
        for (const li of listIndex) {
            if (abortSignal?.aborted) throw new SyncCancelledError('同步已取消');
            processedLists++;
            if ((li.moviesCount ?? 0) === 0) { listToUrlIds.set(li.id, []); continue; }

            const approxPages = Math.max(1, Math.ceil((li.moviesCount ?? 20) / 20));
            const urlIds: string[] = [];

            for (let page = 1; page <= approxPages; page++) {
                if (abortSignal?.aborted) throw new SyncCancelledError('同步已取消');
                onProgress?.({
                    percentage: 50 + Math.round((processedLists / listIndex.length) * 40),
                    message: `收集清单影片 ID：${processedLists}/${listIndex.length}（${li.id} 第${page}页）`,
                    stage: 'pages'
                });
                try {
                    const res = await this.fetchWithRetry(`${origin}/lists/${li.id}?page=${page}`, { method: 'GET', credentials: 'include' });
                    if (!res.ok) break;
                    const html = await res.text();
                    const pageIds = this.parseUrlVideoIdsFromListHTML(html);
                    if (pageIds.length === 0) break;
                    urlIds.push(...pageIds);
                } catch (e: any) { errorCount++; break; }
                if (page > 1) await this.delay(requestInterval);
            }
            listToUrlIds.set(li.id, urlIds);
            syncedCount += urlIds.length;
        }

        // 将 URL ID 与已入库影片匹配，更新 listIds（不创建新影片）
        try {
            onProgress?.({ percentage: 92, message: '更新已入库影片的清单关联...', stage: 'cleanup' });

            const allResp = await this.sendDbMessage<{ success: true; records: VideoRecord[] }>('DB:VIEWED_GET_ALL', {});
            const allRecords: VideoRecord[] = (allResp as any).records || [];

            // 构建 urlId → videoCode 反向索引
            const urlIdPattern = /\/v\/([a-zA-Z0-9_-]+)/;
            const urlIdToCode = new Map<string, string>();
            for (const r of allRecords) {
                const m = String(r.javdbUrl || '').match(urlIdPattern);
                if (m) urlIdToCode.set(m[1], r.id);
            }

            // 计算每个已入库影片应持有的 JavDB 清单 ID
            const videoToNewLists = new Map<string, Set<string>>();
            for (const [listId, urlIds] of listToUrlIds.entries()) {
                for (const urlId of urlIds) {
                    const code = urlIdToCode.get(urlId);
                    if (!code) continue;
                    if (!videoToNewLists.has(code)) videoToNewLists.set(code, new Set());
                    videoToNewLists.get(code)!.add(listId);
                }
            }

            // 只更新有变化的记录
            const toUpdate: VideoRecord[] = [];
            for (const record of allRecords) {
                const oldJavdb = new Set((record.listIds || []).filter(id => syncedJavdbListIds.has(id)));
                const newJavdb = videoToNewLists.get(record.id) || new Set<string>();
                const changed = oldJavdb.size !== newJavdb.size
                    || [...newJavdb].some(id => !oldJavdb.has(id))
                    || [...oldJavdb].some(id => !newJavdb.has(id));
                if (changed) {
                    const local = (record.listIds || []).filter(id => !syncedJavdbListIds.has(id));
                    record.listIds = [...local, ...Array.from(newJavdb)];
                    record.updatedAt = Date.now();
                    toUpdate.push(record);
                }
            }
            if (toUpdate.length > 0) {
                await this.sendDbMessage('DB:VIEWED_BULK_PUT', { records: toUpdate });
                updatedRecords = toUpdate.length;
                logAsync('INFO', `已更新 ${updatedRecords} 个影片的清单关联`);
            }
        } catch (e: any) {
            logAsync('WARN', '更新影片清单关联失败（不阻断同步）', { error: e?.message });
        }

        // 同步完成，清除保存的进度
        await clearSyncProgress();
        logAsync('INFO', '清单同步完成，已清除保存的进度');

        return {
            success: true,
            syncedCount,
            skippedCount,
            errorCount,
            newRecords,
            updatedRecords,
            message: `清单同步完成：${listIndex.length} 个清单，更新 ${updatedRecords} 个已入库影片的关联`
        };
    }
    /**
     * 构建清单变更详情HTML
     */
    private buildListChangeDetails(
        listsToAdd: ListRecord[],
        listsToUpdate: ListRecord[],
        listsToDelete: ListRecord[]
    ): string {
        const parts: string[] = [];
        const totalChanges = listsToAdd.length + listsToUpdate.length + listsToDelete.length;
        
        parts.push('<div class="list-sync-changes">');
        parts.push(`
            <div class="list-sync-summary">
                <span class="list-sync-summary-icon"><i class="fas fa-tasks"></i></span>
                <div>
                    <strong>即将同步 JavDB 清单变更</strong>
                    <span>共 ${totalChanges} 项清单变化，本地清单会保留。</span>
                </div>
            </div>
        `);
        
        if (listsToAdd.length > 0) {
            parts.push(`<div class="change-section add-section">`);
            parts.push(`
                <div class="change-section-header">
                    <span class="change-section-icon"><i class="fas fa-plus"></i></span>
                    <h4>新增清单</h4>
                    <span class="change-count">${listsToAdd.length}</span>
                </div>
            `);
            parts.push(`<ul class="list-items">`);
            for (const list of listsToAdd.slice(0, 5)) {
                parts.push(this.buildListChangeItem(list));
            }
            if (listsToAdd.length > 5) {
                parts.push(`<li class="list-item-more">还有 ${listsToAdd.length - 5} 个清单</li>`);
            }
            parts.push(`</ul></div>`);
        }
        
        if (listsToUpdate.length > 0) {
            parts.push(`<div class="change-section update-section">`);
            parts.push(`
                <div class="change-section-header">
                    <span class="change-section-icon"><i class="fas fa-sync-alt"></i></span>
                    <h4>更新清单</h4>
                    <span class="change-count">${listsToUpdate.length}</span>
                </div>
            `);
            parts.push(`<p class="change-section-note">刷新清单影片信息，并同步新增影片。</p>`);
            parts.push(`</div>`);
        }
        
        if (listsToDelete.length > 0) {
            parts.push(`<div class="change-section delete-section">`);
            parts.push(`
                <div class="change-section-header">
                    <span class="change-section-icon"><i class="fas fa-trash-alt"></i></span>
                    <h4>删除清单</h4>
                    <span class="change-count">${listsToDelete.length}</span>
                </div>
            `);
            parts.push(`<ul class="list-items">`);
            for (const list of listsToDelete.slice(0, 5)) {
                parts.push(this.buildListChangeItem(list));
            }
            if (listsToDelete.length > 5) {
                parts.push(`<li class="list-item-more">还有 ${listsToDelete.length - 5} 个清单</li>`);
            }
            parts.push(`</ul>`);
            parts.push(`<p class="warning-text"><i class="fas fa-exclamation-triangle"></i> 删除清单下的影片会移除清单关联。</p>`);
            parts.push(`</div>`);
        }
        
        parts.push('</div>');
        
        return parts.join('');
    }

    private buildListChangeItem(list: ListRecord): string {
        const count = list.moviesCount ?? 0;
        return `
            <li>
                <span class="list-item-name">${this.escapeHtml(list.name)}</span>
                <span class="list-item-count">${count} 部</span>
            </li>
        `;
    }

    /**
     * HTML转义
     */
    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 通知UI已获取影片
     */
    private notifyVideoFetched(videoNumber: number, videoTitle: string, isSuccess: boolean): void {
        try {
            // 发送自定义事件到UI
            const event = new CustomEvent('video-fetched', {
                detail: { videoNumber, videoTitle, isSuccess }
            });
            document.dispatchEvent(event);
        } catch (error: any) {
            // 忽略错误，不影响同步流程
        }
    }

    // ----------------------------------------------------------------
    //  系列收藏同步
    // ----------------------------------------------------------------
    private async syncUserSeries(
        userProfile: UserProfile,
        onProgress?: (progress: any) => void,
        abortSignal?: AbortSignal
    ): Promise<SyncResponseData> {
        const settings = await getSettings();
        const origin = this.getOriginFromUrl(
            String(settings?.dataSync?.urls?.wantWatch || settings?.dataSync?.urls?.watchedVideos || 'https://javdb.com')
        );
        const requestInterval = (settings.dataSync.requestInterval ?? 1) * 1000;
        const now = Date.now();
        const records: ListRecord[] = [];
        const seen = new Set<string>();

        onProgress?.({ percentage: 0, message: '准备同步收藏系列...', stage: 'preparing' });

        for (let page = 1; page <= 50; page++) {
            if (abortSignal?.aborted) throw new SyncCancelledError('同步已取消');
            const url = `${origin}/users/collection_series?page=${page}`;
            onProgress?.({ percentage: Math.min(90, page * 10), message: `正在获取系列第 ${page} 页...`, stage: 'pages' });
            const res = await this.fetchWithRetry(url, { method: 'GET', credentials: 'include' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const html = await res.text();
            const items = this.parseCollectionItemsFromHTML(html, 'series');
            if (items.length === 0) break;
            for (const it of items) {
                if (seen.has(it.id)) continue;
                seen.add(it.id);
                records.push(normalizeCollectionRecord({
                    id: it.id,
                    externalId: it.id,
                    name: it.name,
                    type: 'series',
                    source: 'javdb',
                    url: `${origin}/series/${it.id}`,
                    moviesCount: it.moviesCount,
                    createdAt: now,
                    updatedAt: now
                }));
            }
            if (page > 1) await this.delay(requestInterval);
        }

        await this.replaceCollectionListRecords('series', records);

        onProgress?.({ percentage: 100, message: '系列同步完成', stage: 'complete' });
        logAsync('INFO', `系列收藏同步完成：${records.length} 个`, { user: userProfile.username });
        return { success: true, syncedCount: records.length, skippedCount: 0, errorCount: 0, newRecords: records.length, updatedRecords: 0, message: `系列同步完成：共 ${records.length} 个` };
    }

    // ----------------------------------------------------------------
    //  番号收藏同步
    // ----------------------------------------------------------------
    private async syncUserLabels(
        userProfile: UserProfile,
        onProgress?: (progress: any) => void,
        abortSignal?: AbortSignal
    ): Promise<SyncResponseData> {
        const settings = await getSettings();
        const origin = this.getOriginFromUrl(
            String(settings?.dataSync?.urls?.wantWatch || settings?.dataSync?.urls?.watchedVideos || 'https://javdb.com')
        );
        const requestInterval = (settings.dataSync.requestInterval ?? 1) * 1000;
        const now = Date.now();
        const records: ListRecord[] = [];
        const seen = new Set<string>();

        onProgress?.({ percentage: 0, message: '准备同步收藏番号...', stage: 'preparing' });

        for (let page = 1; page <= 50; page++) {
            if (abortSignal?.aborted) throw new SyncCancelledError('同步已取消');
            const url = `${origin}/users/collection_codes?page=${page}`;
            onProgress?.({ percentage: Math.min(90, page * 10), message: `正在获取番号第 ${page} 页...`, stage: 'pages' });
            const res = await this.fetchWithRetry(url, { method: 'GET', credentials: 'include' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const html = await res.text();
            const items = this.parseCollectionItemsFromHTML(html, 'labels');
            if (items.length === 0) break;
            for (const it of items) {
                if (seen.has(it.id)) continue;
                seen.add(it.id);
                records.push(normalizeCollectionRecord({
                    id: it.id,
                    externalId: it.id,
                    name: it.name,
                    type: 'label',
                    source: 'javdb',
                    url: `${origin}/video_codes/${it.id}`,
                    moviesCount: it.moviesCount,
                    createdAt: now,
                    updatedAt: now
                }));
            }
            if (page > 1) await this.delay(requestInterval);
        }

        await this.replaceCollectionListRecords('label', records);

        onProgress?.({ percentage: 100, message: '番号同步完成', stage: 'complete' });
        logAsync('INFO', `番号收藏同步完成：${records.length} 个`, { user: userProfile.username });
        return { success: true, syncedCount: records.length, skippedCount: 0, errorCount: 0, newRecords: records.length, updatedRecords: 0, message: `番号同步完成：共 ${records.length} 个` };
    }

    private async replaceCollectionListRecords(type: CollectionListType, records: ListRecord[]): Promise<void> {
        const normalizedRecords = records.map(record => normalizeCollectionRecord(record));
        const newIdSet = new Set(normalizedRecords.map(record => record.id));
        const rawExisting = await this.sendDbMessage<{ success: true; records: ListRecord[] }>('DB:LISTS_GET_ALL', {});
        const existingRecords: ListRecord[] = ((rawExisting as any).records || []).filter((record: ListRecord) => record.type === type);

        for (const existing of existingRecords) {
            const normalizedExisting = normalizeCollectionRecord(existing);
            const rawId = String(existing.id || '');
            const shouldDelete = rawId !== normalizedExisting.id || !newIdSet.has(normalizedExisting.id);
            if (shouldDelete) {
                await this.sendDbMessage('DB:LISTS_DELETE', { id: rawId });
            }
        }

        if (normalizedRecords.length > 0) {
            await this.sendDbMessage('DB:LISTS_BULK_PUT', { records: normalizedRecords });
        }
    }

    // ----------------------------------------------------------------
    //  系列 / 番号页面 HTML 解析器
    // ----------------------------------------------------------------
    private parseCollectionItemsFromHTML(html: string, mode: 'series' | 'labels'): Array<{ id: string; name: string; moviesCount?: number }> {
        const items: Array<{ id: string; name: string; moviesCount?: number }> = [];
        try {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const hrefPattern = mode === 'series' ? /\/series\/([^/?#]+)/ : /\/video_codes\/([^/?#]+)/;
            // series IDs are JavDB internal (e.g. "eb7x"), labels are code prefixes (e.g. "MISM")
            const normalizeId = (raw: string) => mode === 'labels' ? raw.trim().toUpperCase() : raw.trim();

            // Primary: #series .box (series-eb7x) or #codes .box (code-MISM)
            const sectionSel = mode === 'series' ? '#series' : '#codes';
            const idPrefix   = mode === 'series' ? 'series-' : 'code-';
            const boxes = doc.querySelectorAll(`${sectionSel} .box`);
            if (boxes.length > 0) {
                for (const box of Array.from(boxes)) {
                    let id = box.id?.startsWith(idPrefix) ? normalizeId(box.id.slice(idPrefix.length)) : '';
                    if (!id) {
                        const a = box.querySelector('a') as HTMLAnchorElement | null;
                        const m = (a?.getAttribute('href') || '').match(hrefPattern);
                        if (!m) continue;
                        id = normalizeId(m[1]);
                    }
                    if (!id) continue;
                    const name = String(box.querySelector('strong')?.textContent || id).trim();
                    const spanText = box.querySelector('a > span')?.textContent || '';
                    const mc = spanText.match(/(\d+)/);
                    items.push({ id, name, moviesCount: mc ? Number(mc[1]) : undefined });
                }
                return items;
            }

            // Fallback: traverse anchor hrefs
            const anchors = doc.querySelectorAll(`a[href*="${mode === 'series' ? '/series/' : '/video_codes/'}"]`);
            for (const a of Array.from(anchors)) {
                const href = (a as HTMLAnchorElement).getAttribute('href') || '';
                const m = href.match(hrefPattern);
                if (!m) continue;
                const id = normalizeId(m[1]);
                const name = String(a.getAttribute('title') || a.textContent || id).trim();
                if (id) items.push({ id, name });
            }
        } catch (e) {
            logAsync('WARN', `parseCollectionItemsFromHTML(${mode}) 解析出错`, { error: String(e) });
        }
        return items;
    }
}

// 单例实例
let apiClientInstance: ApiClient | null = null;

/**
 * 获取API客户端实例
 */
export function getApiClient(): ApiClient {
    if (!apiClientInstance) {
        apiClientInstance = new ApiClient();
    }
    return apiClientInstance;
}

/**
 * 重置API客户端实例
 */
export function resetApiClient(): void {
    apiClientInstance = null;
}
