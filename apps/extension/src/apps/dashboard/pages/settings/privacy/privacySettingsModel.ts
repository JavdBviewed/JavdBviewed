/**
 * @file privacySettingsModel.ts
 * @description 隐私设置纯数据模型：默认值、映射、校验
 * @module apps/dashboard/pages/settings/privacy
 */
import type { ExtensionSettings } from '../../../../../types';
import type { BlurArea, BlurTrigger } from '../../../../../types/privacy';

export type PrivacyBlurAreaOption = {
  id: string;
  area: BlurArea;
  label: string;
};

export type PrivacySettingsFormState = {
  screenshotEnabled: boolean;
  contentPagesScreenshotEnabled: boolean;
  blurIntensity: number;
  autoBlurTrigger: BlurTrigger | string;
  blurAreas: BlurArea[];
  privateModeEnabled: boolean;
  requirePassword: boolean;
  sessionTimeout: number;
  lockOnTabLeave: boolean;
  lockOnExtensionClose: boolean;
  hasPassword: boolean;
};

export const DEFAULT_PRIVACY_SETTINGS_FORM: PrivacySettingsFormState = {
  screenshotEnabled: false,
  contentPagesScreenshotEnabled: false,
  blurIntensity: 5,
  autoBlurTrigger: 'manual',
  blurAreas: [
    'account-menu',
    'navigation',
    'video-library',
    'actor-library',
    'playlist-page',
    'lists-page',
    'home-page',
  ],
  privateModeEnabled: false,
  requirePassword: false,
  sessionTimeout: 10,
  lockOnTabLeave: false,
  lockOnExtensionClose: false,
  hasPassword: false,
};

export const AUTO_BLUR_TRIGGER_OPTIONS = [
  { value: 'manual', label: '手动控制' },
  { value: 'tab-leave', label: '离开标签页时' },
  { value: 'extension-reopen', label: '重新打开拓展时' },
  { value: 'idle-timeout', label: '空闲超时时' },
] as const;

export const BLUR_AREA_OPTIONS: readonly PrivacyBlurAreaOption[] = [
  { id: 'blurAccountMenu', area: 'account-menu', label: '账号菜单' },
  { id: 'blurNavigation', area: 'navigation', label: '导航栏' },
  { id: 'blurVideoLibrary', area: 'video-library', label: '番号库' },
  { id: 'blurActorLibrary', area: 'actor-library', label: '演员库' },
  { id: 'blurPlaylistPage', area: 'playlist-page', label: '新作品' },
  { id: 'blurListsPage', area: 'lists-page', label: '清单管理' },
  { id: 'blurHomePage', area: 'home-page', label: '首页' },
] as const;

function parseIntSafe(v: unknown, def: number): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : def;
}

/**
 * 从完整设置映射为隐私表单
 */
export function mapSettingsToPrivacyForm(
  settings: Partial<ExtensionSettings> | null | undefined,
): PrivacySettingsFormState {
  const privacy = (settings?.privacy || {}) as any;
  const screenshot = privacy.screenshotMode || {};
  const privateMode = privacy.privateMode || {};
  const blurAreas = Array.isArray(screenshot.blurAreas)
    ? (screenshot.blurAreas as BlurArea[])
    : DEFAULT_PRIVACY_SETTINGS_FORM.blurAreas;
  const autoBlurTrigger = String(
    screenshot.autoBlurTrigger ?? DEFAULT_PRIVACY_SETTINGS_FORM.autoBlurTrigger,
  );
  const idleTimeout = parseIntSafe(
    privateMode.idleTimeout ?? privateMode.sessionTimeout,
    DEFAULT_PRIVACY_SETTINGS_FORM.sessionTimeout,
  );

  return {
    screenshotEnabled: !!screenshot.enabled,
    contentPagesScreenshotEnabled: screenshot.contentPages?.enabled === true,
    blurIntensity: parseIntSafe(screenshot.blurIntensity, DEFAULT_PRIVACY_SETTINGS_FORM.blurIntensity),
    autoBlurTrigger,
    blurAreas: [...blurAreas],
    privateModeEnabled: !!privateMode.enabled,
    requirePassword: !!privateMode.requirePassword,
    sessionTimeout: idleTimeout,
    lockOnTabLeave: !!privateMode.lockOnTabLeave,
    lockOnExtensionClose: !!privateMode.lockOnExtensionClose,
    hasPassword: !!privateMode.passwordHash,
  };
}

/**
 * 校验隐私表单
 */
export function validatePrivacyForm(form: PrivacySettingsFormState): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!Number.isFinite(form.blurIntensity) || form.blurIntensity < 1 || form.blurIntensity > 10) {
    errors.push('模糊强度必须在1-10之间');
  }
  if (!Number.isFinite(form.sessionTimeout) || form.sessionTimeout < 5 || form.sessionTimeout > 1440) {
    errors.push('会话超时时间必须在5-1440分钟之间');
  }
  if (form.privateModeEnabled && form.requirePassword) {
    warnings.push('启用密码保护后，请确保设置了强密码');
  }

  return { isValid: errors.length === 0, errors, warnings };
}

/**
 * 切换模糊区域集合
 */
export function toggleBlurArea(areas: BlurArea[], area: BlurArea, enabled: boolean): BlurArea[] {
  const set = new Set(areas);
  if (enabled) set.add(area);
  else set.delete(area);
  return Array.from(set);
}
