/**
 * @file aliases.ts
 * @description aliases
 * @module features/settingsSearch
 */
export const SETTINGS_SEARCH_ALIASES: Record<string, string[]> = {
  字幕: ['字幕搜索', '迅雷字幕', 'subtitle', 'subtitlecat', 'xunlei'],
  迅雷: ['字幕', '迅雷字幕', 'xunlei'],
  '115': ['115网盘', '离线下载', '推送115', 'drive115'],
  webdav: ['同步', '备份', '云端', 'alist'],
  在线可看: ['在线可看性', '可播放', '资源站', 'jable', 'missav', '123av'],
  磁力: ['磁链', 'bt', 'sukebei', 'btdig', 'btsow', 'torrentz2', 'javbus'],
  fc2: ['fc2破解', 'fc2ppv', 'fc2-ppv'],
  隐私: ['截图模式', '私密模式', '模糊'],
  代理: ['网络', 'proxy', '连通性'],
  ai: ['模型', 'api', '翻译', 'openai'],
  数据洞察: ['报告', '月报', '统计', 'insights'],
  emby: ['jellyfin', '媒体库', '资料库', '资料库来源', '入库状态'],
  openlist: ['115', '授权', '扫码授权'],
  搜索引擎: ['外部搜索', '搜索网站'],
};

export function expandSettingsSearchQuery(query: string): string[] {
  const normalized = normalizeSettingsSearchText(query);
  if (!normalized) return [];

  const terms = new Set<string>([normalized]);
  for (const [key, aliases] of Object.entries(SETTINGS_SEARCH_ALIASES)) {
    const keyNorm = normalizeSettingsSearchText(key);
    const aliasNorms = aliases.map(normalizeSettingsSearchText);
    if (normalized === keyNorm) {
      terms.add(keyNorm);
      aliasNorms.forEach(alias => terms.add(alias));
      continue;
    }

    if (aliasNorms.some(alias => normalized === alias)) {
      terms.add(keyNorm);
    }
  }

  return Array.from(terms).filter(Boolean);
}

export function normalizeSettingsSearchText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .trim();
}
