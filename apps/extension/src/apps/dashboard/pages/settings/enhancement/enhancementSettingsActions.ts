/**
 * @file enhancementSettingsActions.ts
 * @description 功能增强设置动作：持久化、诊断导出、AI 模型读取
 * @module apps/dashboard/pages/settings/enhancement
 */
import type { ExtensionSettings } from '../../../../../types';
import {
  applyEnhancementFormToSettings,
  mapSettingsToEnhancementForm,
  validateEnhancementForm,
  type EnhancementSettingsFormState,
} from './enhancementSettingsModel';
import {
  getSettings,
  saveSettings,
  syncDashboardState,
  notifyJavdbTabsSettingsUpdated,
} from '../shared/settingsPersist';
import { getValue, setValue } from '../../../../../utils/storage';
import { sendRuntimeMessage } from '../../../../../platform/browser/runtimeMessages';

export async function toast(
  message: string,
  type: 'success' | 'info' | 'error' | 'warning' = 'info',
): Promise<void> {
  try {
    const { showMessage } = await import('../../../../../dashboard/ui/toast');
    showMessage(message, type as any);
  } catch {
    /* ignore */
  }
}

/**
 * 加载表单
 */
export async function loadEnhancementSettingsForm(): Promise<EnhancementSettingsFormState> {
  const settings = await getSettings();
  return mapSettingsToEnhancementForm(settings);
}

/**
 * 读取演员页最近一次实际应用的过滤标签。
 */
export async function loadLastAppliedActorTags(): Promise<string[]> {
  const raw = await getValue('lastAppliedActorTags', '');
  return String(raw)
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/**
 * 清除演员页最近一次应用的过滤标签记录。
 */
export async function clearLastAppliedActorTags(): Promise<void> {
  await setValue('lastAppliedActorTags', '');
}

/**
 * 广播设置更新（大小写两套，对齐遗留）
 */
export function broadcastEnhancementSettings(settings: ExtensionSettings): void {
  notifyJavdbTabsSettingsUpdated();
  try {
    chrome.tabs.query({ url: '*://javdb.com/*' }, (tabs) => {
      tabs.forEach((tab) => {
        if (!tab.id) return;
        try {
          chrome.tabs.sendMessage(
            tab.id,
            { type: 'SETTINGS_UPDATED', settings },
            () => {
              if (chrome.runtime.lastError) {
                /* ignore */
              }
            },
          );
        } catch {
          /* ignore */
        }
      });
    });
  } catch {
    /* ignore */
  }
}

/**
 * 持久化增强设置
 */
export async function persistEnhancementForm(
  form: EnhancementSettingsFormState,
): Promise<{ ok: boolean; error?: string }> {
  const validation = validateEnhancementForm(form);
  if (!validation.isValid) {
    return { ok: false, error: validation.errors[0] || '校验失败' };
  }
  try {
    const current = await getSettings();
    const next = applyEnhancementFormToSettings(current, form);
    await saveSettings(next);
    await syncDashboardState(next);
    broadcastEnhancementSettings(next);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '保存失败',
    };
  }
}

/**
 * 读取 AI 当前模型名（翻译区展示）
 */
export async function readAiSelectedModelLabel(): Promise<string> {
  try {
    const { aiService } = await import('../../../../../features/ai');
    await aiService.ready();
    const model = (aiService.getSettings()?.selectedModel || '').trim();
    return model || '';
  } catch {
    return '';
  }
}

/**
 * 跳转 AI 设置
 */
export function navigateToAISettings(): void {
  try {
    window.location.hash = '#tab-settings/ai-settings';
    window.dispatchEvent(
      new CustomEvent('settingsSubSectionChange' as any, {
        detail: { section: 'ai-settings' },
      }),
    );
  } catch {
    /* ignore */
  }
}

type OrchestratorBridge = {
  [key: string]: unknown;
  openOrchestratorModal: () => Promise<void>;
  closeOrchestratorModal: () => void;
  refreshOrchestratorState: () => Promise<void>;
  renderOrchestratorTimeline: (items: unknown[]) => void;
  startOrchestratorAutoRefresh: () => void;
  unsubscribeOrchestratorEvents: () => void;
  stopAllTaskDetails: () => Promise<void>;
  clearGlobalTaskState: () => Promise<void>;
  copyPhasesText: () => Promise<void>;
  copyTimelineText: () => Promise<void>;
};

