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
import {
    ACTOR_SCAN_UNION_MAX_CATEGORIES,
    applyCategoryBlackFilter,
    buildActorScanRequests,
    deriveActorScanInputs,
    looksLikeLoginPage,
    mergeActorWorksResponses,
    type RawDetailDocument,
} from './categoryFilter';

/**
 * 演员作品页遭遇登录墙（10-01-newworks-whitelist-merge）：
 * 类别白名单经 ?t= 生效需登录态，匿名/会话失效时站点 302 到登录页。
 * 修复前该情形表现为页内轮询 30s 超时后被静默吞成「无作品」，
 * 故显式上抛，让扫描编排「停该演员剩余请求」并按轮次汇总上报。
 */
export class ActorLoginWallError extends Error {
    constructor(public readonly actorUrl: string, public readonly finalUrl: string) {
        super(`演员作品页遭遇登录墙: ${actorUrl} -> ${finalUrl}`);
        this.name = 'ActorLoginWallError';
    }
}

/** 墙错误判定（按 name 判定，便于测试桩与跨上下文实例）。 */
export function isActorLoginWallError(error: unknown): boolean {
    if (error instanceof ActorLoginWallError) return true;
    return !!error && typeof error === 'object' && (error as { name?: string }).name === 'ActorLoginWallError';
}

/**
 * 页内采集器（self-contained，chrome.scripting.executeScript func 序列化要求：
 * 不得引用任何模块外标识符）。遍历详情页 .panel-block，返回类别/演员面板原始数据。
 * 返回 null = 页面未就绪（导航中/无面板且未 complete），由调用方继续轮询。
 */
