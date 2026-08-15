/**
 * 功能增强设置面板
 * 解锁强大的增强功能，让JavDB体验更加丰富和高效
 */
// @ts-nocheck — 字段由 split 文件通过 host: any 访问，TS 无法追踪读取，统一关闭检查

import { BaseSettingsPanel } from '../base/BaseSettingsPanel';
import { STATE } from '../../../state';
import { getValue } from '../../../../utils/storage';
import { showMessage } from '../../../ui/toast';
import type { ExtensionSettings, KeywordFilterRule } from '../../../../types';
import type { SettingsValidationResult, SettingsSaveResult } from '../types';
import { saveSettings } from '../../../../utils/storage';
import { ACTOR_FILTER_TAGS, getDefaultTags } from '../../../config/actorFilterTags';
import { handleActorOpacityChange, handleColumnCountChange, handleContainerWidthChange, updateContainerWidthMax, updateCurrentPreviewDelayDisplay, getPreferredPreviewSource, setupCheckboxGroupStyles, setupAnchorConfigStyles, setupVolumeControlStyles } from './ui/enhancementUiStyles';
import { initializeElements } from './binding/enhancementInit';
import { bindEvents } from './binding/enhancementBindEvents';
import { doLoadSettings } from './settings/enhancementLoad';
import { doGetSettings, doSetSettings } from './settings/enhancementSettingsSync';
import { mergeEnhancementSettingsForSave } from './settings/enhancementSettingsMerge';
import { initEnhancementToggles, toggleConfigSections, handleSettingChange } from './settings/enhancementToggles';
import { setupSubSettingsHoverBehavior, handleSubSettingsToggle, updateAllToggleStates } from './ui/enhancementHover';
import { updateTranslationConfigVisibility, onTranslationProviderChange, onTraditionalServiceChange, applyTranslationProviderUI, updateAiCurrentModelUI, navigateToAISettings } from './translation/enhancementTranslation';
import { renderFilterRules, createFilterRuleElement, getFilterFieldsText, getFilterActionText, addFilterRule, editFilterRule, deleteFilterRule, toggleFilterRuleEnabled, openFilterRuleModal, saveFilterRuleFromModal } from './ui/enhancementFilters';
import { displayAppliedTags, initializeActorEnhancementEvents } from './actor/enhancementActorAux';
import { fetchAndUpdateMetrics, enrichMetricsWithLiveTaskState } from './metrics/enhancementMetrics';
import { openOrchestratorModal, closeOrchestratorModal, copyPhasesText, copyTimelineText } from './metrics/enhancementOrchestratorActions';
import { refreshOrchestratorState } from './metrics/enhancementOrchestratorState';
import { bindSubtabLinks, bindOrchestratorControls, mountTranslationConfigIntoVideoBlock } from './binding/enhancementBind';
import { startOrchestratorAutoRefresh, stopOrchestratorAutoRefresh, unsubscribeOrchestratorEvents, getPreferredJavdbTab } from './orchestrator/orchestratorActions';
import { setOrchestratorConnectionStatus, updateOrchestratorLegend, renderOrchestratorPhases, renderOrchestratorTimeline, renderOrchestratorDag } from './orchestrator/orchestratorRender';
import { buildDesignTasks, computeDagLayers, isDesignEmbyEnabled } from './orchestrator/orchestratorDesign';
import type { OrchestratorDesignTask } from './orchestrator/orchestratorDesign';
import { getDesignTaskMeta, getTimelineFilters } from './orchestrator/orchestratorUtils';
import { getStatusLabel, getGlobalTaskStatus, getWaitReasonLabel, buildGlobalTaskDetail, getTaskDescription } from './orchestrator/orchestratorData';
import { getTaskDisplayNameForExport } from './orchestrator/orchestratorExport';
import { normalizeMagnetSortMode } from '../../../../features/magnets';
import { fetchGlobalTaskState } from '../../../services/globalTaskMonitor';
import {
    buildOrchestrationDiagnosticsBundle,
    stringifyDiagnosticsBundle,
} from './diagnostics/orchestrationDiagnosticsBundle';

/**
 * 功能增强设置面板类
 */
export class EnhancementSettings extends BaseSettingsPanel {
    // 数据增强功能元素
    private enableTranslation!: HTMLInputElement;

    // 用户体验增强元素
    private enableContentFilter!: HTMLInputElement;
    private enableMagnetSearch!: HTMLInputElement;
    private enableAnchorOptimization!: HTMLInputElement;
    private enableListEnhancement!: HTMLInputElement;
    private enableActorEnhancement!: HTMLInputElement;
    private enableVideoEnhancement!: HTMLInputElement;
    private enablePasswordHelper!: HTMLInputElement;
    private enableSuperRanking!: HTMLInputElement;

    // 密码助手配置元素
    private passwordShowMethod!: HTMLSelectElement;
    private passwordWaitTime!: HTMLInputElement;

    // 影片页增强子项
    private veEnableCoverImage!: HTMLInputElement;
    private veShowLoadingIndicator!: HTMLInputElement;
    private veEnableReviewEnhancement!: HTMLInputElement;
    private veEnableReviewBreaker!: HTMLInputElement;
    private veEnableFC2Breaker!: HTMLInputElement;
    private veEnableReviewMagnetLinkify!: HTMLInputElement;
    private veEnableReviewPush115!: HTMLInputElement;
    private veEnableActorRemarks!: HTMLInputElement;
    private veEnableActorNameMarks!: HTMLInputElement;
    private veEnableRelatedLists!: HTMLInputElement;
    private veEnableLocalListInSourceModal!: HTMLInputElement;
    private veEnableExternalEntryPanel!: HTMLInputElement;
    private veEnableExternalSearch!: HTMLInputElement;
    private veEnableOnlineAvailability!: HTMLInputElement;
    private veShowOnlineAvailabilityFailures!: HTMLInputElement;
    private veEnableSubtitleSearch!: HTMLInputElement;
    private veActorRemarksMode!: HTMLSelectElement;
    private veActorRemarksTTL!: HTMLInputElement;
    private veActorRemarksTaskTimeout!: HTMLInputElement;
    private veEnableVideoFavoriteRating!: HTMLInputElement; // 新增：影片页收藏与评分
    private enableActorQuickActions!: HTMLInputElement; // 新增：演员标记增强
    // 新增：状态标记增强子项
    private veEnableWantSync!: HTMLInputElement;
    private veAutoMarkWatchedAfter115!: HTMLInputElement;
    private veAutoMarkWatchedStars!: HTMLSelectElement;

    // 磁力搜索源配置
    private magnetSourceSukebei!: HTMLInputElement;
    private magnetSourceBtdig!: HTMLInputElement;
    private magnetSourceBtsow!: HTMLInputElement;
    private magnetSourceTorrentz2!: HTMLInputElement;
    private magnetSourceJavbus!: HTMLInputElement;
    private magnetBlockMojContent!: HTMLInputElement;
    private magnetAutoSearch!: HTMLInputElement;
    private magnetSortMode: HTMLSelectElement | null = null;
    // 磁力搜索并发与限流配置
    private magnetPageMaxConcurrentRequests!: HTMLInputElement;
    private magnetBgGlobalMaxConcurrent!: HTMLInputElement;
    private magnetBgPerHostMaxConcurrent!: HTMLInputElement;
    private magnetBgPerHostRateLimitPerMin!: HTMLInputElement;

    // 锚点优化配置
    private anchorButtonPosition!: HTMLSelectElement;
    private showPreviewButton!: HTMLInputElement;

    // 列表增强配置
    private enableClickEnhancement!: HTMLInputElement;
    private enableClickEnhancementList!: HTMLInputElement;
    private enableClickEnhancementDetail!: HTMLInputElement;
    private enableListVideoPreview!: HTMLInputElement;
    // 🆕 视频预览启用范围
    private enableVideoPreviewList!: HTMLInputElement;
    private enableVideoPreviewDetail!: HTMLInputElement;
    private enableScrollPaging!: HTMLInputElement;
    private previewDelay!: HTMLInputElement;
    private previewVolume!: HTMLInputElement;
    private previewSourceAuto!: HTMLInputElement;
    private previewSourceJavDB!: HTMLInputElement;
    private previewSourceJavSpyl!: HTMLInputElement;
    private previewSourceAVPreview!: HTMLInputElement;
    private previewSourceVBGFL!: HTMLInputElement;
    // 演员水印配置
    private enableActorWatermark!: HTMLInputElement;
    private actorWatermarkPosition!: HTMLSelectElement;
    private actorWatermarkOpacity!: HTMLInputElement;
    private actorWatermarkOpacityValue!: HTMLSpanElement;

