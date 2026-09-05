/**
 * @file collector.ts
 * @description collector
 * @module features/newWorks
 */
// src/features/newWorks/collector.ts
// 新作品采集服务

import type {
    ActorSubscription,
    NewWorksGlobalConfig,
    NewWorkRecord
} from './types';
import type { VideoRecord } from '../../types';
import type { KeywordFilterRule } from '../../types';
import { viewedGetAll, newWorksGet } from '../../platform/storage/indexedDb';
import { buildJavDBUrl } from '../routeManagement';
import { getSettings } from '../../utils/storage';

export class NewWorksCollector {
    private readonly BASE_DELAY = 3000; // 基础延迟3秒

    /**
     * 构建演员作品页面URL，应用类别筛选
     */
    private async buildActorWorksUrl(actorId: string, categoryFilters?: string[]): Promise<string> {
        let url = await buildJavDBUrl(`/actors/${actorId}`);
        
        // 如果有类别筛选，添加到URL参数
        // JavDB格式: ?t=s,d&sort_type=0 (用逗号分隔)
        if (categoryFilters && categoryFilters.length > 0) {
            const filterParam = categoryFilters.join(',');
            url += `?t=${filterParam}&sort_type=0`;
            console.log(`[CS] 应用类别筛选: t=${filterParam}`);
        } else {
            console.log(`[CS] 未应用类别筛选（显示所有类别）`);
        }
        
        return url;
    }

    /**
     * 检查单个演员的新作品
     */
    async checkActorNewWorks(
        subscription: ActorSubscription,
        globalConfig: NewWorksGlobalConfig
    ): Promise<NewWorkRecord[]> {
        try {
            console.log(`开始检查演员 ${subscription.actorName} 的新作品`);
            
            // 构建演员作品页面URL，应用类别筛选
            const actorWorksUrl = await this.buildActorWorksUrl(subscription.actorId, globalConfig.filters.categoryFilters);
            
            // 获取演员作品页面数据
            const works = await this.parseActorWorksPage(actorWorksUrl, globalConfig);
            
            // 应用全局过滤条件
            const filteredWorks = await this.applyGlobalFilters(works, globalConfig.filters);
            
            // 转换为NewWorkRecord格式
            const newWorks: NewWorkRecord[] = [];
            const now = Date.now();
            
            for (const work of filteredWorks.slice(0, globalConfig.maxWorksPerCheck)) {
                // 检查是否已存在
                const exists = await this.checkWorkExists(work.id);
                if (!exists) {
                    newWorks.push({
                        id: work.id,
                        actorId: subscription.actorId,
                        actorName: subscription.actorName,
                        title: work.title,
                        releaseDate: work.releaseDate,
                        javdbUrl: work.url,
                        coverImage: work.coverImage,
                        tags: work.tags || [],
                        discoveredAt: now,
                        isRead: false,
                        status: 'new'
                    });
                }
            }
            
            console.log(`演员 ${subscription.actorName} 发现 ${newWorks.length} 个新作品`);
            return newWorks;
            
        } catch (error) {
            console.error(`检查演员 ${subscription.actorName} 新作品失败:`, error);
            return [];
        }
    }

    /**
     * 解析演员作品页面
     */
    private async parseActorWorksPage(actorUrl: string, globalConfig: NewWorksGlobalConfig): Promise<any[]> {
        try {
            console.log(`[ACTOR] 正在请求演员作品页面: ${actorUrl}`);

            // 添加延迟以避免频繁请求
            await this.delay(this.BASE_DELAY);

            // 使用传入的全局配置确定时间过滤范围
            const dateThreshold = this.calculateDateThreshold(globalConfig.filters.dateRange);

            // 分页解析作品，遇到超出时间范围的作品时停止
            const works = await this.parseActorWorksWithPagination(actorUrl, dateThreshold);
            console.log(`[CS] 解析到 ${works.length} 个作品`);

            return works;
            
        } catch (error) {
            console.error('[CS] 解析演员作品页面失败:', error);

            // 提供更详细的错误信息
            if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
                console.error('[CS] 网络请求失败，可能的原因:');
                console.error('[CS] 1. 网络连接问题');
                console.error('[CS] 2. CORS 跨域限制');
                console.error('[CS] 3. JavDB 网站访问限制');
                console.error('[CS] 4. 扩展权限不足');

                // 检查扩展是否有访问 JavDB 的权限
                if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
                    const manifest = chrome.runtime.getManifest();
                    const permissions = manifest.permissions || [];
                    const hostPermissions = manifest.host_permissions || [];
                    console.log('[CS] 扩展权限:', permissions);
                    console.log('[CS] 主机权限:', hostPermissions);
                }
            }

