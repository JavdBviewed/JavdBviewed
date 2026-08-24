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
  // 功能增强设置使用 React 页面，保留原功能卡片的视觉与交互语义
  'enhancement-settings',
  // W4.6 第一批：已有 React 实现，完成路由接入后启用
  'display-settings',
  'search-engine-settings',
  'ai-settings',
  'privacy-settings',
  // W4.6 第二批：备份、同步与诊断配置页
  'webdav-settings',
  'sync-settings',
  'insights-settings',
  'log-settings',
  // W4.6 第三批：工具与诊断配置页
  'advanced-settings',
  'network-test-settings',
  'global-actions',
]);

/**
 * 是否为完整 React 设置子页
 */
export function isReactFullSettingsPage(subSection: string | null | undefined): boolean {
  if (!subSection) return false;
  return REACT_FULL_SETTINGS_PAGE_IDS.has(subSection);
}
