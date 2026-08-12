import {
  addTrace,
  generateReportHTML,
  getPersonaName,
  renderTemplate,
  type PersonaId,
} from "../../features/insights";
import { aiService } from "../../features/ai";
import { dbInsReportsPut, dbInsReportsList, dbInsReportsGet, dbInsReportsDelete, dbInsReportsExport, dbInsReportsImport } from "../dbClient";
import { dbInsViewsRange, dbViewedPage } from "../dbClient";
import { getSettings } from "../../utils/storage";
import type { VideoRecord } from "../../types";
import { showMessage } from "../ui/toast";
import { initInsightsMonthPicker } from "../components/MonthRangePickerIntegration";
import { themeManager } from "../services/themeManager";
import { log } from '../../utils/logController';
import { createInsightsPromptRuntime } from './insights/promptRuntime';
import { createInsightsTraceRuntime } from './insights/traceRuntime';
import { createInsightsExportRuntime } from './insights/exportRuntime';
import { createInsightsPreviewRuntime } from './insights/previewRuntime';
import { createInsightsConfirmRuntime } from './insights/confirmRuntime';
import { createInsightsModelDropdownRuntime } from './insights/modelDropdownRuntime';
import { createInsightsPreviewActionsRuntime } from './insights/previewActionsRuntime';
import { createInsightsLoadingStatusRuntime } from './insights/loadingStatusRuntime';
import { createInsightsGenerationRuntime } from './insights/generationRuntime';
import { createInsightsSavedReportsRuntime } from './insights/savedReportsRuntime';
import {
  adjustInsightsIframeHeight,
  fetchInsightsVideoRecordsPaged,
  getInsightsPreviewContainer,
  loadInsightsTemplate,
} from './insights/supportRuntime';
import { buildInsightsStatsForPeriod } from './insights/reportAggregationRuntime';
import {
  buildInsightsHistoryEmptyHtml,
  buildInsightsHistoryListHtml,
} from './insights/historyListModel';
import { buildSamplePreviewFields } from './insights/samplePreviewModel';
import { dashboardTabLifecycle } from './tabLifecycle';
import { clearTabWorkset } from './tabWorkset';

function getEl<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

const { updateCurrentPersonaDisplay, ensurePromptsButton, openPromptsModal } = createInsightsPromptRuntime();
const { confirmDialog } = createInsightsConfirmRuntime();
const {
  getSelectedHistoryMonths,
  performExport,
  setupExportDropdown,
  inlineAssets,
} = createInsightsExportRuntime({ getReportByMonth: dbInsReportsGet });

function updateDeleteSelectedEnabled(): void {
  try {
    const btn = getEl<HTMLButtonElement>('insights-delete-selected');
    if (!btn) return;
    const cnt = getSelectedHistoryMonths().length;
    btn.disabled = cnt === 0;
  } catch {}
}

function setModelErrorBanner(msg: string): void {
  try {
    const cont = document.querySelector('.tab-section[data-tab-id="insights"] .container') as HTMLDivElement | null;
    if (!cont) return;
    let el = document.getElementById('insights-model-error') as HTMLDivElement | null;
    if (!el) {
      el = document.createElement('div');
      el.id = 'insights-model-error';
      el.className = 'alert-banner';
      try { el.style.borderColor = '#fecaca'; el.style.backgroundColor = '#fee2e2'; el.style.color = '#991b1b'; } catch {}
      const icon = document.createElement('span');
      icon.className = 'icon';
      icon.textContent = '⛔';
      const text = document.createElement('span');
      el.appendChild(icon);
      el.appendChild(text);
      const toolbar = cont.querySelector('.insights-toolbar');
      cont.insertBefore(el, toolbar || null);
    }
    const spans = el.querySelectorAll('span');
    const textSpan = spans.length > 1 ? spans[1] : null;
    if (textSpan) textSpan.textContent = msg;
    else el.textContent = msg;
  } catch {}
}

function clearModelErrorBanner(): void {
  try {
    const el = document.getElementById('insights-model-error');
    if (el && el.parentElement) el.parentElement.removeChild(el);
  } catch {}
}

// 预览动作的可用状态：生成后才允许“保存为月报”
let canSaveReport = false;
// 页面级：AI 模型覆盖，仅作用于本页面（不改全局设置）
let pageModelOverride: string | undefined = undefined;
// 保存当前预览的原始 HTML（未经预览处理）
let currentPreviewRawHTML: string = '';
let insightsLifecycleUnregister: (() => void) | null = null;
let insightsActive = false;