            return [];
        }
    }

    /**
     * 应用全局过滤条件
     */
    private async applyGlobalFilters(
        works: any[],
        filters: NewWorksGlobalConfig['filters']
    ): Promise<any[]> {
        console.log(`开始应用过滤条件，原始作品数量: ${works.length}`);
        console.log('过滤设置:', filters);

        const filteredWorks: any[] = [];
        let filteredCount = {
            dateRange: 0,
            viewed: 0,
            browsed: 0,
            want: 0,
            ar: 0
        };

        // 使用 IndexedDB 番号库做状态检查（更准确）
        let recordMap = new Map<string, VideoRecord>();
        try {
            const all = await viewedGetAll();
            for (const r of all) { if (r?.id) recordMap.set(r.id, r); }
            console.log(`IDB 番号库记录数量: ${recordMap.size}`);
        } catch (e) {
            console.warn('读取 IDB 番号库失败，过滤将退化为不过滤已看/已浏览/想看', e);
        }

        // 加载智能内容过滤隐藏规则
        let hideRules: KeywordFilterRule[] = [];
        if (filters.applyContentFilter) {
            try {
                const settings = await getSettings();
                hideRules = (settings.contentFilter?.keywordRules || []).filter(
                    (r: KeywordFilterRule) => r.enabled && r.action === 'hide'
                );
            } catch {}
        }

        // 计算日期范围
        let dateThreshold: Date | null = null;
        if (filters.dateRange > 0) {
            dateThreshold = new Date();
            dateThreshold.setMonth(dateThreshold.getMonth() - filters.dateRange);
            console.log(`日期过滤阈值: ${dateThreshold.toISOString()}`);
        }

        for (const work of works) {
            let shouldExclude = false;
            let excludeReason = '';

            // 检查日期范围
            if (dateThreshold && work.releaseDate) {
                const releaseDate = new Date(work.releaseDate);
                if (releaseDate < dateThreshold) {
                    shouldExclude = true;
                    excludeReason = 'dateRange';
                    filteredCount.dateRange++;
                }
            }

            // 检查AR影片（通过标题判断）
            if (!shouldExclude && filters.excludeAR) {
                const title = work.title || '';
                if (/\bAR\b/.test(title)) {
                    shouldExclude = true;
                    excludeReason = 'ar';
                    filteredCount.ar++;
                }
            }

            // 应用智能内容过滤隐藏规则
            if (!shouldExclude && hideRules.length > 0) {
                shouldExclude = this.matchesHideRules(work, hideRules);
                if (shouldExclude) excludeReason = 'contentFilter';
            }

            // 检查番号库状态
            if (!shouldExclude) {
                const localRecord = recordMap.get(work.id);
                if (localRecord) {
                    if (filters.excludeViewed && localRecord.status === 'viewed') {
                        shouldExclude = true;
                        excludeReason = 'viewed';
                        filteredCount.viewed++;
                    } else if (filters.excludeBrowsed && localRecord.status === 'browsed') {
                        shouldExclude = true;
                        excludeReason = 'browsed';
                        filteredCount.browsed++;
                    } else if (filters.excludeWant && localRecord.status === 'want') {
                        shouldExclude = true;
                        excludeReason = 'want';
                        filteredCount.want++;
                    }
                }
            }

            if (!shouldExclude) {
                filteredWorks.push(work);
            } else {
                console.log(`过滤掉作品 ${work.id} (${work.title})，原因: ${excludeReason}`);
            }
        }

        console.log('过滤统计:', filteredCount);
        console.log(`过滤后作品数量: ${filteredWorks.length}`);

        return filteredWorks;
    }

    /**
     * 检查作品是否匹配内容过滤隐藏规则
     */
    private matchesHideRules(work: any, rules: KeywordFilterRule[]): boolean {
        for (const rule of rules) {
            const keyword = rule.keyword || '';
            if (!keyword) continue;
            const fields = rule.fields && rule.fields.length > 0 ? rule.fields : ['title'];
            const candidates: string[] = [];
            if (fields.includes('title')) candidates.push(work.title || '');
            if (fields.includes('video-id')) candidates.push(work.id || '');
            if (fields.includes('actor')) candidates.push(work.actorName || '');
            if (fields.includes('tag') && Array.isArray(work.tags)) candidates.push(...work.tags);
            for (const text of candidates) {
                try {
                    const pattern = rule.isRegex
                        ? new RegExp(keyword, rule.caseSensitive ? '' : 'i')
                        : new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), rule.caseSensitive ? '' : 'i');
                    if (pattern.test(text)) return true;
                } catch {}
            }
        }
        return false;
    }

    /**
     * 应用全局过滤条件（返回过滤统计）
     */
    private async applyGlobalFiltersWithStats(
        works: any[],
        filters: NewWorksGlobalConfig['filters']
    ): Promise<{ filteredWorks: any[]; filteredCount: { dateRange: number; viewed: number; browsed: number; want: number; ar: number } }> {
        console.log(`[CS] 开始应用过滤条件(带统计)，原始作品数量: ${works.length}`);
        console.log('[SETTINGS] 过滤设置:', filters);

        const filteredWorks: any[] = [];
        const filteredCount = {
            dateRange: 0,
            viewed: 0,
            browsed: 0,
            want: 0,
            ar: 0
        };

        // 使用 IndexedDB 番号库做状态检查（更准确）
        let recordMap = new Map<string, VideoRecord>();
        try {
            const all = await viewedGetAll();
            for (const r of all) { if (r?.id) recordMap.set(r.id, r); }
            console.log(`[CS] IDB 番号库记录数量: ${recordMap.size}`);
        } catch (e) {
            console.warn('[CS] 读取 IDB 番号库失败，过滤将退化为不过滤已看/已浏览/想看', e);
            // 留空 recordMap 相当于不触发状态过滤
        }

        // 加载智能内容过滤隐藏规则
        let hideRules: KeywordFilterRule[] = [];
        if (filters.applyContentFilter) {
            try {
                const settings = await getSettings();
                hideRules = (settings.contentFilter?.keywordRules || []).filter(
                    (r: KeywordFilterRule) => r.enabled && r.action === 'hide'
                );
            } catch {}
        }

        // 计算日期范围
        let dateThreshold: Date | null = null;
        if (filters.dateRange > 0) {
            dateThreshold = new Date();
            dateThreshold.setMonth(dateThreshold.getMonth() - filters.dateRange);
            console.log(`[CS] 日期过滤阈值: ${dateThreshold.toISOString()}`);
        }

        for (const work of works) {
            let shouldExclude = false;
            let excludeReason: keyof typeof filteredCount | '' = '';

            // 检查日期范围
            if (dateThreshold && work.releaseDate) {
                const releaseDate = new Date(work.releaseDate);
                if (releaseDate < dateThreshold) {
                    shouldExclude = true;
                    excludeReason = 'dateRange';
                }
            }

            // 检查AR影片（通过标题判断）
            if (!shouldExclude && filters.excludeAR) {
                const title = work.title || '';
                // 精确匹配独立的 "AR" 词（大写），避免误匹配含 "ar" 的普通单词
                if (/\bAR\b/.test(title)) {
                    shouldExclude = true;
                    excludeReason = 'ar';
                    console.log(`[AR-FILTER] 作品 ${work.id} (${work.title}) -> 排除原因: AR影片`);
                }
            }

            // 应用智能内容过滤隐藏规则
            if (!shouldExclude && hideRules.length > 0) {
                if (this.matchesHideRules(work, hideRules)) {
                    shouldExclude = true;
                    console.log(`[CS] 作品 ${work.id} (${work.title}) -> 排除原因: 内容过滤规则`);
                }
            }

            // 检查番号库状态
            if (!shouldExclude) {
                const localRecord = recordMap.get(work.id);
                if (localRecord) {
                    console.log(`[CS] 作品 ${work.id} 在番号库中找到，状态: ${localRecord.status}，过滤设置: viewed=${filters.excludeViewed}, browsed=${filters.excludeBrowsed}, want=${filters.excludeWant}`);
                    
                    if (filters.excludeViewed && localRecord.status === 'viewed') {
                        shouldExclude = true;
                        excludeReason = 'viewed';
                        console.log(`[CS]   -> 排除原因: 已看过`);
                    } else if (filters.excludeBrowsed && localRecord.status === 'browsed') {
                        shouldExclude = true;
                        excludeReason = 'browsed';
                        console.log(`[CS]   -> 排除原因: 已浏览`);
                    } else if (filters.excludeWant && localRecord.status === 'want') {
                        shouldExclude = true;
                        excludeReason = 'want';
                        console.log(`[CS]   -> 排除原因: 想看`);
                    } else {
                        console.log(`[CS]   -> 不排除（状态不匹配或未启用对应过滤）`);
                    }
                } else {
                    console.log(`[CS] 作品 ${work.id} 不在番号库中，不过滤`);
                }
            }

            if (!shouldExclude) {
                filteredWorks.push(work);
            } else {
                if (excludeReason) (filteredCount as any)[excludeReason]++;
            }
        }

        console.log('[CS] 过滤统计(带统计):', filteredCount);
        console.log(`[CS] 过滤后作品数量: ${filteredWorks.length}`);

        return { filteredWorks, filteredCount };
    }

    /**
     * 检查单个演员的新作品（返回详细统计）
     */
    async checkActorNewWorksDetailed(
        subscription: ActorSubscription,
        globalConfig: NewWorksGlobalConfig
    ): Promise<{ works: NewWorkRecord[]; identified: number; effective: number; filteredOut: number; existingCount: number; filterBreakdown: { dateRange: number; viewed: number; browsed: number; want: number; ar: number } }> {
        try {
            console.log(`[ACTOR] 开始(详细)检查演员 ${subscription.actorName} 的新作品`);

            const actorWorksUrl = await this.buildActorWorksUrl(subscription.actorId, globalConfig.filters.categoryFilters);
            const worksRaw = await this.parseActorWorksPage(actorWorksUrl, globalConfig);
            const identified = worksRaw.length;

            const { filteredWorks, filteredCount } = await this.applyGlobalFiltersWithStats(worksRaw, globalConfig.filters);
            const effective = filteredWorks.length;
            const filteredOut = Math.max(0, identified - effective);

            const newWorks: NewWorkRecord[] = [];
            let existingCount = 0;
            const now = Date.now();
            console.log(`[NEWWORKS] 开始检查 ${filteredWorks.length} 个过滤后的作品是否已存在`);
            for (const work of filteredWorks.slice(0, globalConfig.maxWorksPerCheck)) {
                const exists = await this.checkWorkExists(work.id);
                console.log(`[NEWWORKS] 作品 ${work.id} (${work.title}) 存在性检查: ${exists ? '已存在' : '新作品'}`);
                if (!exists) {
                    newWorks.push({
                        id: work.id,
                        actorId: subscription.actorId,
                        actorName: subscription.actorName,
                        title: work.title,
                        releaseDate: work.releaseDate,
                        javdbUrl: work.url,
                        coverImage: work.coverImage,
                        tags: work.tags || [],
                        discoveredAt: now,
                        isRead: false,
                        status: 'new'
                    });
                } else {
                    existingCount++;
                }
            }
            console.log(`[NEWWORKS] 检查完成，发现 ${newWorks.length} 个新作品`);

            return {
                works: newWorks,
                identified,
                effective,
                filteredOut,
                existingCount,
                filterBreakdown: filteredCount
            };
        } catch (error) {
            console.error(`[ACTOR] (详细)检查演员 ${subscription.actorName} 新作品失败:`, error);
            return {
                works: [],
                identified: 0,
                effective: 0,
                filteredOut: 0,
                existingCount: 0,
                filterBreakdown: { dateRange: 0, viewed: 0, browsed: 0, want: 0, ar: 0 }
            };
        }
    }

    /**
     * 检查作品是否已存在于新作品记录中
     */
    private async checkWorkExists(workId: string): Promise<boolean> {
        try {
            const existing = await newWorksGet(workId);
            return !!existing;
        } catch (error) {
            console.error('检查作品存在性失败:', error);
            return false;
        }
    }

    

    /**
     * 分页解析演员作品，遇到超出时间范围的作品时停止
     */
    private async parseActorWorksWithPagination(baseUrl: string, dateThreshold: Date | null): Promise<any[]> {
        const allWorks: any[] = [];
        let currentPage = 1;
        let shouldContinue = true;

        console.log(`[ACTOR] 开始分页解析演员作品，时间阈值: ${dateThreshold?.toISOString() || '无限制'}`);

        while (shouldContinue) {
            // 构建分页URL，保留已有的查询参数
            let pageUrl: string;
            if (currentPage === 1) {
                pageUrl = baseUrl;
            } else {
                // 检查baseUrl是否已有查询参数
                const separator = baseUrl.includes('?') ? '&' : '?';
                pageUrl = `${baseUrl}${separator}page=${currentPage}`;
            }
            
            console.log(`[ACTOR] 解析第 ${currentPage} 页: ${pageUrl}`);

            try {
                const pageWorks = await this.parseActorWorksInTab(pageUrl);

                if (pageWorks.length === 0) {
                    console.log(`[ACTOR] 第 ${currentPage} 页没有作品，停止解析`);
                    break;
                }

                // 检查是否有超出时间范围的作品
                let hasOldWorks = false;
                for (const work of pageWorks) {
                    if (dateThreshold && work.releaseDate) {
                        const releaseDate = new Date(work.releaseDate);
                        if (releaseDate < dateThreshold) {
                            console.log(`[ACTOR] 发现超出时间范围的作品: ${work.id} (${work.releaseDate})，停止解析后续页面`);
                            hasOldWorks = true;
                            break;
                        }
                    }
                    allWorks.push(work);
                }

                if (hasOldWorks) {
                    shouldContinue = false;
                } else {
                    currentPage++;

                    // 添加页面间延迟
                    if (shouldContinue) {
                        await this.delay(this.BASE_DELAY);
                    }
                }

            } catch (error) {
                console.error(`[ACTOR] 解析第 ${currentPage} 页失败:`, error);
                break;
            }
        }

        console.log(`[ACTOR] 分页解析完成，共获取 ${allWorks.length} 个作品，解析了 ${currentPage} 页`);
        return allWorks;
    }

    /**
     * 在标签页中解析演员作品数据
     */
    private async parseActorWorksInTab(url: string): Promise<any[]> {
        return new Promise((resolve, reject) => {
            // 创建一个隐藏的标签页
            chrome.tabs.create({
                url: url,
                active: false
            }, (tab) => {
                if (!tab || !tab.id) {
                    reject(new Error('无法创建标签页'));
                    return;
                }

                const tabId = tab.id;
                let isResolved = false;
                let pollTimer: ReturnType<typeof setInterval> | null = null;
                let attempt = 0;

                const onUpdated = (updatedTabId: number, changeInfo: any) => {
                    // load 完成时立即尝试一次（load 可能因第三方脚本挂起而不触发，
                    // 因此这只是加速路径，真正的就绪判定靠轮询 executeScript）
                    if (updatedTabId === tabId && changeInfo.status === 'complete') {
                        tryParse();
                    }
                };

                const cleanup = () => {
                    clearTimeout(timeout);
                    if (pollTimer) {
                        clearInterval(pollTimer);
                        pollTimer = null;
                    }
                    chrome.tabs.onUpdated.removeListener(onUpdated);
                };

                // 注入脚本解析作品数据。
                // 页面未就绪（仍在导航 / readyState=loading / 列表容器未渲染）时返回 null，
                // 由调用方继续轮询；就绪后返回作品数组（空数组表示该页确实没有作品）。
                const parseFunc = (targetUrl: string): any[] | null => {
                    try {
                        const target = new URL(targetUrl);
                        const here = new URL(window.location.href);
                        if (here.origin !== target.origin || here.pathname !== target.pathname) {
                            return null;
                        }
                        if (document.readyState === 'loading') {
                            return null;
                        }
                        const hasContainer = !!document.querySelector('.movie-list, .grid-item');
                        if (!hasContainer && document.readyState !== 'complete') {
                            return null;
                        }

                        const works: any[] = [];
                        const movieItems = document.querySelectorAll('.movie-list .item, .grid-item .item');

                        movieItems.forEach(item => {
                            try {
                                // 获取作品链接和ID
                                const linkElement = item.querySelector('a[href*="/v/"]');
                                if (!linkElement) return;

                                const href = linkElement.getAttribute('href');
                                if (!href) return;

                                // 提取视频ID
                                const videoIdMatch = href.match(/\/v\/([^\/?]+)/);
                                if (!videoIdMatch) return;
                                const videoId = videoIdMatch[1];

                                // 获取标题
                                const titleElement = item.querySelector('.video-title, .title');
                                const title = titleElement?.textContent?.trim() || '';

                                // 从标题中提取番号作为ID（用于与番号库匹配）
                                // 标题格式通常是: "MIAB-608 【FANZA限定】..."
                                let actualId = videoId; // 默认使用JavDB ID
                                const codeMatch = title.match(/^([A-Z]+-\d+)/);
                                if (codeMatch) {
                                    actualId = codeMatch[1]; // 使用番号作为ID
                                    console.log(`[ACTOR] 提取番号: ${actualId} (JavDB ID: ${videoId})`);
                                } else {
                                    console.log(`[ACTOR] 未能从标题提取番号，使用JavDB ID: ${videoId}, 标题: ${title}`);
                                }

                                // 获取封面图
                                const imgElement = item.querySelector('img');
                                const coverImage = imgElement?.getAttribute('data-src') || imgElement?.getAttribute('src') || '';

                                // 获取发行日期
                                const dateElement = item.querySelector('.meta, .video-meta');
                                const dateText = dateElement?.textContent?.trim() || '';

                                // 简单的日期提取
                                let releaseDate = '';
                                const dateMatch = dateText.match(/(\d{4}-\d{2}-\d{2})/);
                                if (dateMatch) {
                                    releaseDate = dateMatch[1];
                                }

                                // 获取标签
                                const tagElements = item.querySelectorAll('.tag, .genre');
                                const tags: string[] = [];
                                tagElements.forEach(tag => {
                                    const tagText = tag.textContent?.trim();
                                    if (tagText) tags.push(tagText);
                                });

                                // 注意：URL 始终使用 javdb.com 作为持久化存储的域名
                                // 显示时会通过 RouteManager 动态替换为当前选择的线路
                                works.push({
                                    id: actualId, // 使用提取的番号或JavDB ID
                                    javdbId: videoId, // 保留JavDB ID用于链接
                                    title,
                                    url: `https://javdb.com${href}`,
                                    coverImage,
                                    releaseDate,
                                    tags
                                });

                            } catch (error) {
                                console.warn('[ACTOR] 解析作品项失败:', error);
                            }
                        });

                        return works;
                    } catch (error) {
                        return null;
                    }
                };

                const tryParse = () => {
                    if (isResolved) return;
                    chrome.scripting.executeScript(
                        {
                            target: { tabId: tabId },
                            func: parseFunc,
                            args: [url]
                        },
                        (results) => {
                            if (isResolved) return;
                            // 执行失败（页面仍在导航、无可用上下文等）时 results 为空，继续轮询
                            const result = results && results[0] && results[0].result;
                            if (!Array.isArray(result)) return;
                            isResolved = true;
                            cleanup();
                            chrome.tabs.remove(tabId);
                            console.log(`[ACTOR] 第 ${attempt} 次尝试解析成功，作品数: ${result.length}`);
                            resolve(result);
                        }
                    );
                };

                // 设置超时
                const timeout = setTimeout(() => {
                    if (!isResolved) {
                        isResolved = true;
                        cleanup();
                        chrome.tabs.remove(tabId);
                        reject(new Error(`解析作品数据超时（${attempt} 次尝试后页面仍未就绪）`));
                    }
                }, 30000); // 30秒超时

                chrome.tabs.onUpdated.addListener(onUpdated);

                // 不等待 load 事件：页面可能因第三方脚本（如 yandex metrika）挂起而永不触发 load，
                // 而 DOM 在 domcontentloaded 后即可解析。轮询 executeScript，页面就绪（URL 匹配 +
                // readyState 非 loading + 列表容器存在）时立即解析。
                pollTimer = setInterval(() => {
                    attempt += 1;
                    tryParse();
                }, 800);
            });
        });
    }

    /**
     * 计算日期阈值
     */
    private calculateDateThreshold(dateRangeMonths: number): Date | null {
        if (dateRangeMonths <= 0) {
            return null; // 不限制时间范围
        }

        const threshold = new Date();
        threshold.setMonth(threshold.getMonth() - dateRangeMonths);
        return threshold;
    }

    /**
     * 延迟函数
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 检查多个演员的新作品（支持并发）
     */
    async checkMultipleActors(
        subscriptions: ActorSubscription[],
        globalConfig: NewWorksGlobalConfig
    ): Promise<{
        discovered: number;
        errors: string[];
        newWorks: NewWorkRecord[];
    }> {
        const results = {
            discovered: 0,
            errors: [] as string[],
            newWorks: [] as NewWorkRecord[]
        };

        const activeSubscriptions = subscriptions.filter(sub => sub.enabled);
        const concurrency = globalConfig.concurrency || 1;
        
        console.log(`[NewWorksCollector] 开始检查 ${activeSubscriptions.length} 个演员，并发数: ${concurrency}`);
        
        // 使用并发控制
        for (let i = 0; i < activeSubscriptions.length; i += concurrency) {
            const batch = activeSubscriptions.slice(i, i + concurrency);
            console.log(`[NewWorksCollector] 处理批次 ${Math.floor(i / concurrency) + 1}，包含 ${batch.length} 个演员`);
            
            // 并发检查当前批次
            const batchPromises = batch.map(async (subscription) => {
                try {
                    const works = await this.checkActorNewWorks(subscription, globalConfig);
                    
                    // 更新订阅的最后检查时间
                    subscription.lastCheckTime = Date.now();
                    
                    return {
                        success: true,
                        works,
                        actorName: subscription.actorName
                    };
                } catch (error) {
                    const errorMsg = `检查演员 ${subscription.actorName} 失败: ${error}`;
                    console.error(errorMsg);
                    return {
                        success: false,
                        error: errorMsg,
                        actorName: subscription.actorName
                    };
                }
            });
            
            // 等待当前批次完成
            const batchResults = await Promise.all(batchPromises);
            
            // 处理批次结果
            for (const result of batchResults) {
                if (result.success && result.works) {
                    results.newWorks.push(...result.works);
                    results.discovered += result.works.length;
                    console.log(`[NewWorksCollector] 演员 ${result.actorName} 发现 ${result.works.length} 个新作品`);
                } else if (!result.success && result.error) {
                    results.errors.push(result.error);
                }
            }
            
            // 在批次之间添加延迟（如果不是最后一个批次）
            if (i + concurrency < activeSubscriptions.length && globalConfig.requestInterval > 0) {
                console.log(`[NewWorksCollector] 批次间延迟 ${globalConfig.requestInterval} 秒`);
                await this.delay(globalConfig.requestInterval * 1000);
            }
        }

        console.log(`[NewWorksCollector] 检查完成，共发现 ${results.discovered} 个新作品，${results.errors.length} 个错误`);
        return results;
    }
}
