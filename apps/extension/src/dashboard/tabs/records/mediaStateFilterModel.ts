/**
 * @file mediaStateFilterModel.ts
 * @description records 媒体库状态筛选（10-24-records-filter-media-states）：
 * 「已入库」「真实已看」两维度的 per-record 命中映射（纯函数）。
 *
 * 口径与站点列表 hideInMediaLibrary / hideRealWatched 同源（只消费不改）：
 * - inLibrary   = Emby/JF 同步索引命中（∩ 已配置启用服务器）∨ 115 网盘索引命中；
 * - realWatched = Emby/JF 命中且 computeWatchState === 'watched'（115 无观看态，不计）。
 * 无番号（videoCode 与 id 均无法归一为番号）的记录两维度均不命中。
 *
 * 本模块零 chrome 依赖：索引与服务器配置由调用方（mediaStateFilterRuntime）读取后注入。
 */
import type { VideoRecord } from '../../../types';
import {
  computeEmbyHidingHit,
  hasDrive115Hit,
} from '../../../features/list-hiding/mediaLibraryHiding';
import type { EmbyLibraryIndex } from '../../../features/embyLibrary/types';
import type { Drive115LibraryIndexState } from '../../../features/drive115/mediaLibrary';

/** 单条记录的媒体库状态命中（与 computeEmbyHidingHit 返回同形，115 并入 inLibrary）。 */
export interface MediaStateHit {
  inLibrary: boolean;
  realWatched: boolean;
}

export interface BuildMediaStateHitMapInput {
  records: ReadonlyArray<VideoRecord | null | undefined>;
  embyIndex: EmbyLibraryIndex | null | undefined;
  drive115State: Drive115LibraryIndexState | null | undefined;
  /** STATE.settings.emby.mediaServers 原样透传（谓词内部按 enabled!==false + url 归一）。 */
  servers: unknown;
}

/**
 * 记录主键（与存储键同源）：有 id 用 id，否则用 videoCode 原值；皆无 → 空串（不命中）。
 * filterAndSortRecords 侧以同一键查表，保证两侧一致。
 */
export function getMediaStateRecordKey(record: VideoRecord | null | undefined): string {
  if (!record || typeof record !== 'object') return '';
  const id = String(record.id ?? '').trim();
  if (id) return id;
  return String(record.videoCode ?? '').trim();
}

/**
 * 全量 records → Map<记录主键, MediaStateHit>（纯函数）。
 * 仅收录至少命中一维的记录；零命中零成本。
 */
export function buildMediaStateHitMap(input: BuildMediaStateHitMapInput): Map<string, MediaStateHit> {
  const map = new Map<string, MediaStateHit>();
  const records = Array.isArray(input.records) ? input.records : [];

  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    const code = String(record.videoCode || record.id || '').trim();
    if (!code) continue;

    const embyHit = computeEmbyHidingHit(input.embyIndex, code, input.servers);
    const hit: MediaStateHit = {
      inLibrary: embyHit.inLibrary || hasDrive115Hit(input.drive115State, code),
      realWatched: embyHit.realWatched,
    };
    if (!hit.inLibrary && !hit.realWatched) continue;

    const key = getMediaStateRecordKey(record);
    if (key) map.set(key, hit);
  }

  return map;
}
