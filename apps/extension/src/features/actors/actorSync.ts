/**
 * @file actorSync.ts
 * @description actorSync
 * @module features/actors
 */
// src/features/actors/actorSync.ts
// 演员数据同步服务

import type {
    ActorRecord,
    ActorSyncConfig,
    ActorSyncProgress,
    ActorSyncResult
} from '../../types';
import { actorManager } from './actorManager';
import { getSettings } from '../../utils/storage';
import { isCloudflareChallenge } from '../../dashboard/dataSync/cloudflareVerification';

/**
 * 将 JavDB 同步拿到的演员合并到本地既有记录（纯函数，供 saveActorsToDatabase 与单测共用）。
 *
 * 手动编辑保护：本地手动改过、已记入 manuallyEditedFields 的字段（含 favorited）
 * 一律以本地值为准，同步不覆盖——与编辑弹窗锁图标「此字段已锁定，不会被自动同步覆盖」
 * 的既有契约一致；manuallyEditedFields 本身是本地概念（JavDB 侧不存在该字段），恒保留本地值。
 */
export function mergeSyncedActor(
  existingActor: ActorRecord,
  actor: ActorRecord,
  forceUpdate: boolean,
  now = Date.now(),
): ActorRecord {
  const updated: ActorRecord = {
    ...actor,
    // 根据forceUpdate决定是否强制更新性别和分类
    gender: forceUpdate ? actor.gender : (existingActor.gender !== 'unknown' ? existingActor.gender : actor.gender),
    category: forceUpdate ? actor.category : (existingActor.category !== 'unknown' ? existingActor.category : actor.category),
    // 合并别名，去重
    aliases: [...new Set([...existingActor.aliases, ...actor.aliases])],
    // 保留创建时间
    createdAt: existingActor.createdAt,
    // 更新修改时间
    updatedAt: now,
    // 保留其他详细信息
    details: existingActor.details || actor.details,
  };

  // 保留手动编辑字段清单本身（JavDB 侧永远不会下发该字段）
  if (existingActor.manuallyEditedFields) {
    updated.manuallyEditedFields = existingActor.manuallyEditedFields;
  }

  // 手动编辑过的字段不被同步覆盖
  for (const field of existingActor.manuallyEditedFields ?? []) {
    if (field === 'manuallyEditedFields') continue;
    const source = existingActor as unknown as Record<string, unknown>;
    if (field in source) {
      (updated as unknown as Record<string, unknown>)[field] = source[field];
    }
  }

  return updated;
}

export class ActorSyncService {
    private abortController: AbortController | null = null;
    private isRunning = false;

    /**
     * 开始同步演员数据
     */
    async syncActors(
        type: 'full' | 'incremental' = 'full',
        onProgress?: (progress: ActorSyncProgress) => void,
        forceUpdate: boolean = false
    ): Promise<ActorSyncResult> {
        if (this.isRunning) {
            throw new Error('演员同步正在进行中，请等待完成');
        }

        this.isRunning = true;
        this.abortController = new AbortController();

        const startTime = Date.now();
        const result: ActorSyncResult = {
            success: false,
            syncedCount: 0,
            skippedCount: 0,
            errorCount: 0,
            newActors: 0,
            updatedActors: 0,
            errors: [],
            duration: 0
        };

        try {
            const settings = await getSettings();
            const config = settings.actorSync;

            if (!config.enabled) {
                throw new Error('演员同步功能未启用，请在设置中启用演员同步功能');
            }

            // 使用优化的方法：逐页解析并保存演员信息
            onProgress?.({
                stage: 'pages',
                current: 0,
                total: 0, // 未知总量
                percentage: 0,
                message: '正在获取收藏演员列表...',
                stats: {
                    currentPage: 0,
                    totalProcessed: 0,
                    newActors: 0,
                    updatedActors: 0,
                    skippedActors: 0
                }
            });

            const syncResults = await this.fetchAndSaveActorsPaginated(config, type, onProgress, forceUpdate);

            if (syncResults.synced === 0 && syncResults.newActors === 0 && syncResults.updatedActors === 0) {
                onProgress?.({
                    stage: 'complete',
                    current: 0,
                    total: 0,
                    percentage: 100,
                    message: '未找到收藏演员',
                    stats: {
                        currentPage: 0,
                        totalProcessed: 0,
                        newActors: 0,
                        updatedActors: 0,
                        skippedActors: 0
                    }
                });

                result.success = true;
                result.duration = Date.now() - startTime;
                return result;
            }

            result.syncedCount = syncResults.synced;
            result.skippedCount = syncResults.skipped;
            result.errorCount = syncResults.errors.length;
            result.newActors = syncResults.newActors;
            result.updatedActors = syncResults.updatedActors;
            result.errors = syncResults.errors;
            result.success = true;
            result.duration = Date.now() - startTime;

            onProgress?.({
                stage: 'complete',
                current: result.syncedCount,
                total: result.syncedCount,
                percentage: 100,
                message: `演员同步完成：新增 ${result.newActors}，更新 ${result.updatedActors}`,
                stats: {
                    currentPage: 0,
                    totalProcessed: result.syncedCount,
                    newActors: result.newActors,
                    updatedActors: result.updatedActors,
                    skippedActors: result.skippedCount
                }
            });

            console.log('演员同步完成:', result);
            return result;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '未知错误';
            result.errors.push(errorMessage);
            result.success = false;

            onProgress?.({
                stage: 'error',
                current: 0,
                total: 0,
                percentage: 0,
                message: `同步失败：${errorMessage}`,
                errors: result.errors
            });
        } finally {
            result.duration = Date.now() - startTime;
            this.isRunning = false;
            this.abortController = null;
        }

        return result;
    }

