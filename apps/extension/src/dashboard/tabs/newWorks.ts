// src/dashboard/tabs/newWorks.ts
// 新作品标签页实现

import { newWorksManager } from '../../features/newWorks';
// 移除未使用的 actorManager 与 newWorksCollector 引用
import { actorSelector } from '../components/actorSelector';
import { showMessage } from '../ui/toast';
import { showConfirm, showDanger } from '../components/confirmModal';
import {
    MAX_UNREAD_BATCH_OPEN_COUNT,
    getNewWorksPageSize,
} from './newWorksBatchOpenPolicy';
import { runUnreadBatchOpenWorkflow } from './newWorksBatchOpenWorkflow';
import { attachNewWorksFilterControls } from './newWorksFilterControlsRuntime';
import { createNewWorksTabState } from './newWorksTabState';
import { renderNewWorksListRuntime, type RenderNewWorksListResult } from './newWorksListRuntime';
import {
    clearNewWorksSelection,
    selectAllCurrentNewWorksPage,
    syncNewWorksBatchOperations,
} from './newWorksListRuntime';
import { runNewWorksManualCheckWorkflow } from './newWorksManualCheckWorkflow';
import {
    runNewWorksManualConfirmWorkflow,
    type NewWorksManualCommitResponse,
} from './newWorksManualConfirmWorkflow';
import type {
    NewWorksManualConfirmSource,
    NewWorksManualPendingWork,
} from './newWorksManualConfirmViewModel';
import { runNewWorksStatusSyncWorkflow } from './newWorksStatusSyncWorkflow';
import { runNewWorksAutoStatusSyncWorkflow } from './newWorksAutoStatusSyncWorkflow';
import {
    runDeleteWorksWorkflow,
    runMarkWorksAsReadWorkflow,
    runVisitWorkWorkflow,
} from './newWorksItemActionsWorkflow';
import { attachNewWorksHelpTooltip } from './newWorksHelpTooltipRuntime';
import { updateNewWorksLastCheckTimeDisplay } from './newWorksLastCheckTimeRuntime';
import { openSubscriptionManagementModal } from './newWorksSubscriptionModalRuntime';
import { createNewWorksSubscriptionActionsRuntime } from './newWorksSubscriptionActionsRuntime';
import {
    attachNewWorksProgressListener,
    detachNewWorksProgressListener,
    ensureNewWorksProgressUI,
    hideNewWorksProgressUIAfter,
    updateNewWorksProgressUI,
} from './newWorksProgressRuntime';
import type { NewWorksProgressData } from './newWorksProgressRuntime';
import {
    buildScanInterruptedToastMessage,
    buildScanSummaryToastMessage,
    restoreNewWorksScanState,
    type RestoreRunningScanState,
    type ScanStatusQueryResult,
} from './newWorksScanRestoreWorkflow';
import { renderNewWorksStatsRuntime } from './newWorksStatsRuntime';
import {
    findSelectedBatchWorkById,
    runSelectedBatchOpenWorkflow,
} from './newWorksSelectedBatchWorkflow';
import {
    getSelectedBatchCurrentPageWork,
    setBatchOpenSelectedButtonLoading,
} from './newWorksSelectedBatchRuntime';
import { runBatchDeleteSelectedWorkflow } from './newWorksBatchDeleteWorkflow';
import { attachNewWorksButtonEvents } from './newWorksButtonEventsRuntime';
import {
    setBatchDeleteSelectedButtonLoading as setBatchDeleteSelectedButtonLoadingState,
    setCheckNowButtonLoading as setCheckNowButtonLoadingState,
    setSyncStatusButtonLoading as setSyncStatusButtonLoadingState,
    updateBatchOpenUnreadButtonState,
} from './newWorksButtonStateRuntime';
import { dashboardTabLifecycle } from './tabLifecycle';
import { createSingleFlightAsyncTask } from './activationScheduler';
import { waitForDomReady } from './domReadyPoller';
import { readNewWorksDiagnosticMode } from './newWorksDiagnosticMode';
import { renderNewWorksPage } from './newWorksRenderPlan';
import { createNewWorksAutoSyncScheduler } from './newWorksAutoSyncScheduler';
import { measureNewWorksInitializationPhase } from './newWorksInitializationDiagnostics';
import { scheduleHomeChartRender } from '../home/homeRenderScheduler';
import { enableNewWorksDiagnosticsFromQuery, recordNewWorksDiagnosticCounter, beginNewWorksDiagnosticSpan } from '../../features/newWorks/newWorksDiagnostics';

