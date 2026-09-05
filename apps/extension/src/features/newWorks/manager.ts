/**
 * @file manager.ts
 * @description manager
 * @module features/newWorks
 */
// src/features/newWorks/manager.ts
// 新作品管理服务

import { getValue, setValue } from '../../utils/storage';
import { STORAGE_KEYS, DEFAULT_NEW_WORKS_CONFIG } from '../../utils/config';
import { log } from '../../utils/logController';
import type {
    ActorSubscription,
    NewWorksGlobalConfig,
    NewWorkRecord,
    NewWorksStats,
    NewWorksSearchResult
} from './types';
import type { VideoRecord } from '../../types';
import { actorManager } from '../actors';
import { dbNewWorksQuery, dbNewWorksStats, dbNewWorksGet, dbNewWorksDelete, dbNewWorksGetAll, dbViewedStatusGetMany } from '../../dashboard/dbClient';
import { newWorksPut, newWorksBulkPut } from '../../platform/storage/indexedDb';
import { dbViewedPage } from '../../dashboard/dbClient';
import { recordNewWorksDiagnosticCounter, recordNewWorksDiagnosticError, recordNewWorksDiagnosticValue, beginNewWorksDiagnosticSpan } from './newWorksDiagnostics';
import { createNewWorksAutoStatusSyncGate } from './autoStatusSyncGate';
import { buildViewedStatusMap, collectNewWorkMatchIds } from './statusSyncSelection';

const NEW_WORKS_AUTO_STATUS_SYNC_TTL_MS = 5 * 60 * 1000;

export interface NewWorksStatusSyncOptions {
    force?: boolean;
}

export interface NewWorksStatusSyncResult {
    updated: number;
    details: Array<{ id: string; oldStatus: string; newStatus: string }>;
    skipped?: boolean;
}

/** addNewWorks 持久化统计 */
export interface NewWorksAddStats {
    total: number;
    saved: number;
    failed: number;
}

export class NewWorksManager {
    private subscriptions: Map<string, ActorSubscription> = new Map();
    private newWorks: Map<string, NewWorkRecord> = new Map();
    private globalConfig: NewWorksGlobalConfig = DEFAULT_NEW_WORKS_CONFIG;
    private isLoaded = false;
    // 跨上下文一致性（SW / dashboard 各持独立实例，initialize 幂等只读一次）：
    // baseline = initialize 读存储时的 id 集合（每次保存后重设）；
    // dirty = 本实例改过的 id（全量回写白名单，同步时不因存储缺失被移除）；
    // localDeleted = 本实例已删、待持久化的 id（同步时不从存储重新合并）。
    private subscriptionBaseline: Set<string> = new Set();
    private workBaseline: Set<string> = new Set();
    private dirtySubscriptionIds: Set<string> = new Set();
    private dirtyWorkIds: Set<string> = new Set();
    private localDeletedSubscriptionIds: Set<string> = new Set();
    private localDeletedWorkIds: Set<string> = new Set();
    private readonly autoStatusSyncGate = createNewWorksAutoStatusSyncGate<NewWorksStatusSyncResult>({
        ttlMs: NEW_WORKS_AUTO_STATUS_SYNC_TTL_MS,
        createSkipped: () => ({ updated: 0, details: [], skipped: true }),
    });