    // 🆕 列表显示控制配置
    private listColumnCount!: HTMLInputElement;
    private listColumnCountValue!: HTMLSpanElement;
    private listContainerWidth!: HTMLInputElement;
    private listContainerWidthValue!: HTMLSpanElement;
    private enableContainerExpansion!: HTMLInputElement;
    // 🆕 状态标签显示
    private showStatusBadge!: HTMLInputElement;
    private enableLibraryMatchStatus!: HTMLInputElement;
    private enableStatusQuickAction!: HTMLInputElement;
    private enableListFavoriteQuickAction!: HTMLInputElement;
    private enablePopularityEffects!: HTMLInputElement;
    private popularityMinRating!: HTMLInputElement;
    private popularityMinRatingCount!: HTMLInputElement;

    // 演员页增强配置
    private enableAutoApplyTags!: HTMLInputElement;
    private actorDefaultTagInputs!: NodeListOf<HTMLInputElement>;
    private appliedTagsContainer!: HTMLElement;
    private actorEnhancementConfig!: HTMLElement;
    private lastAppliedTagsDisplay!: HTMLElement;
    private clearLastAppliedTags!: HTMLButtonElement;
    private aeEnableActionButtons!: HTMLInputElement;
    // 新增：演员页 影片分段显示
    private aeEnableTimeSegmentationDivider!: HTMLInputElement;
    private aeTimeSegmentationMonths!: HTMLInputElement;
    // 翻译相关元素
    private translationProviderSel!: HTMLSelectElement;
    private traditionalServiceSel!: HTMLSelectElement;
    private traditionalApiKeyInput!: HTMLInputElement;
    private traditionalApiKeyGroup!: HTMLDivElement;
    private traditionalConfigContainer!: HTMLDivElement;
    private translationConfig!: HTMLDivElement;
    private currentTranslationServiceLabel!: HTMLElement;
    private aiConfigContainer!: HTMLDivElement;
    private aiCurrentModelLabel!: HTMLElement;
    private aiModelEmptyTip!: HTMLElement;
    private goAiSettingsBtn!: HTMLButtonElement;
    private translateCurrentTitleChk!: HTMLInputElement;
    private translationDisplayModeSel!: HTMLSelectElement;

    // 内容过滤相关元素
    private magnetSourcesConfig!: HTMLDivElement;
    private contentFilterConfig!: HTMLElement;
    private anchorOptimizationConfig!: HTMLElement;
    private videoEnhancementConfig!: HTMLDivElement;
    private addFilterRuleBtn!: HTMLButtonElement;
    private filterRulesList!: HTMLElement;
    private enableKeyboardShortcuts?: HTMLInputElement;
    private enhancementTogglesInitialized = false;

    private currentFilterRules: KeywordFilterRule[] = [];

    public getVideoEnhancementSchedulingMode(): 'smart' | 'immediate' {
        return document.querySelector<HTMLInputElement>(
            'input[name="videoEnhancementSchedulingMode"]:checked',
        )?.value === 'immediate' ? 'immediate' : 'smart';
    }

    // 子标签元素
    private subtabLinks!: NodeListOf<HTMLButtonElement>;
    public currentSubtab: 'list' | 'video' | 'actor' | 'other' = 'list';

    // 编排可视化相关
    private orchFilterStatusSel!: HTMLSelectElement | null;
    private orchFilterPhaseSel!: HTMLSelectElement | null;
    private orchFilterSearchInput!: HTMLInputElement | null;
    private orchViewModeSel!: HTMLSelectElement | null;
    private orchGlobalScopeSel!: HTMLSelectElement | null;
    private orchGlobalGroupingSel!: HTMLSelectElement | null;
    private showOrchestratorBtn!: HTMLButtonElement | null;
    private orchestratorModal!: HTMLElement | null;
    private orchestratorModalClose!: HTMLButtonElement | null;
    private orchestratorCloseBtn!: HTMLButtonElement | null;
    private orchestratorRefreshBtn!: HTMLButtonElement | null;
    private orchestratorStopAllBtn!: HTMLButtonElement | null;
    private orchestratorClearGlobalBtn!: HTMLButtonElement | null;
        private orchestratorFullscreenBtn!: HTMLButtonElement | null;
    private orchestratorCopyPhasesBtn!: HTMLButtonElement | null;
    private orchestratorCopyTimelineBtn!: HTMLButtonElement | null;
    private orchestratorPhases!: HTMLElement | null;
    private orchestratorTimeline!: HTMLElement | null;
    private orchestratorSummary!: HTMLElement | null;
    private orchestratorDag!: HTMLElement | null;
    private orchestratorGrid!: HTMLElement | null;
    private orchestratorLegend!: HTMLElement | null;
    private orchestratorConnectionStatus!: HTMLElement | null;
    private orchestratorRuntimeListener?: (msg: any, sender: any, sendResponse: any) => void;
    private orchestratorAutoRefreshTimer?: number;
    private orchestratorTimelineData: Array<{ phase: string; label: string; status: string; ts: number; detail?: any; durationMs?: number }> = [];
    private globalOrchestratorState: any[] = [];

    // 任务明细弹窗相关元素
    private showTaskDetailsBtn!: HTMLButtonElement | null;
    private taskDetailsModal!: HTMLElement | null;
    private taskDetailsModalClose!: HTMLButtonElement | null;
    private taskDetailsCloseBtn!: HTMLButtonElement | null;
    private taskDetailsRefreshBtn!: HTMLButtonElement | null;
    private taskDetailsStopAllBtn!: HTMLButtonElement | null;
    private taskDetailsClearBtn!: HTMLButtonElement | null;
    private taskDetailsCopyCurrentPageBtn!: HTMLButtonElement | null;
    private taskDetailsCopyDiagnosticsBtn!: HTMLButtonElement | null;
    private taskDetailsPrevPage!: HTMLButtonElement | null;
    private taskDetailsNextPage!: HTMLButtonElement | null;
    private taskDetailsSearch!: HTMLInputElement | null;
    private taskDetailsViewTasks!: HTMLButtonElement | null;
    private taskDetailsViewPages!: HTMLButtonElement | null;
    private taskDetailsViewMode!: null;
    private taskDetailsTable!: HTMLTableElement | null;
    private taskDetailsTableBody!: HTMLElement | null;
    private taskDetailsCount!: HTMLElement | null;
    private taskDetailsPagination!: HTMLElement | null;
    private taskDetailsSummary!: HTMLElement | null;
    private taskDetailsPageSummaryHead!: HTMLElement | null;
    private taskDetailsView: 'tasks' | 'pages' = 'tasks';
    private taskDetailsPageSize: number = 200;
    private taskDetailsData: any[] = [];
    private taskDetailsFilteredData: any[] = [];
    private taskDetailsPageSummaryData: any[] = [];
    private taskDetailsPageSummaryFilteredData: any[] = [];
    private taskDetailsSearchQuery: string = '';
    private taskDetailsCurrentPage: number = 1;
    private taskDetailsSortField: string = 'createdAt';
    private taskDetailsSortOrder: 'asc' | 'desc' = 'desc';
    private taskDetailsExpandedParents: Set<string> = new Set();
    private taskDetailsExpandedPageSummaries: Set<string> = new Set();
    private taskDetailsRenderedRows: any[] = [];
    private taskDetailsRenderFingerprint: string = '';
    private taskDetailsRefreshing = false;
    private taskDetailsAutoRefreshTimer?: number;
    private taskDetailsController!: any;
    private subSettingsOpenTimers: WeakMap<HTMLElement, number> = new WeakMap();
    private subSettingsCollapseTimers: WeakMap<HTMLElement, number> = new WeakMap();
    private subSettingsOpenedAt: WeakMap<HTMLElement, number> = new WeakMap();
    private subSettingsHoverInitialized: boolean = false;

    constructor() {
        super({
            panelId: 'enhancement-settings',
            panelName: '功能增强设置',
            autoSave: true,
            saveDelay: 1000,
            requireValidation: false
        });
    }