const extractDetailPanelsFunc = (targetUrl: string):
    { redirected: boolean; finalUrl: string; panels: RawDetailDocument['panels'] } | null => {
    try {
        const target = new URL(targetUrl);
        const here = new URL(window.location.href);
        if (here.origin !== target.origin || here.pathname !== target.pathname) {
            // 跳转（典型：302→登录页）：立即上报最终 URL，调用方判定
            return { redirected: true, finalUrl: here.href, panels: [] };
        }
        if (document.readyState === 'loading') return null;
        const hasPanel = document.querySelector('.panel-block') !== null;
        if (!hasPanel && document.readyState !== 'complete') return null;
        const panels: RawDetailDocument['panels'] = [];
        document.querySelectorAll('.panel-block').forEach((panel) => {
            const strong = panel.querySelector('strong');
            const label = (strong && strong.textContent) || '';
            const tagHrefs: string[] = [];
            panel.querySelectorAll('a[href*="/tags?c"]').forEach((a) => {
                tagHrefs.push(a.getAttribute('href') || '');
            });
            const actorLinks: RawDetailDocument['panels'][number]['actorLinks'] = [];
            panel.querySelectorAll('a').forEach((a) => {
                const href = a.getAttribute('href') || '';
                if (!/\/actors\//.test(href)) return;
                const next = a.nextElementSibling || a.nextSibling;
                const parent = a.parentElement;
                const symbol = parent ? parent.querySelector('.symbol') : null;
                actorLinks.push({
                    href: href,
                    text: a.textContent || '',
                    nextText: next ? (next.textContent || '') : null,
                    symbolClass: symbol ? (symbol.getAttribute('class') || '') : null,
                    symbolText: symbol ? (symbol.textContent || '') : null,
                    linkClass: a.getAttribute('class') || null,
                });
            });
            const value = panel.querySelector('.value');
            panels.push({
                label: label,
                tagHrefs: tagHrefs,
                actorLinks: actorLinks,
                hasAnyLink: panel.querySelectorAll('a').length > 0,
                valueText: value ? (value.textContent || '') : null,
            });
        });
        return { redirected: false, finalUrl: here.href, panels: panels };
    } catch (e) {
        return null;
    }
};

export class NewWorksCollector {
    private readonly BASE_DELAY = 3000; // 基础延迟3秒

    /**
     * 演员扫描编排（10-01-newworks-whitelist-merge）：类别白名单 → 多请求并集合并。
     * - 基础过滤 t 码 + 数字类别 ID 一律走 ?t=（演员页 ?cN= 实测被站点静默忽略，不再拼）；
     * - N 个数字类别 = N 个请求，按 video ID 并集去重（站点 ?t= 多值是 AND 交集，
     *   单请求拼多个数字会把并集压成交集甚至 0 结果）；N 超上限降级单请求 AND；
     * - 单请求失败（网络/解析）记日志并继续，不因一个类别丢掉整个演员；
     * - 任一响应跳登录页 → 停该演员剩余请求并标 wallDetected（调用方按轮次汇总）。
     */
    private async scanActorWorksWithWhitelist(
        subscription: ActorSubscription,
        globalConfig: NewWorksGlobalConfig
    ): Promise<{ works: any[]; wallDetected: boolean; requestCount: number; degraded: boolean }> {
        const inputs = deriveActorScanInputs(globalConfig.filters.categoryFilters ?? []);
        if (inputs.dropped.length > 0) {
            console.warn(`[CS] 白名单含不可识别值（已忽略）: ${inputs.dropped.join(', ')}`);
        }
        const paths = buildActorScanRequests(subscription.actorId, inputs.letters, inputs.nums);
        const degraded = inputs.nums.length > ACTOR_SCAN_UNION_MAX_CATEGORIES;
        if (degraded) {
            console.warn(`[CS] 白名单数字类别 ${inputs.nums.length} 项超过并集上限 ${ACTOR_SCAN_UNION_MAX_CATEGORIES}，降级为「同时满足全部（交集）」单请求`);
        }
        if (inputs.nums.length > 0) {
            console.log(`[CS] 类别白名单生效: ${paths.length} 个请求（并集），基础过滤 ${inputs.letters.join(',') || '无'}`);
        } else if (inputs.letters.length > 0) {
            console.log(`[CS] 应用基础过滤 t 码: ${inputs.letters.join(',')}`);
        } else {
            console.log(`[CS] 未应用类别白名单（显示所有类别）`);
        }

        const pages: any[][] = [];
        let wallDetected = false;
        for (const path of paths) {
            const url = await buildJavDBUrl(path);
            try {
                pages.push(await this.parseActorWorksPage(url, globalConfig));
            } catch (error) {
                if (isActorLoginWallError(error)) {
                    wallDetected = true;
                    console.warn(`[ACTOR][WALL] 演员 ${subscription.actorName} 遭遇登录墙，停止该演员剩余请求: ${url}`);
                    break;
                }
                console.error('[ACTOR] 单个类别请求失败（跳过该请求，保留其余结果）:', error);
            }
        }

        const merged = mergeActorWorksResponses(pages);
        if (paths.length > 1) {
            console.log(`[CS] 多类别并集合并: ${merged.pages}/${paths.length} 个响应成功，去重后 ${merged.works.length} 个作品（重复 ${merged.duplicates}）`);
        }
        return { works: merged.works, wallDetected, requestCount: paths.length, degraded };
    }

    /** 轮次级登录墙名单（批量扫描一轮汇总上报一次；单演员入口即时上报）。 */
    private roundWallActors: string[] = [];
    private roundOpen = false;

    /** 登记遭遇登录墙的演员：批量轮次内累积，非轮次（单演员）即时上报。 */
    private noteWallActor(actorName: string): void {
        if (!this.roundWallActors.includes(actorName)) this.roundWallActors.push(actorName);
        if (!this.roundOpen) this.reportWalls('单演员扫描');
    }

    /** 每轮次经既有日志通道汇总上报一次（不建新 UI）。 */
    private reportWalls(scope: string): void {
        if (this.roundWallActors.length === 0) return;
        console.warn(`[NEWWORKS][WALL] ${scope}：本轮 ${this.roundWallActors.length} 个演员遭遇登录墙（类别白名单需登录态才生效），名单: ${this.roundWallActors.join(', ')}`);
        this.roundWallActors = [];
    }

    /**
     * P3：入库前类别黑名单剔除（保守：解析失败/未知一律保留不丢片）。
     * 缓存优先（演员穿透缓存），miss 才请求详情（限速 3s/次）。
     */
    private async applyCategoryBlacklist(
        works: any[],
        blackFilters: string[] | undefined
    ): Promise<{ kept: any[]; removed: number }> {
        if (!blackFilters || blackFilters.length === 0 || works.length === 0) {
            return { kept: works, removed: 0 };
        }
        const result = await applyCategoryBlackFilter(works, blackFilters, {
            delay: (ms) => this.delay(ms),
            buildDetailUrl: (id) => buildJavDBUrl(`/v/${id}`),
            // SW 无 DOMParser：详情页经隐藏标签页 + 页内采集取得 raw panels
            loadDetail: (url) => this.loadDetailInTab(url),
        });
        if (result.removed > 0) {
            console.log(`[CS] 入库前类别黑名单剔除 ${result.removed} 个: ${result.removedIds.join(', ')}`);
        }
        return { kept: result.kept, removed: result.removed };
    }

    /**
     * P3：隐藏标签页 + 页内采集取详情页原始面板数据（对齐 parseActorWorksInTab 机制：
     * 轮询 executeScript、URL/readyState 就绪判定、30s 超时、结束关页）。
     * null = 加载失败（超时/脚本错误/标签页创建失败）；
     * 非登录跳转 → { finalUrl, panels: [] }（由 looksLikeLoginPage 判定后保守保留）。
     */
    private loadDetailInTab(url: string): Promise<RawDetailDocument | null> {
        return new Promise((resolve) => {
            chrome.tabs.create({ url, active: false }, (tab) => {
                if (!tab || tab.id === undefined) {
                    resolve(null);
                    return;
                }
                const tabId = tab.id;
                let isResolved = false;
                let pollTimer: ReturnType<typeof setInterval> | null = null;

                const cleanup = () => {
                    clearTimeout(timeout);
                    if (pollTimer) {
                        clearInterval(pollTimer);
                        pollTimer = null;
                    }
                    chrome.tabs.onUpdated.removeListener(onUpdated);
                };

                const finish = (value: RawDetailDocument | null) => {
                    if (isResolved) return;
                    isResolved = true;
                    cleanup();
                    chrome.tabs.remove(tabId);
                    resolve(value);
                };

                const onUpdated = (updatedTabId: number, changeInfo: any) => {
                    if (updatedTabId === tabId && changeInfo.status === 'complete') {
                        tryRead();
                    }
                };

                const tryRead = () => {
                    if (isResolved) return;
                    chrome.scripting.executeScript(
                        {
                            target: { tabId: tabId },
                            func: extractDetailPanelsFunc,
                            args: [url]
                        },
                        (results) => {
                            if (isResolved) return;
                            // 页面仍在导航/上下文不可用时 results 为空，继续轮询
                            const result = results && results[0] && results[0].result;
                            if (!result || typeof result !== 'object') return;
                            finish({
                                finalUrl: result.finalUrl,
                                panels: Array.isArray(result.panels) ? result.panels : []
                            });
                        }
                    );
                };

                const timeout = setTimeout(() => finish(null), 30000); // 30秒超时

                chrome.tabs.onUpdated.addListener(onUpdated);
                // 不依赖 load 事件（第三方脚本可能挂起），轮询 executeScript 判定就绪
                pollTimer = setInterval(tryRead, 800);
            });
        });
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
            
            // 类别白名单：多请求并集扫描（遇登录墙停该演员剩余请求）
            const scan = await this.scanActorWorksWithWhitelist(subscription, globalConfig);
            if (scan.wallDetected) this.noteWallActor(subscription.actorName);
            const works = scan.works;
            
            // 应用全局过滤条件
            const filteredWorks = await this.applyGlobalFilters(works, globalConfig.filters);

            // 转换为NewWorkRecord格式
            const newWorks: NewWorkRecord[] = [];
            const now = Date.now();

            // P3（run11b 真机归因修复）：存在性检查先行，类别黑名单只评估新候选——
            // 已存在作品不再触发详情抓取（黑名单语义上从不回溯移除已入库作品，终态一致）。
            // 修复前黑名单在存在性检查之前对全池作品执行：冷穿透缓存下
            // 510 作品 × (3s 延迟 + 隐藏标签页详情 8~13s) ≈ 50min，SW 120s 无响应。
            const freshCandidates: any[] = [];
            for (const work of filteredWorks.slice(0, globalConfig.maxWorksPerCheck)) {
                // 检查是否已存在
                const exists = await this.checkWorkExists(work.id);
                if (!exists) {
                    freshCandidates.push(work);
                }
            }
            const blackResult = await this.applyCategoryBlacklist(freshCandidates, globalConfig.filters.categoryBlackFilters);
            for (const work of blackResult.kept) {
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
            // 登录墙上抛给扫描编排（停剩余请求 + 轮次汇总），不静默吞成空列表
            if (isActorLoginWallError(error)) throw error;
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
    ): Promise<{ filteredWorks: any[]; filteredCount: { dateRange: number; viewed: number; browsed: number; want: number; ar: number; categoryBlack: number } }> {
        console.log(`[CS] 开始应用过滤条件(带统计)，原始作品数量: ${works.length}`);
        console.log('[SETTINGS] 过滤设置:', filters);

        const filteredWorks: any[] = [];
        const filteredCount = {
            dateRange: 0,
            viewed: 0,
            browsed: 0,
            want: 0,
            ar: 0,
            categoryBlack: 0 // P3：入库前类别黑名单剔除计数（由 checkActorNewWorksDetailed 填充）
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
    ): Promise<{ works: NewWorkRecord[]; identified: number; effective: number; filteredOut: number; existingCount: number; filterBreakdown: { dateRange: number; viewed: number; browsed: number; want: number; ar: number; categoryBlack: number } }> {
        try {
            console.log(`[ACTOR] 开始(详细)检查演员 ${subscription.actorName} 的新作品`);

            const scan = await this.scanActorWorksWithWhitelist(subscription, globalConfig);
            if (scan.wallDetected) this.noteWallActor(subscription.actorName);
            const worksRaw = scan.works;
            const identified = worksRaw.length;

            const { filteredWorks, filteredCount } = await this.applyGlobalFiltersWithStats(worksRaw, globalConfig.filters);

            const newWorks: NewWorkRecord[] = [];
            let existingCount = 0;
            const now = Date.now();
            // P3（run11b 真机归因修复）：存在性检查先行，类别黑名单只评估新候选——
            // 已存在作品不再触发详情抓取（冷穿透缓存全池串行 fetch ≈ 50min，SW 120s 无响应）。
            console.log(`[NEWWORKS] 开始检查 ${filteredWorks.length} 个过滤后的作品是否已存在`);
            const freshCandidates: any[] = [];
            for (const work of filteredWorks.slice(0, globalConfig.maxWorksPerCheck)) {
                const exists = await this.checkWorkExists(work.id);
                console.log(`[NEWWORKS] 作品 ${work.id} (${work.title}) 存在性检查: ${exists ? '已存在' : '新作品'}`);
                if (!exists) {
                    freshCandidates.push(work);
                } else {
                    existingCount++;
                }
            }
            // 入库前类别黑名单剔除（仅新候选；剔除数计入 filterBreakdown.categoryBlack）
            const blackResult = await this.applyCategoryBlacklist(freshCandidates, globalConfig.filters.categoryBlackFilters);
            filteredCount.categoryBlack = blackResult.removed;
            const effective = filteredWorks.length - blackResult.removed;
            const filteredOut = Math.max(0, identified - effective);
            for (const work of blackResult.kept) {
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
                filterBreakdown: { dateRange: 0, viewed: 0, browsed: 0, want: 0, ar: 0, categoryBlack: 0 }
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
                if (isActorLoginWallError(error)) throw error; // 登录墙：上抛，编排层停剩余请求
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
                const parseFunc = (targetUrl: string): any[] | { redirected: boolean; finalUrl: string } | null => {
                    try {
                        const target = new URL(targetUrl);
                        const here = new URL(window.location.href);
                        if (here.origin !== target.origin || here.pathname !== target.pathname) {
                            // 跳转（典型：类别白名单需登录态，匿名 302→登录页）：上报最终 URL，
                            // 由调用方判定登录墙（照 extractDetailPanelsFunc 口径）；
                            // 非登录页的瞬态跳转仍由调用方继续轮询，不误判空页。
                            return { redirected: true, finalUrl: here.href };
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
                            if (result && typeof result === 'object' && !Array.isArray(result)
                                && (result as { redirected?: boolean }).redirected) {
                                const finalUrl = String((result as { finalUrl?: string }).finalUrl || '');
                                if (looksLikeLoginPage(finalUrl)) {
                                    isResolved = true;
                                    cleanup();
                                    chrome.tabs.remove(tabId);
                                    reject(new ActorLoginWallError(url, finalUrl));
                                    return;
                                }
                                return; // 瞬态跳转（非登录页）：继续轮询
                            }
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
     * 本线（10-01-newworks-whitelist-merge）：一轮批量扫描的登录墙只在结束时汇总上报一次。
     */
    async checkMultipleActors(
        subscriptions: ActorSubscription[],
        globalConfig: NewWorksGlobalConfig
    ): Promise<{
        discovered: number;
        errors: string[];
        newWorks: NewWorkRecord[];
    }> {
        this.roundOpen = true;
        this.roundWallActors = [];
        try {
            return await this.runCheckMultipleActors(subscriptions, globalConfig);
        } finally {
            this.roundOpen = false;
            this.reportWalls('批量扫描');
        }
    }

    private async runCheckMultipleActors(
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
