﻿﻿import { STATE } from '../state';
import { showMessage } from '../ui/toast';
import { log } from '../../utils/logController';
import type { LogEntry as CoreLogEntry, LogLevel } from '../../types';
import { dbLogsQuery, dbLogsClear, dbLogsExport, dbMagnetPushLogsQuery, dbMagnetPushLogsClear, dbMagnetPushLogsExport, type LogsQueryParams } from '../dbClient';
import { dashboardTabLifecycle } from './tabLifecycle';
import { clearTabWorkset } from './tabWorkset';

/**
 * 日志条目接口：在全局 LogEntry 基础上扩展可选来源字段
 */
interface LogEntry extends CoreLogEntry {
    source?: string;
}

interface MagnetLogEntry extends LogEntry {}

/**
 * 日志标签页类
 */
export class LogsTab {
    public isInitialized: boolean = false;
    private currentLevelFilter: 'ALL' | LogLevel = 'ALL';
    private currentCategoryFilter: string = 'ALL';
    private currentSearchQuery: string = '';
    private currentStartDate?: Date;
    private currentEndDate?: Date;
    private currentHasDataOnly: boolean = false;
    private currentMagnetStatusFilter: 'ALL' | 'SUCCESS' | 'FAILED' = 'ALL';
    private logs: LogEntry[] = [];
    private totalLogsCount: number = 0; // IDB 端总数（EXT 视图无过滤时使用）

    // 视图模式：扩展日志（EXT）/ 磁力推送记录（MAGNET）
    private viewMode: 'EXT' | 'MAGNET' = 'EXT';
    private magnetLogs: MagnetLogEntry[] = [];
    private totalMagnetCount: number = 0;
    private active = false;
    private renderGeneration = 0;
    private lifecycleUnregister: (() => void) | null = null;

    // 分页状态
    private currentPage: number = 1;
    private pageSize: number = 20;
    private logsPaginationEl!: HTMLElement;
    private logsPerPageSelect!: HTMLSelectElement;
    private logsCountInfoEl!: HTMLSpanElement;

    // DOM 元素
    private logLevelFilter!: HTMLSelectElement;
    private logCategoryFilter!: HTMLSelectElement;
    private logSearchInput!: HTMLInputElement;
    private logStartDateInput!: HTMLInputElement;
    private logEndDateInput!: HTMLInputElement;
    private logHasDataOnlyCheckbox!: HTMLInputElement;
    private extFilters!: HTMLDivElement;
    private magnetFilters!: HTMLDivElement;
    private magnetStatusFilter!: HTMLSelectElement;
    private refreshButton!: HTMLButtonElement;
    private clearButton!: HTMLButtonElement;
    private exportButton!: HTMLButtonElement;
    private logBody!: HTMLDivElement;
    private magnetLogBody!: HTMLDivElement;
    private logViewExtBtn!: HTMLButtonElement;
    private logViewMagnetBtn!: HTMLButtonElement;