export class NewWorksTab {
    public isInitialized: boolean = false;
    private readonly state = createNewWorksTabState();
    private readonly subscriptionActions = createNewWorksSubscriptionActionsRuntime({
        initialize: () => newWorksManager.initialize(),
        getSubscriptions: () => newWorksManager.getSubscriptions(),
        showActorSelector: (subscribedIds, onSelected) => actorSelector.showSelector(subscribedIds, onSelected),
        addSubscription: actorId => newWorksManager.addSubscription(actorId),
        getGlobalSubscriptionsForModal: () => newWorksManager.getSubscriptions(),
        openSubscriptionManagementModal,
        toggleSubscription: (actorId, enabled) => newWorksManager.toggleSubscription(actorId, enabled),
        removeSubscription: actorId => newWorksManager.removeSubscription(actorId),
        confirmRemove: actorName => showDanger(`确定要移除对演员 ${actorName} 的订阅吗？`, '移除订阅'),
        sendSingleActorCheck: subscription => new Promise<any>((resolve) => {
            chrome.runtime.sendMessage(
                {
                    type: 'new-works-check-single-actor',
                    actorId: subscription.actorId,
                    actorName: subscription.actorName,
                    // 新作品页订阅行的「扫描」= 手动检查路径：后台只收集，确认后入库
                    confirmRequired: true,
                },
                resolve,
            );
        }),
        confirmAndCommit: source => this.confirmAndCommitNewWorksManualResults(source),
        render: () => this.render(),
        showMessage,
        logInfo: (message, data) => data === undefined ? console.log(message) : console.log(message, data),
        logError: (message, error) => console.error(message, error),
    });
    private debounceRender = this.debounce(() => this.render(), 300);
    private progressListener?: (message: any) => void;
    private progressEl?: HTMLElement;
    /** 手动检查在途标记：发起页收到 finished 广播不重复收口（由 sendResponse 结果路径收口） */
    private manualCheckInFlight = false;
    /** 进度 UI 世代：延迟隐藏到期时校验仍属当前扫描（窗口内重开新扫描，旧延迟不得拆新 UI） */
    private progressUiGeneration = 0;
    /** 终态收口标记：查询回填与终态广播双路径互斥，防重复 toast */
    private scanTerminalHandled = false;
    private unreadBatchOpenCooldownTimer?: number;
    private active = true;
    private renderGeneration = 0;
    private lifecycleUnregister: (() => void) | null = null;
    private refreshEventHandler: (() => void) | null = null;
    private domReadyController: AbortController | null = null;
    private readonly initializeSingleFlight = createSingleFlightAsyncTask(() => this.initializeInternal());
    private readonly diagnosticMode = readNewWorksDiagnosticMode();
    private readonly autoSyncScheduler = createNewWorksAutoSyncScheduler({
        run: () => { void this.autoSyncStatus(); },
        schedule: callback => scheduleHomeChartRender(callback, { timeoutMs: 1200 }),
    });
    private readonly statsScheduler = createNewWorksAutoSyncScheduler({
        run: () => { void this.renderStats(); },
        schedule: callback => scheduleHomeChartRender(callback, { timeoutMs: 1200 }),
    });

    constructor() {
        enableNewWorksDiagnosticsFromQuery(window.location.search);
    }

    /**
     * 初始化新作品标签页
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) return;
        return this.initializeSingleFlight();
    }

    private async initializeInternal(): Promise<void> {
        if (this.isInitialized) return;
        this.ensureLifecycle();
        try {
            console.log('[NewWorks] 开始初始化新作品标签页');

            // 确保DOM元素存在
            const domReady = await measureNewWorksInitializationPhase(
                'page.initialize.domReady.duration',
                () => this.waitForDOM(),
            );
            if (!domReady) return;

            // 设置事件监听器
            await measureNewWorksInitializationPhase(
                'page.initialize.eventListeners.duration',
                () => this.setupEventListeners(),
            );

            // 监听刷新事件
            this.refreshEventHandler = () => {
                if (!this.active) return;
                console.log('[NewWorks] 收到刷新事件，重新渲染列表');
                this.render();
            };
            window.addEventListener('newworks-refresh', this.refreshEventHandler);

            // 渲染页面
            await measureNewWorksInitializationPhase(
                'page.initialize.render.duration',
                () => this.render(),
            );

            this.isInitialized = true;
            // issue#52：刷新/重开后向 SW 查询扫描状态回填（fire-and-forget；查询失败 logError 静默跳过）
            void this.restoreManualScanState();
            // 自动同步状态不与首轮列表竞争；隐藏页会取消未启动的空闲任务。
            if (this.diagnosticMode.autoSync) this.autoSyncScheduler.request();
            console.log('[NewWorks] 新作品标签页初始化完成');
        } catch (error) {
            console.error('[NewWorks] 初始化新作品标签页失败:', error);
        }
    }

    /**
     * 批量打开当前页的未读新作品，并标记为已读
     */
    private async batchOpenCurrentPageUnread(): Promise<void> {
        await runUnreadBatchOpenWorkflow({
            filters: this.state.filters,
            page: this.state.getPage(),
            pageSize: this.getCurrentPageSize(),
            deps: {
                getCooldownRemaining: () => this.getUnreadBatchOpenCooldownRemaining(),
                getCooldownSeconds: () => this.getUnreadBatchOpenCooldownSeconds(),
                updateButton: options => this.updateBatchOpenUnreadButton(options),
                getNewWorks: query => newWorksManager.getNewWorks(query as any),
                confirm: options => showConfirm(options),
                openWorkUrl: url => this.openNewWorkUrl(url),
                markAsRead: workIds => newWorksManager.markAsRead(workIds),
                startCooldown: () => this.startUnreadBatchOpenCooldown(),
                render: () => this.render(),
                showMessage,
                logWarn: (message, error) => console.warn(message, error),
                logError: (message, error) => console.error(message, error),
            },
        });
    }