    /**
     * 初始化新作品管理器
     */
    async initialize(): Promise<void> {
        if (this.isLoaded) return;

        try {
            // 加载全局配置（带迁移）
            const raw = await getValue<any>(
                STORAGE_KEYS.NEW_WORKS_CONFIG,
                DEFAULT_NEW_WORKS_CONFIG as any
            );
            // 迁移：将旧的 enabled 映射为 autoCheckEnabled（仅当新字段未设置时）
            const migrated: NewWorksGlobalConfig = {
                ...DEFAULT_NEW_WORKS_CONFIG,
                ...raw,
                // 深度合并 filters，确保新增字段（如 excludeAR）有默认值
                filters: {
                    ...DEFAULT_NEW_WORKS_CONFIG.filters,
                    ...(raw?.filters || {}),
                },
                autoCheckEnabled: (
                    raw?.autoCheckEnabled !== undefined
                        ? !!raw.autoCheckEnabled
                        : (raw?.enabled !== undefined ? !!raw.enabled : DEFAULT_NEW_WORKS_CONFIG.autoCheckEnabled)
                ),
                showActorPageScanButton: (
                    raw?.showActorPageScanButton !== undefined
                        ? !!raw.showActorPageScanButton
                        : DEFAULT_NEW_WORKS_CONFIG.showActorPageScanButton
                )
            };
            // 清理遗留字段
            delete (migrated as any).enabled;
            this.globalConfig = migrated;

            // 加载订阅数据
            const subscriptionsData = await getValue<Record<string, ActorSubscription>>(
                STORAGE_KEYS.NEW_WORKS_SUBSCRIPTIONS,
                {}
            );
            log.verbose('NewWorksManager: 从存储加载的订阅数据:', subscriptionsData);
            this.subscriptions.clear();
            Object.values(subscriptionsData).forEach(sub => {
                // 确保 enabled 字段存在，如果不存在则默认为 true
                if (sub.enabled === undefined) {
                    sub.enabled = true;
                    log.verbose(`NewWorksManager: 订阅 ${sub.actorName} 缺少 enabled 字段，设置为 true`);
                }
                this.subscriptions.set(sub.actorId, sub);
            });

            // 加载新作品数据（用于兼容与回退）
            const newWorksData = await getValue<Record<string, NewWorkRecord>>(STORAGE_KEYS.NEW_WORKS_RECORDS, {});
            this.newWorks.clear();
            Object.values(newWorksData).forEach(work => { this.newWorks.set(work.id, work); });

            // 记录加载基线：后续保存同步时，只移除"基线中存在且本实例未修改"的存储缺失项，
            // 避免误删 initialize 后由调用方直接注入内存的条目（兼容既有契约）
            this.subscriptionBaseline = new Set(this.subscriptions.keys());
            this.workBaseline = new Set(this.newWorks.keys());

            this.isLoaded = true;
            log.verbose(`NewWorksManager: Loaded ${this.subscriptions.size} subscriptions, ${this.newWorks.size} works`);
        } catch (error) {
            console.error('[NewWorks] Failed to initialize:', error);
            throw error;
        }
    }

    /**
     * 获取全局配置
     */
    async getGlobalConfig(): Promise<NewWorksGlobalConfig> {
        await this.initialize();
        return { ...this.globalConfig };
    }

    /**
     * 更新全局配置
     */
    async updateGlobalConfig(config: Partial<NewWorksGlobalConfig>): Promise<void> {
        await this.initialize();

        // 合并并清理遗留字段
        const merged: any = { ...this.globalConfig, ...config };
        delete merged.enabled;
        this.globalConfig = merged as NewWorksGlobalConfig;
        await setValue(STORAGE_KEYS.NEW_WORKS_CONFIG, this.globalConfig);
    }

    /**
     * 删除作品
     */
    async deleteWorks(workIds: string[]): Promise<void> {
        await this.initialize();
        let changed = false;
        for (const id of workIds) {
            if (this.newWorks.has(id)) {
                this.newWorks.delete(id);
                this.localDeletedWorkIds.add(id);
                changed = true;
            }
            try { await dbNewWorksDelete(id); } catch {}
        }
        if (changed) await this.saveNewWorks();
    }