    /**
     * 初始化日志标签页
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        try {
            log.verbose('开始初始化日志标签页');
            this.ensureLifecycle();

            // 初始化DOM元素
            this.initializeElements();

            // 绑定事件监听器
            this.bindEvents();

            // 同步初始过滤器显示
            this.updateFilterVisibility();

            // 加载日志数据
            await this.loadLogs();

            // 渲染日志
            this.renderLogs();

            this.isInitialized = true;
            log.verbose('日志标签页初始化完成');
        } catch (error) {
            log.error('初始化日志标签页失败:', error);
            showMessage('初始化日志标签页失败', 'error');
        }
    }

    private ensureLifecycle(): void {
        if (this.lifecycleUnregister) return;
        this.lifecycleUnregister = dashboardTabLifecycle.register('tab-logs', {
            onActive: () => { this.active = true; },
            onRestore: () => {
                this.active = true;
                this.renderLogs();
            },
            onHidden: () => this.clearRenderedWorkset(),
            onDispose: () => {
                this.clearRenderedWorkset();
                this.lifecycleUnregister?.();
                this.lifecycleUnregister = null;
            },
        });
    }

    private clearRenderedWorkset(): void {
        this.active = false;
        this.renderGeneration += 1;
        this.logs = [];
        this.magnetLogs = [];
        this.totalLogsCount = 0;
        this.totalMagnetCount = 0;
        clearTabWorkset(document.getElementById('tab-logs'), [
            '#log-body',
            '#magnet-log-body',
            '#logsPagination',
        ]);
    }

    /**
     * 初始化DOM元素
     */
    private initializeElements(): void {
        this.logLevelFilter = document.getElementById('log-level-filter') as HTMLSelectElement;
        this.logCategoryFilter = document.getElementById('log-category-filter') as HTMLSelectElement;
        this.logSearchInput = document.getElementById('log-search-input') as HTMLInputElement;
        this.logStartDateInput = document.getElementById('log-start-date') as HTMLInputElement;
        this.logEndDateInput = document.getElementById('log-end-date') as HTMLInputElement;
        this.logHasDataOnlyCheckbox = document.getElementById('log-has-data-only') as HTMLInputElement;
        this.extFilters = document.getElementById('log-filters-ext') as HTMLDivElement;
        this.magnetFilters = document.getElementById('log-filters-magnet') as HTMLDivElement;
        this.magnetStatusFilter = document.getElementById('magnet-status-filter') as HTMLSelectElement;
        this.refreshButton = document.getElementById('refresh-logs-button') as HTMLButtonElement;
        this.clearButton = document.getElementById('clear-logs-button') as HTMLButtonElement;
        // 尝试获取已存在的“导出”按钮；如无则动态创建并插入到“清空”按钮旁
        this.exportButton = document.getElementById('export-logs-button') as HTMLButtonElement;
        if (!this.exportButton) {
            try {
                const btn = document.createElement('button');
                btn.id = 'export-logs-button';
                btn.className = 'button is-light';
                btn.textContent = '导出';
                if (this.clearButton && this.clearButton.parentElement) {
                    this.clearButton.parentElement.insertBefore(btn, this.clearButton.nextSibling);
                } else if (this.refreshButton && this.refreshButton.parentElement) {
                    this.refreshButton.parentElement.appendChild(btn);
                } else if (this.logsPaginationEl) {
                    this.logsPaginationEl.appendChild(btn);
                }
                this.exportButton = btn as HTMLButtonElement;
            } catch {}
        }
        this.logBody = document.getElementById('log-body') as HTMLDivElement;
        this.magnetLogBody = document.getElementById('magnet-log-body') as HTMLDivElement;
        this.logsPaginationEl = document.getElementById('logsPagination') as HTMLElement;
        this.logsPerPageSelect = document.getElementById('logsPerPageSelect') as HTMLSelectElement;
        this.logsCountInfoEl = document.getElementById('logsCountInfo') as HTMLSpanElement;
        this.logViewExtBtn = document.getElementById('log-view-ext') as HTMLButtonElement;
        this.logViewMagnetBtn = document.getElementById('log-view-magnet') as HTMLButtonElement;

        // 验证元素是否存在
        if (!this.logLevelFilter) {
            console.error('[LogsTab] 找不到log-level-filter元素');
            return;
        }
        if (!this.logCategoryFilter) {
            console.error('[LogsTab] 找不到log-category-filter元素');
            return;
        }
        if (!this.logSearchInput) {
            console.error('[LogsTab] 找不到log-search-input元素');
            return;
        }
        if (!this.logStartDateInput) {
            console.error('[LogsTab] 找不到log-start-date元素');
            return;
        }
        if (!this.logEndDateInput) {
            console.error('[LogsTab] 找不到log-end-date元素');
            return;
        }
        if (!this.logHasDataOnlyCheckbox) {
            console.error('[LogsTab] 找不到log-has-data-only元素');
            return;
        }
        if (!this.extFilters) {
            console.error('[LogsTab] 找不到log-filters-ext元素');
            return;
        }
        if (!this.magnetFilters) {
            console.error('[LogsTab] 找不到log-filters-magnet元素');
            return;
        }
        if (!this.magnetStatusFilter) {
            console.error('[LogsTab] 找不到magnet-status-filter元素');
            return;
        }
        if (!this.refreshButton) {
            console.error('[LogsTab] 找不到refresh-logs-button元素');
            return;
        }
        if (!this.clearButton) {
            log.error('[LogsTab] 找不到clear-logs-button元素');
            return;
        }
        if (!this.logBody) {
            log.error('[LogsTab] 找不到log-body元素');
            return;
        }
        if (!this.logsPaginationEl) {
            console.error('[LogsTab] 找不到logsPagination元素');
            return;
        }
        if (!this.logsPerPageSelect) {
            console.error('[LogsTab] 找不到logsPerPageSelect元素');
            return;
        }

        log.verbose('[LogsTab] DOM元素初始化完成');
    }