function orchestratorElement<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function bindOrchestratorControl(
  element: HTMLElement | null,
  action: () => void,
): void {
  if (!element || element.dataset.reactOrchestratorBound === '1') return;
  element.dataset.reactOrchestratorBound = '1';
  element.addEventListener('click', action);
}

/**
 * React 设置页复用全局调度中心，不初始化遗留设置面板，避免其 DOM 监听覆盖 React 状态。
 */
export async function openEnhancementOrchestrator(): Promise<void> {
  const [{ getEnhancementSettings }, { TaskDetailsController }] = await Promise.all([
    import('../../../../../dashboard/tabs/settings/enhancement'),
    import('../../../../../dashboard/tabs/settings/enhancement/taskDetails/taskDetailsController'),
  ]);
  const bridge = (await getEnhancementSettings()) as unknown as OrchestratorBridge;

  Object.assign(bridge, {
    orchestratorModal: orchestratorElement('orchestratorModal'),
    orchestratorModalClose: orchestratorElement<HTMLButtonElement>('orchestratorModalClose'),
    orchestratorCloseBtn: orchestratorElement<HTMLButtonElement>('orchestratorCloseBtn'),
    orchestratorRefreshBtn: orchestratorElement<HTMLButtonElement>('orchestratorRefreshBtn'),
    orchestratorStopAllBtn: orchestratorElement<HTMLButtonElement>('orchestratorStopAllBtn'),
    orchestratorClearGlobalBtn: orchestratorElement<HTMLButtonElement>('orchestratorClearGlobalBtn'),
    orchestratorFullscreenBtn: orchestratorElement<HTMLButtonElement>('orchestratorFullscreenBtn'),
    orchestratorCopyPhasesBtn: orchestratorElement<HTMLButtonElement>('orchestratorCopyPhasesBtn'),
    orchestratorCopyTimelineBtn: orchestratorElement<HTMLButtonElement>('orchestratorCopyTimelineBtn'),
    orchViewModeSel: orchestratorElement<HTMLSelectElement>('orchViewMode'),
    orchFilterStatusSel: orchestratorElement<HTMLSelectElement>('orchFilterStatus'),
    orchFilterPhaseSel: orchestratorElement<HTMLSelectElement>('orchFilterPhase'),
    orchGlobalScopeSel: orchestratorElement<HTMLSelectElement>('orchGlobalScope'),
    orchGlobalGroupingSel: orchestratorElement<HTMLSelectElement>('orchGlobalGrouping'),
    orchFilterSearchInput: orchestratorElement<HTMLInputElement>('orchFilterSearch'),
    orchestratorPhases: orchestratorElement('orchestratorPhases'),
    orchestratorTimeline: orchestratorElement('orchestratorTimeline'),
    orchestratorSummary: orchestratorElement('orchestratorSummary'),
    orchestratorDag: orchestratorElement('orchestratorDag'),
    orchestratorGrid: orchestratorElement('orchestratorGrid'),
    orchestratorLegend: orchestratorElement('orchestratorLegend'),
    orchestratorConnectionStatus: orchestratorElement('orchestratorConnectionStatus'),
  });

  bridge.taskDetailsController = new TaskDetailsController(bridge);
  bindOrchestratorControl(
    bridge.orchestratorModalClose as HTMLButtonElement | null,
    () => bridge.closeOrchestratorModal(),
  );
  bindOrchestratorControl(
    bridge.orchestratorCloseBtn as HTMLButtonElement | null,
    () => bridge.closeOrchestratorModal(),
  );
  bindOrchestratorControl(
    bridge.orchestratorRefreshBtn as HTMLButtonElement | null,
    () => void bridge.refreshOrchestratorState(),
  );
  bindOrchestratorControl(
    bridge.orchestratorStopAllBtn as HTMLButtonElement | null,
    () => void bridge.stopAllTaskDetails(),
  );
  bindOrchestratorControl(
    bridge.orchestratorClearGlobalBtn as HTMLButtonElement | null,
    () => void bridge.clearGlobalTaskState(),
  );
  bindOrchestratorControl(
    bridge.orchestratorCopyPhasesBtn as HTMLButtonElement | null,
    () => void bridge.copyPhasesText(),
  );
  bindOrchestratorControl(
    bridge.orchestratorCopyTimelineBtn as HTMLButtonElement | null,
    () => void bridge.copyTimelineText(),
  );

  const timeline = bridge.orchestratorTimeline as HTMLElement | null;
  const fullscreen = bridge.orchestratorFullscreenBtn as HTMLButtonElement | null;
  bindOrchestratorControl(fullscreen, () => {
    const content = orchestratorElement('orchestratorModalContent');
    if (!content) return;
    const expanded = content.classList.toggle('fullscreen');
    if (fullscreen) fullscreen.textContent = expanded ? '退出全屏' : '全屏';
    timeline?.scrollTo({ top: timeline.scrollHeight });
  });

  const filterStatus = bridge.orchFilterStatusSel as HTMLSelectElement | null;
  const filterPhase = bridge.orchFilterPhaseSel as HTMLSelectElement | null;
  const filterSearch = bridge.orchFilterSearchInput as HTMLInputElement | null;
  const scope = bridge.orchGlobalScopeSel as HTMLSelectElement | null;
  const grouping = bridge.orchGlobalGroupingSel as HTMLSelectElement | null;
  const mode = bridge.orchViewModeSel as HTMLSelectElement | null;
  const bindChange = (element: HTMLElement | null, event: 'change' | 'input', action: () => void) => {
    if (!element || element.dataset.reactOrchestratorBound === '1') return;
    element.dataset.reactOrchestratorBound = '1';
    element.addEventListener(event, action);
  };
  bindChange(filterStatus, 'change', () => bridge.renderOrchestratorTimeline((bridge.orchestratorTimelineData as unknown[]) || []));
  bindChange(filterPhase, 'change', () => bridge.renderOrchestratorTimeline((bridge.orchestratorTimelineData as unknown[]) || []));
  bindChange(filterSearch, 'input', () => bridge.renderOrchestratorTimeline((bridge.orchestratorTimelineData as unknown[]) || []));
  bindChange(scope, 'change', () => void bridge.refreshOrchestratorState());
  bindChange(grouping, 'change', () => void bridge.refreshOrchestratorState());
  bindChange(mode, 'change', () => {
    bridge.unsubscribeOrchestratorEvents();
    bridge.startOrchestratorAutoRefresh();
    void bridge.refreshOrchestratorState();
  });

  await bridge.openOrchestratorModal();
}