    /**
     * 动态注入“磁力资源搜索”的并发与限流配置 UI（避免直接修改 settings.html）
     */
    public injectMagnetConcurrencyControls(): void {
        try {
            const container = document.getElementById('magnetSourcesConfig');
            if (!container) return;
            if (document.getElementById('magnetConcurrencyConfig')) return; // 已存在则跳过

            const section = document.createElement('div');
            section.className = 'magnet-concurrency-config';
            section.id = 'magnetConcurrencyConfig';

            // 头部
            const header = document.createElement('div');
            header.className = 'sub-settings-header';
            header.innerHTML = `
                <h5>⚙️ 并发与限流</h5>
                <p class="sub-description">控制磁力搜索的并发与后台限流策略，避免同时打开多个页面时产生突发流量。</p>
            `;
            section.appendChild(header);

            // 行1：页面内并发 + 后台全局并发
            const row1 = document.createElement('div');
            row1.className = 'form-row';
            row1.innerHTML = `
                <div class="form-group-inline" data-settings-search-target="magnet-concurrency:magnetPageMaxConcurrentRequests">
                    <label for="magnetPageMaxConcurrentRequests">页面内并发:</label>
                    <input type="number" id="magnetPageMaxConcurrentRequests" class="number-input" min="1" max="8" value="2">
                    <span class="input-suffix">请求</span>
                </div>
                <div class="form-group-inline" data-settings-search-target="magnet-concurrency:magnetBgGlobalMaxConcurrent">
                    <label for="magnetBgGlobalMaxConcurrent">后台全局并发:</label>
                    <input type="number" id="magnetBgGlobalMaxConcurrent" class="number-input" min="1" max="16" value="4">
                    <span class="input-suffix">请求</span>
                </div>
            `;
            section.appendChild(row1);

            // 行2：每域并发 + 每域速率
            const row2 = document.createElement('div');
            row2.className = 'form-row';
            row2.innerHTML = `
                <div class="form-group-inline" data-settings-search-target="magnet-concurrency:magnetBgPerHostMaxConcurrent">
                    <label for="magnetBgPerHostMaxConcurrent">每域并发:</label>
                    <input type="number" id="magnetBgPerHostMaxConcurrent" class="number-input" min="1" max="4" value="1">
                    <span class="input-suffix">请求</span>
                </div>
                <div class="form-group-inline" data-settings-search-target="magnet-concurrency:magnetBgPerHostRateLimitPerMin">
                    <label for="magnetBgPerHostRateLimitPerMin">每域速率:</label>
                    <input type="number" id="magnetBgPerHostRateLimitPerMin" class="number-input" min="1" max="120" value="12">
                    <span class="input-suffix">次/分钟</span>
                </div>
            `;
            section.appendChild(row2);

            container.appendChild(section);
        } catch (e) {
            console.warn('[Enhancement] injectMagnetConcurrencyControls failed:', e);
        }
    }

    /**
     * 同步演员水印透明度滑块的显示（数值与轨道填充）
     */
    public handleActorOpacityChange(): void {
        return handleActorOpacityChange(this);
    }

    /**
     * 🆕 处理列数变化
     */
    public handleColumnCountChange(): void {
        return handleColumnCountChange(this);
    }

    /**
     * 🆕 处理容器宽度变化
     */
    public handleContainerWidthChange(): void {
        return handleContainerWidthChange(this);
    }

    /**
     * 🆕 根据容器扩展状态和列数更新容器宽度的最大值
     */
    public updateContainerWidthMax(): void {
        return updateContainerWidthMax(this);
    }

    /**
     * 获取当前选中的预览来源
     */
    private getPreferredPreviewSource(): 'auto' | 'javdb' | 'javspyl' | 'avpreview' | 'vbgfl' {
        return getPreferredPreviewSource(this);
    }

    /**
     * 同步"视频预览增强"的当前延迟展示到说明文字（#currentPreviewDelay）
     */
    public updateCurrentPreviewDelayDisplay(): void {
        return updateCurrentPreviewDelayDisplay(this);
    }

    /**
     * 动态生成演员页过滤标签复选框
     */
    public renderActorFilterTags(): void {
        const container = document.getElementById('actorDefaultTagsGroup');
        if (!container) return;

        // 清空容器
        container.innerHTML = '';

        // 根据配置生成复选框
        ACTOR_FILTER_TAGS.forEach(tag => {
            const label = document.createElement('label');
            label.className = 'checkbox-label';
            label.title = tag.description || '';

            const input = document.createElement('input');
            input.type = 'checkbox';
            input.name = 'actorDefaultTag';
            input.value = tag.value;

            const checkmark = document.createElement('span');
            checkmark.className = 'checkmark';

            const text = document.createTextNode(tag.label);

            label.appendChild(input);
            label.appendChild(checkmark);
            label.appendChild(text);
            container.appendChild(label);
        });
    }

    /**
     * 初始化DOM元素
     */
    protected initializeElements(): void {
        initializeElements(this);
    }

    /**
     * 绑定事件监听器
     */
    protected bindEvents(): void {
        bindEvents(this);
    }

    /** 将单个板块重置为默认值 */
    public async resetSectionToDefaults(section: 'list' | 'video' | 'actor'): Promise<void> {
        const s = STATE.settings;
        if (!s) return;
        if (section === 'list') {
            s.listEnhancement = {
                enabled: true,
                enableClickEnhancement: true,
                enableVideoPreview: true,
                enableScrollPaging: false,
                enableListOptimization: true,
                previewDelay: 1000,
                previewVolume: 0.2,
                enableRightClickBackground: true,
                preferredPreviewSource: 'auto'
            };
        } else if (section === 'video') {
            s.videoEnhancement = {
                enabled: false,
                enableCoverImage: true,
                enableTranslation: true,
                showLoadingIndicator: true,
                enableRelatedLists: true,
                enableLocalListInSourceModal: true,
                enableExternalEntryPanel: true,
                enableExternalSearch: true,
                enableOnlineAvailability: true,
                showOnlineAvailabilityFailures: false,
                onlineAvailabilitySites: {},
                enableSubtitleSearch: true,
            } as any;
        } else if (section === 'actor') {
            s.actorEnhancement = {
                enabled: true,
                autoApplyTags: true,
                defaultTags: getDefaultTags(),
                defaultSortType: 0,
            } as any;
        }

        await saveSettings(s);
        STATE.settings = s;
        await this.doLoadSettings();
        showMessage('已重置为默认值', 'success');
    }

    /**
     * 解绑事件监听器
     */
    protected unbindEvents(): void {
        // 这里可以添加解绑逻辑，但由于使用了bind，需要保存引用才能正确解绑
        // 为简化起见，暂时省略
    }

    // ===== Orchestrator Visualization =====
    public async openOrchestratorModal(): Promise<void> {
        return openOrchestratorModal(this);
    }

    public closeOrchestratorModal(): void {
        return closeOrchestratorModal(this);
    }

    public startOrchestratorAutoRefresh(): void {
        return startOrchestratorAutoRefresh(this);
    }

    public stopOrchestratorAutoRefresh(): void {
        return stopOrchestratorAutoRefresh(this);
    }

    public async refreshOrchestratorState(): Promise<void> {
        return refreshOrchestratorState(this);
    }

    public setOrchestratorConnectionStatus(status: 'connecting' | 'connected' | 'disconnected' | 'idle'): void {
        return setOrchestratorConnectionStatus(this, status);
    }

    // 设计视图：根据当前真实配置构造蓝图
    public buildDesignTasks(): OrchestratorDesignTask[] {
        return buildDesignTasks(() => this.doGetSettings() as any);
    }

    public updateOrchestratorLegend(mode: 'global' | 'dag'): void {
        return updateOrchestratorLegend(this, mode);
    }

    public renderOrchestratorDag(tasks: OrchestratorDesignTask[]): void {
        return renderOrchestratorDag(this, tasks);
    }

    public computeDagLayers(tasks: OrchestratorDesignTask[]): Map<string, number> {
        return computeDagLayers(tasks);
    }

    public isDesignEmbyEnabled(settings: ExtensionSettings & Record<string, any>): boolean {
        return isDesignEmbyEnabled(settings);
    }

    public renderOrchestratorPhases(phases: Record<string, string[]>): void {
        return renderOrchestratorPhases(this, phases);
    }

    public getDesignTaskMeta(label: string): OrchestratorDesignTask | null {
        return getDesignTaskMeta(this.buildDesignTasks(), label);
    }

    public getTimelineFilters() {
        return getTimelineFilters(this.orchFilterStatusSel?.value, this.orchFilterPhaseSel?.value, this.orchFilterSearchInput?.value);
    }

    public getStatusLabel(status: string): string {
        return getStatusLabel(status);
    }

    public getGlobalTaskStatus(task: any): string {
        return getGlobalTaskStatus(task);
    }

    public getWaitReasonLabel(waitReason: string | undefined): string {
        return getWaitReasonLabel(waitReason);
    }

    public buildGlobalTaskDetail(task: any): string {
        return buildGlobalTaskDetail(task);
    }

    // 任务中文说明（可按需扩展）
    public getTaskDescription(label: string): string {
        return getTaskDescription(label);
    }

    public renderOrchestratorTimeline(timeline: Array<{ phase: string; label: string; status: string; ts: number; detail?: any; durationMs?: number }>): void {
        return renderOrchestratorTimeline(this, timeline);
    }