    private async openNewWorkUrl(url: string): Promise<void> {
        if (typeof chrome !== 'undefined' && chrome.tabs && typeof chrome.tabs.create === 'function') {
            await new Promise<void>((resolve) => {
                try { chrome.tabs.create({ url }, () => resolve()); } catch { resolve(); }
            });
        } else {
            window.open(url, '_blank');
        }
    }

    private getCurrentPageSize(): number {
        return getNewWorksPageSize(this.state.filters.filter);
    }

    private getUnreadBatchOpenCooldownRemaining(now: number = Date.now()): number {
        return this.state.getUnreadBatchOpenCooldownRemaining(now);
    }

    private getUnreadBatchOpenCooldownSeconds(now: number = Date.now()): number {
        return this.state.getUnreadBatchOpenCooldownSeconds(now);
    }

    private startUnreadBatchOpenCooldown(): void {
        this.state.startUnreadBatchOpenCooldown();
        if (this.unreadBatchOpenCooldownTimer) {
            window.clearInterval(this.unreadBatchOpenCooldownTimer);
        }

        this.updateBatchOpenUnreadButton();
        this.unreadBatchOpenCooldownTimer = window.setInterval(() => {
            this.updateBatchOpenUnreadButton();
            if (this.getUnreadBatchOpenCooldownRemaining() <= 0 && this.unreadBatchOpenCooldownTimer) {
                window.clearInterval(this.unreadBatchOpenCooldownTimer);
                this.unreadBatchOpenCooldownTimer = undefined;
            }
        }, 1000);
    }

    private updateBatchOpenUnreadButton(options?: { loading?: boolean }): void {
        updateBatchOpenUnreadButtonState({
            loading: options?.loading,
            cooldownSeconds: this.getUnreadBatchOpenCooldownSeconds(),
            maxOpenCount: MAX_UNREAD_BATCH_OPEN_COUNT,
        });
    }

    /**
     * 等待DOM元素准备就绪
     */
    private async waitForDOM(): Promise<boolean> {
        this.domReadyController?.abort();
        const controller = new AbortController();
        this.domReadyController = controller;

        const ready = await waitForDomReady(() => {
                const newWorksTab = document.getElementById('tab-new-works');
                const checkNowBtn = document.getElementById('checkNowBtn');
                const syncStatusBtn = document.getElementById('syncStatusBtn');
                const cleanupReadBtn = document.getElementById('cleanupReadWorksBtn');
                const addSubscriptionBtn = document.getElementById('addSubscriptionBtn');
                const manageSubscriptionsBtn = document.getElementById('manageSubscriptionsBtn');
                const batchOpenUnreadBtn = document.getElementById('batchOpenUnreadBtn');
                const selectAllCurrentPageBtn = document.getElementById('selectAllCurrentPageBtn');
                const clearSelectionBtn = document.getElementById('clearSelectionBtn');
                const batchOpenSelectedBtn = document.getElementById('batchOpenSelectedBtn');

                return Boolean(newWorksTab && checkNowBtn && syncStatusBtn && cleanupReadBtn && addSubscriptionBtn && manageSubscriptionsBtn && batchOpenUnreadBtn && selectAllCurrentPageBtn && clearSelectionBtn && batchOpenSelectedBtn);
        }, { signal: controller.signal });

        if (this.domReadyController === controller) {
            this.domReadyController = null;
        }
        if (ready) {
            console.log('新作品标签页DOM元素已准备就绪');
        }
        return ready;
    }

    /**
     * 设置事件监听器
     */
    private async setupEventListeners(): Promise<void> {
        // 使用事件委托，确保在DOM元素存在时绑定事件
        this.bindButtonEvents();
        this.bindFormEvents();
    }