/**
 * 导出编排诊断包（简化：告警诊断 + 版本信息）
 */
export async function exportOrchestrationDiagnostics(): Promise<{
  ok: boolean;
  error?: string;
}> {
  try {
    let alarmDiagnostics: Record<string, unknown> | null = null;
    try {
      const resp = await sendRuntimeMessage({ type: 'GET_ALARM_DIAGNOSTICS' });
      if (resp && typeof resp === 'object') {
        alarmDiagnostics = (resp as any).data || (resp as any);
      }
    } catch {
      /* background 可能未就绪 */
    }

    const { buildOrchestrationDiagnosticsBundle, stringifyDiagnosticsBundle } = await import(
      '../../../../../dashboard/tabs/settings/enhancement/diagnostics/orchestrationDiagnosticsBundle'
    );

    let extensionVersion = 'unknown';
    try {
      extensionVersion = chrome.runtime.getManifest()?.version || 'unknown';
    } catch {
      /* ignore */
    }

    const bundle = buildOrchestrationDiagnosticsBundle({
      extensionVersion,
      alarmDiagnostics,
      meta: {
        note: 'React enhancement settings page export',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      },
    });
    const text = stringifyDiagnosticsBundle(bundle);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orchestration-diagnostics-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '导出失败',
    };
  }
}

/**
 * 请求后台告警诊断摘要（用于 UI 提示）
 */
export async function fetchAlarmDiagnosticsSummary(): Promise<string> {
  try {
    const resp = await sendRuntimeMessage({ type: 'GET_ALARM_DIAGNOSTICS' });
    if (!resp) return '未获取到后台定时诊断数据';
    const data = (resp as any).data || resp;
    const alarms = Array.isArray(data?.alarms)
      ? data.alarms
      : Array.isArray(data?.items)
        ? data.items
        : null;
    if (alarms) {
      return `后台定时任务：共 ${alarms.length} 条记录`;
    }
    if (typeof data === 'object') {
      const keys = Object.keys(data as object);
      return `后台定时诊断已返回（字段：${keys.slice(0, 6).join(', ')}${keys.length > 6 ? '…' : ''}）`;
    }
    return '已收到后台定时诊断响应';
  } catch (err) {
    return `获取失败：${err instanceof Error ? err.message : '未知错误'}`;
  }
}