function ensureInsightsLifecycle(): void {
  if (insightsLifecycleUnregister) return;
  insightsLifecycleUnregister = dashboardTabLifecycle.register('tab-insights', {
    onActive: () => { insightsActive = true; },
    onRestore: () => {
      insightsActive = true;
      if (currentPreviewRawHTML) previewRuntime.refreshPreviewFromRaw();
      else void previewSample();
      void insightsTab.refreshHistory();
    },
    onHidden: () => {
      insightsActive = false;
      const iframe = getEl<HTMLIFrameElement>('insights-preview');
      if (iframe) iframe.srcdoc = '';
      clearTabWorkset(document.getElementById('tab-insights'), ['#insights-history-list']);
    },
    onDispose: () => {
      const iframe = getEl<HTMLIFrameElement>('insights-preview');
      if (iframe) iframe.srcdoc = '';
      clearTabWorkset(document.getElementById('tab-insights'), ['#insights-history-list']);
      insightsActive = false;
      insightsLifecycleUnregister?.();
      insightsLifecycleUnregister = null;
    },
  });
}

const adjustIframeHeight = adjustInsightsIframeHeight;
const loadTemplate = () => loadInsightsTemplate({
  getTemplateUrl: () => chrome.runtime.getURL('assets/templates/insights-report.html'),
});
const fetchAllVideoRecordsPaged = (pageSize = 500): Promise<VideoRecord[]> =>
  fetchInsightsVideoRecordsPaged<VideoRecord>(dbViewedPage, pageSize);
const getPreviewContainer = () => getInsightsPreviewContainer(document);
const { ensureModelDropdown } = createInsightsModelDropdownRuntime({
  readyAi: () => aiService.ready(),
  getAiSettings: () => aiService.getSettings(),
  getAvailableModels: (forceRefresh?: boolean) => aiService.getAvailableModels(forceRefresh),
  setPageModelOverride: (value) => { pageModelOverride = value; },
  setModelErrorBanner,
  clearModelErrorBanner,
  showMessage,
});
const previewActionsRuntime = createInsightsPreviewActionsRuntime({
  getPreviewContainer,
  getCanSaveReport: () => canSaveReport,
  onSaveCurrentAsMonthly: () => { void insightsTab.saveCurrentAsMonthly(); },
  inlineAssets,
  showMessage,
});
const { setActionsDisabled, showLoading, showStatus, clearStatus } = createInsightsLoadingStatusRuntime({
  getPreviewContainer,
});
const { ensureTraceButton, onTraceClick } = createInsightsTraceRuntime({ getPreviewContainer });
const previewRuntime = createInsightsPreviewRuntime({
  setCurrentPreviewRawHtml: (html) => { currentPreviewRawHTML = html; },
  getCurrentPreviewRawHtml: () => currentPreviewRawHTML,
  setCanSaveReport: (value) => { canSaveReport = value; },
  adjustIframeHeight,
  ensurePreviewCopyButton,
});
const { handleGenerate } = createInsightsGenerationRuntime({
  showLoading,
  clearStatus,
  showStatus,
  previewSample,
  dbInsReportsGet,
  confirmDialog,
  getSettings,
  buildStatsForPeriod: buildInsightsStatsForPeriod,
  dbInsViewsRange,
  fetchAllVideoRecordsPaged,
  addTrace,
  getPersonaName,
  loadTemplate,
  generateReportHTML,
  writePreview: (html, options) => previewRuntime.writePreview(html, options),
  getAiLastError: () => {
    try { return aiService.getStatus().lastError; } catch { return undefined; }
  },
  getPageModelOverride: () => pageModelOverride,
  logError: (message, error) => { log.error(message, error); },
  getBaseHref: () => chrome.runtime.getURL('') || './',
});
const savedReportsRuntime = createInsightsSavedReportsRuntime({
  dbInsReportsGet,
  dbInsReportsList,
  dbInsReportsPut,
  dbInsReportsDelete,
  dbInsReportsExport,
  dbInsReportsImport,
  confirmDialog,
  getSettings,
  buildStatsForPeriod: buildInsightsStatsForPeriod,
  dbInsViewsRange,
  fetchAllVideoRecordsPaged,
  loadTemplate,
  getPersonaName,
  generateReportHTML,
  writePreview: (html, options) => previewRuntime.writePreview(html, options),
  getPageModelOverride: () => pageModelOverride,
  getBaseHref: () => chrome.runtime.getURL('') || './',
  updateDeleteSelectedEnabled,
  buildHistoryEmptyHtml: buildInsightsHistoryEmptyHtml,
  buildHistoryListHtml: buildInsightsHistoryListHtml,
});

function ensurePreviewCopyButton(): HTMLDivElement | null {
  return previewActionsRuntime.ensurePreviewCopyButton();
}

