import { STATE } from '../state';
import { VIDEO_STATUS, STORAGE_KEYS } from '../../utils/config';
import type { VideoRecord, VideoStatus } from '../../types';
import { showMessage } from '../ui/toast';
import { showConfirmationModal } from '../ui/modal';
import { dbViewedPage, dbViewedStats, dbViewedDelete, dbViewedBulkDelete, dbViewedQuery, dbViewedPut, dbViewedGet } from '../dbClient';
import { dbListsGetAllNormalized, dbViewedPatchList, dbViewedBulkPatchList } from '../dbClient';
import {
    parseRecordsSearchTokens,
} from './records/searchQueryModel';
import { createRecordsCoverRuntimeController } from './records/coverRuntimeController';
import { createRecordsAdvancedConditionsController } from './records/advancedConditionsController';
import { createRecordsViewToolbarController } from './records/viewToolbarController';
import { createRecordsBatchSelectionController } from './records/batchSelectionController';
import { createRecordsExportController } from './records/exportController';
import { createRecordsSearchSuggestController } from './records/searchSuggestController';
import { createRecordsStatsController } from './records/statsController';
import { createRecordsListMetaController } from './records/listMetaController';
import { createRecordsSearchResultCountController } from './records/searchResultCountController';
import { createRecordsRenderCoordinator } from './records/renderCoordinator';
import { bindAdvancedSearchToggleDelegation } from './records/advancedSearchToggleBinding';
import { collectRecordsPageElements, ensureUntrackedStatusOption } from './records/pageElements';
import { refreshRecordsSingleRecord } from './records/refreshRecordService';
import { hideRecordsProgressModal, showRecordsProgressModal } from './records/progressModalController';
import { createRecordsQueryRuntime, type RecordsQueryRuntime } from './records/queryRuntime';
import { createRecordsStateRefreshController, type RecordsStateRefreshController } from './records/stateRefreshController';
import { createRecordsItemActionsRuntime } from './records/itemActionsRuntime';
import { createRecordsBatchOperationsRuntime, type RecordsBatchOperationsRuntime } from './records/batchOperationsRuntime';
import { createRecordsFilterRuntime, type RecordsFilterRuntime } from './records/filterRuntime';
import { createRecordsViewRuntime, type RecordsViewRuntime } from './records/viewRuntime';
import { createRecordsLifecycleRuntime } from './records/lifecycleRuntime';
import { shouldRenderRecordsOnRestore } from './records/restorePolicy';
import { type RecordsAdvancedCondition as AdvCondition } from './records/advancedConditionModel';
import { createRecordsBatchImportController, type RecordsBatchImportSubmission } from './records/batchImportController';
import { normalizeBatchNumbers } from './records/batchImportModel';
import { processBatchImportItem, type BatchImportMode } from './records/batchImportService';
import { runBatchImportTask } from './records/batchImportRunner';
import {
    BATCH_IMPORT_TASK_STORAGE_KEY,
    clearBatchImportTask,
    loadBatchImportTask,
    saveBatchImportTask,
    type BatchImportTaskSnapshot,
} from './records/batchImportTaskStore';
import { fetchHtml, parseDetailPage, parseSearchResults } from '../../features/records';
import { dashboardTabLifecycle } from './tabLifecycle';

// 防重复初始化（避免多次绑定事件导致重复行为）
let RECORDS_TAB_INITIALIZED = false;
let recordsActive = true;
let recordsLifecycleUnregister: (() => void) | null = null;

function recordRecordsLifecycleSnapshot(
    stage: 'before-hidden' | 'after-hidden' | 'microtask-after-hidden',
    root: HTMLElement,
    videoList: HTMLElement,
): void {
    const probe = (globalThis as typeof globalThis & {
        __JAVDB_PERF_PROBE__?: { recordsLifecycleSnapshots?: unknown[] };
    }).__JAVDB_PERF_PROBE__;
    if (!probe) return;
    probe.recordsLifecycleSnapshots ??= [];
    probe.recordsLifecycleSnapshots.push({
        stage,
        rootDomNodes: root.querySelectorAll('*').length + 1,
        videoListDomNodes: videoList.querySelectorAll('*').length + 1,
        rootChildCount: root.children.length,
        rootChildren: Array.from(root.children).map((child) => ({
            id: child.id || null,
            className: typeof child.className === 'string' ? child.className.slice(0, 120) : null,
            domNodes: child.querySelectorAll('*').length + 1,
            imageCount: child.querySelectorAll('img').length,
            childMetrics: Array.from(child.children).map((nested) => ({
                id: nested.id || null,
                className: typeof nested.className === 'string' ? nested.className.slice(0, 120) : null,
                domNodes: nested.querySelectorAll('*').length + 1,
            })),
        })),
    });
}