    // 注入一次性的轻量样式，保证在暗色主题下也清晰
    public ensureOrchestratorLocalStyles(): void {
        if (document.getElementById('orch-local-style')) return;
        const style = document.createElement('style');
        style.id = 'orch-local-style';
        style.textContent = `
        #orchestratorModalContent.fullscreen { width:96vw !important; max-width:96vw !important; height:96vh !important; max-height:96vh !important; }
        .orchestrator-toolbar { display:flex; flex-wrap:wrap; gap:10px; align-items:center; padding:8px; background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:10px; color:var(--text-primary); box-shadow:0 1px 2px rgba(0,0,0,0.04); }
        .orchestrator-toolbar label { display:flex; align-items:center; gap:6px; padding:6px 10px; background:var(--bg-primary); border:1px solid var(--border-color); border-radius:8px; color:var(--text-primary); transition:background .2s ease, border-color .2s ease, box-shadow .2s ease; }
        .orchestrator-toolbar label:focus-within { border-color:#60a5fa; box-shadow:0 0 0 3px rgba(96,165,250,.16); }
        .orchestrator-toolbar label > select { border:none; outline:none; background:var(--bg-primary); color:var(--text-primary); font-weight:600; min-width:88px; cursor:pointer; appearance:auto; border-radius:6px; padding:2px 24px 2px 8px; }
        .orchestrator-toolbar label > select option { background:var(--bg-primary); color:var(--text-primary); }
        .orchestrator-toolbar label > select:disabled { color:var(--text-secondary); cursor:not-allowed; opacity:.72; }
        .orchestrator-toolbar input[type="search"] { padding:8px 12px; border:1px solid var(--border-color); border-radius:999px; background:var(--bg-primary); color:var(--text-primary); min-width:240px; box-shadow: inset 0 1px 2px rgba(0,0,0,0.03); }
        .orchestrator-toolbar input[type="search"]::placeholder { color:var(--text-secondary); opacity:.9; }
        .orchestrator-toolbar input[type="search"]:focus { border-color:#60a5fa; box-shadow: 0 0 0 3px rgba(96,165,250,.25); outline:none; }
        .orch-legend { margin:8px 0 12px 0; font-size:12px; color:var(--text-secondary); line-height:1.6; background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:8px; padding:8px 10px; text-align:left; }
        .orch-legend strong { color:var(--text-primary); }
        .orch-legend code { padding:0 4px; border-radius:4px; background:var(--bg-primary); color:var(--text-primary); }
        .orch-legend .legend-title { font-weight:600; }
        @media (prefers-color-scheme: dark) {
          .orchestrator-toolbar { box-shadow:0 1px 2px rgba(0,0,0,0.24); }
          .orchestrator-toolbar label > select { background:var(--bg-tertiary); color:var(--text-primary); border:1px solid var(--border-primary); }
          .orchestrator-toolbar label > select option { background:var(--bg-tertiary); color:var(--text-primary); }
          .orchestrator-toolbar input[type="search"] { box-shadow: inset 0 1px 2px rgba(255,255,255,0.04); }
        }
        .orch-phases-grid { display:grid; grid-template-columns: repeat(2, 1fr); gap:12px; }
        .orch-card { background:var(--bg-primary); border:1px solid var(--border-color); border-radius:8px; box-shadow:0 1px 2px rgba(0,0,0,0.04); }
        .orch-card-header { display:flex; justify-content:space-between; align-items:center; padding:8px 10px; border-bottom:1px solid var(--border-color); font-weight:600; }
        .orch-list { list-style:none; margin:8px 10px; padding:0; }
        .orch-list li { padding:4px 0; display:flex; gap:6px; align-items:flex-start; color:var(--text-primary); line-height:1.4; }
        .orch-list li .dot { width:6px; height:6px; background:#9ca3af; border-radius:50%; display:inline-block; margin-top:6px; flex-shrink:0; }
        .orch-list li .task-label { font-weight:500; color:var(--text-primary); }
        .orch-list li .task-meta { color:#0f766e; font-size:11px; font-weight:600; padding:0 6px; border-radius:999px; background:rgba(15,118,110,0.12); }
        .orch-list li .task-desc { color:var(--text-secondary); font-size:12px; }
        .orch-list li.muted { color:#9ca3af; }
        .muted { color:#9ca3af; }
        .header.with-duration { display:grid; grid-template-columns: 90px 100px 110px 1fr 80px; align-items:center; column-gap:8px; }
        .header.no-duration { display:grid; grid-template-columns: 90px 100px 110px 1fr; align-items:center; column-gap:8px; }
        #orchestratorTimeline.timeline-realtime .row { display:grid; grid-template-columns: 90px 100px 110px 1fr 80px; align-items:center; column-gap:8px; }
        #orchestratorTimeline.timeline-design .row { display:grid; grid-template-columns: 90px 100px 110px 1fr; align-items:center; column-gap:8px; }
        .header { font-weight:600; padding:6px 4px; border-bottom:1px solid var(--border-color); background:var(--bg-secondary); color:var(--text-primary); }
        .row { padding:6px 4px; border-bottom:1px dashed var(--border-color); position:relative; }
        .row.concurrent { background:rgba(59, 130, 246, 0.1); border-left:3px solid #3b82f6; }
        .badge { display:inline-block; padding:2px 8px; border-radius:999px; font-size:12px; font-weight:600; color:#fff; }
        .badge.scheduled { background:#607d8b; }
        .badge.registered { background:#6b7280; }
        .badge.queued { background:#0ea5e9; }
        .badge.leased { background:#7c3aed; }
        .badge.running { background:#ff8f00; }
        .badge.paused { background:#a855f7; }
        .badge.canceled { background:#6b7280; }
        .badge.done { background:#2e7d32; }
        .badge.error { background:#d32f2f; }
        .badge.stale { background:#b45309; }
        .detail { margin:0 4px 6px 4px; color:#b91c1c; font-size:12px; }
        .label-main { font-weight:600; color:var(--text-primary); }
        .label-desc { color:var(--text-secondary); font-size:12px; margin-top:2px; }
        .concurrent-marker { color:#3b82f6; font-size:14px; margin-right:4px; font-weight:bold; }
        .col.time { color:var(--text-secondary); font-family:monospace; }
        .orch-dag-wrap { overflow-x:auto; }
        .orch-dag-grid { display:grid; gap:1px; background:var(--border-color); border:1px solid var(--border-color); border-radius:8px; overflow:hidden; min-width:max-content; }
        .orch-dag-corner { background:var(--bg-secondary); padding:8px; }
        .orch-dag-layer-hdr { background:var(--bg-secondary); padding:8px 10px; font-weight:600; font-size:12px; text-align:center; color:var(--text-secondary); }
        .orch-dag-phase-lbl { background:var(--bg-secondary); padding:8px 4px; font-size:11px; font-weight:700; text-align:center; display:flex; align-items:center; justify-content:center; writing-mode:vertical-rl; }
        .orch-dag-cell { background:var(--bg-primary); padding:6px; display:flex; flex-direction:column; gap:4px; min-height:40px; }
        .orch-dag-node { border-radius:6px; padding:5px 8px; font-size:12px; cursor:default; border-left:3px solid; display:flex; flex-direction:column; gap:2px; background:rgba(0,0,0,0.03); }
        .orch-dag-node-label { font-weight:600; color:var(--text-primary); word-break:break-all; }
        .orch-dag-node-meta { font-size:10px; color:var(--text-secondary); }
        .td-view-switcher { display:flex; gap:2px; align-items:center; }
        .td-view-btn { padding:5px 12px; border:none; border-bottom:2px solid transparent; background:transparent; color:var(--text-secondary); cursor:pointer; font-size:12px; font-weight:500; border-radius:4px 4px 0 0; transition:color .15s, border-color .15s; }
        .td-view-btn:hover { color:var(--text-primary); background:var(--bg-secondary); }
        .td-view-btn--active { color:var(--bg-accent, #546da1); border-bottom-color:var(--bg-accent, #546da1); font-weight:600; }
        `;
        document.head.appendChild(style);
    }

