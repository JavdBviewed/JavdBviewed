/**
 * @file configuredMatches.ts
 * @description 已配置启用服务器过滤的媒体库索引匹配（徽章与列表隐藏共用，避免双份漂移）
 * @module features/embyLibrary/domain
 *
 * 2026-09-30（09-30-media-library-hide-filter）：原 embyLibrary/content/statusBadges.ts
 * 私有 getConfiguredServerKeys/getConfiguredMatches 抽成共享纯函数导出——
 * 「隐藏媒体库已入库影片」开关与徽章判定共用同一口径（条目必须属于已配置且启用的服务器）。
 */
import { findLibraryMatches, normalizeServerUrl } from './libraryIndex';
import type { EmbyLibraryIndex, EmbyLibraryIndexEntry } from '../types';

/**
 * 已配置且启用的服务器键集合：`{emby|jellyfin}:{归一化 URL}`。
 * 与徽章口径一致：enabled!==false 且有 url 才参与匹配。
 */
export function getConfiguredServerKeys(servers: unknown): Set<string> {
  if (!Array.isArray(servers)) return new Set();

  return new Set(
    (servers as Array<Record<string, unknown> | null | undefined>)
      .filter((server) => server && server.enabled !== false && server.url)
      .map((server) =>
        `${server!.type === 'jellyfin' ? 'jellyfin' : 'emby'}:${normalizeServerUrl(String(server!.url || ''))}`,
      ),
  );
}

/**
 * 某番号的索引条目中，属于已配置启用服务器的匹配集合。
 * 无已配置服务器 / 无索引 / 番号取不到 → 空数组（零命中零误隐）。
 */
export function findConfiguredLibraryMatches(
  index: EmbyLibraryIndex | null | undefined,
  videoCode: string,
  servers: unknown,
): EmbyLibraryIndexEntry[] {
  const configuredServerKeys = getConfiguredServerKeys(servers);
  if (configuredServerKeys.size === 0) return [];

  return findLibraryMatches(index, videoCode).filter((entry) => {
    const entryKey = `${entry.serverType}:${normalizeServerUrl(entry.serverUrl)}`;
    return configuredServerKeys.has(entryKey);
  });
}