    /**
     * 绑定按钮事件
     */
    private bindButtonEvents(): void {
        attachNewWorksButtonEvents({
            checkNow: () => this.checkNewWorksNow(),
            syncStatus: () => this.syncNewWorksStatus(),
            setupSyncHelp: () => this.setupHelpIcon(),
            setupCheckNowHelp: () => this.setupCheckNowHelpIcon(),
            addSubscription: () => this.showAddSubscriptionModal(),
            manageSubscriptions: () => this.showManageSubscriptionsModal(),
            confirmCleanupRead: () => showDanger('将删除所有已读的新作品，操作不可撤销，确认继续？', '清理已读'),
            cleanupReadWorks: () => newWorksManager.cleanupReadWorks(),
            render: () => this.render(),
            showMessage,
            logError: (message, error) => console.error(message, error),
            batchOpenUnread: () => this.batchOpenCurrentPageUnread(),
            updateBatchOpenUnreadButton: () => this.updateBatchOpenUnreadButton(),
            selectAllCurrentPage: () => this.selectAllCurrentPage(),
            clearSelection: () => this.clearSelection(),
            batchOpenSelected: () => this.batchOpenSelected(),
            batchDeleteSelected: () => this.batchDeleteSelected(),
        });
    }

    /**
     * 绑定表单事件
     */
    private bindFormEvents(): void {
        attachNewWorksFilterControls(this.state.filters, {
            setPage: page => { this.state.setPage(page); },
            render: () => this.render(),
            debounceRender: () => this.debounceRender(),
        });
    }

    /**
     * 渲染页面
     */
    private async render(): Promise<void> {
        if (!this.active || this.state.isLoading()) return;

        const generation = ++this.renderGeneration;
        
        try {
            this.state.setLoading(true);
            await renderNewWorksPage({
                options: this.diagnosticMode,
                renderList: () => this.renderNewWorksList(),
                renderStats: stats => this.renderStats(stats),
                scheduleStats: () => this.statsScheduler.request(),
            });
            if (!this.active || generation !== this.renderGeneration) return;
        } catch (error) {
            console.error('渲染新作品页面失败:', error);
        } finally {
            this.state.setLoading(false);
        }
    }

    private ensureLifecycle(): void {
        if (this.lifecycleUnregister) return;
        this.lifecycleUnregister = dashboardTabLifecycle.register('tab-new-works', {
            onActive: () => {
                this.active = true;
                this.autoSyncScheduler.setActive(true);
                this.statsScheduler.setActive(true);
            },
            onRestore: () => {
                this.active = true;
                this.autoSyncScheduler.setActive(true);
                this.statsScheduler.setActive(true);
                if (this.isInitialized) {
                    void this.render();
                    this.updateBatchOpenUnreadButton();
                } else {
                    // 初始化可能在隐藏时被取消，恢复后允许重新建立一次初始化流程。
                    void this.initialize().then(() => {
                        if (!this.isInitialized && this.active) void this.initialize();
                    });
                }
            },
            onHidden: () => this.suspendForHiddenTab(),
            onDispose: () => {
                this.autoSyncScheduler.dispose();
                this.statsScheduler.dispose();
                this.suspendForHiddenTab();
                if (this.refreshEventHandler) {
                    window.removeEventListener('newworks-refresh', this.refreshEventHandler);
                    this.refreshEventHandler = null;
                }
                this.lifecycleUnregister?.();
                this.lifecycleUnregister = null;
            },
        });
    }

    private suspendForHiddenTab(): void {
        this.active = false;
        this.autoSyncScheduler.setActive(false);
        this.statsScheduler.setActive(false);
        this.renderGeneration += 1;
        this.domReadyController?.abort();
        this.domReadyController = null;
        this.detachProgressListener();
        if (this.unreadBatchOpenCooldownTimer) {
            window.clearInterval(this.unreadBatchOpenCooldownTimer);
            this.unreadBatchOpenCooldownTimer = undefined;
        }
        this.progressEl?.remove();
        this.progressEl = undefined;
        document.getElementById('newWorksStatsContainer')?.replaceChildren();
        document.getElementById('newWorksList')?.replaceChildren();
        document.getElementById('newWorksPagination')?.replaceChildren();
        this.state.setLoading(false);
    }

    /**
     * 渲染统计信息
     */
    private async renderStats(stats?: import('../../types').NewWorksStats): Promise<void> {
        await renderNewWorksStatsRuntime({
            filters: this.state.filters,
            stats,
            deps: {
                getStats: async () => {
                    recordNewWorksDiagnosticCounter('page.stats.calls');
                    const end = beginNewWorksDiagnosticSpan('page.stats.duration');
                    try { return await newWorksManager.getStats(); } finally { end(); }
                },
                setPage: page => { this.state.setPage(page); },
                render: () => this.render(),
                openSubscriptionManager: () => {
                    const manageBtn = document.getElementById('manageSubscriptionsBtn') as HTMLButtonElement | null;
                    manageBtn?.click();
                },
                updateLastCheckTimeDisplay: lastCheckTime => this.updateLastCheckTimeDisplay(lastCheckTime),
                logInfo: (message, data) => data === undefined ? console.log(message) : console.log(message, data),
                logWarn: message => console.warn(message),
                logError: (message, error) => console.error(message, error),
            },
        });
    }