    /**
     * 添加演员订阅
     */
    async addSubscription(actorId: string): Promise<void> {
        await this.initialize();

        // 检查演员是否存在
        const actor = await actorManager.getActorById(actorId);
        if (!actor) {
            throw new Error(`演员 ${actorId} 不存在`);
        }

        // 检查是否已订阅
        if (this.subscriptions.has(actorId)) {
            throw new Error(`演员 ${actor.name} 已经订阅`);
        }

        const subscription: ActorSubscription = {
            actorId,
            actorName: actor.name,
            avatarUrl: actor.avatarUrl,
            subscribedAt: Date.now(),
            enabled: true
        };

        this.subscriptions.set(actorId, subscription);
        this.dirtySubscriptionIds.add(actorId);
        await this.saveSubscriptions();
    }

    /**
     * 移除演员订阅
     */
    async removeSubscription(actorId: string): Promise<void> {
        await this.initialize();

        if (this.subscriptions.has(actorId)) {
            this.subscriptions.delete(actorId);
            this.localDeletedSubscriptionIds.add(actorId);
            await this.saveSubscriptions();
        }
    }

    /**
     * 获取所有订阅
     */
    async getSubscriptions(): Promise<ActorSubscription[]> {
        await this.initialize();
        const subscriptions = Array.from(this.subscriptions.values());
        log.verbose(`NewWorksManager: 获取订阅列表，共 ${subscriptions.length} 个订阅`);
        subscriptions.forEach(sub => {
            log.verbose(`  - ${sub.actorName} (${sub.actorId}): enabled=${sub.enabled}`);
        });
        return subscriptions;
    }

    /**
     * 切换订阅状态
     */
    async toggleSubscription(actorId: string, enabled: boolean): Promise<void> {
        await this.initialize();

        const subscription = this.subscriptions.get(actorId);
        if (subscription) {
            log.verbose(`NewWorksManager: 切换订阅状态 - 演员: ${subscription.actorName}, 从 ${subscription.enabled} 切换到 ${enabled}`);
            subscription.enabled = enabled;
            this.subscriptions.set(actorId, subscription);
            this.dirtySubscriptionIds.add(actorId);
            await this.saveSubscriptions();
            log.verbose(`NewWorksManager: 订阅状态已保存`);
        } else {
            log.warn(`NewWorksManager: 未找到演员订阅 ${actorId}`);
        }
    }

    /**
     * 获取新作品列表
     */
    async getNewWorks(filters?: {
        search?: string;
        filter?: 'all' | 'unread' | 'today' | 'week';
        sort?: string;
        page?: number;
        pageSize?: number;
        includeStats?: boolean;
    }): Promise<NewWorksSearchResult> {
        await this.initialize();

        const { search = '', filter = 'all', sort = 'discoveredAt_desc', page = 1, pageSize = 20 } = filters || {};
        const includeStats = filters?.includeStats !== false;

        // 优先使用 IDB 查询
        try {
            recordNewWorksDiagnosticCounter('manager.dbNewWorksQuery.calls');
            const queryEnd = beginNewWorksDiagnosticSpan('manager.dbNewWorksQuery.duration');
            const sortField = (sort.split('_')[0] as 'discoveredAt' | 'releaseDate' | 'actorName');
            const sortOrder = (sort.split('_')[1] === 'asc' ? 'asc' : 'desc');
            const { items, total } = await dbNewWorksQuery({
                search,
                filter,
                sort: sortField,
                order: sortOrder,
                offset: (page - 1) * pageSize,
                limit: pageSize,
            });
            queryEnd();
            recordNewWorksDiagnosticValue('manager.dbNewWorksQuery.total', total);
            recordNewWorksDiagnosticValue('manager.dbNewWorksQuery.items', items.length);
            const stats = includeStats ? await this.getStats() : this.getCachedStats();

            return {
                works: items,
                total,
                page,
                pageSize,
                hasMore: page * pageSize < total,
                stats,
            };
        } catch (e) {
            log.warn('NewWorksManager: 使用 IDB 查询失败，回退到本地缓存', e);
        }

        // 回退：使用缓存
        let works = Array.from(this.newWorks.values());
        const lowerSearch = search.trim().toLowerCase();
        if (lowerSearch) {
            works = works.filter(w => w.title.toLowerCase().includes(lowerSearch) || w.actorName.toLowerCase().includes(lowerSearch) || w.id.toLowerCase().includes(lowerSearch));
        }
        const now = Date.now();
        const todayStart = new Date().setHours(0, 0, 0, 0);
        const weekStart = now - 7 * 24 * 60 * 60 * 1000;
        if (filter === 'unread') works = works.filter(w => !w.isRead);
        else if (filter === 'today') works = works.filter(w => w.discoveredAt >= todayStart);
        else if (filter === 'week') works = works.filter(w => w.discoveredAt >= weekStart);
        const [field, order] = sort.split('_');
        works.sort((a, b) => {
            let av: any; let bv: any;
            switch (field) {
                case 'releaseDate': av = a.releaseDate || ''; bv = b.releaseDate || ''; break;
                case 'actorName': av = a.actorName.toLowerCase(); bv = b.actorName.toLowerCase(); break;
                case 'discoveredAt':
                default: av = a.discoveredAt; bv = b.discoveredAt;
            }
            if (typeof av === 'string' && typeof bv === 'string') {
                const cmp = av.localeCompare(bv);
                return order === 'asc' ? cmp : -cmp;
            }
            return order === 'asc' ? (av - bv) : (bv - av);
        });
        const total = works.length;
        const pageWorks = works.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
        const stats = await this.getStats();
        return { works: pageWorks, total, page, pageSize, hasMore: page * pageSize < total, stats };
    }