    /**
     * 绑定事件监听器
     */
    private bindEvents(): void {
        // 视图切换
        this.logViewExtBtn?.addEventListener('click', () => {
            if (this.viewMode !== 'EXT') {
                this.viewMode = 'EXT';
                this.updateViewVisibility();
                this.currentPage = 1;
                this.renderLogs();
                this.updateSwitchBtnActive();
            }
        });
        this.logViewMagnetBtn?.addEventListener('click', () => {
            if (this.viewMode !== 'MAGNET') {
                this.viewMode = 'MAGNET';
                this.updateViewVisibility();
                this.currentPage = 1;
                this.renderLogs();
                this.updateSwitchBtnActive();
            }
        });

        // 过滤器事件
        this.logLevelFilter?.addEventListener('change', () => {
            const raw = (this.logLevelFilter.value || 'ALL').toUpperCase();
            this.currentLevelFilter = (raw === 'ALL' ? 'ALL' : (raw as LogLevel));
            this.currentPage = 1;
            this.renderLogs();
        });

        this.logCategoryFilter?.addEventListener('change', () => {
            this.currentCategoryFilter = this.logCategoryFilter.value;
            this.currentPage = 1;
            this.renderLogs();
        });

        // 搜索框（带防抖）
        const debouncedSearch = this.debounce(() => {
            this.currentSearchQuery = (this.logSearchInput.value || '').trim();
            this.currentPage = 1;
            this.renderLogs();
        }, 250);
        this.logSearchInput?.addEventListener('input', debouncedSearch);

        // 日期范围
        this.logStartDateInput?.addEventListener('change', () => {
            const v = this.logStartDateInput.value;
            this.currentStartDate = v ? new Date(v) : undefined;
            this.currentPage = 1;
            this.renderLogs();
        });
        this.logEndDateInput?.addEventListener('change', () => {
            const v = this.logEndDateInput.value;
            this.currentEndDate = v ? new Date(v) : undefined;
            // 若仅输入结束日期，将其时间设置为当天 23:59:59.999
            if (this.currentEndDate) {
                this.currentEndDate.setHours(23, 59, 59, 999);
            }
            this.currentPage = 1;
            this.renderLogs();
        });

        // 仅含详细数据
        this.logHasDataOnlyCheckbox?.addEventListener('change', () => {
            this.currentHasDataOnly = !!this.logHasDataOnlyCheckbox.checked;
            this.currentPage = 1;
            this.renderLogs();
        });

        this.magnetStatusFilter?.addEventListener('change', () => {
            const raw = (this.magnetStatusFilter.value || 'ALL').toUpperCase();
            this.currentMagnetStatusFilter = raw === 'SUCCESS' || raw === 'FAILED' ? raw : 'ALL';
            this.currentPage = 1;
            this.renderLogs();
        });

        // 每页数量选择
        if (this.logsPerPageSelect) {
            const val = parseInt(this.logsPerPageSelect.value || '20', 10);
            this.pageSize = Number.isFinite(val) && val > 0 ? val : 20;
            this.logsPerPageSelect.addEventListener('change', () => {
                const v = parseInt(this.logsPerPageSelect.value || '20', 10);
                this.pageSize = Number.isFinite(v) && v > 0 ? v : 20;
                this.currentPage = 1;
                this.renderLogs();
            });
        }

        // 按钮事件
        this.refreshButton?.addEventListener('click', () => {
            this.refreshLogs();
        });

        this.clearButton?.addEventListener('click', () => {
            this.clearLogs();
        });

        // 导出日志
        this.exportButton?.addEventListener('click', async () => {
            try {
                this.exportButton.disabled = true;
                this.exportButton.textContent = '导出中...';
                if (this.viewMode === 'MAGNET') {
                    const json = await dbMagnetPushLogsExport();
                    const blob = new Blob([json], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `javdb-115-push-logs-${new Date().toISOString().split('T')[0]}.json`;

                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    showMessage('磁力推送记录已导出', 'success');
                    return;
                }
                const json = await dbLogsExport();
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `javdb-logs-${new Date().toISOString().split('T')[0]}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                showMessage('日志已导出', 'success');
            } catch (e) {
                console.error('[LogsTab] 导出日志失败', e);
                showMessage('导出日志失败', 'error');
            } finally {
                this.exportButton.disabled = false;
                this.exportButton.textContent = '导出';
            }
        });
    }

    /**
     * 加载日志数据
     */
    private async loadLogs(): Promise<void> {
        // 纯 IndexedDB 模式：不做预加载，延迟到 renderLogs 中查询
        this.logs = [];
        this.totalLogsCount = 0;
        this.magnetLogs = [];
        this.totalMagnetCount = 0;
    }

    /**
     * 刷新日志
     */
    private async refreshLogs(): Promise<void> {
        try {
            this.refreshButton.disabled = true;
            this.refreshButton.textContent = '刷新中...';

            if (this.viewMode === 'EXT') {
                // 重新加载并显式等待渲染完成，以便获得准确数量
                await this.loadLogs();
                const res = await this.fetchAndRenderExtLogs();
                const pageCount = (res?.items?.length ?? 0);
                const total = (res?.total ?? pageCount);
                showMessage(`已刷新（本页 ${pageCount} / 总 ${total}）`, 'success');
            } else {
                const res = await this.fetchAndRenderMagnetLogs();
                const pageCount = (res?.items?.length ?? 0);
                const total = (res?.total ?? pageCount);
                showMessage(`磁力推送：本页 ${pageCount} / 总 ${total} 条`, 'success');
            }
        } catch (error) {
            console.error('刷新日志失败:', error);
            showMessage('刷新日志失败', 'error');
        } finally {
            this.refreshButton.disabled = false;
            this.refreshButton.textContent = '刷新';
        }
    }

    /**
     * 清空日志
     */
    private async clearLogs(): Promise<void> {
        try {
            if (!confirm('确定要清空所有日志吗？此操作不可撤销。')) return;
            if (this.viewMode === 'MAGNET') {
                await dbMagnetPushLogsClear();
                this.magnetLogs = [];
                this.totalMagnetCount = 0;
            } else {
                await dbLogsClear();
            }
            this.logs = [];
            this.totalLogsCount = 0;
            this.currentPage = 1;
            this.renderLogs();
            showMessage('日志已清空', 'success');
        } catch (error) {
            console.error('清空日志失败:', error);
            showMessage('清空日志失败', 'error');
        }
    }

    /**
     * 渲染日志
     */
    private renderLogs(): void {
        if (!this.active) return;
        if (!this.logBody) return;
        const generation = this.renderGeneration;

        // 视图切换下的可见性
        this.updateViewVisibility();

        if (this.viewMode === 'MAGNET') {
            this.magnetLogBody.innerHTML = '<div class="loading">加载中...</div>';
            this.fetchAndRenderMagnetLogs(generation).catch((e) => {
                if (!this.active || generation !== this.renderGeneration) return;
                console.error('[LogsTab] 读取磁力推送记录失败', e);
                this.magnetLogBody.innerHTML = '<div class="no-logs">磁力推送记录加载失败，请稍后重试</div>';
            });
            return;
        }

        // 扩展日志视图：若无任何过滤条件，改为通过 IDB 分页读取，避免加载全量日志
        if (this.isNoFilterActive()) {
            // 异步渲染：先显示加载中占位，再走统一的获取+渲染逻辑
            this.logBody.innerHTML = '<div class="loading">加载中...</div>';
            this.fetchAndRenderExtLogs(generation).catch((e) => {
                if (!this.active || generation !== this.renderGeneration) return;
                console.error('[LogsTab] 读取 IDB 日志失败', e);
                this.logBody.innerHTML = '<div class="no-logs">日志加载失败，请稍后重试</div>';
            });
            return;
        }

        // 若仅启用“日期/等级”过滤（无搜索/来源/hasData/设置联动），使用 IDB 查询
        if (this.isOnlyDateAndLevelFilterActive()) {
            this.logBody.innerHTML = '<div class="loading">加载中...</div>';
            this.fetchAndRenderExtLogs(generation).catch((e) => {
                if (!this.active || generation !== this.renderGeneration) return;
                console.warn('[LogsTab] IDB 按日期/等级查询失败', e);
                this.logBody.innerHTML = '<div class="no-logs">日志加载失败，请稍后重试</div>';
            });
            return;
        }

        // 带条件查询：统一走 IDB 查询
        this.logBody.innerHTML = '<div class="loading">加载中...</div>';
        this.fetchAndRenderExtLogs(generation).catch((e) => {
            if (!this.active || generation !== this.renderGeneration) return;
            console.error('[LogsTab] IDB 查询失败', e);
            this.logBody.innerHTML = '<div class="no-logs">日志加载失败，请稍后重试</div>';
        });
    }

    /**
     * 统一的“扩展日志”获取+渲染逻辑（返回当页 items 与总数），便于 refresh 显式等待
     */
    private async fetchAndRenderExtLogs(generation = this.renderGeneration): Promise<{ items: LogEntry[]; total: number; totalPages: number }>{
        const offset = (this.currentPage - 1) * this.pageSize;
        const limit = this.pageSize;

        // 构造查询参数（保持与 renderLogs 分支逻辑一致）
        const params: LogsQueryParams = { offset, limit, order: 'desc' } as any;
        if (!this.isNoFilterActive()) {
            // 日期范围
            if (this.currentStartDate) params.fromMs = this.currentStartDate.getTime();
            if (this.currentEndDate) params.toMs = this.currentEndDate.getTime();
            // 搜索关键字
            if ((this.currentSearchQuery || '').trim()) params.query = this.currentSearchQuery.trim();
            // 是否仅含详细数据
            if (this.currentHasDataOnly) params.hasDataOnly = true;
            // 等级筛选
            if (this.currentLevelFilter !== 'ALL') params.level = this.currentLevelFilter as any;
            // 类别筛选
            if (this.currentCategoryFilter !== 'ALL') params.category = this.currentCategoryFilter;
        }

        const { items, total } = await dbLogsQuery(params);
        if (!this.active || generation !== this.renderGeneration) {
            return { items: [], total: 0, totalPages: 1 };
        }
        this.logs = Array.isArray(items) ? items : [];
        this.totalLogsCount = Number.isFinite(total) ? total : 0;
        const totalPages = Math.max(1, Math.ceil(this.totalLogsCount / this.pageSize));
        if (this.currentPage > totalPages) this.currentPage = totalPages;

        const logHtml = this.logs.map(l => this.createLogEntryHtml(l)).join('');
        this.logBody.innerHTML = logHtml || '<div class="no-logs">暂无日志记录</div>';
        this.renderPagination(this.currentPage, totalPages);
        this.updateCountText(`扩展日志：已筛选 ${this.totalLogsCount} 条（第 ${this.currentPage}/${totalPages} 页）`);

        return { items: this.logs, total: this.totalLogsCount, totalPages };
    }

    private async fetchAndRenderMagnetLogs(generation = this.renderGeneration): Promise<{ items: MagnetLogEntry[]; total: number; totalPages: number }>{
        const offset = (this.currentPage - 1) * this.pageSize;
        const params = {
            offset,
            limit: this.pageSize,
            order: 'desc' as const,
            query: this.currentSearchQuery || '',
            status: this.currentMagnetStatusFilter,
        };

        if (this.currentStartDate) (params as any).fromMs = this.currentStartDate.getTime();
        if (this.currentEndDate) (params as any).toMs = this.currentEndDate.getTime();

        try {
            console.info('[115Trace] dashboard:magnet-log:query:start', {
                ...params,
                fromMs: (params as any).fromMs,
                toMs: (params as any).toMs,
                page: this.currentPage,
                pageSize: this.pageSize,
            });
        } catch {}
        const { items, total } = await dbMagnetPushLogsQuery(params);
        if (!this.active || generation !== this.renderGeneration) {
            return { items: [], total: 0, totalPages: 1 };
        }
        try {
            console.info('[115Trace] dashboard:magnet-log:query:done', {
                total,
                items: Array.isArray(items) ? items.length : -1,
                query: params.query,
                status: params.status,
                page: this.currentPage,
                pageSize: this.pageSize,
            });
        } catch {}
        this.totalMagnetCount = Number.isFinite(total) ? total : 0;
        const totalPages = Math.max(1, Math.ceil(this.totalMagnetCount / this.pageSize));
        if (this.currentPage > totalPages) this.currentPage = totalPages;
        this.magnetLogs = Array.isArray(items) ? items as MagnetLogEntry[] : [];

        const html = this.magnetLogs.map((item) => this.createMagnetEntryHtml(item)).join('');
        this.magnetLogBody.innerHTML = html || '<div class="no-logs">暂无磁力推送记录</div>';
        this.renderPagination(this.currentPage, totalPages);
        const statusLabel = this.currentMagnetStatusFilter === 'SUCCESS' ? '成功' : this.currentMagnetStatusFilter === 'FAILED' ? '失败' : '全部';
        this.updateCountText(`磁力推送：${statusLabel} ${this.totalMagnetCount} 条（第 ${this.currentPage}/${totalPages} 页）`);
        return { items: this.magnetLogs, total: this.totalMagnetCount, totalPages };
    }

    /**
     * 渲染分页控件
     */
    private renderPagination(currentPage: number, totalPages: number): void {
        if (!this.logsPaginationEl) return;
        if (totalPages <= 1) {
            this.logsPaginationEl.innerHTML = '';
            return;
        }

        const createBtn = (label: string, page: number, options: { disabled?: boolean; active?: boolean; ellipsis?: boolean } = {}) => {
            if (options.ellipsis) {
                return `<button class="page-button ellipsis" disabled>…</button>`;
            }
            const disabled = options.disabled ? 'disabled' : '';
            const active = options.active ? 'active' : '';
            return `<button class="page-button ${active}" data-page="${page}" ${disabled}>${label}</button>`;
        };

        const buttons: string[] = [];
        // Prev
        buttons.push(createBtn('«', Math.max(1, currentPage - 1), { disabled: currentPage === 1 }));

        const windowSize = 2;
        const pages: number[] = [];
        pages.push(1);
        for (let p = currentPage - windowSize; p <= currentPage + windowSize; p++) {
            if (p > 1 && p < totalPages) pages.push(p);
        }
        if (totalPages > 1) pages.push(totalPages);
        const uniqPages = Array.from(new Set(pages)).sort((a, b) => a - b);

        let last = 0;
        for (const p of uniqPages) {
            if (last && p - last > 1) {
                buttons.push(createBtn('…', last + 1, { ellipsis: true }));
            }
            buttons.push(createBtn(String(p), p, { active: p === currentPage }));
            last = p;
        }

        // Next
        buttons.push(createBtn('»', Math.min(totalPages, currentPage + 1), { disabled: currentPage === totalPages }));

        this.logsPaginationEl.innerHTML = buttons.join('');

        // 绑定点击事件
        this.logsPaginationEl.querySelectorAll<HTMLButtonElement>('.page-button').forEach(btn => {
            const p = btn.dataset.page ? parseInt(btn.dataset.page, 10) : NaN;
            if (!Number.isFinite(p) || btn.classList.contains('ellipsis') || btn.disabled) return;
            btn.addEventListener('click', () => {
                if (p < 1) return;
                this.currentPage = p;
                this.renderLogs();
            });
        });
    }

    /**
     * 创建日志条目HTML
     */
    private createLogEntryHtml(log: LogEntry): string {
        // 使用与控制台一致的可选毫秒显示
        const fmt = this.getConsoleFormat();
        const timestamp = this.formatConsoleTimestamp(new Date(log.timestamp).getTime(), { showMilliseconds: fmt.showMilliseconds, timeZone: fmt.timeZone });
        const level = log.level.toUpperCase();
        const levelClass = this.getLevelClass(level);

        // 高亮命中
        const highlight = (text: string) => {
            const q = (this.currentSearchQuery || '').trim();
            if (!q) return this.escapeHtml(text);
            try {
                const escaped = this.escapeHtml(text);
                const re = new RegExp(this.escapeRegExp(q), 'ig');
                return escaped.replace(re, (m) => `<mark class="log-highlight">${this.escapeHtml(m)}</mark>`);
            } catch {
                return this.escapeHtml(text);
            }
        };

        // 获取日志分类（优先沿用 source；否则从 message 推断）
        const deriveCategoryFromMessage = (msg: string): string => {
            const text = String(msg || '');
            const match = text.match(/^\[([A-Z0-9]+)\]/i);
            if (match) {
                const normalized = match[1].toUpperCase();
                if (normalized === '115' || normalized === '115V2' || normalized === 'DRIVE115') return 'DRIVE115';
                return normalized;
            }
            if (/\[(?:115|115V2|Drive115)\]|\b115\b|Drive115/i.test(text)) return 'DRIVE115';
            if (/\bDB\b|database/i.test(text)) return 'DB';
            if (/\bBG\b|background/i.test(text)) return 'BG';
            if (/\bCONTENT\b|content/i.test(text)) return 'CONTENT';
            return 'GENERAL';
        };
        const category = log.source ? String(log.source).toUpperCase() : deriveCategoryFromMessage(log.message);

        // 创建详细数据部分
        const dataHtml = log.data ? `
            <details class="log-data-details">
                <summary>详细数据</summary>
                <pre>${highlight(JSON.stringify(log.data, null, 2))}</pre>
            </details>
        ` : '';

        return `
            <div class="log-entry log-level-${levelClass}">
                <div class="log-header">
                    <span class="log-level-badge">${level}</span>
                    <span class="log-category">${this.escapeHtml(category)}</span>
                    <span class="log-message">${highlight(log.message)}</span>
                    <span class="log-timestamp">${timestamp}</span>
                </div>
                ${dataHtml}
            </div>
        `;
    }

    /**
     * 获取日志等级对应的CSS类
     */
    private getLevelClass(level: string): string {
        switch (level.toLowerCase()) {
            case 'error': return 'error';
            case 'warn': case 'warning': return 'warn';
            case 'info': return 'info';
            case 'debug': return 'debug';
            default: return 'info';
        }
    }

    /**
     * 获取控制台格式设置
     */
    private getConsoleFormat(): { showTimestamp: boolean; showSource: boolean; showMilliseconds: boolean; timeZone?: string } {
        const fmt = (STATE.settings?.logging as any)?.consoleFormat || {};
        return {
            showTimestamp: fmt.showTimestamp !== false,
            showSource: fmt.showSource !== false,
            showMilliseconds: !!fmt.showMilliseconds,
            timeZone: fmt.timeZone || undefined,
        };
    }

    /**
     * 格式化控制台时间戳，支持时区与毫秒
     */
    private formatConsoleTimestamp(ts: number, fmt: { showMilliseconds: boolean; timeZone?: string }): string {
        try {
            const options: Intl.DateTimeFormatOptions = {
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                hour12: false,
            };
            const dtf = new Intl.DateTimeFormat(undefined, { ...options, timeZone: fmt.timeZone });
            const parts = dtf.formatToParts(new Date(ts));
            const map: Record<string, string> = {};
            for (const p of parts) { if (p.type !== 'literal') map[p.type] = p.value; }
            let base = `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
            if (fmt.showMilliseconds) {
                const ms = new Date(ts).getMilliseconds().toString().padStart(3, '0');
                base += `.${ms}`;
            }
            return base;
        } catch {
            const d = new Date(ts);
            let base = d.toLocaleString();
            if (fmt.showMilliseconds) base += `.${d.getMilliseconds().toString().padStart(3, '0')}`;
            return base;
        }
    }

    private createMagnetEntryHtml(item: MagnetLogEntry): string {
        const fmt = this.getConsoleFormat();
        const timestamp = this.formatConsoleTimestamp(new Date(item.timestamp).getTime(), { showMilliseconds: fmt.showMilliseconds, timeZone: fmt.timeZone });
        const data = (item.data || {}) as any;
        const action = String(data.action || '').toUpperCase() || 'PUSH';
        const levelClass = this.getLevelClass(String(item.level || 'INFO'));
        const title = data.magnetName || data.videoId || item.message || '磁力推送';
        const meta = [data.source, data.videoId, data.wpPathId, data.error].filter(Boolean).join(' · ');
        return `
            <div class="log-entry log-level-${levelClass} magnet-entry">
                <div class="log-header">
                    <span class="log-level-badge">${this.escapeHtml(String(item.level || 'INFO').toUpperCase())}</span>
                    <span class="log-category">${this.escapeHtml(action)}</span>
                    <span class="log-message">${this.escapeHtml(String(title))}</span>
                    <span class="log-timestamp">${this.escapeHtml(timestamp)}</span>
                </div>
                <details class="log-data-details">
                    <summary>${this.escapeHtml(meta || item.message || '详细信息')}</summary>
                    <pre>${this.escapeHtml(JSON.stringify(item.data || item, null, 2))}</pre>
                </details>
            </div>
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
     * 转义正则关键字
     */
    private escapeRegExp(text: string): string {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * 刷新标签页
     */
    async refresh(): Promise<void> {
        await this.refreshLogs();
    }

    /**
     * 简易防抖
     */
    private debounce<T extends (...args: any[]) => void>(fn: T, delay = 200): T {
        let timer: number | undefined;
        // @ts-ignore
        return ((...args: any[]) => {
            if (timer) window.clearTimeout(timer);
            timer = window.setTimeout(() => fn(...args), delay);
        }) as T;
    }

    /**
     * 根据视图切换显示容器
     */
    private updateViewVisibility(): void {
        if (!this.logBody || !this.magnetLogBody) return;
        this.updateFilterVisibility();
        if (this.viewMode === 'EXT') {
            this.logBody.hidden = false;
            this.magnetLogBody.hidden = true;
        } else {
            this.logBody.hidden = true;
            this.magnetLogBody.hidden = false;
        }
    }

    private updateFilterVisibility(): void {
        if (this.extFilters) {
            this.extFilters.classList.toggle('is-hidden', this.viewMode !== 'EXT');
        }
        if (this.magnetFilters) {
            this.magnetFilters.classList.toggle('is-hidden', this.viewMode !== 'MAGNET');
        }
        this.moveLinkedFilterControl('log-search-input');
        this.moveLinkedFilterControl('log-start-date');
        this.moveLinkedFilterControl('log-end-date');
    }

    private moveLinkedFilterControl(controlId: string): void {
        const control = document.getElementById(controlId);
        const target = document.querySelector<HTMLElement>(
            `.log-filters:not(.is-hidden) [data-linked-control="${controlId}"]`
        );
        if (!control || !target || target.firstElementChild === control) return;
        target.replaceChildren(control);
    }

    private updateSwitchBtnActive(): void {
        if (this.logViewExtBtn && this.logViewMagnetBtn) {
            if (this.viewMode === 'EXT') {
                this.logViewExtBtn.classList.add('active');
                this.logViewMagnetBtn.classList.remove('active');
            } else {
                this.logViewMagnetBtn.classList.add('active');
                this.logViewExtBtn.classList.remove('active');
            }
        }
    }

    /**
     * 更新日志条数显示
     */
    private updateCountText(text: string): void {
        if (!this.logsCountInfoEl) return;
        this.logsCountInfoEl.textContent = text;
    }

    /**
     * 判断是否为“无过滤条件”状态（可走快速分页路径）
     */
    private isNoFilterActive(): boolean {
            const noLevel = this.currentLevelFilter === 'ALL';
            const noCategory = this.currentCategoryFilter === 'ALL';
            const noSearch = !this.currentSearchQuery;
            const noDate = !this.currentStartDate && !this.currentEndDate;
            const noHasDataOnly = !this.currentHasDataOnly;
            return noLevel && noCategory && noSearch && noDate && noHasDataOnly;
        }


    /**
     * 仅启用“日期/等级”过滤（且未启用设置阈值/来源类别映射），其他过滤条件均未生效
     * 用于走 IDB 分页查询路径
     */
    private isOnlyDateAndLevelFilterActive(): boolean {
            // 首先必须不是"完全无过滤"状态，否则已由 isNoFilterActive 分支处理
            if (this.isNoFilterActive()) return false;
            const noSearch = !this.currentSearchQuery;
            const noCategory = this.currentCategoryFilter === 'ALL';
            const noHasDataOnly = !this.currentHasDataOnly;
            // 允许：等级（可为 ALL 或具体级别）+ 日期（可无或有）
            return noSearch && noCategory && noHasDataOnly;
        }

}

// 导出单例实例
export const logsTab = new LogsTab();

// 自启动：若页面在加载时位于日志页或通过 hash 切换到日志页，自动初始化
try {
    const initIfLogsTab = () => {
        try {
            const hash = window.location.hash.substring(1) || '';
            const mainTab = hash.split('/')[0];
            if (mainTab === 'tab-logs' && !logsTab.isInitialized) {
                logsTab.initialize().catch((e) => console.error('[LogsTab] 初始化失败:', e));
            }
        } catch {}
    };
    // 初次 DOM 就绪后判断一次（延迟一个微任务，等待 dashboard 完成初始切换）
    window.addEventListener('DOMContentLoaded', () => {
        try { setTimeout(initIfLogsTab, 0); } catch {}
    });
    // hash 切换时也判断
    window.addEventListener('hashchange', () => {
        try { initIfLogsTab(); } catch {}
    });
} catch {}
