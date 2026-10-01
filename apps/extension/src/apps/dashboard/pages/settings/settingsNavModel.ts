/**
 * @file settingsNavModel.ts
 * @description 设置中心导航目录（纯数据，供 React 入口页与搜索索引对齐）
 * @module apps/dashboard/pages/settings
 */

export type SettingsNavItem = {
  /** hash 子路径，如 display-settings */
  id: string;
  title: string;
  description: string;
  /** Font Awesome 类名（不含 fas） */
  icon: string;
  /** 是否显示 Beta 徽标 */
  beta?: boolean;
};

/**
 * 设置入口卡片顺序与文案（对齐原 settings-index.html）
 */
export const SETTINGS_NAV_ITEMS: readonly SettingsNavItem[] = [
  {
    id: 'enhancement-settings',
    title: '功能增强',
    description: '增强功能和体验',
    icon: 'fa-magic',
  },
  {
    id: 'search-engine-settings',
    title: '搜索引擎',
    description: '自定义搜索引擎配置',
    icon: 'fa-search',
  },
  {
    id: 'ai-settings',
    title: 'AI设置',
    description: '配置AI功能和模型',
    icon: 'fa-robot',
  },
  {
    id: 'privacy-settings',
    title: '隐私保护',
    description: '截图模式和私密模式',
    icon: 'fa-shield-alt',
  },
  {
    id: 'webdav-settings',
    title: 'WebDAV 冷备份',
    description: '全量备份与换机恢复兜底',
    icon: 'fa-cloud-upload-alt',
  },
  {
    id: 'cloud-settings',
    title: 'Cloud 多端同步',
    description: '自建中枢：账号、设备与 live 同步',
    icon: 'fa-cloud',
    beta: true,
  },
  {
    id: 'sync-settings',
    title: '同步设置',
    description: 'JavDB数据同步配置',
    icon: 'fa-sync-alt',
  },  {
    id: 'drive115-settings',
    title: '115网盘',
    description: '授权、离线下载与媒体库片库',
    icon: 'fa-cloud-download-alt',
  },
  {
    // 2026-10-03 IA 裁决：emby-settings 改名 media-library-settings（旧 hash 在路由层归一化）
    id: 'media-library-settings',
    title: '媒体库设置',
    description: 'Emby/Jellyfin 媒体服务器配置',
    icon: 'fa-film',
    beta: true,
  },
  {
    id: 'insights-settings',
    title: '报告',
    description: '统计报告配置',
    icon: 'fa-chart-line',
  },
  {
    id: 'log-settings',
    title: '日志设置',
    description: '日志记录配置',
    icon: 'fa-file-alt',
  },
  {
    id: 'advanced-settings',
    title: '高级配置',
    // 描述保住「全局」关键词：全局操作已并入本页，设置索引只剩一张卡
    description: '原始配置编辑与全局数据操作',
    icon: 'fa-cogs',
  },
  {
    id: 'network-test-settings',
    title: '网络配置',
    description: '线路管理与连通性测试',
    icon: 'fa-network-wired',
  },
  {
    id: 'update-settings',
    title: '版本与关于',
    description: '检查更新、查看版本与项目链接',
    icon: 'fa-code-branch',
  },
] as const;

/**
 * 生成设置子页 hash
 */
export function settingsNavHref(id: string): string {
  return `#tab-settings/${id}`;
}

/**
 * 按关键词过滤导航项（标题/描述）
 */
export function filterSettingsNavItems(
  items: readonly SettingsNavItem[],
  query: string,
): SettingsNavItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.id.toLowerCase().includes(q),
  );
}

/**
 * 子页壳元信息：标题/描述/面板根 id（与 partial 根节点 id、BaseSettingsPanel.panelId 对齐）
 */
export type SettingsSubpageMeta = {
  title: string;
  description: string;
  /** 通常等于 hash 子路径，如 display-settings */
  panelRootId: string;
};

/**
 * 由 hash 子路径解析子页壳文案（找不到目录项时用兜底标题）
 */
export function resolveSettingsSubpageMeta(subSection: string): SettingsSubpageMeta {
  const hit = SETTINGS_NAV_ITEMS.find((item) => item.id === subSection);
  if (hit) {
    return {
      title: hit.title,
      description: hit.description,
      panelRootId: hit.id,
    };
  }
  return {
    title: '设置',
    description: '',
    panelRootId: subSection,
  };
}