    /**
     * 标记为已读
     */
    async markAsRead(workIds: string[]): Promise<void> {
        await this.initialize();
        let pending: NewWorkRecord[] = [];
        for (const id of workIds) {
            try {
                const cur = await dbNewWorksGet(id);
                if (cur && !cur.isRead) {
                    cur.isRead = true;
                    pending.push(cur);
                    this.newWorks.set(id, cur);
                    this.dirtyWorkIds.add(id);
                }
                // IDB 查无该作品 = 已被删除（本实例或他处）：不再用内存副本回写，防止复活
            } catch (e) {
                // IDB 读取失败（非删除）：只更新内存、不放入待写集合，
                // 避免异常状态下用内存旧副本回写 IDB 复活已删记录
                const backup = this.newWorks.get(id);
                if (backup && !backup.isRead) {
                    backup.isRead = true;
                    this.newWorks.set(id, backup);
                    this.dirtyWorkIds.add(id);
                }
            }
        }
        if (pending.length > 0) {
            try { await newWorksBulkPut(pending); } catch (err) { log.error('[NewWorks] 批量写入 IndexedDB 失败:', err); }
            await this.saveNewWorks();
        }
    }


    /**
     * 清理所有已读作品
     * 返回删除的数量
     */
    async cleanupReadWorks(): Promise<number> {
        await this.initialize();
        try {
            const all = await dbNewWorksGetAll();
            const toDelete = all.filter(w => w.isRead).map(w => w.id);
            await this.deleteWorks(toDelete);
            return toDelete.length;
        } catch {
            const worksToDelete: string[] = [];
            this.newWorks.forEach((work, id) => { if (work.isRead) worksToDelete.push(id); });
            if (worksToDelete.length > 0) await this.deleteWorks(worksToDelete);
            return worksToDelete.length;
        }
    }

    /**
     * 清理旧作品
     */
    async cleanupOldWorks(): Promise<number> {
        await this.initialize();
        if (!this.globalConfig.autoCleanup) return 0;
        const cutoffTime = Date.now() - this.globalConfig.cleanupDays * 24 * 60 * 60 * 1000;
        try {
            const all = await dbNewWorksGetAll();
            const toDelete = all.filter(w => (w.discoveredAt || 0) < cutoffTime && w.isRead).map(w => w.id);
            await this.deleteWorks(toDelete);
            return toDelete.length;
        } catch {
            const worksToDelete: string[] = [];
            this.newWorks.forEach((work, id) => { if ((work.discoveredAt || 0) < cutoffTime && work.isRead) worksToDelete.push(id); });
            if (worksToDelete.length > 0) await this.deleteWorks(worksToDelete);
            return worksToDelete.length;
        }
    }

