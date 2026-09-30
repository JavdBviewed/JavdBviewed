/**
 * @file updateSettingsActions.ts
 * @description 版本检查与保存动作（对齐遗留 UpdateSettings）
 * @module apps/dashboard/pages/settings/update
 */
import {
  checkForUpdatesWithPolicy,
  getCurrentVersion,
  LAST_UPDATE_CHECK_KEY,
  type UpdateCheckResult,
} from '../../../../../features/updateChecker';
import { REPO_RELEASES_LATEST_URL, REPO_RELEASES_URL } from '../../../../../shared/repoIdentity';
import type { ExtensionSettings } from '../../../../../types';
import {
  buildTelemetryPayloadPreview,
  findTelemetryPayloadSensitiveValues,
  type TelemetryPayload,
  type TelemetryPreviewEvent,
  type TelemetrySensitiveFinding,
} from '../../../../../features/telemetry';
import {
  getSettings,
  saveSettings,
  syncDashboardState,
} from '../shared/settingsPersist';
import {
  applyUpdateFormToSettings,
  type UpdateSettingsFormState,
} from './updateSettingsModel';

async function toast(
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
 * 持久化版本设置并派发遗留自定义事件
 */
export async function persistUpdateForm(
  form: UpdateSettingsFormState,
  opts?: { emitEvents?: boolean; previous?: UpdateSettingsFormState },
): Promise<void> {
  const current = await getSettings();
  const next = applyUpdateFormToSettings(current, form);
  await saveSettings(next);
  await syncDashboardState(next);

  if (opts?.emitEvents) {
    if (opts.previous && opts.previous.autoUpdateCheck !== form.autoUpdateCheck) {
      window.dispatchEvent(
        new CustomEvent('autoUpdateCheckChanged', {
          detail: { enabled: form.autoUpdateCheck },
        }),
      );
    }
    if (opts.previous && opts.previous.updateCheckInterval !== form.updateCheckInterval) {
      window.dispatchEvent(
        new CustomEvent('updateCheckIntervalChanged', {
          detail: { interval: form.updateCheckInterval },
        }),
      );
    }
  }
}

/**
 * 强制检查更新
 */
export async function runUpdateCheck(form: UpdateSettingsFormState): Promise<UpdateCheckResult> {
  return checkForUpdatesWithPolicy(
    {
      autoUpdateCheck: form.autoUpdateCheck,
      updateCheckInterval: form.updateCheckInterval,
      force: true,
    },
    form.includePrerelease,
  );
}

export function markLastUpdateCheckNow(): string {
  const iso = new Date().toISOString();
  try {
    localStorage.setItem(LAST_UPDATE_CHECK_KEY, iso);
  } catch {
    /* ignore */
  }
  return iso;
}

export function readLastUpdateCheck(): string | null {
  try {
    return localStorage.getItem(LAST_UPDATE_CHECK_KEY);
  } catch {
    return null;
  }
}

export function openChangelog(): void {
  window.open(REPO_RELEASES_URL, '_blank', 'noopener,noreferrer');
}

export function openDownload(url?: string | null): void {
  window.open(url || REPO_RELEASES_LATEST_URL, '_blank', 'noopener,noreferrer');
}

export { getCurrentVersion, toast };

/**
 * 从设置对象读当前 form（供外部）
 */
export async function loadUpdateSettingsForm(): Promise<UpdateSettingsFormState> {
  const settings = await getSettings();
  const { mapSettingsToUpdateForm } = await import('./updateSettingsModel');
  return mapSettingsToUpdateForm(settings as ExtensionSettings);
}


/* ------------------------------------------------------------------ *
 * 遥测数据查看器（09-30）：只读预览，绝不发送、绝不改配置
 * ------------------------------------------------------------------ */

export interface TelemetryPreviewResult {
  /** 本次预览采用的上报事件类型 */
  event: TelemetryPreviewEvent;
  payload: TelemetryPayload;
  /** 本地敏感字段自查结果，空数组=本次请求体没有任何疑似敏感形态 */
  sensitiveFindings: TelemetrySensitiveFinding[];
}

/**
 * 用当前配置组装「此刻若上报就会发出的请求体」。
 * 复用上报侧同一构造器，因此字段与真实上报一致；不发网络请求、不回写遥测状态。
 */
export async function loadTelemetryPreview(event: TelemetryPreviewEvent): Promise<TelemetryPreviewResult> {
  const settings = await getSettings();
  const payload = await buildTelemetryPayloadPreview(event, { settings });
  return {
    event,
    payload,
    sensitiveFindings: findTelemetryPayloadSensitiveValues(payload),
  };
}
