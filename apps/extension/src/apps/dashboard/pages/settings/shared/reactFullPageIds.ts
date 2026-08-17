/**
 * @file reactFullPageIds.ts
 * @description 完整 React 内容页 id 集合
 * @module apps/dashboard/pages/settings/shared
 *
 * 产品决策（2026-07-15）：设置子页内容默认保持遗留 partial + 原 CSS/弹窗交互，
 * 仅索引页与返回壳走 React。完整 React 内容页按名单渐进接入。
 *
 * 说明：drive115 已作为 W4.1 试点进入 REACT_FULL；回退时从名单移除即可回到 partial。
 * 媒体库片库配置在设置页内维护。
 */

/** hash 子路径 id；仅名单内走完整 React 内容页 */
export const REACT_FULL_SETTINGS_PAGE_IDS = new Set<string>([
  // Cloud 为新能力，无遗留 partial 样式负担
  'cloud-settings',
  // W4.1：115 设置保真 React 全页（用户点验启用）
  'drive115-settings',
  // 媒体服务器配置已迁移为摘要列表 + 弹窗编辑
  'emby-settings',
  // 版本与关于页面包含系列产品入口，使用 React 内容页
  'update-settings',
  // 功能增强设置已提供完整 React 页面，确保其他增强开关可见
  'enhancement-settings',
]);

/**
 * 是否为完整 React 设置子页
 */
export function isReactFullSettingsPage(subSection: string | null | undefined): boolean {
  if (!subSection) return false;
  return REACT_FULL_SETTINGS_PAGE_IDS.has(subSection);
}
