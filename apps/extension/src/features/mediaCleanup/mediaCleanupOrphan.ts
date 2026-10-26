/**
 * @file mediaCleanupOrphan.ts
 * @description 清理面板孤儿判定：副本来源（type:归一化URL）不在「当前启用来源
 * 白名单」（与资料库索引对账同一口径）→「来源已失效」。
 * @module features/mediaCleanup
 *
 * 10-26-emby-index-reconcile：改地址 / 删来源后，旧地址副本无配置可反查，
 * 「从来源删除」必然失败且无清除入口。孤儿副本禁用依赖来源的操作，
 * 提供「清除失效条目」（本地清索引条目 + 操作记录）。
 * 115 / 无地址副本不参与孤儿判定（无来源服务器可反查，语义不同）。
 */
import { normalizeServerKey } from '../embyLibrary/domain/libraryIndex';
import {
  getServerIndexKey,
  resolveEnabledMediaServers,
} from '../embyLibrary/domain/indexReconcile';
import type { MediaCleanupCopyEntry } from './mediaCleanupModel';

/** 副本来源服务器键；115 / 无地址 → null（豁免孤儿判定）。 */
export function getCleanupCopyServerKey(
  copy: Pick<MediaCleanupCopyEntry, 'source' | 'serverUrl'>,
): string | null {
  if (copy.source === '115') return null;
  const url = String(copy.serverUrl || '').trim();
  if (!url) return null;
  return `${copy.source}:${normalizeServerKey(url)}`;
}

/** 「当前启用来源」键集合（与索引对账同一白名单口径）。 */
export function getValidCleanupSourceKeys(settings: unknown): ReadonlySet<string> {
  return new Set(resolveEnabledMediaServers(settings).map((server) => getServerIndexKey(server)));
}

/** 副本来源是否已失效（不在当前启用配置白名单内）。 */
export function isCleanupCopySourceInvalid(
  copy: Pick<MediaCleanupCopyEntry, 'source' | 'serverUrl'>,
  validSourceKeys: ReadonlySet<string>,
): boolean {
  const key = getCleanupCopyServerKey(copy);
  return key !== null && !validSourceKeys.has(key);
}