    // 统一的剪贴板写入（带回退）
    private async writeClipboard(text: string): Promise<void> {
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch {}
            document.body.removeChild(ta);
        }
    }

    // 复制”已注册任务”文本
    public async copyPhasesText(): Promise<void> {
        return copyPhasesText(this);
    }

    // 复制”事件时间线”文本
    public async copyTimelineText(): Promise<void> {
        return copyTimelineText(this);
    }

    public unsubscribeOrchestratorEvents(): void {
        return unsubscribeOrchestratorEvents(this);
    }

    public async getPreferredJavdbTab(): Promise<chrome.tabs.Tab | null> {
        return getPreferredJavdbTab();
    }

    public getTaskDisplayNameForExport(label: string): string {
        return getTaskDisplayNameForExport(label);
    }

    public getSortedTaskDetailsData(): any[] {
        return this.taskDetailsController.getSortedTaskDetailsData();
    }

    public getTaskDetailSortValue(task: any, sortField: string): string | number {
        return this.taskDetailsController.getTaskDetailSortValue(task, sortField);
    }

    public compareTaskDetailItems(a: any, b: any): number {
        return this.taskDetailsController.compareTaskDetailItems(a, b);
    }

    public getVisibleTaskDetailGroups(includeCollapsedChildren: boolean = false): Array<{ parentKey: string; parent: any; children: any[] }> {
        return this.taskDetailsController.getVisibleTaskDetailGroups(includeCollapsedChildren);
    }

    private buildVisibleTaskDetailsTableText(): string {
        return this.taskDetailsController.buildVisibleTaskDetailsTableText();
    }

    public async copyCurrentPageTaskDiagnostics(): Promise<void> {
        try {
            this.renderTaskDetailsTable();
            const total = this.getRenderedTaskDetailsCount();
            const totalPages = Math.max(1, Math.ceil(total / this.taskDetailsPageSize));
            this.updateTaskDetailsPagination(total, totalPages);
            const text = this.buildVisibleTaskDetailsTableText();
            await this.writeClipboard(text);
            showMessage(this.taskDetailsView === 'pages' ? '当前页面实例汇总已复制' : '当前任务明细已复制', 'success');
        } catch (e) {
            console.error('[Enhancement] copyCurrentPageTaskDiagnostics failed:', e);
            showMessage(this.taskDetailsView === 'pages' ? '复制页面实例汇总失败' : '复制当前任务明细失败', 'error');
        }
    }

    /**
     * 复制完整 JSON 诊断包（任务明细 + 任务中心快照 + alarm 诊断 + 版本）
     * 供用户粘贴给开发者远程排障，避免双方互测浏览器。
     */
    public async copyOrchestrationDiagnosticsBundle(): Promise<void> {
        const errors: string[] = [];
        try {
            const send = <T = any>(message: any): Promise<T | null> =>
                new Promise((resolve) => {
                    try {
                        chrome.runtime.sendMessage(message, (resp) => {
                            if (chrome.runtime.lastError) {
                                errors.push(String(chrome.runtime.lastError.message || 'runtime error'));
                                resolve(null);
                                return;
                            }
                            resolve(resp as T);
                        });
                    } catch (e) {
                        errors.push(String(e));
                        resolve(null);
                    }
                });

            const [detailsResp, centerState, alarmResp] = await Promise.all([
                send<any>({ type: 'orchestrator:getTaskDetails', options: { page: 1, pageSize: 5000 } }),
                fetchGlobalTaskState().catch((e) => {
                    errors.push(`task-center: ${e}`);
                    return { tasks: [] };
                }),
                send<any>({ type: 'ALARM_DIAGNOSTICS_GET' }),
            ]);

            let extensionVersion = 'unknown';
            try {
                extensionVersion = chrome.runtime.getManifest?.()?.version || extensionVersion;
            } catch {}

            const details = Array.isArray(detailsResp?.details)
                ? detailsResp.details
                : Array.isArray(this.taskDetailsData)
                    ? this.taskDetailsData
                    : [];
            if (!detailsResp?.details) {
                errors.push('orchestrator:getTaskDetails unavailable; used in-memory taskDetailsData fallback if any');
            }

            const centerTasks = Array.isArray(centerState?.tasks) ? centerState.tasks : [];
            const alarmDiagnostics =
                alarmResp?.success && alarmResp?.diagnostics && typeof alarmResp.diagnostics === 'object'
                    ? alarmResp.diagnostics
                    : alarmResp?.diagnostics || undefined;
            if (alarmResp && alarmResp.success === false) {
                errors.push(`alarm diagnostics: ${alarmResp.error || 'failed'}`);
            }

            const timeline = Array.isArray(this.orchestratorTimelineData)
                ? (this.orchestratorTimelineData as any[])
                : [];

            const bundle = buildOrchestrationDiagnosticsBundle({
                extensionVersion,
                exportedAt: Date.now(),
                alarmDiagnostics,
                taskCenterTasks: centerTasks,
                taskDetails: details,
                orchestratorTimeline: timeline,
                meta: {
                    note: 'Paste this JSON to the developer for orchestration troubleshooting',
                    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
                    branchHint: 'feat/orchestration-p1',
                },
                errors: errors.length ? errors : undefined,
            });

            await this.writeClipboard(stringifyDiagnosticsBundle(bundle));
            showMessage('诊断包已复制（JSON）。发给开发者即可远程排查', 'success');
        } catch (e) {
            console.error('[Enhancement] copyOrchestrationDiagnosticsBundle failed:', e);
            showMessage('复制诊断包失败', 'error');
        }
    }

    /**
     * 加载设置到UI
     */
    protected async doLoadSettings(): Promise<void> {
        return doLoadSettings(this);
    }

    /**
     * 幂等绑定子标签点击事件
     * 设置页子页面会被 replace 重建，因此需要在重新加载后对新按钮补绑事件
     */
    public bindSubtabLinks(): void {
        return bindSubtabLinks(this);
    }

    /**
     * 幂等绑定编排面板相关按钮事件
     * 设置页子页面会被 replace 重建，因此需要在重新加载后对新按钮补绑事件
     */
    public bindOrchestratorControls(): void {
        return bindOrchestratorControls(this);
    }

    /**
     * 将翻译配置(#translationConfig)移动到”影片页增强”的标题翻译独立区块内
     */
    public mountTranslationConfigIntoVideoBlock(): void {
        return mountTranslationConfigIntoVideoBlock(this);
    }

    /**
     * 保存设置
     */
    protected async doSaveSettings(): Promise<SettingsSaveResult> {
        try {
            const mergedEnhancementSettings = mergeEnhancementSettingsForSave(STATE.settings, this);
            const newSettings: ExtensionSettings = {
                ...STATE.settings,
                // 磁力资源搜索设置保存
                magnetSearch: {
                    sources: {
                        sukebei: this.magnetSourceSukebei?.checked !== false,
                        btdig: this.magnetSourceBtdig?.checked !== false,
                        btsow: this.magnetSourceBtsow?.checked !== false,
                        torrentz2: this.magnetSourceTorrentz2?.checked === true,
                        javbus: this.magnetSourceJavbus?.checked === true,
                        custom: [],
                    },
                    blockMojContent: this.magnetBlockMojContent?.checked !== false,
                    autoSearch: this.magnetAutoSearch?.checked === true,
                    sortMode: normalizeMagnetSortMode(this.magnetSortMode?.value),
                    maxResults: (STATE.settings?.magnetSearch as any)?.maxResults ?? 15,
                    timeoutMs: (STATE.settings?.magnetSearch as any)?.timeoutMs ?? 6000,
                    concurrency: {
                        pageMaxConcurrentRequests: parseInt(this.magnetPageMaxConcurrentRequests?.value || '2', 10),
                        bgGlobalMaxConcurrent: parseInt(this.magnetBgGlobalMaxConcurrent?.value || '4', 10),
                        bgPerHostMaxConcurrent: parseInt(this.magnetBgPerHostMaxConcurrent?.value || '1', 10),
                        bgPerHostRateLimitPerMin: parseInt(this.magnetBgPerHostRateLimitPerMin?.value || '12', 10),
                    },
                },
                dataEnhancement: {
                    enableMultiSource: false, // 仍未启用
                    // 将"视频预览增强"与列表增强的预览开关保持一致
                    enableVideoPreview: this.enableListVideoPreview?.checked !== false,
                    enableTranslation: this.enableTranslation.checked,
                },
                // 影片页增强配置保存（启用状态由主开关决定）
                videoEnhancement: {
                    schedulingMode: this.getVideoEnhancementSchedulingMode(),
                    enabled: this.enableVideoEnhancement?.checked === true,
                    enableCoverImage: this.veEnableCoverImage?.checked !== false,
                    // 与"翻译"总开关保持一致，避免两处状态不一致
                    enableTranslation: this.enableTranslation?.checked === true,
                    showLoadingIndicator: this.veShowLoadingIndicator?.checked !== false,
                    enableReviewEnhancement: this.veEnableReviewEnhancement?.checked === true,
                    enableReviewBreaker: this.veEnableReviewBreaker?.checked === true,
                    enableFC2Breaker: this.veEnableFC2Breaker?.checked === true,
                    enableReviewMagnetLinkify: this.veEnableReviewMagnetLinkify?.checked !== false,
                    enableReviewPush115: this.veEnableReviewPush115?.checked !== false,
                    // 新增：本地同步子项
                    enableWantSync: this.veEnableWantSync?.checked !== false,
                    autoMarkWatchedAfter115: this.veAutoMarkWatchedAfter115?.checked !== false,
                    autoMarkWatchedStars: parseInt(this.veAutoMarkWatchedStars?.value || '4', 10) || 4,
                    // 新增：演员备注
                    enableActorRemarks: this.veEnableActorRemarks?.checked === true,
                    enableActorNameMarks: this.veEnableActorNameMarks?.checked !== false,
                    enableRelatedLists: this.veEnableRelatedLists?.checked !== false,
                    enableLocalListInSourceModal: this.veEnableLocalListInSourceModal?.checked !== false,
                    enableExternalEntryPanel: this.veEnableExternalEntryPanel?.checked !== false,
                    enableExternalSearch: this.veEnableExternalSearch?.checked !== false,
                    enableOnlineAvailability: this.veEnableOnlineAvailability?.checked !== false,
                    showOnlineAvailabilityFailures: this.veShowOnlineAvailabilityFailures?.checked === true,
                    onlineAvailabilitySites: (mergedEnhancementSettings.videoEnhancement as any)?.onlineAvailabilitySites ?? {},
                    enableSubtitleSearch: this.veEnableSubtitleSearch?.checked !== false,
                    actorRemarksMode: ((this.veActorRemarksMode?.value as any) || 'panel') as any,
                    actorRemarksTTLDays: parseInt(this.veActorRemarksTTL?.value || '0', 10) || 0,
                    actorRemarksTaskTimeoutSeconds: parseInt(this.veActorRemarksTaskTimeout?.value || '10', 10) || 10,
                    // 新增：影片页收藏与评分
                    enableVideoFavoriteRating: this.veEnableVideoFavoriteRating?.checked === true,
                    // 新增：演员标记增强
                    enableActorQuickActions: this.enableActorQuickActions?.checked === true,
                } as any,
                translation: {
                    provider: (this.translationProviderSel?.value as 'traditional' | 'ai') || 'traditional',
                    traditional: {
                        service: 'google',
                        apiKey: this.traditionalApiKeyInput?.value?.trim() || undefined,
                        sourceLanguage: 'ja',
                        targetLanguage: 'zh-CN',
                    },
                    ai: {
                        useGlobalModel: true,
                    },
                    displayMode: (this.translationDisplayModeSel?.value as 'append' | 'replace') || 'append',
                    targets: {
                        currentTitle: this.translateCurrentTitleChk?.checked === true,
                    }
                },
                userExperience: {
                    enableContentFilter: this.enableContentFilter.checked,
                    enableKeyboardShortcuts: false, // 开发中，强制禁用
                    enableMagnetSearch: this.enableMagnetSearch.checked,
                    enableAnchorOptimization: this.enableAnchorOptimization.checked,
                    enableListEnhancement: this.enableListEnhancement.checked,
                    // 演员页增强主开关是唯一权威来源
                    enableActorEnhancement: this.enableActorEnhancement.checked,
                    showEnhancedTooltips: false, // 开发中，强制禁用
                    enablePasswordHelper: this.enablePasswordHelper?.checked === true,
                    enableSuperRanking: this.enableSuperRanking?.checked !== false,
                },
                passwordHelper: {
                    showMethod: parseInt(this.passwordShowMethod?.value || '0', 10),
                    waitTime: parseInt(this.passwordWaitTime?.value || '350', 10),
                },
                anchorOptimization: {
                    enabled: this.enableAnchorOptimization.checked,
                    showPreviewButton: this.showPreviewButton?.checked !== false,
                    buttonPosition: (this.anchorButtonPosition?.value as 'right-center' | 'right-bottom') || 'right-center',
                },
                libraryMatchStatus: mergedEnhancementSettings.libraryMatchStatus,
                listEnhancement: mergedEnhancementSettings.listEnhancement,
                actorEnhancement: {
                    // 演员页增强运行总开关与主开关保持一致
                    enabled: this.enableActorEnhancement.checked,
                    autoApplyTags: this.enableAutoApplyTags?.checked !== false,
                    defaultTags: this.actorDefaultTagInputs && this.actorDefaultTagInputs.length > 0
                        ? Array.from(this.actorDefaultTagInputs).filter((i: HTMLInputElement) => i.checked).map(i => i.value)
                        : getDefaultTags(),
                    defaultSortType: 0,
                    enableActionButtons: this.aeEnableActionButtons?.checked !== false,
                    // 新增：演员页 影片分段显示
                    enableTimeSegmentationDivider: this.aeEnableTimeSegmentationDivider?.checked === true,
                    timeSegmentationMonths: parseInt(this.aeTimeSegmentationMonths?.value || '6', 10),
                },
                contentFilter: {
                    enabled: this.enableContentFilter.checked,
                    keywordRules: this.currentFilterRules,
                },
            };

            await saveSettings(newSettings);
            console.log('[Enhancement] saving translation targets', {
                currentTitleChecked: this.translateCurrentTitleChk?.checked,
                translationTargets: newSettings.translation?.targets,
            });
            STATE.settings = newSettings;

            // 通知所有JavDB标签页设置已更新（兼容大小写类型）
            chrome.tabs.query({ url: '*://javdb.com/*' }, (tabs) => {
                tabs.forEach(tab => {
                    if (tab.id) {
                        try {
                            console.log('[Enhancement] Broadcasting settings-updated to tab:', { tabId: tab.id, url: tab.url });
                            chrome.tabs.sendMessage(tab.id, { type: 'settings-updated', settings: newSettings }, () => {
                                if (chrome.runtime.lastError) {
                                    console.debug('[Enhancement] settings-updated skipped:', { tabId: tab.id, error: chrome.runtime.lastError.message });
                                }
                            });
                        } catch {}
                        try {
                            console.log('[Enhancement] Broadcasting SETTINGS_UPDATED to tab:', { tabId: tab.id, url: tab.url });
                            chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED', settings: newSettings }, () => {
                                if (chrome.runtime.lastError) {
                                    console.debug('[Enhancement] SETTINGS_UPDATED skipped:', { tabId: tab.id, error: chrome.runtime.lastError.message });
                                }
                            });
                        } catch {}
                    }
                });
            });

            return {
                success: true,
                savedSettings: {
                    dataEnhancement: newSettings.dataEnhancement,
                    userExperience: newSettings.userExperience,
                    anchorOptimization: newSettings.anchorOptimization,
                    listEnhancement: newSettings.listEnhancement,
                    actorEnhancement: newSettings.actorEnhancement
                }
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : '保存失败'
            };
        }
    }

    // 读取当前面板值为设置（满足 BaseSettingsPanel 接口）
    protected doGetSettings(): Partial<ExtensionSettings> {
        return doGetSettings(this);
    }

    // 将给定设置快速回填到面板（满足 BaseSettingsPanel 接口）
    protected doSetSettings(settings: Partial<ExtensionSettings>): void {
        return doSetSettings(this, settings);
    }

    /**
     * 验证设置
     */
    protected doValidateSettings(): SettingsValidationResult {
        return { isValid: true };
    }


    /**
     * 初始化功能增强开关
     */
    public initEnhancementToggles(): void {
        return initEnhancementToggles(this);
    }

    /**
     * 悬浮展开/离开折叠 sub-settings
     */
    public setupSubSettingsHoverBehavior(): void {
        return setupSubSettingsHoverBehavior(this);
    }

    /**
     * 处理子设置的显示/隐藏
     */
    public handleSubSettingsToggle(targetId: string, isEnabled: boolean): void {
        return handleSubSettingsToggle(this, targetId, isEnabled);
    }

    /**
     * 更新翻译配置可见性
     */
    public updateTranslationConfigVisibility(): void {
        return updateTranslationConfigVisibility(this);
    }

    /**
     * 处理翻译服务切换
     */
    public onTranslationProviderChange(): void {
        return onTranslationProviderChange(this);
    }

    /**
     * 传统服务切换（目前仅 Google）
     */
    public onTraditionalServiceChange(): void {
        return onTraditionalServiceChange(this);
    }

    // 本地不再切换 AI 模型，直接使用 AI 设置中的模型

    /**
     * 应用翻译服务 UI 显示
     */
    public applyTranslationProviderUI(): void {
        return applyTranslationProviderUI(this);
    }

    /**
     * 更新 AI 当前模型显示
     */
    public async updateAiCurrentModelUI(): Promise<void> {
        return updateAiCurrentModelUI(this);
    }

    /**
     * 跳转到 AI 设置
     */
    public navigateToAISettings(): void {
        return navigateToAISettings();
    }

    /**
     * 切换配置区域显示/隐藏
     */
    public toggleConfigSections(): void {
        return toggleConfigSections(this);
    }

    /**
     * 处理设置变化
     */
    public handleSettingChange(): void {
        return handleSettingChange(this);
    }

    /**
     * 处理音量变化
     
    private handleVolumeChange(e: Event): void {
        const value = (e.target as HTMLInputElement).value;
        const volumeFloat = parseFloat(value);
        const percentage = Math.round(volumeFloat * 100);

        console.log(`[Enhancement] 音量变化: ${percentage}%`);

        // 更新百分比显示
        if (this.previewVolumeValue) {
            this.previewVolumeValue.textContent = `${percentage}%`;
        }

        // 更新进度条宽度
        const volumeGroup = document.querySelector('.volume-control-group') as HTMLElement;
        const trackFill = volumeGroup?.querySelector('.range-track-fill') as HTMLElement;
        if (trackFill) {
            trackFill.style.width = `${percentage}%`;
            console.log(`[Enhancement] 进度条宽度更新为: ${trackFill.style.width}`);
        } else {
            console.warn('[Enhancement] 未找到进度条元素，无法更新宽度');
        }

        // 立即通知内容脚本音量已更改
        this.notifyVolumeChange(volumeFloat);

        this.handleSettingChange();
    }*/

    /**
     * 通知内容脚本音量已更改
     
    private notifyVolumeChange(volume: number): void {
        // 通知所有JavDB标签页音量已更改
        if (typeof chrome !== 'undefined' && chrome.tabs) {
            chrome.tabs.query({ url: '*://javdb.com/*' }, (tabs) => {
                tabs.forEach(tab => {
                    if (tab.id) {
                        chrome.tabs.sendMessage(tab.id, {
                            type: 'volume-changed',
                            volume: volume
                        }).catch(() => {
                            // 忽略无法发送消息的标签页（可能已关闭或未加载扩展）
                        });
                    }
                });
            });
        }
    }*/

    /**
     * 渲染过滤规则列表
     */
    public renderFilterRules(): void {
        return renderFilterRules(this);
    }

    /**
     * 创建过滤规则元素
     */
    public createFilterRuleElement(rule: KeywordFilterRule, index: number): HTMLElement {
        return createFilterRuleElement(this, rule, index);
    }

    /**
     * 获取过滤字段文本
     */
    public getFilterFieldsText(fields: string[]): string {
        return getFilterFieldsText(fields);
    }

    /**
     * 获取过滤动作文本
     */
    public getFilterActionText(action: string): string {
        return getFilterActionText(action);
    }

    /**
     * 添加过滤规则
     */
    public addFilterRule(): void {
        return addFilterRule(this);
    }

    /**
     * 编辑过滤规则
     */
    public editFilterRule(index: number): void {
        return editFilterRule(this, index);
    }

    /**
     * 打开规则弹窗
     */
    public openFilterRuleModal(rule?: KeywordFilterRule, index?: number): void {
        return openFilterRuleModal(this, rule, index);
    }

    /** 保存弹窗中的规则 */
    public saveFilterRuleFromModal(index?: number): void {
        return saveFilterRuleFromModal(this, index);
    }

    /**
     * 删除过滤规则
     */
    public async deleteFilterRule(index: number): Promise<void> {
        return deleteFilterRule(this, index);
    }

    /**
     * 快速切换过滤规则的启用状态
     */
    public toggleFilterRuleEnabled(index: number): void {
        return toggleFilterRuleEnabled(this, index);
    }

    /**
     * 强制更新所有滑块状态
     */
    public updateAllToggleStates(): void {
        return updateAllToggleStates(this);
    }

    /**
     * 切换子标签显示
     */
    public switchSubtab(sub: 'list' | 'video' | 'actor' | 'other'): void {
        console.log('[Enhancement] switchSubtab called with:', sub);
        this.currentSubtab = sub as any;
        try { localStorage.setItem('enhancementSubtab', sub); } catch {}

        // 更新按钮状态
        if (this.subtabLinks && this.subtabLinks.length > 0) {
            this.subtabLinks.forEach(btn => {
                if (btn.getAttribute('data-subtab') === sub) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
        }

        // 控制所有带 data-subtab 的元素显示/隐藏
        // 选择 .settings-page-body 下的所有 .form-group[data-subtab]
        const subtabElements = document.querySelectorAll('#enhancement-settings .settings-page-body .form-group[data-subtab]');
        console.log('[Enhancement] Found subtab elements:', subtabElements.length);
        
        subtabElements.forEach(el => {
            const elem = el as HTMLElement;
            const attr = elem.getAttribute('data-subtab');
            const shouldShow = (attr === sub);
            elem.style.display = shouldShow ? '' : 'none';
            console.log(`[Enhancement] Element with data-subtab="${attr}": ${shouldShow ? 'show' : 'hide'}`);
        });

        // 读取并应用每个 section 的折叠状态
        const sectionIds = ['listEnhancementConfig','videoEnhancementConfig','actorAutoApplyConfig','actorDefaultTagsConfig'];
        sectionIds.forEach(id => {
            const section = document.getElementById(id);
            if (!section) return;
            try {
                const key = `enhancementSectionCollapsed:${id}`;
                const collapsed = localStorage.getItem(key) === '1';
                section.classList.toggle('collapsed', collapsed);
            } catch {}
        });
    }

    /**
     * 设置复选框组样式支持
     * 为不支持CSS :has()选择器的浏览器提供JavaScript支持
     */
    public setupCheckboxGroupStyles(): void {
        return setupCheckboxGroupStyles();
    }

    /**
     * 更新复选框标签状态
     */
    public updateCheckboxLabelState(checkbox: HTMLInputElement, label: HTMLElement): void {
        if (checkbox.checked) {
            label.classList.add('checked');
        } else {
            label.classList.remove('checked');
        }
    }

    /**
     * 设置锚点配置样式支持
     * 为不支持CSS :has()选择器的浏览器提供JavaScript支持
     */
    public setupAnchorConfigStyles(): void {
        return setupAnchorConfigStyles();
    }

    /**
     * 更新锚点配置选项状态
     */
    public updateAnchorConfigState(input: HTMLInputElement, option: HTMLElement): void {
        if (input.checked) {
            option.classList.add('active');
        } else {
            option.classList.remove('active');
        }
    }

    /**
     * 设置音量控制样式支持
     * 处理滑块轨道填充效果和交互状态
     */
    public setupVolumeControlStyles(): void {
        return setupVolumeControlStyles();
    }

    /**
     * 加载上次应用的标签
     */
    public async loadLastAppliedTags(): Promise<void> {
        try {
            const lastAppliedTags = await getValue('lastAppliedActorTags', '');
            if (lastAppliedTags && this.appliedTagsContainer) {
                this.displayAppliedTags(lastAppliedTags);
            }
        } catch (error) {
            console.error('[Enhancement] 加载上次应用标签失败:', error);
        }
    }

    /**
     * 显示已应用的标签
     */
    public displayAppliedTags(tagsString: string): void {
        return displayAppliedTags(this, tagsString);
    }

    /**
     * 初始化演员页增强事件监听器
     */
    public initializeActorEnhancementEvents(): void {
        return initializeActorEnhancementEvents(this);
    }

    /**
     * 获取并更新性能指标
     */
    public async fetchAndUpdateMetrics(): Promise<void> {
        return fetchAndUpdateMetrics(this);
    }

    /**
     * 更新性能指标显示
     */
    public updatePerformanceMetrics(metrics: any): void {
        const metricTotalTasks = document.getElementById('metricTotalTasks');
        const metricCompletedTasks = document.getElementById('metricCompletedTasks');
        const metricRunningTasks = document.getElementById('metricRunningTasks');
        const metricPendingTasks = document.getElementById('metricPendingTasks');
        const metricFailedTasks = document.getElementById('metricFailedTasks');
        const metricTimeoutTasks = document.getElementById('metricTimeoutTasks');
        const metricAvgDuration = document.getElementById('metricAvgDuration');
        const metricMaxDuration = document.getElementById('metricMaxDuration');
        const metricMinDuration = document.getElementById('metricMinDuration');
        const metricTotalDuration = document.getElementById('metricTotalDuration');
        const metricBatchTotal = document.getElementById('metricBatchTotal');
        const metricBatchCompleted = document.getElementById('metricBatchCompleted');
        const metricSubtaskTotal = document.getElementById('metricSubtaskTotal');
        const metricSubtaskCompleted = document.getElementById('metricSubtaskCompleted');
        const metricSubtaskFailed = document.getElementById('metricSubtaskFailed');

        if (!metrics) {
            // 清空或显示默认值
            if (metricTotalTasks) metricTotalTasks.textContent = '0';
            if (metricCompletedTasks) metricCompletedTasks.textContent = '0';
            if (metricRunningTasks) metricRunningTasks.textContent = '0';
            if (metricPendingTasks) metricPendingTasks.textContent = '0';
            if (metricFailedTasks) metricFailedTasks.textContent = '0';
            if (metricTimeoutTasks) metricTimeoutTasks.textContent = '0';
            if (metricAvgDuration) metricAvgDuration.textContent = '0ms';
            if (metricMaxDuration) metricMaxDuration.textContent = '0ms';
            if (metricMinDuration) metricMinDuration.textContent = '∞';
            if (metricTotalDuration) metricTotalDuration.textContent = '0ms';
            if (metricBatchTotal) metricBatchTotal.textContent = '0';
            if (metricBatchCompleted) metricBatchCompleted.textContent = '0';
            if (metricSubtaskTotal) metricSubtaskTotal.textContent = '0';
            if (metricSubtaskCompleted) metricSubtaskCompleted.textContent = '0';
            if (metricSubtaskFailed) metricSubtaskFailed.textContent = '0';
            return;
        }

        // 格式化时间显示
        const formatDuration = (ms: number): string => {
            if (ms < 1000) {
                return `${Math.round(ms)}ms`;
            } else if (ms < 60000) {
                return `${(ms / 1000).toFixed(2)}s`;
            } else {
                const minutes = Math.floor(ms / 60000);
                const seconds = ((ms % 60000) / 1000).toFixed(0);
                return `${minutes}m ${seconds}s`;
            }
        };

        // 更新指标
        if (metricTotalTasks) metricTotalTasks.textContent = String(metrics.totalTasks || 0);
        if (metricCompletedTasks) {
            const successRate = metrics.successRate !== undefined ? ` (${metrics.successRate.toFixed(1)}%)` : '';
            metricCompletedTasks.textContent = `${metrics.completedTasks || 0}${successRate}`;
        }
        if (metricRunningTasks) metricRunningTasks.textContent = String(metrics.runningTasks || 0);
        if (metricPendingTasks) metricPendingTasks.textContent = String(metrics.pendingTasks || 0);
        if (metricFailedTasks) metricFailedTasks.textContent = String(metrics.failedTasks || 0);
        if (metricTimeoutTasks) metricTimeoutTasks.textContent = String(metrics.timeoutTasks || 0);
        if (metricAvgDuration) metricAvgDuration.textContent = formatDuration(metrics.avgDuration || 0);
        
        // 最长耗时：显示任务名称
        if (metricMaxDuration) {
            metricMaxDuration.textContent = formatDuration(metrics.maxDuration || 0);
            metricMaxDuration.title = metrics.maxDurationTask ? `最耗时任务: ${metrics.maxDurationTask}` : '';
        }
        
        if (metricMinDuration) {
            const minDur = metrics.minDuration;
            metricMinDuration.textContent = (minDur === Infinity || minDur === undefined) ? '∞' : formatDuration(minDur);
        }
        if (metricTotalDuration) metricTotalDuration.textContent = formatDuration(metrics.totalDuration || 0);
        if (metricBatchTotal) metricBatchTotal.textContent = String(metrics.batchTotal ?? metrics.recordCount ?? 0);
        if (metricBatchCompleted) metricBatchCompleted.textContent = String(metrics.batchCompleted ?? metrics.completedTasks ?? 0);
        if (metricSubtaskTotal) metricSubtaskTotal.textContent = String(metrics.subtaskTotal ?? 0);
        if (metricSubtaskCompleted) metricSubtaskCompleted.textContent = String(metrics.subtaskDone ?? 0);
        if (metricSubtaskFailed) metricSubtaskFailed.textContent = String((metrics.subtaskError ?? 0) + (metrics.subtaskTimeout ?? 0));
    }

    public enrichMetricsWithLiveTaskState(metrics: any, tasks: any[]): any {
        return enrichMetricsWithLiveTaskState(this, metrics, tasks);
    }

    // ===== 任务明细弹窗相关方法 =====

    /**
     * 打开任务明细弹窗
     */
    public async openTaskDetailsModal(): Promise<void> {
        return this.taskDetailsController.openTaskDetailsModal();
    }

    /**
     * 关闭任务明细弹窗
     */
    public closeTaskDetailsModal(): void {
        return this.taskDetailsController.closeTaskDetailsModal();
    }

    public startTaskDetailsAutoRefresh(): void {
        return this.taskDetailsController.startTaskDetailsAutoRefresh();
    }

    public stopTaskDetailsAutoRefresh(): void {
        return this.taskDetailsController.stopTaskDetailsAutoRefresh();
    }

    /**
     * 刷新任务明细数据
     */
    public async refreshTaskDetails(showSpinner: boolean = true): Promise<void> {
        return this.taskDetailsController.refreshTaskDetails(showSpinner);
    }

    /**
     * 清空任务明细数据
     */
    public async clearTaskDetails(): Promise<void> {
        return this.taskDetailsController.clearTaskDetails();
    }

    public async clearGlobalTaskState(): Promise<void> {
        return this.taskDetailsController.clearGlobalTaskState();
    }

    public async stopAllTaskDetails(): Promise<void> {
        return this.taskDetailsController.stopAllTaskDetails();
    }

    /**
     * 从后台获取任务明细数据
     */
    public buildTaskDetailsFingerprint(rows: any[]): string {
        return this.taskDetailsController.buildTaskDetailsFingerprint(rows);
    }

    public async fetchTaskDetails(showLoading: boolean = true): Promise<void> {
        return this.taskDetailsController.fetchTaskDetails(showLoading);
    }

    /**
     * 渲染任务明细表格
     */

    public getTaskDetailsSourceData(): any[] {
        return this.taskDetailsController.getTaskDetailsSourceData();
    }

    public getTaskDetailsPageSummarySourceData(): any[] {
        return this.taskDetailsController.getTaskDetailsPageSummarySourceData();
    }

    public getPagePath(url?: string): string {
        return this.taskDetailsController.getPagePath(url);
    }

    public formatTaskDuration(ms: number): string {
        return this.taskDetailsController.formatTaskDuration(ms);
    }

    public formatTaskTimestamp(ts: number): string {
        return this.taskDetailsController.formatTaskTimestamp(ts);
    }


    public getTaskRegisteredAt(task: any): number {
        return this.taskDetailsController.getTaskRegisteredAt(task);
    }

    public getTaskStartedAt(task: any): number {
        return this.taskDetailsController.getTaskStartedAt(task);
    }

    public getTaskEndedAt(task: any): number {
        return this.taskDetailsController.getTaskEndedAt(task);
    }

    public getTaskEffectiveEndAt(task: any): number {
        return this.taskDetailsController.getTaskEffectiveEndAt(task);
    }

    public getTaskWaitDurationMs(task: any): number {
        return this.taskDetailsController.getTaskWaitDurationMs(task);
    }

    public getTaskRunDurationMs(task: any): number {
        return this.taskDetailsController.getTaskRunDurationMs(task);
    }

    public getTaskPendingReasonLabel(waitReason?: string): string {
        return this.taskDetailsController.getTaskPendingReasonLabel(waitReason);
    }

    public isTerminalTaskStatus(status?: string): boolean {
        return this.taskDetailsController.isTerminalTaskStatus(status);
    }

    public getTaskDisplayReason(task: any): string {
        return this.taskDetailsController.getTaskDisplayReason(task);
    }

    public escapeHtml(value: any): string {
        return this.taskDetailsController.escapeHtml(value);
    }

    public getPageSummaryTasks(item: any): any[] {
        return this.taskDetailsController.getPageSummaryTasks(item);
    }

    public buildPageSummaryReasonStats(tasks: any[]): Array<{ label: string; count: number }> {
        return this.taskDetailsController.buildPageSummaryReasonStats(tasks);
    }

    public buildTaskDetailPageSummaries(tasks: any[]): any[] {
        return this.taskDetailsController.buildTaskDetailPageSummaries(tasks);
    }

    public getTaskDetailsGroupedParents(data: any[]): Array<{ parentKey: string; parent: any; children: any[] }> {
        return this.taskDetailsController.getTaskDetailsGroupedParents(data);
    }

    /**
     * 渲染任务明细表格
     */
    public renderTaskDetailsTable(): void {
        return this.taskDetailsController.renderTaskDetailsTable();
    }

    public renderTaskDetailsPageSummaryTable(): void {
        return this.taskDetailsController.renderTaskDetailsPageSummaryTable();
    }

    /**
     * 更新分页信息

     */
    public updateTaskDetailsPagination(total: number, totalPages: number): void {
        return this.taskDetailsController.updateTaskDetailsPagination(total, totalPages);
    }

    /**
     * 上一页
     */
    public taskDetailsPrevPageHandler(): void {
        return this.taskDetailsController.taskDetailsPrevPageHandler();
    }

    /**
     * 下一页
     */
    public taskDetailsNextPageHandler(): void {
        return this.taskDetailsController.taskDetailsNextPageHandler();
    }

    public getRenderedTaskDetailsCount(): number {
        return this.taskDetailsController.getRenderedTaskDetailsCount();
    }

    /**
     * 排序处理
     */
    public taskDetailsSortHandler(field: string): void {
        return this.taskDetailsController.taskDetailsSortHandler(field);
    }

    /**
     * 搜索处理
     */
    public taskDetailsSearchHandler(): void {
        return this.taskDetailsController.taskDetailsSearchHandler();
    }
}
