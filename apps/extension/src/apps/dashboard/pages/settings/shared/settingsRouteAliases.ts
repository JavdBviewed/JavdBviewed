/**
 * @file settingsRouteAliases.ts
 * @description 设置子页退役路由 id → 现役路由 id 归一化（纯函数，无副作用）
 * @module apps/dashboard/pages/settings/shared
 *
 * 2026-10-03 IA 裁决：
 * - 全局操作（global-actions）并入高级配置（advanced-settings），不再独立成页；
 * - 媒体服务器页 emby-settings 改名 media-library-settings（仅路由 id，零数据迁移）。
 *
 * 旧书签 / 深链 / 遗留设置搜索索引里的旧 hash 必须在「React 全页名单判定」与
 * 「遗留 init 跳过判定」之前归一化：两处判定只允许看到新 id，否则
 * 退役 id 会绕开 React 名单落到遗留 moduleMap（重复渲染同名按钮 id）。
 */

/** 退役 hash 子路径 → 现役 hash 子路径 */
export const LEGACY_SETTINGS_SUBSECTION_ALIASES: Readonly<Record<string, string>> = {
  'global-actions': 'advanced-settings',
  'emby-settings': 'media-library-settings',
};

/**
 * 归一化设置子路径 id；未登记的 id 原样返回，缺值返回空串。
 */
export function normalizeSettingsSubSectionId(subSection: string | null | undefined): string {
  if (!subSection) return '';
  const trimmed = subSection.trim();
  if (!trimmed) return '';
  return LEGACY_SETTINGS_SUBSECTION_ALIASES[trimmed] ?? trimmed;
}
