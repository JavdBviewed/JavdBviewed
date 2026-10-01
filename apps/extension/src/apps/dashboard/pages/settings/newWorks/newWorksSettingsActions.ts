/**
 * @file newWorksSettingsActions.ts
 * @description 新作品设置页 IO 动作：读 config → 表单；表单 → 校验 + 落盘 + 重启调度器
 *
 * 保存语义（纯 autosave 汇聚点）：
 * - 落盘经 newWorksManager.updateGlobalConfig（new_works_config 键，形状零变化）；
 * - 成功后发 'new-works-scheduler-restart'（承接原 workflow「restart 失败仅 warn 不阻断」）；
 * - 校验失败不落盘，返回 { ok:false, error } 由页面弹 saveError 横幅 + toast。
 * @module apps/dashboard/pages/settings/newWorks
 */
import { newWorksManager } from '../../../../../features/newWorks';
import { sendRuntimeMessage } from '../../../../../platform/browser/runtimeMessages';
import {
  mapConfigToFormState,
  mapFormStateToConfigPatch,
  validateNewWorksForm,
  type NewWorksSettingsFormState,
} from './newWorksSettingsModel';

type ToastType = 'success' | 'error' | 'info' | 'warn' | 'warning';

/** 右下角 toast（与 emby 页同模式：动态 import 共享 toast，零改动共享实现） */
export async function toast(message: string, type: ToastType = 'info'): Promise<void> {
  try {
    const { showMessage } = await import('../../../../../dashboard/ui/toast');
    showMessage(message, type);
  } catch (err) {
    console.warn('[NewWorksSettingsPage] toast 失败', err);
  }
}

export type PersistNewWorksFormResult = { ok: boolean; error?: string };

/** 读全局配置并映射为表单（manager 内部幂等 initialize + enabled 旧键迁移口径同源） */
export async function loadNewWorksSettingsForm(): Promise<NewWorksSettingsFormState> {
  const config = await newWorksManager.getGlobalConfig();
  return mapConfigToFormState(config);
}

/** 校验 → 落盘 → 重启调度器；任何失败都归一为 { ok:false, error }（不 throw） */
export async function persistNewWorksForm(form: NewWorksSettingsFormState): Promise<PersistNewWorksFormResult> {
  const validation = validateNewWorksForm(form);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }
  try {
    await newWorksManager.updateGlobalConfig(mapFormStateToConfigPatch(form));
  } catch (err) {
    console.error('[NewWorksSettingsPage] 保存失败', err);
    return { ok: false, error: (err as Error)?.message || '保存失败' };
  }
  try {
    await sendRuntimeMessage({ type: 'new-works-scheduler-restart' });
  } catch (err) {
    console.warn('[NewWorksSettingsPage] 重启自动检查失败', err);
  }
  return { ok: true };
}