export function initRecordsTab(): void {
    if (RECORDS_TAB_INITIALIZED) {
        console.warn('[RecordsTab] initRecordsTab() called more than once, skipping re-init');
        return;
    }
    RECORDS_TAB_INITIALIZED = true;
    recordsActive = true;
    const pageElements = collectRecordsPageElements();
    const {
        searchInput,
        filterSelect,
        sortSelect,
        videoList,
        paginationContainer,
        recordsPerPageSelect,
        searchResultCount,
    } = pageElements.required;
    ensureUntrackedStatusOption(filterSelect, {
        untracked: VIDEO_STATUS.UNTRACKED,
        viewed: VIDEO_STATUS.VIEWED,
    });

    const {
        advConditionsEl,
        quickTimeField,
        quickTimeValue,
        quickTimeUnit,
    } = pageElements.advanced;
    const searchSuggest = pageElements.searchSuggest;
    const {
        batchOperations,
        selectAllCheckbox,
        selectedCount,
        batchActionsBtn,
        batchActionsDropdown,
        batchModifyListBtn,
        batchAddTagBtn,
        batchRefreshBtn,
        batchDeleteBtn,
        cancelBatchBtn,
    } = pageElements.batch;
    const {
        toggleCoversBtn,
        toggleViewModeBtn,
        myFavoritesBtn,
        batchImportBtn,
    } = pageElements.toolbar;
    let currentViewMode: 'list' | 'card' = STATE.settings.recordsViewMode || 'list'; // 从设置中读取，默认列表视图
    let favoritesFilterActive = false;

    const coverRuntimeController = createRecordsCoverRuntimeController({
        fallbackUrl: chrome.runtime.getURL('assets/alternate-search.png'),
    });

    // 选择状态
    let selectedRecords = new Set<string>();

    // Tags filter state
    let selectedTags = new Set<string>();
    // 由搜索输入解析出的标签（自动同步到 selectedTags）
    let tokenSelectedTags = new Set<string>();
    let allTags = new Set<string>();
    let allTagsStale = true;

    let selectedListIds = new Set<string>();
    let tokenSelectedListIds = new Set<string>();

    let selectedSeriesIds = new Set<string>();
    let tokenSelectedSeriesIds = new Set<string>();
    let selectedLabelIds = new Set<string>();
    let tokenSelectedLabelIds = new Set<string>();

    const listMetaController = createRecordsListMetaController({
        loadLists: dbListsGetAllNormalized,
        shouldRenderAfterLoad: () => {
            try {
                const hasAnyLists = (Array.isArray(STATE.records) ? STATE.records : [])
                    .some((record: any) => Array.isArray(record?.listIds) && record.listIds.length > 0);
                return hasAnyLists || selectedSeriesIds.size > 0 || selectedLabelIds.size > 0;
            } catch {
                return false;
            }
        },
        onAfterLoaded: () => render(),
    });
    const {
        listIdToName,
        listIdToSource,
        seriesIdToName,
        labelIdToName,
        seriesIdToRecord,
        labelIdToRecord,
    } = listMetaController.maps;
    const ensureListMetaLoaded = () => {
        void listMetaController.ensureLoaded();
    };

    const escapeHtml = (s: string) => String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    // ---------- 搜索框 tag 自动补全 ----------
    // 简单防抖实现
    function debounce<F extends (...args: any[]) => void>(fn: F, wait = 150) {
        let t: number | undefined;
        return (...args: Parameters<F>) => {
            if (t) window.clearTimeout(t);
            t = window.setTimeout(() => fn(...args), wait);
        };
    }
    function ensureAllTagsCollected() {
        try { if (allTagsStale) { collectAllTags(); allTagsStale = false; } } catch {}
    }

    // 解析搜索文本中的标签前缀，如：tag:素人  或  #无码
    const parseSearchTokens = parseRecordsSearchTokens;

    // 立即初始化 Tooltip 容器
    coverRuntimeController.ensureTooltipElement();

    // 高级搜索按钮 - 事件委托兜底（避免早期返回导致监听未绑定）
    bindAdvancedSearchToggleDelegation();

    // Advanced search state
    let advConditions: AdvCondition[] = [];

    // 已移除：高级搜索方案相关逻辑（保存/载入/删除）

    // 已移除：rebuildAdvRows（方案功能去除后不再需要）

    if (!searchInput || !videoList || !sortSelect || !recordsPerPageSelect || !paginationContainer) return;

    let currentPage = 1;
    let recordsPerPage = STATE.settings.recordsPerPage || 10;
    let filteredRecords: VideoRecord[] = [];
    // IDB 分页模式
    let serverModeActive = false;
    let serverPageItems: VideoRecord[] = [];
    let serverTotal = 0;
    let lastQueryDurationMs: number | null = null;
    let hasRenderedRecordsPage = false;
    let recordsRenderStale = true;
    let viewRuntime: RecordsViewRuntime;
    let queryRuntime: RecordsQueryRuntime;
    let stateRefreshController: RecordsStateRefreshController;
    let filterRuntime: RecordsFilterRuntime;
    let batchOperationsRuntime: RecordsBatchOperationsRuntime;
    const searchResultCountController = createRecordsSearchResultCountController({
        container: searchResultCount,
        searchInput,
        filterSelect,
        getTotalCount: () => serverModeActive ? serverTotal : filteredRecords.length,
        getDurationMs: () => lastQueryDurationMs,
        getSelectedTagsCount: () => selectedTags.size,
        getSelectedListIdsCount: () => selectedListIds.size,
        getSelectedSeriesIdsCount: () => selectedSeriesIds.size,
        getSelectedLabelIdsCount: () => selectedLabelIds.size,
        getAdvancedConditionsCount: () => advConditions.length,
    });
    const updateSearchResultCount = () => searchResultCountController.update();
    const exportController = createRecordsExportController({
        getExportCountText: () => filteredRecords.length > 0
            ? `当前筛选条件下共 ${filteredRecords.length} 条记录`
            : `共 ${STATE.records.length} 条记录`,
        getRecords: async () => viewRuntime.getRecordsForExport(),
        getListName: (listId) => listIdToName.get(String(listId)) || String(listId),
        showMessage,
        getSelectedRecordIds: () => Array.from(selectedRecords),
        getSelectedCountText: () => `仅导出选中记录（${selectedRecords.size} 条）`,
    });
    const itemActionsController = createRecordsItemActionsRuntime({
        getRecords: () => STATE.records,
        selectedRecords,
        saveRecord: dbViewedPut,
        deleteRecord: dbViewedDelete,
        sendRuntimeMessage: (message) => chrome.runtime.sendMessage(message),
        showMessage,
        showConfirmationModal,
        videoStatus: VIDEO_STATUS,
        updateFilteredRecords,
        render,
        isFavoritesFilterActive: () => favoritesFilterActive,
    });
    const searchSuggestController = createRecordsSearchSuggestController({
        input: searchInput,
        suggest: searchSuggest,
        getTags: () => allTags,
        ensureTagsLoaded: ensureAllTagsCollected,
        onApply: () => {
            stateRefreshController.resetAndRender();
        },
    });
    const advancedConditionsController = createRecordsAdvancedConditionsController({
        container: advConditionsEl,
        quickTimeField,
        quickTimeValue,
        quickTimeUnit,
        quickTimePreview: document.getElementById('quickTimePreview') as HTMLSpanElement,
        getConditions: () => advConditions,
        setConditions: (conditions) => {
            advConditions = conditions;
        },
        onConditionsChange: () => {
            stateRefreshController.resetAndRender();
        },
        showMessage,
    });
    const statsController = createRecordsStatsController({
        container: document.getElementById('recordsStatsContainer'),
        searchInput,
        filterSelect,
        selectedTags,
        tokenSelectedTags,
        selectedListIds,
        tokenSelectedListIds,
        refreshTagsFilter: () => tagsFilterController.refresh(),
        refreshListsFilter: () => {
            try { listsFilterController.refresh(); } catch {}
        },
        setAdvancedConditions: (conditions) => {
            advConditions = conditions;
        },
        renderAdvancedConditions: () => advancedConditionsController.renderConditions(),
        onFilterApplied: () => {
            stateRefreshController.resetAndRender();
        },
        getRecords: () => STATE.records,
        isServerModeActive: () => serverModeActive,
        loadServerStats: dbViewedStats,
        isActive: () => recordsActive,
    });
    const batchSelectionController = createRecordsBatchSelectionController({
        batchOperations,
        selectAllCheckbox,
        selectedCount,
        batchActionsBtn,
        selectedRecords,
        getCurrentRecords: () => (
            serverModeActive
                ? serverPageItems
                : filteredRecords.slice((currentPage - 1) * recordsPerPage, currentPage * recordsPerPage)
        ),
        onRender: () => render(),
    });
    batchOperationsRuntime = createRecordsBatchOperationsRuntime({
        selectedRecords,
        getVisibleRecords: () => (serverModeActive ? serverPageItems : filteredRecords),
        loadLists: dbListsGetAllNormalized,
        patchList: dbViewedPatchList,
        bulkPatchList: dbViewedBulkPatchList,
        showMessage,
        render,
        escapeHtml,
        getSelectedIds: () => Array.from(selectedRecords),
        refreshRecord: (recordId) => refreshRecordsSingleRecord(recordId, (message, callback) => {
            chrome.runtime.sendMessage(message, callback);
        }),
        deleteRecords: async (selectedIds) => {
            await dbViewedBulkDelete(selectedIds);
            const idSet = new Set(selectedIds);
            STATE.records = Array.isArray(STATE.records)
                ? STATE.records.filter(record => !idSet.has(record.id))
                : [];
        },
        clearSelection: () => {
            selectedRecords.clear();
        },
        afterMutation: () => {
            stateRefreshController.refreshAndRenderBatch();
        },
        toolbarElements: {
            selectAllCheckbox,
            batchActionsBtn,
            batchActionsDropdown,
            batchModifyListBtn,
            batchAddTagBtn,
            batchRefreshBtn,
            batchDeleteBtn,
            cancelBatchBtn,
        },
        onSelectAll: () => batchSelectionController.handleSelectAll(),
        onClearSelection: () => batchSelectionController.clearAllSelection(),
        getRecordById: async (id) => {
            const { dbViewedGet } = await import('../dbClient');
            return dbViewedGet(id);
        },
        putRecord: dbViewedPut,
    });
    const viewToolbarController = createRecordsViewToolbarController({
        toggleCoversBtn,
        toggleViewModeBtn,
        favoritesButton: myFavoritesBtn,
        videoList,
        getCoversEnabled: () => !!STATE.settings.showCoversInRecords,
        setCoversEnabled: (enabled) => {
            STATE.settings.showCoversInRecords = enabled;
        },
        getViewMode: () => currentViewMode,
        setViewMode: (mode) => {
            currentViewMode = mode;
            STATE.settings.recordsViewMode = mode;
        },
        getFavoritesActive: () => favoritesFilterActive,
        setFavoritesActive: (active) => {
            favoritesFilterActive = active;
        },
        persistSettings: () => {
            chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: STATE.settings });
        },
        onFilterChanged: () => {
            stateRefreshController.resetAndRender();
        },
        onRender: () => render(),
    });
    recordsPerPageSelect.value = String(recordsPerPage);

    function updateFilteredRecords() {
        filterRuntime.updateFilteredRecords();
    }

    function renderVideoList() {
        viewRuntime.renderVideoList();
        hasRenderedRecordsPage = true;
        recordsRenderStale = false;
    }

    function renderPagination() {
        viewRuntime.renderPagination();
    }

    async function updateStats() {
        await statsController.updateStats();
    }

    queryRuntime = createRecordsQueryRuntime({
        searchInput,
        filterSelect,
        sortSelect,
        videoList,
        getCurrentPage: () => currentPage,
        getRecordsPerPage: () => recordsPerPage,
        selectedTags,
        selectedListIds,
        selectedSeriesIds,
        selectedLabelIds,
        listNameById: listIdToName,
        getAdvancedConditions: () => advConditions,
        isFavoritesFilterActive: () => favoritesFilterActive,
        queryRecords: dbViewedQuery,
        pageRecords: dbViewedPage,
        setServerModeActive: (active) => {
            serverModeActive = active;
        },
        setServerPageItems: (items) => {
            serverPageItems = items;
        },
        setServerTotal: (total) => {
            serverTotal = total;
        },
        setLastQueryDurationMs: (duration) => {
            lastQueryDurationMs = duration;
        },
        renderVideoList,
        renderPagination,
        updateSearchResultCount,
        showMessage,
        isActive: () => recordsActive,
    });

    const renderCoordinator = createRecordsRenderCoordinator({
        videoList,
        shouldUseIDB: queryRuntime.shouldUseIDB,
        setServerModeActive: (active) => {
            serverModeActive = active;
        },
        renderServerPage: queryRuntime.renderServerPage,
        updateFilteredRecords,
        renderVideoList,
        renderPagination,
        updateStats,
        isActive: () => recordsActive,
    });

    function render() {
        if (!recordsActive) {
            recordsRenderStale = true;
            return;
        }
        recordsRenderStale = true;
        renderCoordinator.render();
    }

    stateRefreshController = createRecordsStateRefreshController({
        resetCurrentPage: () => {
            currentPage = 1;
        },
        updateFilteredRecords,
        render,
        updateBatchUI,
    });

    let batchImportCancelRequested = false;
    const batchImportStorage = {
        get: async (key: string): Promise<unknown> => {
            const result = await chrome.storage.local.get(key);
            return result[key];
        },
        set: async (key: string, value: unknown): Promise<void> => {
            await chrome.storage.local.set({ [key]: value });
        },
        remove: async (key: string): Promise<void> => {
            await chrome.storage.local.remove(key);
        },
    };

    const syncImportedRecordToState = (record: VideoRecord) => {
        const index = STATE.records.findIndex(item => item.id === record.id);
        if (index >= 0) {
            STATE.records[index] = record;
        } else {
            STATE.records.push(record);
        }
        allTagsStale = true;
    };

    const batchImportController = createRecordsBatchImportController({
        onClose: () => {
            batchImportCancelRequested = true;
        },
        onSubmit: async (submission: RecordsBatchImportSubmission) => {
            const normalized = normalizeBatchNumbers(submission.input);
            if (normalized.length === 0) throw new Error('没有识别到可处理的番号。');

            const task: BatchImportTaskSnapshot = {
                version: 1,
                id: `batch-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                mode: submission.mode,
                userTags: submission.userTags,
                items: normalized.map(item => ({
                    code: item.code,
                    sourceText: item.sourceText,
                    status: item.status === 'ready' ? 'pending' : item.status,
                })),
                cursor: 0,
                status: 'running',
                updatedAt: Date.now(),
            };
            batchImportCancelRequested = false;
            activeBatchImportTask = task;
            await runBatchImportTaskWithUI(task);
        },
        onRetryItem: (index: number) => {
            const task = activeBatchImportTask;
            const item = task?.items[index];
            if (!task || !item || item.status !== 'failed') return;
            item.status = 'pending';
            delete item.error;
            task.cursor = index;
            task.status = 'paused';
            void runBatchImportTaskWithUI(task);
        },
        onExportFailures: (codes: string[]) => {
            if (codes.length === 0) {
                showMessage('当前没有失败的番号可导出', 'info');
                return;
            }
            const blob = new Blob([`${codes.join('\n')}\n`], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `batch-import-failures-${new Date().toISOString().slice(0, 10)}.txt`;
            anchor.click();
            URL.revokeObjectURL(url);
            showMessage(`已导出 ${codes.length} 个失败番号`, 'success');
        },
    });

    let activeBatchImportTask: BatchImportTaskSnapshot | null = null;

    async function runBatchImportTaskWithUI(task: BatchImportTaskSnapshot): Promise<void> {
        batchImportCancelRequested = false;
        batchImportController.setBusy(true);
        const updateProgress = (snapshot: BatchImportTaskSnapshot) => {
            const completed = snapshot.items.filter(item => !['pending', 'searching'].includes(item.status)).length;
            const failed = snapshot.items.filter(item => item.status === 'failed').length;
            batchImportController.setProgress(`已处理 ${completed}/${snapshot.items.length}${failed > 0 ? `，失败 ${failed}` : ''}`);
            batchImportController.setResults(snapshot.items);
        };

        const dependencies = {
            processItem: async (code: string, mode: BatchImportMode, userTags: string[]) => processBatchImportItem(
                code,
                mode,
                userTags,
                {
                    findExactMatch: async (itemCode: string) => {
                        const searchUrl = `https://javdb.com/search?q=${encodeURIComponent(itemCode)}&f=all`;
                        const html = await fetchHtml(searchUrl);
                        return parseSearchResults(html, itemCode);
                    },
                    fetchMatchMetadata: async (match: { href: string; title: string }) => {
                        const html = await fetchHtml(match.href);
                        return {
                            ...parseDetailPage(html),
                            title: match.title,
                            javdbUrl: match.href,
                        };
                    },
                    getRecord: dbViewedGet,
                    putRecord: async (record: VideoRecord) => {
                        await dbViewedPut(record);
                        syncImportedRecordToState(record);
                    },
                },
            ),
            findExactMatch: async (code: string) => {
                const searchUrl = `https://javdb.com/search?q=${encodeURIComponent(code)}&f=all`;
                const html = await fetchHtml(searchUrl);
                return parseSearchResults(html, code);
            },
            fetchMatchMetadata: async (match: { href: string; title: string }) => {
                const html = await fetchHtml(match.href);
                return {
                    ...parseDetailPage(html),
                    title: match.title,
                    javdbUrl: match.href,
                };
            },
            getRecord: dbViewedGet,
            putRecord: async (record: VideoRecord) => {
                await dbViewedPut(record);
                syncImportedRecordToState(record);
            },
            shouldCancel: () => batchImportCancelRequested,
            saveTask: async (snapshot: BatchImportTaskSnapshot) => {
                await saveBatchImportTask(batchImportStorage, snapshot);
                updateProgress(snapshot);
                render();
            },
        };

        await saveBatchImportTask(batchImportStorage, task);
        batchImportController.setResults(task.items);
        try {
            const result = await runBatchImportTask(task, dependencies);
            if (result.status === 'completed') {
                await clearBatchImportTask(batchImportStorage);
                batchImportController.setResults(result.items);
                const failed = result.items.filter(item => item.status === 'failed').length;
                const notFound = result.items.filter(item => item.status === 'not-found').length;
                const placeholders = result.items.filter(item => item.status === 'placeholder').length;
                const imported = result.items.filter(item => ['imported', 'existing'].includes(item.status)).length;
                const skipped = result.items.filter(item => ['duplicate', 'invalid'].includes(item.status)).length;
                batchImportController.setProgress(`处理完成：${imported} 项已加入收藏，${placeholders} 项待补全，${notFound} 项未找到，${skipped} 项跳过，${failed} 项失败。`);
                showMessage(failed > 0 ? `批量导入完成，有 ${failed} 项失败` : '批量导入完成', failed > 0 ? 'warning' : 'success');
            } else {
                batchImportController.setProgress(`已暂停：下次打开“批量导入收藏”可继续（${result.cursor}/${result.items.length}）。`);
                showMessage('批量导入已暂停，可以稍后继续。', 'warning');
            }
            stateRefreshController.resetAndRender();
        } finally {
            batchImportController.setBusy(false);
        }
    }

    batchImportBtn.addEventListener('click', () => {
        batchImportCancelRequested = false;
        batchImportController.open();
        void loadBatchImportTask(batchImportStorage).then((task) => {
            if (!task || task.status === 'completed' || task.cursor >= task.items.length) return;
            batchImportController.setResumeAvailable(
                `继续上次任务（已处理 ${task.cursor}/${task.items.length} 项）`,
                () => {
                    batchImportCancelRequested = false;
                    void runBatchImportTaskWithUI(task);
                },
            );
        });
    });

    function collectAllTags() {
        allTags.clear();
        STATE.records.forEach(record => {
            if (record.tags && Array.isArray(record.tags)) {
                record.tags.forEach(tag => allTags.add(tag));
            }
            if (record.userTags && Array.isArray(record.userTags)) {
                record.userTags.forEach(tag => allTags.add(tag));
            }
        });
    }

    const handleFilterSelectionChanged = () => {
        stateRefreshController.resetAndRender();
    };

    filterRuntime = createRecordsFilterRuntime({
        elements: {
            searchInput,
            filterSelect,
            sortSelect,
            filters: pageElements.filters,
        },
        getRecords: () => STATE.records,
        selectedTags,
        selectedListIds,
        selectedSeriesIds,
        selectedLabelIds,
        getTokenSelectedTags: () => tokenSelectedTags,
        setTokenSelectedTags: (value) => {
            tokenSelectedTags = value;
        },
        getTokenSelectedListIds: () => tokenSelectedListIds,
        setTokenSelectedListIds: (value) => {
            tokenSelectedListIds = value;
        },
        getTokenSelectedSeriesIds: () => tokenSelectedSeriesIds,
        setTokenSelectedSeriesIds: (value) => {
            tokenSelectedSeriesIds = value;
        },
        getTokenSelectedLabelIds: () => tokenSelectedLabelIds,
        setTokenSelectedLabelIds: (value) => {
            tokenSelectedLabelIds = value;
        },
        getAllTags: () => {
            collectAllTags();
            return Array.from(allTags).map(String);
        },
        listNameById: listIdToName,
        listSourceById: listIdToSource,
        seriesNameById: seriesIdToName,
        labelNameById: labelIdToName,
        seriesIdToRecord,
        labelIdToRecord,
        ensureListMetaLoaded,
        getAdvancedConditions: () => advConditions,
        isFavoritesFilterActive: () => favoritesFilterActive,
        setFilteredRecords: (records) => {
            filteredRecords = records;
        },
        onFilterChanged: handleFilterSelectionChanged,
        escapeHtml,
    });
    const syncDropdownBackdrop = filterRuntime.syncDropdownBackdrop;
    const filterControllers = filterRuntime.filterControllers;
    const tagsFilterController = filterControllers.tags;
    const listsFilterController = filterControllers.lists;
    const seriesFilterController = filterControllers.series;
    const labelsFilterController = filterControllers.labels;
    viewRuntime = createRecordsViewRuntime({
        videoList,
        paginationContainer,
        getSourceRecords: () => serverModeActive ? serverPageItems : (Array.isArray(filteredRecords) ? filteredRecords : []),
        isServerModeActive: () => serverModeActive,
        getServerTotal: () => serverTotal,
        getFilteredCount: () => filteredRecords.length,
        getCurrentPage: () => currentPage,
        setCurrentPage: (page) => {
            currentPage = page;
        },
        getRecordsPerPage: () => recordsPerPage,
        getViewMode: () => currentViewMode,
        getCoversEnabled: () => !!STATE.settings.showCoversInRecords,
        coverRuntime: coverRuntimeController,
        updateSearchResultCount,
        ensureListMetaLoaded,
        selectedRecordIds: selectedRecords,
        selectedTags,
        selectedListIds,
        listNameById: listIdToName,
        getSearchEngines: () => Array.isArray(STATE.settings?.searchEngines) ? STATE.settings.searchEngines : [],
        fallbackIconUrl: chrome.runtime.getURL('assets/alternate-search.png'),
        escapeHtml,
        onToggleRecordSelection: handleRecordSelection,
        onFilterChanged: handleFilterSelectionChanged,
        refreshTags: () => tagsFilterController.refresh(),
        refreshLists: () => listsFilterController.refresh(),
        actionCallbacks: {
            onToggleFavorite: itemActionsController.onToggleFavorite,
            onEdit: itemActionsController.onEdit,
            onRefresh: itemActionsController.onRefresh,
            onDelete: itemActionsController.onDelete,
            onOpenListPicker: (targetRecord) => {
                batchOperationsRuntime.listPickerRuntime.openSingle(targetRecord);
            },
        },
        onRenderRecordError: (error, record) => {
            if (record?.id) {
                console.error('[Records] 渲染记录项时出错:', error, record);
                return;
            }
            console.error('[Records] 渲染视频列表时出错:', error);
        },
        getFilteredRecords: () => filteredRecords,
        getSearchText: () => (searchInput?.value || '').trim(),
        getStatus: () => (filterSelect?.value || 'all') as 'all' | VideoStatus,
        getSort: () => queryRuntime.parseSort(),
        getAdvancedConditions: () => advConditions,
        queryRecords: dbViewedQuery,
        showProgress: showRecordsProgressModal,
        hideProgress: hideRecordsProgressModal,
        exportController,
        renderPage: () => {
            render();
        },
    });
    // 已移除：精确查询事件监听器

    // Advanced search 切换使用文档级事件委托（见前文注入），此处不再重复绑定

    // 已移除：高级搜索方案事件绑定（保存/载入/删除）

    // 已移除：初始化预置下拉

    const triggerSuggest = searchSuggestController.createDebouncedUpdate();
    const triggerFilter = debounce(() => stateRefreshController.resetAndRender(), 150);

    createRecordsLifecycleRuntime({
        pageElements,
        getRecordsPerPage: () => recordsPerPage,
        setRecordsPerPage: (value) => {
            recordsPerPage = value;
            STATE.settings.recordsPerPage = value;
        },
        persistRecordsPerPage: () => {
            chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: STATE.settings });
        },
        resetCurrentPage: () => {
            currentPage = 1;
        },
        updateFilteredRecords,
        render,
        syncDropdownBackdrop,
        triggerSuggest,
        triggerFilter,
        viewToolbar: viewToolbarController,
        batchToolbar: batchOperationsRuntime.batchToolbarController,
        searchSuggest: searchSuggestController,
        filters: {
            tags: tagsFilterController,
            lists: listsFilterController,
            series: seriesFilterController,
            labels: labelsFilterController,
        },
        advancedConditions: advancedConditionsController,
        addAdvancedCondition: (condition) => {
            advConditions.push(condition);
        },
        setAdvancedConditions: (conditions) => {
            advConditions = conditions;
        },
        listPickerRuntime: batchOperationsRuntime.listPickerRuntime,
        coverRuntime: coverRuntimeController,
        handleExportRecords: () => viewRuntime.handleExportRecords(),
        updateBatchUI,
        debounce,
    }).bind();

    function handleRecordSelection(recordId: string, isSelected: boolean) {
        batchSelectionController.handleRecordSelection(recordId, isSelected);
    }

    function updateBatchUI() {
        batchSelectionController.updateBatchUI();
    }

    recordsLifecycleUnregister = dashboardTabLifecycle.register('tab-records', {
        onActive: () => { recordsActive = true; },
        onRestore: () => {
            recordsActive = true;
            if (shouldRenderRecordsOnRestore({
                hasRenderedPage: hasRenderedRecordsPage,
                stale: recordsRenderStale,
            })) {
                render();
            }
            // 仅恢复已选摘要；候选项等到用户展开下拉框时再生成，避免恢复页面立即重建数千个节点。
            filterRuntime.filterControllers.tags.refresh();
            filterRuntime.filterControllers.lists.refresh();
            filterRuntime.filterControllers.series.refresh();
            filterRuntime.filterControllers.labels.refresh();
        },
        onHidden: () => {
            const recordsRoot = videoList.closest('.records-page') as HTMLElement | null;
            if (recordsRoot) recordRecordsLifecycleSnapshot('before-hidden', recordsRoot, videoList);
            recordsActive = false;
            queryRuntime.invalidate();
            batchSelectionController.clearAllSelection();
            filterRuntime.clearRenderedOptions();
            if (recordsRoot) {
                recordRecordsLifecycleSnapshot('after-hidden', recordsRoot, videoList);
                queueMicrotask(() => recordRecordsLifecycleSnapshot('microtask-after-hidden', recordsRoot, videoList));
            }
        },
        onDispose: () => {
            recordsActive = false;
            queryRuntime.invalidate();
            coverRuntimeController.teardownObserver();
            recordsLifecycleUnregister?.();
            recordsLifecycleUnregister = null;
        },
    });

}