    /**
     * 同步新作品状态与番号库记录
     * 检查番号库中是否有对应记录，如果有则更新新作品的状态
     */
    async syncWithVideoRecords(options: NewWorksStatusSyncOptions = { force: true }): Promise<NewWorksStatusSyncResult> {
        await this.initialize();
        return this.autoStatusSyncGate.run(
            () => this.syncWithVideoRecordsInternal(),
            { force: options.force !== false },
        );
    }

    private async syncWithVideoRecordsInternal(): Promise<NewWorksStatusSyncResult> {
        // 先读取新作品，再只查询它们实际涉及的番号状态，避免复制整张番号库。
        let works: NewWorkRecord[] = [];
        try {
            works = await dbNewWorksGetAll();
            recordNewWorksDiagnosticCounter('manager.dbNewWorksGetAll.calls');
            recordNewWorksDiagnosticValue('manager.dbNewWorksGetAll.count', works.length);
        } catch {
            works = Array.from(this.newWorks.values());
        }

        const matchIds = [...new Set(collectNewWorkMatchIds(works).values())];
        let viewedStatusMap = new Map<string, VideoRecord['status']>();
        try {
            recordNewWorksDiagnosticCounter('manager.dbViewedStatusGetMany.calls');
            recordNewWorksDiagnosticValue('manager.dbViewedStatusGetMany.ids', matchIds.length);
            viewedStatusMap = buildViewedStatusMap(await dbViewedStatusGetMany(matchIds));
        } catch (error) {
            // 兼容旧数据库/旧后台构建：批量接口不可用时才回退到旧分页路径。
            recordNewWorksDiagnosticCounter('manager.dbViewedPage.fallbacks');
            recordNewWorksDiagnosticError('manager.dbViewedStatusGetMany.error', error);
            log.warn('[NewWorks] 批量读取番号状态失败，回退到分页查询', error);
            const viewedMap: Record<string, VideoRecord> = {};
            try {
                let offset = 0;
                const limit = 1000;
                let page = await dbViewedPage({ offset, limit, orderBy: 'updatedAt', order: 'desc' });
                recordNewWorksDiagnosticCounter('manager.dbViewedPage.calls');
                const total = page.total;
                recordNewWorksDiagnosticValue('manager.dbViewedPage.total', total);
                while (true) {
                    page.items.forEach((record) => { if (record?.id) viewedMap[record.id] = record; });
                    offset += limit;
                    if (offset >= total) break;
                    page = await dbViewedPage({ offset, limit, orderBy: 'updatedAt', order: 'desc' });
                    recordNewWorksDiagnosticCounter('manager.dbViewedPage.calls');
                }
                viewedStatusMap = buildViewedStatusMap(Object.values(viewedMap));
            } catch {
                const fallback = await getValue<Record<string, VideoRecord>>(STORAGE_KEYS.VIEWED_RECORDS, {});
                viewedStatusMap = buildViewedStatusMap(Object.values(fallback));
            }
        }

        log.info(`[NewWorks] 新作品列表中共有 ${works.length} 个作品，按需读取 ${matchIds.length} 个番号状态`);

        let updatedCount = 0;
        const updateDetails: Array<{ id: string; oldStatus: string; newStatus: string }> = [];
        const toUpdate: NewWorkRecord[] = [];

        for (const work of works) {
            const matchId = collectNewWorkMatchIds([work]).get(work.id) ?? work.id;
            if (matchId !== work.id) log.verbose(`[NewWorks] 从标题提取番号: ${matchId} (原ID: ${work.id})`);
            
            const status = viewedStatusMap.get(matchId);
            if (!status) {
                log.verbose(`[NewWorks] 作品 ${work.id} (匹配ID: ${matchId}) 不在番号库中，跳过`);
                continue;
            }
            log.verbose(`[NewWorks] 作品 ${work.id} (匹配ID: ${matchId}) 在番号库中，状态: ${status}`);
            const oldStatus = work.isRead ? 'read' : 'unread';
            let newIsRead = false;
            let newStatus: NewWorkRecord['status'] = 'new';
            switch (status) {
                case 'viewed': newIsRead = true; newStatus = 'viewed'; break;
                case 'browsed': newIsRead = true; newStatus = 'browsed'; break;
                case 'want': newIsRead = false; newStatus = 'want'; break;
            }
            if (work.isRead !== newIsRead || work.status !== newStatus) {
                log.verbose(`[NewWorks] 作品 ${work.id} 状态需要更新: ${oldStatus} -> ${newIsRead ? 'read' : 'unread'} (${newStatus})`);
                const updated = { ...work, isRead: newIsRead, status: newStatus } as NewWorkRecord;
                toUpdate.push(updated);
                this.newWorks.set(work.id, updated);
                this.dirtyWorkIds.add(work.id);
                updatedCount++;
                updateDetails.push({ id: work.id, oldStatus, newStatus: newIsRead ? `read (${newStatus})` : `unread (${newStatus})` });
            } else {
                log.verbose(`[NewWorks] 作品 ${work.id} 状态无需更新`);
            }
        }

        log.info(`[NewWorks] 共需要更新 ${updatedCount} 个作品的状态`);

        if (toUpdate.length > 0) {
            try { await newWorksBulkPut(toUpdate); } catch (err) { log.error('[NewWorks] 批量写入 IndexedDB 失败:', err); }
            await this.saveNewWorks();
        }

        return { updated: updatedCount, details: updateDetails };
    }

