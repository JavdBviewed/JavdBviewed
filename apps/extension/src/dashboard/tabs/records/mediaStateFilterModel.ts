/**
 * @file mediaStateFilterModel.ts
 * @description records 媒体库状态筛选（10-24-records-filter-media-states）：
 * 「已入库」「真实已看」两维度的 per-record 命中映射（纯函数）。
 *
 * 口径与站点列表 hideInMediaLibrary / hideRealWatched 同源（只消费不改）：
 * - inLibrary   = Emby/JF 同步索引命中（∩ 已配置启用服务器）∨ 115 网盘索引命中；
 * - realWatched = Emby/JF 命中且 computeWatchState === 'watched'（115 无观看态，不计）。
 * 候选顺序为 videoCode 优先、id 兜底；截断/无效 videoCode 不遮蔽完整 id。
 * 每条记录采用首个命中候选，避免把不同候选的状态合并。两者均无法归一为番号时不命中。
 *
 * 人工钉住（10-27-records-derived-state-pin）：record.mediaStateOverrides 逐维三态
 * （true=钉住强制命中 / false=强制关 / 缺=未钉住）；override 优先于派生判定，
 * 两维独立，未钉住维度回落派生；旧记录无字段=行为零变化。
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
  /** 人工钉住维度（10-27 pin）：true=钉住 / false=强制关 / 缺=派生判定（仅供显示层区分 chip 来源文案）。 */
  pinned?: { inLibrary?: boolean; realWatched?: boolean };
}

/**
 * 人工钉住字段归一（10-27 pin）：只保留 boolean 维度；非对象/脏值维度=未钉住（回落派生）。
 * 全维度无效 → null（等价旧数据无字段）。
 */
export function normalizeMediaStateOverrides(raw: unknown): { inLibrary?: boolean; realWatched?: boolean } | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  const out: { inLibrary?: boolean; realWatched?: boolean } = {};
  if (typeof candidate.inLibrary === 'boolean') out.inLibrary = candidate.inLibrary;
  if (typeof candidate.realWatched === 'boolean') out.realWatched = candidate.realWatched;
  return out.inLibrary !== undefined || out.realWatched !== undefined ? out : null;
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
    const candidates = [...new Set([record.videoCode, record.id]
      .map((value) => String(value ?? '').trim())
      .filter(Boolean))];

    let hit: MediaStateHit | null = null;
    for (const code of candidates) {
      const embyHit = computeEmbyHidingHit(input.embyIndex, code, input.servers);
      const candidateHit: MediaStateHit = {
        inLibrary: embyHit.inLibrary || hasDrive115Hit(input.drive115State, code),
        realWatched: embyHit.realWatched,
      };
      if (!candidateHit.inLibrary && !candidateHit.realWatched) continue;
      hit = candidateHit;
      break;
    }

    // 人工钉住（10-27 pin）：override 优先于派生；两维独立；未钉住维度回落派生（无字段=零回补）
    const pinned = normalizeMediaStateOverrides(record.mediaStateOverrides);
    const finalHit: MediaStateHit = {
      inLibrary: pinned?.inLibrary ?? Boolean(hit?.inLibrary),
      realWatched: pinned?.realWatched ?? Boolean(hit?.realWatched),
    };
    if (!finalHit.inLibrary && !finalHit.realWatched) continue;
    if (pinned) finalHit.pinned = pinned;

    const key = getMediaStateRecordKey(record);
    if (key) map.set(key, finalHit);
  }

  return map;
}
