/**
 * @file indexReconcile.ts
 * @description 资料库索引对账共享纯函数：
 * - 启用来源白名单（与同步执行侧同一事实源）；
 * - 孤儿条目识别（entries × 白名单 → 新 entries，不写存储）；
 * - 服务器配置变化 diff（设置保存后是否触发一次后台同步）。
 * @module features/embyLibrary
 *
 * 10-26-emby-index-reconcile：改地址 / 删来源 / 停用后，索引条目键
 * （type:归一化URL）成为孤儿。既有清孤儿只在「同步时」执行，等待窗口内
 * 媒体库页 / 清理面板持续渲染失效条目。本模块提供「设置保存 / 云 apply
 * 后立即对账」与清理面板孤儿判定共用的口径。
 */
import type {
  EmbyLibraryFolderOption,
  EmbyLibraryIndexEntry,
  EmbyMediaServer,
} from '../types';
import { isSyncEligibleServer } from './serverEligibility';
import { normalizeServerKey, normalizeServerUrl } from './libraryIndex';

/**
 * 服务器索引键：`{emby|jellyfin}:{归一化 URL}`（归一化=去尾斜杠+小写，
 * 使「改地址大小写/尾斜杠」后的同一服务器仍匹配到旧 entry）。
 */
export function getServerIndexKey(server: Pick<EmbyMediaServer, 'type' | 'url'>): string {
  return `${server.type}:${normalizeServerKey(server.url)}`;
}

export function getEntryServerIndexKey(entry: Pick<EmbyLibraryIndexEntry, 'serverType' | 'serverUrl'>): string {
  return `${entry.serverType}:${normalizeServerKey(entry.serverUrl)}`;
}

/**
 * 启用来源白名单（对账口径的单一事实源）：
 * 启用 + 地址非空 + 至少一种凭据（apiKey / accessToken / 账号+密码），
 * 归一化与同步执行侧一致。
 */
export function resolveEnabledMediaServers(settings: any): EmbyMediaServer[] {
  const servers = settings?.emby?.mediaServers;
  if (!Array.isArray(servers)) return [];

  // 资格判定统一走共享 isSyncEligibleServer（与同步执行 / 自动同步 alarm 注册侧同一函数）。
  // 仅 账号+密码（未登录会话）的服务器也保留：由各功能入口的凭据守卫给出配置指引。
  return servers
    .filter((server) => isSyncEligibleServer(server))
    .map((server) => {
      const type: EmbyMediaServer['type'] = server.type === 'jellyfin' ? 'jellyfin' : 'emby';
      const libraryIds = Array.isArray(server.libraryIds)
        ? server.libraryIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
        : [];
      const libraryOptions = Array.isArray(server.libraryOptions)
        ? server.libraryOptions
            .map((opt: any) => ({
              id: String(opt?.id || '').trim(),
              name: String(opt?.name || opt?.id || '').trim(),
              collectionType: opt?.collectionType ? String(opt.collectionType) : undefined,
            }))
            .filter((opt: EmbyLibraryFolderOption) => opt.id)
        : undefined;
      return {
        id: String(server.id || `${type}:${normalizeServerUrl(String(server.url || ''))}`),
        type,
        name: String(server.name || (type === 'jellyfin' ? 'Jellyfin' : 'Emby')),
        url: normalizeServerUrl(String(server.url || '')),
        apiKey: String(server.apiKey || ''),
        enabled: true,
        libraryIds,
        ...(libraryOptions && libraryOptions.length ? { libraryOptions } : {}),
        username: server.username ? String(server.username) : undefined,
        password: server.password ? String(server.password) : undefined,
        accessToken: server.accessToken ? String(server.accessToken) : undefined,
        userId: server.userId ? String(server.userId) : undefined,
        userDisplayName: server.userDisplayName ? String(server.userDisplayName) : undefined,
        tokenObtainedAt: Number(server.tokenObtainedAt) || undefined,
      };
    });
}

/**
 * 入库功能是否启用（对账后是否建议触发同步用）。
 * 不依赖 isEmbyLibraryEnabled 的回退分支：旧数据只有 libraryStatus 且无
 * recognitionEnabled/libraryEnabled 字段时，isEmbyLibraryEnabled 要求
 * emby.enabled===true，会误判为关闭；这里用「未显式关闭 + 任一启用信号」判定。
 */
export function isLibraryFeatureEnabled(emby: unknown): boolean {
  const config = (emby || {}) as { libraryEnabled?: unknown; libraryStatus?: { enabled?: unknown } };
  return config.libraryEnabled !== false
    && (config.libraryEnabled === true || config.libraryStatus?.enabled === true);
}

export function countLibraryEntries(
  entries: Record<string, EmbyLibraryIndexEntry[]> | null | undefined,
): number {
  let count = 0;
  for (const list of Object.values(entries || {})) {
    if (Array.isArray(list)) count += list.length;
  }
  return count;
}

/**
 * 对账核心：只保留服务器键命中「当前启用来源白名单」的条目。
 * 仍在配置中但本次同步失败的服务器仍在白名单内 → 旧 entry 保留
 * （避免临时故障导致数据丢失）。
 */
export function reconcileLibraryEntries(
  entries: Record<string, EmbyLibraryIndexEntry[]> | null | undefined,
  configuredServers: ReadonlyArray<Pick<EmbyMediaServer, 'type' | 'url'>>,
): Record<string, EmbyLibraryIndexEntry[]> {
  const validKeys = new Set(configuredServers.map((server) => getServerIndexKey(server)));
  const next: Record<string, EmbyLibraryIndexEntry[]> = {};
  for (const [code, codeEntries] of Object.entries(entries || {})) {
    const kept = codeEntries.filter((entry) => validKeys.has(getEntryServerIndexKey(entry)));
    if (kept.length > 0) next[code] = kept;
  }
  return next;
}

/** 单来源功能指纹：id / 类型 / 归一化地址 / 启用态 / 凭证（apiKey / accessToken / userId）。 */
function serverFingerprint(server: Record<string, unknown>): string {
  return JSON.stringify({
    id: String(server.id || '').trim(),
    type: server.type === 'jellyfin' ? 'jellyfin' : 'emby',
    url: normalizeServerKey(String(server.url || '')),
    enabled: server.enabled !== false,
    apiKey: String(server.apiKey || '').trim(),
    accessToken: String(server.accessToken || '').trim(),
    userId: String(server.userId || '').trim(),
  });
}

function enabledFingerprints(settings: unknown): string[] {
  const servers = (settings as { emby?: { mediaServers?: unknown } } | null | undefined)?.emby?.mediaServers;
  if (!Array.isArray(servers)) return [];
  return servers
    .filter((server) => isSyncEligibleServer(server))
    .map((server) => serverFingerprint(server as Record<string, unknown>));
}

/**
 * 触发同步的变化判定：与保存前配置 diff，
 * id / 地址(归一化) / 类型 / 启用态 / 凭证(apiKey / accessToken / userId)
 * 任一变化即算；名称 / 库目录选择等非功能字段变化不触发。
 */
export function isEmbyServerConfigChanged(
  prevSettings: unknown,
  nextSettings: unknown,
): boolean {
  const prev = enabledFingerprints(prevSettings);
  const next = enabledFingerprints(nextSettings);
  if (prev.length !== next.length) return true;
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  for (const fp of next) {
    if (!prevSet.has(fp)) return true;
  }
  for (const fp of prev) {
    if (!nextSet.has(fp)) return true;
  }
  return false;
}