    /**
     * 获取统计信息
     */
    async getStats(): Promise<NewWorksStats> {
        await this.initialize();
        recordNewWorksDiagnosticCounter('manager.getStats.calls');

        const subscriptions = Array.from(this.subscriptions.values());
        const todayStart = new Date().setHours(0, 0, 0, 0);

        try {
            // 优先使用 IndexedDB 统计，更快更准确
            const lite = await dbNewWorksStats();
            const stats = {
                totalSubscriptions: subscriptions.length,
                activeSubscriptions: subscriptions.filter(sub => sub.enabled).length,
                totalNewWorks: lite.total,
                unreadWorks: lite.unread,
                todayDiscovered: lite.today,
                lastCheckTime: this.globalConfig.lastGlobalCheck,
            } as NewWorksStats;
            log.verbose('NewWorksManager: 返回统计信息(IDB):', stats);
            return stats;
        } catch (e) {
            // 回退：使用内存缓存统计
            const works = Array.from(this.newWorks.values());
            const stats = {
                totalSubscriptions: subscriptions.length,
                activeSubscriptions: subscriptions.filter(sub => sub.enabled).length,
                totalNewWorks: works.length,
                unreadWorks: works.filter(work => !work.isRead).length,
                todayDiscovered: works.filter(work => (work.discoveredAt || 0) >= todayStart).length,
                lastCheckTime: this.globalConfig.lastGlobalCheck
            } as NewWorksStats;
            log.verbose('NewWorksManager: 返回统计信息(内存回退):', stats);
            return stats;
        }
    }

    private getCachedStats(): NewWorksStats {
        const subscriptions = Array.from(this.subscriptions.values());
        const todayStart = new Date().setHours(0, 0, 0, 0);
        const works = Array.from(this.newWorks.values());
        return {
            totalSubscriptions: subscriptions.length,
            activeSubscriptions: subscriptions.filter(sub => sub.enabled).length,
            totalNewWorks: works.length,
            unreadWorks: works.filter(work => !work.isRead).length,
            todayDiscovered: works.filter(work => (work.discoveredAt || 0) >= todayStart).length,
            lastCheckTime: this.globalConfig.lastGlobalCheck,
        };
    }