async function previewSample() {
  const iframe = getEl<HTMLIFrameElement>('insights-preview');
  if (!iframe) return;
  const now = new Date();
  const extSettings = await getSettings();
  const p = (extSettings as any)?.insights?.prompts || {};
  const usePersona: PersonaId = ['doctor', 'default', 'maid', 'tsundere', 'yandere', 'analyst', 'friend', 'bro'].includes(p?.persona) ? p.persona : 'doctor';
  const personaName = getPersonaName(usePersona);
  const fields = buildSamplePreviewFields({
    personaName,
    baseHref: chrome.runtime.getURL('') || './',
    generatedAt: now.toLocaleString(),
  });
  const tpl = await loadTemplate();
  const html = renderTemplate({ templateHTML: tpl, fields });
  previewRuntime.writePreview(html, { canSave: false });
}

export const insightsTab = {
  isInitialized: false,
  async initialize() {
    if (this.isInitialized) return;
    ensureInsightsLifecycle();
    this.isInitialized = true;

    const genBtn = getEl<HTMLButtonElement>('insights-generate');
    const exportBtn = getEl<HTMLButtonElement>('insights-export');
    const refreshHistoryBtn = getEl<HTMLButtonElement>('insights-refresh-history');
    const deleteSelectedBtn = getEl<HTMLButtonElement>('insights-delete-selected');

    genBtn?.addEventListener('click', handleGenerate);
    // 将“生成报告”主按钮移动到右侧动作区
    try {
      const actionsBar = document.getElementById('insights-toolbar-row2-actions');
      if (actionsBar && genBtn && genBtn.parentElement !== actionsBar) {
        actionsBar.appendChild(genBtn);
      }
    } catch {}
    exportBtn?.addEventListener('click', () => { performExport('html'); });
    setupExportDropdown(exportBtn || null);
    // 保存按钮由预览区右上角动态注入与控制
    refreshHistoryBtn?.addEventListener('click', () => this.refreshHistory());
    deleteSelectedBtn?.addEventListener('click', async () => {
      const months = getSelectedHistoryMonths();
      if (!months.length) { try { showMessage('请先勾选要删除的历史项', 'info'); } catch {} return; }
      const ok = await confirmDialog({
        title: '确认删除',
        message: `将删除 ${months.length} 个已保存的月报，操作不可恢复。`,
        okText: '删除',
        cancelText: '取消'
      });
      if (!ok) return;
      setActionsDisabled(true);
      try {
        for (const m of months) { try { await dbInsReportsDelete(m); } catch {} }
        await this.refreshHistory();
        try { showMessage('删除完成', 'info'); } catch {}
      } finally { setActionsDisabled(false); }
    });

    // 默认选中上一个月
    try {
      const sEl = getEl<HTMLInputElement>('insights-month-start');
      const eEl = getEl<HTMLInputElement>('insights-month-end');
      if (sEl && !sEl.value) {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        sEl.value = `${y}-${m}`;
      }
      if (eEl && !eEl.value) {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        eEl.value = `${y}-${m}`;
      }
    } catch {}

    // 初始化新的月份选择器（替换原生控件）
    try {
      initInsightsMonthPicker();
    } catch (err) {
      log.warn('[Insights] 初始化月份选择器失败，回退到原生输入', err);
    }

    // 按钮初始化顺序：先创建编辑提示词，再创建查看生成过程，最后移动生成报告
    try {
      const promptsBtn = ensurePromptsButton();
      promptsBtn?.addEventListener('click', () => { openPromptsModal(); });
    } catch {}
    try {
      const traceBtn = ensureTraceButton();
      traceBtn?.addEventListener('click', onTraceClick);
    } catch {}
    try { await ensureModelDropdown(); } catch {}

    // 初次进入显示示例预览
    try { await previewSample(); } catch {}

    // 更新当前人设显示
    try { await updateCurrentPersonaDisplay(); } catch {}

    // 刷新历史
    try { await this.refreshHistory(); updateDeleteSelectedEnabled(); } catch {}

    // 监听主题切换，自动重新渲染预览
    try {
      themeManager.onThemeChange(() => {
        previewRuntime.refreshPreviewFromRaw();
      });
    } catch (err) {
      log.warn('[Insights] 主题切换监听器注册失败', err);
    }
  },

  async saveCurrentAsMonthly(): Promise<void> {
    await savedReportsRuntime.saveCurrentAsMonthly();
  },

  async refreshHistory(): Promise<void> {
    await savedReportsRuntime.refreshHistory();
  },

  async enforceRetention(maxMonths = 24): Promise<void> {
    await savedReportsRuntime.enforceRetention(maxMonths);
  }
  ,
  async exportAllJson(): Promise<void> {
    await savedReportsRuntime.exportAllJson();
  }
  ,
  async importAllJson(): Promise<void> {
    await savedReportsRuntime.importAllJson();
  }
};
