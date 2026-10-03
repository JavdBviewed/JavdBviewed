/**
 * @file updateSettingsModel.ts
 * @description 版本与关于页纯数据模型
 * @module apps/dashboard/pages/settings/update
 */
import type { ExtensionSettings } from '../../../../../types';

export type UpdateSettingsFormState = {
  autoUpdateCheck: boolean;
  /** 小时数字符串，与遗留 select value 对齐 */
  updateCheckInterval: string;
  includePrerelease: boolean;
};

export const DEFAULT_UPDATE_SETTINGS_FORM: UpdateSettingsFormState = {
  autoUpdateCheck: true,
  updateCheckInterval: '24',
  includePrerelease: false,
};

export const UPDATE_INTERVAL_OPTIONS: { value: string; label: string }[] = [
  { value: '6', label: '每 6 小时' },
  { value: '12', label: '每 12 小时' },
  { value: '24', label: '每 24 小时' },
  { value: '72', label: '每 3 天' },
  { value: '168', label: '每周' },
];

/**
 * 从完整设置映射为表单
 */
export function mapSettingsToUpdateForm(
  settings: Partial<ExtensionSettings> | null | undefined,
): UpdateSettingsFormState {
  return {
    autoUpdateCheck: (settings as any)?.autoUpdateCheck !== false,
    updateCheckInterval: String((settings as any)?.updateCheckInterval || '24'),
    includePrerelease: (settings as any)?.includePrerelease === true,
  };
}

/**
 * 合并表单回设置对象
 */
export function applyUpdateFormToSettings(
  current: ExtensionSettings,
  form: UpdateSettingsFormState,
): ExtensionSettings {
  return {
    ...current,
    autoUpdateCheck: form.autoUpdateCheck,
    updateCheckInterval: form.updateCheckInterval,
    includePrerelease: form.includePrerelease,
  } as ExtensionSettings;
}

/**
 * 格式化上次检查时间
 */
export function formatLastUpdateCheck(iso: string | null | undefined): string {
  if (!iso) return '从未检查';
  try {
    return new Date(iso).toLocaleString('zh-CN');
  } catch {
    return '从未检查';
  }
}


/* ------------------------------------------------------------------ *
 * 遥测数据查看器（09-30）：纯数据与文案，页面只负责渲染
 * ------------------------------------------------------------------ */

/** 上报包含的数据类别（与 buildTelemetryPayload 字段一一对应） */
export const TELEMETRY_DATA_INCLUDED_ITEMS: string[] = [
  '环境与版本：拓展版本、构建号、发布渠道、浏览器与平台、语言与时区',
  '会话活跃度：随机会话 ID、活动时间、本次会话已活跃秒数',
  '功能开关状态：每项功能只有「开/关」一个布尔值，不含任何功能参数',
  '资源数量分桶：已看、演员、订阅、搜索引擎、在线可用站点、磁力源的数量区间（只报区间，不报精确值）',
  '错误信息：出错模块名、错误码、异常类名、堆栈哈希（不报完整堆栈）',
  '设备标识：deviceId 与 installId，用于区分设备的遥测数据',
];

/** 明确不在上报范围内的数据（敏感字段自查口径） */
export const TELEMETRY_DATA_EXCLUDED_ITEMS: string[] = [
  '番号、视频标题与封面信息',
  '演员名、演员链接与演员备注',
  '已看记录、收藏、想看、订阅的具体条目',
  '浏览过的页面地址与站内搜索关键词',
  '磁力链接、种子与文件名、本地磁盘路径',
  'WebDAV / 115 / Emby 等服务的地址、账号、密码与令牌',
  '邮箱、手机号等账号信息',
  '资源数量的精确值（仅上报区间）',
];

/** 设备标识口径（用户需知晓：上报里确实含一个设备标识，但不含账号信息） */
export const TELEMETRY_DEVICE_ID_NOTE = '上报数据包含一个设备标识（deviceId / installId），来源是本地生成的随机标识与控制面板的 Device ID，仅用于区分设备的遥测数据（去重与多端归并），不包含你的账号信息、邮箱与浏览内容。';

/** 使用即允许 + 目的说明 */
export const TELEMETRY_PURPOSE_NOTE = '上报只用于帮助程序的开发与优化：让我们知道哪些功能在被使用、使用规模多大、哪里出错，以此安排开发与修复优先级。使用本拓展即默认允许上报这类优化数据。';

export type TelemetryViewerState = {
  /** 遥测总开关（未配置视为启用，与上报侧同一口径） */
  enabled: boolean;
};

/**
 * 从设置里映射遥测展示状态（只读，不改任何配置）
 */
export function mapTelemetryViewFromSettings(
  settings: Partial<ExtensionSettings> | null | undefined,
): TelemetryViewerState {
  // 2026-10-03 10-11 线裁决：上报恒启用，legacy telemetry.enabled 不再读取（键仍存储、不迁移）
  void settings;
  return {
    enabled: true,
  };
}

/**
 * 完整请求体 JSON 文本（等宽展示用，两空格缩进）
 */
export function formatTelemetryPayloadJson(payload: unknown): string {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return '无法序列化请求体';
  }
}

/**
 * 统计请求体里的叶子字段数量（页脚「共 N 个字段」）
 */
export function countTelemetryPayloadFields(payload: unknown): number {
  if (payload === null || payload === undefined) return 0;
  if (Array.isArray(payload)) {
    return payload.reduce<number>((total, item) => total + countTelemetryPayloadFields(item), 0);
  }
  if (typeof payload === 'object') {
    return Object.values(payload as Record<string, unknown>)
      .reduce<number>((total, item) => total + countTelemetryPayloadFields(item), 0);
  }
  return 1;
}