    /**
     * 保存订阅数据
     */
    /**
     * 将内存订阅表与 chrome.storage 双向同步（在全量回写之前调用）
     * - 存储有、内存无（且非本实例待持久化的删除）= 他处新增 → 并入内存
     * - 加载基线中存在、内存仍有、存储已无（且本实例未修改）= 他处已删 → 从内存移除
     * 读存储失败时告警并按当前内存状态继续（不阻塞保存）
     */
    private async syncSubscriptionsFromStorage(): Promise<void> {
        let stored: Record<string, ActorSubscription> | null = null;
        try {
            stored = await getValue<Record<string, ActorSubscription>>(STORAGE_KEYS.NEW_WORKS_SUBSCRIPTIONS, {});
        } catch (e) {
            log.warn('[NewWorks] 同步订阅存储失败，按内存状态继续', e);
            return;
        }
        const storedMap = new Map<string, ActorSubscription>();
        Object.entries(stored ?? {}).forEach(([id, sub]) => {
            if (sub) storedMap.set(id, sub);
        });
        storedMap.forEach((sub, id) => {
            if (!this.subscriptions.has(id) && !this.localDeletedSubscriptionIds.has(id)) {
                if (sub.enabled === undefined) sub.enabled = true;
                this.subscriptions.set(id, sub);
            }
        });
        this.subscriptionBaseline.forEach(id => {
            if (this.subscriptions.has(id) && !storedMap.has(id) && !this.dirtySubscriptionIds.has(id)) {
                this.subscriptions.delete(id);
            }
        });
    }

    /**
     * 将内存新作品表与 chrome.storage 兼容键双向同步，策略同 syncSubscriptionsFromStorage
     */
    private async syncNewWorksFromStorage(): Promise<void> {
        let stored: Record<string, NewWorkRecord> | null = null;
        try {
            stored = await getValue<Record<string, NewWorkRecord>>(STORAGE_KEYS.NEW_WORKS_RECORDS, {});
        } catch (e) {
            log.warn('[NewWorks] 同步新作品存储失败，按内存状态继续', e);
            return;
        }
        const storedMap = new Map<string, NewWorkRecord>();
        Object.entries(stored ?? {}).forEach(([id, work]) => {
            if (work) storedMap.set(id, work);
        });
        storedMap.forEach((work, id) => {
            if (!this.newWorks.has(id) && !this.localDeletedWorkIds.has(id)) {
                this.newWorks.set(id, work);
            }
        });
        this.workBaseline.forEach(id => {
            if (this.newWorks.has(id) && !storedMap.has(id) && !this.dirtyWorkIds.has(id)) {
                this.newWorks.delete(id);
            }
        });
    }

    /**
     * 保存订阅数据（先同步后全量回写，防止陈旧内存快照复活他处已删的订阅）
     */
    private async saveSubscriptions(): Promise<void> {
        await this.syncSubscriptionsFromStorage();
        const subscriptionsObject: Record<string, ActorSubscription> = {};
        this.subscriptions.forEach((sub, id) => {
            subscriptionsObject[id] = sub;
        });

        await setValue(STORAGE_KEYS.NEW_WORKS_SUBSCRIPTIONS, subscriptionsObject);
        this.dirtySubscriptionIds.clear();
        this.localDeletedSubscriptionIds.clear();
        this.subscriptionBaseline = new Set(this.subscriptions.keys());
    }