    /**
     * 从收藏演员列表HTML直接解析演员信息
     * 这样可以避免为每个演员单独请求详情页面，提高同步效率
     */
    private async parseActorsFromCollectionHtml(html: string): Promise<ActorRecord[]> {
        const actors: ActorRecord[] = [];
        const now = Date.now();

        console.log('开始解析收藏演员列表，HTML长度:', html.length);

        // 匹配演员卡片的正则表达式
        const actorBoxRegex = /<div[^>]*class="[^"]*actor-box[^"]*"[^>]*id="actor-([^"]+)"[^>]*>([\s\S]*?)<\/div>/g;
        let match: RegExpExecArray | null;

        while ((match = actorBoxRegex.exec(html)) !== null) {
            const actorId = match[1];
            const actorHtml = match[2];

            try {
                // 解析演员链接和基本信息
                const linkMatch = actorHtml.match(/<a[^>]*href="\/actors\/[^"]*"[^>]*title="([^"]*)"[^>]*>/);
                if (!linkMatch) continue;

                const titleContent = linkMatch[1];

                // 解析名称和别名
                // title可能包含多个名称，用逗号分隔
                const names = titleContent.split(',').map(name => name.trim()).filter(name => name);
                if (names.length === 0) continue;

                const primaryName = names[0];
                const aliases = names.slice(1);

                // 解析头像URL - 支持多种属性顺序
                let avatarUrl: string | undefined;

                // 尝试多种匹配模式，支持不同的属性顺序
                const avatarPatterns = [
                    /<img[^>]*class="[^"]*avatar[^"]*"[^>]*src="([^"]+)"/,
                    /<img[^>]*src="([^"]+)"[^>]*class="[^"]*avatar[^"]*"/,
                    /<img[^>]*class="[^"]*avatar[^"]*"[^>]*>/,
                ];

                for (const pattern of avatarPatterns) {
                    const m = actorHtml.match(pattern);
                    if (m) {
                        if (m[1]) {
                            avatarUrl = m[1];
                            break;
                        } else {
                            const imgTag = m[0];
                            const srcMatch = imgTag.match(/src="([^"]+)"/);
                            if (srcMatch) {
                                avatarUrl = srcMatch[1];
                                break;
                            }
                        }
                    }
                }

                // 解析显示名称（从strong标签）
                const strongMatch = actorHtml.match(/<strong[^>]*>([^<]+)<\/strong>/);
                const displayName = strongMatch ? strongMatch[1].trim() : primaryName;

                // 创建演员记录
                // 注意：profileUrl 始终使用 javdb.com 作为持久化存储的域名
                // 显示时会通过 RouteManager 动态替换为当前选择的线路
                const actor: ActorRecord = {
                    id: actorId,
                    name: displayName || primaryName,
                    aliases: aliases,
                    gender: 'unknown',
                    category: 'unknown',
                    avatarUrl: this.isValidAvatarUrl(avatarUrl) ? avatarUrl : undefined,
                    profileUrl: `https://javdb.com/actors/${actorId}`,
                    createdAt: now,
                    updatedAt: now,
                    syncInfo: {
                        source: 'javdb',
                        lastSyncAt: now,
                        syncStatus: 'success'
                    }
                };

                actors.push(actor);

            } catch (error) {
                console.error(`解析演员 ${actorId} 失败:`, error);
            }
        }

        console.log(`从收藏列表解析完成，找到 ${actors.length} 个演员`);
        return actors;
    }

    /**
     * 判断是否应该跳过演员（增量同步）
     */
    private shouldSkipActor(actor: ActorRecord): boolean {
        const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
        return actor.syncInfo?.lastSyncAt ? actor.syncInfo.lastSyncAt > dayAgo : false;
    }

    /**
     * 取消正在进行的同步
     */
    cancelSync(): void {
        if (this.abortController) {
            this.abortController.abort();
        }
        this.isRunning = false;
    }

    /**
     * 检查是否正在同步
     */
    isSync(): boolean {
        return this.isRunning;
    }

    /**
     * 获取演员列表页面
     */


    /**
     * 分页获取并保存演员信息
     * 逐页解析并立即保存，支持未知总量的进度显示
     */
    private async fetchAndSaveActorsPaginated(
        config: ActorSyncConfig,
        syncType: 'full' | 'incremental',
        onProgress?: (progress: ActorSyncProgress) => void,
        forceUpdate: boolean = false
    ): Promise<{
        synced: number;
        skipped: number;
        newActors: number;
        updatedActors: number;
        errors: string[];
    }> {
        const result = {
            synced: 0,
            skipped: 0,
            newActors: 0,
            updatedActors: 0,
            errors: [] as string[]
        };

        let totalProcessed = 0;
        const seenActorIds = new Set<string>(); // 用于检测重复

        // 定义所有需要同步的分类URL（包含性别和分类信息）
        const actorCategories = [
            { g: 0, t: 0, gender: 'female', category: 'censored', displayName: '有码女优' },
            { g: 1, t: 0, gender: 'male', category: 'censored', displayName: '有码男优' },
            { g: 0, t: 1, gender: 'female', category: 'uncensored', displayName: '无码女优' },
            { g: 1, t: 1, gender: 'male', category: 'uncensored', displayName: '无码男优' },
            { g: 0, t: 2, gender: 'female', category: 'western', displayName: '欧美女优' },
            { g: 1, t: 2, gender: 'male', category: 'western', displayName: '欧美男优' }
        ];

        // 遍历所有分类
        for (const category of actorCategories) {
            if (this.abortController?.signal.aborted) break;

            console.log(`开始同步 ${category.displayName}...`);

            let categoryPage = 1;
            let categoryHasMore = true;

            while (categoryHasMore && !this.abortController?.signal.aborted) {
                try {
                    // 构建带分类参数的URL
                    const baseUrl = config.urls?.collectionActors || '';
                    const params = new URLSearchParams();
                    params.set('g', category.g.toString());
                    params.set('t', category.t.toString());
                    if (categoryPage > 1) {
                        params.set('page', categoryPage.toString());
                    }
                    const url = `${baseUrl}?${params.toString()}`;

                    onProgress?.({
                        stage: 'pages',
                        current: totalProcessed,
                        total: 0, // 未知总量
                        percentage: 0, // 不使用百分比
                        message: `正在获取 ${category.displayName} 第 ${categoryPage} 页...`,
                        stats: {
                            currentPage: categoryPage,
                            totalProcessed: totalProcessed,
                            newActors: result.newActors,
                            updatedActors: result.updatedActors,
                            skippedActors: result.skipped
                        }
                    });

                    console.log(`正在获取第 ${categoryPage} 页: ${url}`);

                    const response = await fetch(url, {
                        signal: this.abortController?.signal
                    });

                    if (!response.ok) {
                        const errorMsg = `HTTP ${response.status}，${category.displayName} 同步中断`;
                        result.errors.push(errorMsg);
                        onProgress?.({
                            stage: 'error',
                            current: totalProcessed,
                            total: 0,
                            percentage: 0,
                            message: errorMsg,
                            errors: [errorMsg],
                        });
                        categoryHasMore = false;
                        break;
                    }

                    const html = await response.text();

                    // Cloudflare 拦截检测：遇到验证页面立即终止当前分类，不写入脏数据
                    if (isCloudflareChallenge(html)) {
                        const errorMsg = `检测到 Cloudflare 人机验证，${category.displayName} 同步中断`;
                        result.errors.push(errorMsg);
                        onProgress?.({
                            stage: 'error',
                            current: totalProcessed,
                            total: 0,
                            percentage: 0,
                            message: errorMsg,
                            errors: [errorMsg],
                        });
                        categoryHasMore = false;
                        break;
                    }

                    const pageActors = await this.parseActorsFromCollectionHtml(html);

                    console.log(`${category.displayName} 第 ${categoryPage} 页解析到 ${pageActors.length} 个演员`);

                    if (pageActors.length === 0) {
                        console.log(`${category.displayName} 第 ${categoryPage} 页没有找到演员，停止获取此分类`);
                        categoryHasMore = false;
                        break;
                    }

                    // 为演员设置正确的性别和分类信息
                    const pageActorsWithCategory = pageActors.map((actor: ActorRecord) => ({
                        ...actor,
                        gender: category.gender as 'male' | 'female',
                        category: category.category as 'censored' | 'uncensored' | 'western'
                    }));

                    // 检查是否有重复的演员ID（说明到了最后一页或循环）
                    let newActorsInPage = 0;
                    const pageActorsToSave: ActorRecord[] = [];

                    for (const a of pageActorsWithCategory) {
                        if (!seenActorIds.has(a.id)) {
                            seenActorIds.add(a.id);
                            pageActorsToSave.push(a);
                            newActorsInPage++;
                        }
                    }

                    if (newActorsInPage === 0) {
                        console.log(`${category.displayName} 第 ${categoryPage} 页所有演员都已处理过，停止获取此分类`);
                        categoryHasMore = false;
                        break;
                    }

                    // 立即保存这一页的演员
                    onProgress?.({
                        stage: 'details',
                        current: totalProcessed,
                        total: 0, // 未知总量
                        percentage: 0, // 不使用百分比
                        message: `正在保存 ${category.displayName} 第 ${categoryPage} 页的 ${pageActorsToSave.length} 个演员...`,
                        stats: {
                            currentPage: categoryPage,
                            totalProcessed: totalProcessed,
                            newActors: result.newActors,
                            updatedActors: result.updatedActors,
                            skippedActors: result.skipped,
                            currentPageActors: pageActorsToSave.length
                        }
                    });

                    const pageResult = await this.saveActorsToDatabase(
                        pageActorsToSave,
                        syncType,
                        (progress) => {
                            // 转发保存进度，但调整消息和统计
                            onProgress?.({
                                ...progress,
                                percentage: 0, // 不使用百分比
                                message: `${category.displayName} 第 ${categoryPage} 页：${progress.message}`,
                                stats: {
                                    currentPage: categoryPage,
                                    totalProcessed: totalProcessed + (progress.current || 0),
                                    newActors: result.newActors,
                                    updatedActors: result.updatedActors,
                                    skippedActors: result.skipped,
                                    currentPageActors: pageActorsToSave.length,
                                    currentPageProgress: progress.current || 0,
                                    currentPageTotal: progress.total || pageActorsToSave.length
                                }
                            });
                        },
                        forceUpdate
                    );

                    // 累计结果
                    result.synced += pageResult.synced;
                    result.skipped += pageResult.skipped;
                    result.newActors += pageResult.newActors;
                    result.updatedActors += pageResult.updatedActors;
                    result.errors.push(...pageResult.errors);

                    totalProcessed += pageActorsToSave.length;

                    console.log(`${category.displayName} 第 ${categoryPage} 页保存完成：新增 ${pageResult.newActors}，更新 ${pageResult.updatedActors}`);

                    // 如果这一页的新演员数量少于预期，可能是最后一页
                    if (newActorsInPage < pageActorsWithCategory.length * 0.8) {
                        console.log(`${category.displayName} 第 ${categoryPage} 页新演员比例较低，可能接近结束`);
                    }

                    categoryPage++;

                    // 请求间隔
                    if (categoryHasMore) {
                        await this.delay((config.requestInterval ?? 3) * 1000);
                    }

                } catch (error) {
                    if (error instanceof Error && error.name === 'AbortError') {
                        throw new Error('同步已取消');
                    }

                    const errorMsg = `获取 ${category.displayName} 第 ${categoryPage} 页失败：${error instanceof Error ? error.message : '未知错误'}`;
                    result.errors.push(errorMsg);
                    console.error(errorMsg);

                    // 如果连续失败，停止同步
                    if (result.errors.length >= (config.maxRetries ?? 3)) {
                        throw new Error('连续失败次数过多，停止同步');
                    }

                    // 继续下一页
                    categoryPage++;
                }
            }

            console.log(`${category.displayName} 同步完成`);
        }

        return result;
    }



    /**
     * 保存演员数据到数据库
     */
    private async saveActorsToDatabase(
        actors: ActorRecord[],
        syncType: 'full' | 'incremental',
        onProgress?: (progress: ActorSyncProgress) => void,
        forceUpdate: boolean = false
    ): Promise<{
        synced: number;
        skipped: number;
        newActors: number;
        updatedActors: number;
        errors: string[];
    }> {
        const result = {
            synced: 0,
            skipped: 0,
            newActors: 0,
            updatedActors: 0,
            errors: [] as string[]
        };

        for (let i = 0; i < actors.length; i++) {
            if (this.abortController?.signal.aborted) {
                throw new Error('同步已取消');
            }

            const actor = actors[i];

            onProgress?.({
                stage: 'details',
                current: i + 1,
                total: actors.length,
                percentage: Math.round((i + 1) / actors.length * 100),
                message: `正在保存演员 ${i + 1}/${actors.length}: ${actor.name}...`
            });

            try {
                // 检查是否需要跳过（增量同步）
                if (syncType === 'incremental') {
                    const existingActor = await actorManager.getActorById(actor.id);
                    if (existingActor && this.shouldSkipActor(existingActor)) {
                        result.skipped++;
                        continue;
                    }
                }

                const existingActor = await actorManager.getActorById(actor.id);

                if (existingActor) {
                    // 根据forceUpdate参数决定更新策略（合并 + 手动编辑字段保护见 mergeSyncedActor）
                    const oldGender = existingActor.gender;
                    const oldCategory = existingActor.category;

                    const updatedActor = mergeSyncedActor(existingActor, actor, forceUpdate);

                    await actorManager.saveActor(updatedActor);
                    result.updatedActors++;

                    // 记录性别和分类的更新情况
                    const genderChanged = oldGender !== updatedActor.gender;
                    const categoryChanged = oldCategory !== updatedActor.category;

                    if (forceUpdate && (genderChanged || categoryChanged)) {
                        console.log(`强制更新演员 ${actor.name} (${actor.id}): 性别 ${oldGender} → ${updatedActor.gender}, 分类 ${oldCategory} → ${updatedActor.category}`);
                    } else if (genderChanged || categoryChanged) {
                        console.log(`更新演员 ${actor.name} (${actor.id}): 性别 ${oldGender} → ${updatedActor.gender}, 分类 ${oldCategory} → ${updatedActor.category}`);
                    } else {
                        console.log(`更新演员 ${actor.name} (${actor.id}): 性别和分类无变化`);
                    }
                } else {
                    // 新演员直接保存
                    await actorManager.saveActor(actor);
                    result.newActors++;

                    console.log(`新增演员成功: ${actor.name} (${actor.id})`);
                }
                result.synced++;

                console.log(`保存演员成功: ${actor.name} (${actor.id})`);

            } catch (error) {
                const errorMsg = `演员 ${actor.name} (${actor.id}): ${error instanceof Error ? error.message : '未知错误'}`;
                result.errors.push(errorMsg);
                console.error(errorMsg);
            }

            // 批量处理间隔
            if ((i + 1) % 10 === 0) {
                await this.delay(100); // 每10个演员暂停100ms
            }
        }

        return result;
    }

    /**
     * 检查头像URL是否有效（不是默认头像）
     */
    private isValidAvatarUrl(avatarUrl: string | undefined): boolean {
        if (!avatarUrl) return false;

        // 检查是否为默认头像的各种变体
        const defaultAvatarPatterns = [
            'actor_unknow.jpg',      // 原始默认头像
            'actor_unknown.jpg',     // 可能的拼写变体
            'actor_default.jpg',     // 可能的默认头像
            'default_avatar.jpg',    // 通用默认头像
            'no_avatar.jpg',         // 无头像标识
            'placeholder.jpg',       // 占位符图片
            '/images/actor_unknow',  // 路径匹配
            '/images/default',       // 默认图片路径
            'data:image/svg+xml',    // SVG占位符
        ];

        // 检查URL是否包含任何默认头像模式
        const lowerUrl = avatarUrl.toLowerCase();
        for (const pattern of defaultAvatarPatterns) {
            if (lowerUrl.includes(pattern.toLowerCase())) {
                return false;
            }
        }

        // 检查是否为有效的图片URL
        try {
            const url = new URL(avatarUrl);
            // 检查是否为图片文件扩展名
            const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
            const pathname = url.pathname.toLowerCase();
            const hasImageExtension = imageExtensions.some(ext => pathname.endsWith(ext));

            // 如果没有明确的图片扩展名，但URL看起来像图片服务，也认为有效
            const imageServicePatterns = [
                'jdbstatic.com/avatars/',
                'images.javdb.com/',
                'cdn.javdb.com/',
                '/avatars/',
                '/images/actors/'
            ];

            const hasImageService = imageServicePatterns.some(pattern =>
                avatarUrl.toLowerCase().includes(pattern)
            );

            return hasImageExtension || hasImageService;

        } catch (error) {
            // 如果URL解析失败，认为无效
            return false;
        }
    }

    /**
     * 延迟函数
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// 单例实例
export const actorSyncService = new ActorSyncService();