    /**
     * 渲染新作品列表
     */
    private async renderNewWorksList(): Promise<RenderNewWorksListResult | undefined> {
        return await renderNewWorksListRuntime({
            filters: this.state.filters,
            page: this.state.getPage(),
            pageSize: this.getCurrentPageSize(),
            selectedWorks: this.state.selectedWorks,
            deps: {
                getNewWorks: async query => {
                    recordNewWorksDiagnosticCounter('page.list.calls');
                    const end = beginNewWorksDiagnosticSpan('page.list.duration');
                    try { return await newWorksManager.getNewWorks({ ...query, includeStats: false }); } finally { end(); }
                },
                setPage: page => { this.state.setPage(page); },
                render: () => this.render(),
                updateBatchOpenUnreadButton: () => this.updateBatchOpenUnreadButton(),
                markWorksAsRead: workIds => this.markWorksAsRead(workIds),
                visitWork: workId => this.visitWork(workId),
                deleteWorks: workIds => this.deleteWorks(workIds),
                updateBatchOperations: () => this.updateBatchOperations(),
                logInfo: (message, data) => data === undefined ? console.log(message) : console.log(message, data),
                logWarn: message => console.warn(message),
                logError: (message, error) => console.error(message, error),
            },
        });
    }

    /**
     * 防抖函数
     */
    private debounce(func: Function, wait: number) {
        let timeout: NodeJS.Timeout;
        return function executedFunction(...args: any[]) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * 标记作品为已读
     */
    private async markWorksAsRead(workIds: string[]): Promise<void> {
        await runMarkWorksAsReadWorkflow({
            workIds,
            deps: {
                markAsRead: ids => newWorksManager.markAsRead(ids),
                render: () => this.render(),
                logError: (message, error) => console.error(message, error),
            },
        });
    }

    /**
     * 访问作品
     */
    private async visitWork(workId: string): Promise<void> {
        await runVisitWorkWorkflow({
            workId,
            deps: {
                getNewWorks: query => newWorksManager.getNewWorks(query),
                openUrl: url => window.open(url, '_blank'),
                markWorksAsRead: ids => this.markWorksAsRead(ids),
                logError: (message, error) => console.error(message, error),
            },
        });
    }

    /**
     * 删除作品
     */
    private async deleteWorks(workIds: string[]): Promise<void> {
        await runDeleteWorksWorkflow({
            workIds,
            deps: {
                confirm: message => confirm(message),
                deleteWorks: ids => newWorksManager.deleteWorks(ids),
                clearSelection: () => this.state.clearSelection(),
                render: () => this.render(),
                logError: (message, error) => console.error(message, error),
            },
        });
    }

    /**
     * 同步新作品状态
     */
    private async syncNewWorksStatus(): Promise<void> {
        await runNewWorksStatusSyncWorkflow({
            deps: {
                setSyncButtonLoading: loading => this.setSyncStatusButtonLoading(loading),
                syncWithVideoRecords: async () => {
                    recordNewWorksDiagnosticCounter('page.manualSync.calls');
                    const end = beginNewWorksDiagnosticSpan('page.manualSync.duration');
                    try { return await newWorksManager.syncWithVideoRecords({ force: true }); } finally { end(); }
                },
                render: () => this.render(),
                showMessage,
                logInfo: (message, data) => data === undefined ? console.log(message) : console.log(message, data),
                logError: (message, error) => console.error(message, error),
            },
        });
    }

    private setSyncStatusButtonLoading(loading: boolean): void {
        setSyncStatusButtonLoadingState(loading);
    }

    /**
     * 初始化时自动同步状态（静默执行）
     */
    private async autoSyncStatus(): Promise<void> {
        await runNewWorksAutoStatusSyncWorkflow({
            deps: {
                syncWithVideoRecords: async () => {
                    recordNewWorksDiagnosticCounter('page.autoSync.calls');
                    const end = beginNewWorksDiagnosticSpan('page.autoSync.duration');
                    try { return await newWorksManager.syncWithVideoRecords({ force: false }); } finally { end(); }
                },
                render: () => this.render(),
                logInfo: message => console.log(message),
                logError: (message, error) => console.error(message, error),
            },
        });
    }

    /**
     * 设置帮助图标的自定义tooltip
     */
    private setupHelpIcon(): void {
        const helpIcon = document.getElementById('syncStatusHelpIcon');
        if (!helpIcon) return;

        const helpText = '将新作品列表中的作品状态与番号库同步。\n\n例如：如果某个新作品在番号库中被标记为"已看"或"已浏览"，点击此按钮后会自动更新新作品列表中的状态。\n\n建议在浏览完作品后点击此按钮，保持状态一致。';
        attachNewWorksHelpTooltip(helpIcon, helpText);
    }

    /**
     * 设置立即检查按钮的帮助图标
     */
    private setupCheckNowHelpIcon(): void {
        const helpIcon = document.getElementById('checkNowHelpIcon');
        if (!helpIcon) return;

        const helpText = '立即检查所有已启用的订阅演员的新作品。\n\n系统会根据设置的并发数量同时检查多个演员，并自动过滤已看、已浏览等状态的作品。\n\n检查完成后，新发现的作品会显示在下方列表中。';
        attachNewWorksHelpTooltip(helpIcon, helpText);
    }

    /**
     * 更新批量操作状态
     */
    private updateBatchOperations(): void {
        syncNewWorksBatchOperations(this.state.selectedWorks);
    }

    /**
     * 本页全选
     */
    private selectAllCurrentPage(): void {
        selectAllCurrentNewWorksPage(this.state.selectedWorks);
        this.updateBatchOperations();
    }

    /**
     * 清空选择
     */
    private clearSelection(): void {
        console.log('执行清空选择，当前选中数量:', this.state.selectedWorks.size);
        clearNewWorksSelection(this.state.selectedWorks);
        this.updateBatchOperations();
        console.log('清空选择完成');
    }

    /**
     * 批量打开（已选）
     */
    private async batchOpenSelected(): Promise<void> {
        const ids = Array.from(this.state.selectedWorks);
        await runSelectedBatchOpenWorkflow({
            selectedIds: ids,
            deps: {
                confirm: options => showConfirm(options),
                setLoading: loading => this.setBatchOpenSelectedLoading(loading),
                getCurrentPageWork: id => getSelectedBatchCurrentPageWork(id),
                findWorkById: id => findSelectedBatchWorkById(id, query => newWorksManager.getNewWorks(query)),
                openWorkUrl: url => this.openNewWorkUrl(url),
                markAsRead: workIds => newWorksManager.markAsRead(workIds),
                removeSelection: workIds => workIds.forEach(workId => this.state.selectedWorks.delete(workId)),
                render: () => this.render(),
                showMessage,
                updateBatchOperations: () => this.updateBatchOperations(),
                logWarn: (message, error) => console.warn(message, error),
                logError: (message, error) => console.error(message, error),
            },
        });
    }

    private setBatchOpenSelectedLoading(loading: boolean): void {
        setBatchOpenSelectedButtonLoading({
            loading,
            selectedCount: this.state.selectedWorks.size,
        });
    }

    /**
     * 批量删除（已选）
     */
    private async batchDeleteSelected(): Promise<void> {
        await runBatchDeleteSelectedWorkflow({
            selectedWorks: this.state.selectedWorks,
            deps: {
                confirm: options => showConfirm(options),
                setDeletingButtonLoading: (loading, selectedCount) => this.setBatchDeleteSelectedLoading(loading, selectedCount),
                deleteWorks: workIds => newWorksManager.deleteWorks(workIds),
                render: () => this.render(),
                showMessage,
                updateBatchOperations: () => this.updateBatchOperations(),
                logError: (message, error) => console.error(message, error),
            },
        });
    }

    private setBatchDeleteSelectedLoading(loading: boolean, selectedCount: number): void {
        setBatchDeleteSelectedButtonLoadingState({
            loading,
            selectedCount,
        });
    }

    /**
     * 更新上一次检查时间显示
     */
    private updateLastCheckTimeDisplay(lastCheckTime?: number): void {
        updateNewWorksLastCheckTimeDisplay(lastCheckTime);
    }

    /**
     * 立即检查新作品
     */
    private async checkNewWorksNow(): Promise<void> {
        this.manualCheckInFlight = true;
        this.scanTerminalHandled = false;
        try {
            await runNewWorksManualCheckWorkflow({
                deps: {
                    setCheckingButtonLoading: loading => this.setCheckNowButtonLoading(loading),
                    getSubscriptions: () => newWorksManager.getSubscriptions(),
                    ensureProgressUI: () => this.ensureProgressUI(),
                    updateProgressUI: data => this.updateProgressUI(data),
                    attachProgressListener: () => this.attachProgressListener(),
                    detachProgressListener: () => this.detachProgressListener(),
                    hideProgressUIAfter: ms => this.hideProgressUIAfter(ms),
                    sendManualCheck: () => new Promise<any>((resolve) => {
                        // confirmRequired = 后台只收集不入库，弹窗确认后才写（无标记仍是旧直写）
                        chrome.runtime.sendMessage({ type: 'new-works-manual-check', confirmRequired: true }, resolve);
                    }),
                    confirmAndCommit: source => this.confirmAndCommitNewWorksManualResults(source),
                    render: () => this.render(),
                    showMessage,
                    logWarn: (message, error) => console.warn(message, error),
                    logError: (message, error) => console.error(message, error),
                    ackScanState: () => this.sendManualScanStateAck(),
                },
            });
        } finally {
            this.manualCheckInFlight = false;
        }
    }

    private setCheckNowButtonLoading(loading: boolean): void {
        setCheckNowButtonLoadingState(loading);
    }

    /**
     * 手动检查结果的「确认后才入库」流程。
     * 适用范围 = 新作品页两条手动检查路径（立刻检查 / 订阅行单演员扫描）；
     * 演员选择器与演员页扫描按钮未接此流程，仍是当场扫描即入库。
     */
    private async confirmAndCommitNewWorksManualResults(source: NewWorksManualConfirmSource): Promise<void> {
        await runNewWorksManualConfirmWorkflow({
            deps: {
                showConfirmModal: ({ title, html, confirmLabel, cancelLabel }) => showConfirm({
                    title,
                    message: html,
                    isHtml: true,
                    confirmText: confirmLabel,
                    cancelText: cancelLabel,
                    type: 'info',
                    className: 'newworks-confirm-modal',
                }),
                sendManualCommit: (works: NewWorksManualPendingWork[]) => new Promise<NewWorksManualCommitResponse>((resolve) => {
                    chrome.runtime.sendMessage(
                        { type: 'new-works-manual-commit', works },
                        (response?: NewWorksManualCommitResponse) => {
                            if (chrome.runtime.lastError) {
                                resolve({ success: false, error: chrome.runtime.lastError.message });
                                return;
                            }
                            resolve(response || { success: false, error: '后台无响应' });
                        },
                    );
                }),
                render: () => this.render(),
                showMessage,
                logError: (message, error) => console.error(message, error),
            },
            source,
        });
    }

    /**
     * 创建进度UI（若不存在）
     */
    private ensureProgressUI(): void {
        // 世代 +1：旧延迟隐藏到期时若世代已变，不拆新扫描 UI
        this.progressUiGeneration++;
        this.progressEl = ensureNewWorksProgressUI(this.progressEl, {
            sendCancelMessage: () => {
                try {
                    chrome.runtime.sendMessage({ type: 'new-works-manual-cancel' }, (_res?: any) => {});
                } catch {}
            },
        });
    }

    /**
     * 更新进度UI
     */
    private updateProgressUI(data: NewWorksProgressData): void {
        updateNewWorksProgressUI(this.progressEl, data);
    }

    /**
     * 隐藏进度UI（延迟）
     */
    private hideProgressUIAfter(ms: number): void {
        const generation = this.progressUiGeneration;
        hideNewWorksProgressUIAfter(this.progressEl, ms, () => {
            if (this.progressUiGeneration === generation) this.progressEl = undefined;
        }, window, () => this.progressUiGeneration === generation);
    }

    /**
     * 绑定后台进度消息监听
     */
    private attachProgressListener(): void {
        this.progressListener = attachNewWorksProgressListener(
            this.progressListener,
            data => {
                this.updateProgressUI(data);
                // 本页发起的扫描由 sendResponse 结果路径收口（确认弹窗/直写提示）；finished 广播只服务离线恢复页
                if (data.finished && !this.manualCheckInFlight) this.onManualScanFinished(data);
            },
            chrome.runtime as any,
        );
    }

    /**
     * 解绑后台进度消息监听
     */
    private detachProgressListener(): void {
        this.progressListener = detachNewWorksProgressListener(this.progressListener, chrome.runtime as any);
    }

    /**
     * 显示添加订阅弹窗
     */
    private async showAddSubscriptionModal(): Promise<void> {
        await this.subscriptionActions.showAddSubscriptionModal();
    }

    /**
     * 显示管理订阅弹窗
     */
    private async showManageSubscriptionsModal(): Promise<void> {
        await this.subscriptionActions.showManageSubscriptionsModal();
    }
    /**
     * issue#52：刷新/重开后向 SW 查询手动扫描状态并回填
     * （running → 恢复进度 UI + 取消按钮；terminal → 一次性提示；idle → 无操作）
     */
    private async restoreManualScanState(): Promise<void> {
        let restoredRunning: RestoreRunningScanState | null = null;
        await restoreNewWorksScanState({
            queryStatus: () => this.queryManualScanState(),
            restoreProgressUI: state => {
                restoredRunning = state;
                this.restoreManualScanProgressUI(state);
            },
            showSummaryToast: (status, result) => showMessage(buildScanSummaryToastMessage(status, result), 'info'),
            showInterruptedToast: () => showMessage(buildScanInterruptedToastMessage(), 'info'),
            logError: (message, error) => console.error('[NewWorks]', message, error),
        });
        if (!restoredRunning) return;
        // 二次查询：兜「首查与 UI 恢复之间扫描已结束、本页错过终态广播」窗口
        // （terminal 已被 SW 查询侧消费；广播与回填双路径由 scanTerminalHandled 互斥防重复提示）
        const recheck = await this.queryManualScanStateSafe();
        if (!recheck) return;
        if (recheck.status === 'done' || recheck.status === 'cancelled') {
            this.onManualScanFinished({
                finished: true,
                cancelled: recheck.status === 'cancelled',
                resultSummary: recheck.result,
            });
        } else if (recheck.status === 'interrupted') {
            showMessage(buildScanInterruptedToastMessage(), 'info');
        }
    }

    /** running 回填：恢复进度 UI + 取消按钮 + 进行中按钮态（取消机制零改动，原样复用） */
    private restoreManualScanProgressUI(state: RestoreRunningScanState): void {
        this.setCheckNowButtonLoading(true);
        this.ensureProgressUI();
        this.updateProgressUI({
            processed: state.processed,
            total: state.total,
            identifiedTotal: state.identifiedTotal,
            pendingTotal: state.pendingTotal,
            actorName: state.actorName,
            activeActorNames: state.activeActorNames,
            concurrency: state.concurrency,
        });
        this.attachProgressListener();
    }

    /**
     * 终态收口（双路径入口：SW finished 广播 / 查询回填二次查询）；
     * scanTerminalHandled 保证每页加载只收口一次（防广播与回填竞态重复提示）
     */
    private onManualScanFinished(data: NewWorksProgressData): void {
        if (this.scanTerminalHandled) return;
        this.scanTerminalHandled = true;
        this.detachProgressListener();
        this.setCheckNowButtonLoading(false);
        this.hideProgressUIAfter(1500);
        if (!data.error && data.resultSummary) {
            showMessage(buildScanSummaryToastMessage(data.cancelled ? 'cancelled' : 'done', data.resultSummary), 'info');
        }
        this.sendManualScanStateAck();
    }

    /** 查询 SW 手动扫描状态（失败 reject；调用方决定静默或记日志） */
    private queryManualScanState(): Promise<ScanStatusQueryResult> {
        return new Promise<ScanStatusQueryResult>((resolve, reject) => {
            try {
                chrome.runtime.sendMessage({ type: 'new-works-manual-scan-status' }, (response: any) => {
                    const lastError = chrome.runtime.lastError;
                    if (lastError) {
                        reject(new Error(lastError.message || 'scan status query failed'));
                        return;
                    }
                    if (!response || response.success !== true || !response.status || typeof response.status !== 'object') {
                        reject(new Error(response && response.error ? String(response.error) : 'scan status query failed'));
                        return;
                    }
                    resolve(this.mapScanStatusResponse(response.status));
                });
            } catch (error) {
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    private async queryManualScanStateSafe(): Promise<ScanStatusQueryResult | null> {
        try {
            return await this.queryManualScanState();
        } catch {
            return null;
        }
    }

    /** SW 侧完整状态 → 页面侧扁平形态（防御性字段过滤） */
    private mapScanStatusResponse(status: any): ScanStatusQueryResult {
        if (status.status === 'running') {
            return {
                status: 'running',
                processed: typeof status.processed === 'number' ? status.processed : 0,
                total: typeof status.total === 'number' ? status.total : 0,
                identifiedTotal: typeof status.identifiedTotal === 'number' ? status.identifiedTotal : 0,
                pendingTotal: typeof status.pendingTotal === 'number' ? status.pendingTotal : 0,
                actorName: typeof status.actorName === 'string' ? status.actorName : undefined,
                activeActorNames: Array.isArray(status.activeActorNames)
                    ? status.activeActorNames.filter((name: unknown): name is string => typeof name === 'string')
                    : [],
                concurrency: typeof status.concurrency === 'number' ? status.concurrency : undefined,
            };
        }
        if (status.status === 'done' || status.status === 'cancelled') {
            return {
                status: status.status,
                result: status.result && typeof status.result === 'object' ? status.result : undefined,
            };
        }
        if (status.status === 'interrupted') {
            return { status: 'interrupted' };
        }
        return { status: 'idle' };
    }

    /** 终态消费确认（SW 只清 terminal；running/SW 缺席均安全 no-op） */
    private sendManualScanStateAck(): void {
        try {
            chrome.runtime.sendMessage({ type: 'new-works-manual-scan-ack' }, () => {
                void chrome.runtime.lastError;
            });
        } catch {}
    }
}

// 导出实例
export const newWorksTab = new NewWorksTab();