    /**
     * 保存新作品数据
     */
    /**
     * 保存新作品数据（先同步后全量回写，防止陈旧内存快照复活他处已删的作品）
     */
    private async saveNewWorks(): Promise<void> {
        await this.syncNewWorksFromStorage();
        const newWorksObject: Record<string, NewWorkRecord> = {};
        this.newWorks.forEach((work, id) => { newWorksObject[id] = work; });
        // 先保存到本地存储，保持兼容
        await setValue(STORAGE_KEYS.NEW_WORKS_RECORDS, newWorksObject);
        // 再批量写入 IDB（直接调用，SW/dashboard 同 origin 共享同一 IDB）
        try { await newWorksBulkPut(Object.values(newWorksObject)); } catch (err) { log.error('[NewWorks] 批量写入 IndexedDB 失败:', err); }
        this.dirtyWorkIds.clear();
        this.localDeletedWorkIds.clear();
        this.workBaseline = new Set(this.newWorks.keys());
    }

    /**
     * 添加新作品记录
     */
    async addNewWork(work: NewWorkRecord): Promise<void> {
        await this.initialize();
        if (!this.newWorks.has(work.id)) {
            this.newWorks.set(work.id, work);
            this.dirtyWorkIds.add(work.id);
            await this.saveNewWorks();
        }
        try {
            await newWorksPut(work);
        } catch (err) {
            log.error(`[NewWorks] 单条写入 IndexedDB 失败 ${work.id}:`, err);
            try { recordNewWorksDiagnosticError('newworks_add_persist_failed', err); } catch {}
        }
    }

    /**
     * 批量添加新作品记录
     *
     * 直接写入 IndexedDB：Service Worker 与 dashboard 页面同 origin、共享同一 IDB，
     * 不再依赖动态 import / runtime 消息传递（消息路径在 SW 内无接收端，会导致 0/N 全部失败）。
     * @returns 持久化统计 { total, saved, failed }
     */
    async addNewWorks(works: NewWorkRecord[]): Promise<NewWorksAddStats> {
        await this.initialize();
        const total = works.length;
        log.info(`[NewWorks] 准备添加 ${total} 个新作品`);

        if (total === 0) {
            return { total: 0, saved: 0, failed: 0 };
        }

        let hasChanges = false;
        works.forEach(work => {
            if (!this.newWorks.has(work.id)) {
                this.newWorks.set(work.id, work);
                this.dirtyWorkIds.add(work.id);
                hasChanges = true;
            }
        });

        log.verbose(`[NewWorks] hasChanges: ${hasChanges}, 内存中现有 ${this.newWorks.size} 个作品, 将直写 ${total} 个作品到 IndexedDB`);

        if (hasChanges) {
            await this.saveNewWorks();
            log.info(`[NewWorks] 已保存到 chrome.storage`);
        }

        let saved = 0;
        let failed = 0;
        for (const work of works) {
            try {
                await newWorksPut(work);
                saved++;
                log.verbose(`[NewWorks] 成功写入作品 ${work.id} (${saved + failed}/${total})`);
            } catch (err) {
                failed++;
                log.error(`[NewWorks] 写入作品 ${work.id} 失败:`, err);
            }
        }
        log.info(`[NewWorks] 已保存 ${saved}/${total} 个作品到 IndexedDB (直接调用)`);

        if (failed > 0) {
            try {
                recordNewWorksDiagnosticError('newworks_add_persist_failed', new Error(`addNewWorks 持久化失败 ${failed}/${total}`));
            } catch {}
        }

        return { total, saved, failed };
    }

    /**
     * 标记某订阅刚完成一次检查（更新 lastCheckTime 并持久化）
     */
    async markSubscriptionChecked(actorId: string): Promise<void> {
        await this.initialize();
        // SW 可能在该订阅创建之前就已启动（initialize 幂等，内存订阅表陈旧）：
        // 先与存储双向同步（并入他处新增 / 移除他处已删），再处理目标订阅
        await this.syncSubscriptionsFromStorage();
        const subscription = this.subscriptions.get(actorId);
        if (!subscription) return;
        subscription.lastCheckTime = Date.now();
        this.dirtySubscriptionIds.add(actorId);
        await this.saveSubscriptions();
        log.verbose(`[NewWorks] 已更新订阅最后检查时间: ${subscription.actorName}`);
    }
}
