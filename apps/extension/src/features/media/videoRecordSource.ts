/**
 * @file videoRecordSource.ts
 * @description 10-08：VideoRecord 媒体源字段（sourceType/sourceId）写入链
 *
 * 写入口径（派单定死）：
 * 1) 仅当观看/播放事件源可知时写入（证据源 emby/jellyfin/drive115）；
 *    源未知（站点浏览/手动标记等）一律省略字段，禁猜默认值禁静默填
 * 2) 每条记录至多一个源；多源竞争=确定性优先级裁决：
 *    T1 = watched 态 emby/jellyfin 候选（lastPlayedAt 最大，并列取 copyId 字典序最大）
 *    T2 = 唯一已知源候选（含 115 唯一命中）
 *    T3 = 其余（多源无 watched 主导/零候选/候选无 sourceItemId）→ 弃，不写不清除既有
 * 3) 旧数据零回补：仅事件发生时刻按 code 匹配到的记录写入，不遍历全库回填
 *
 * 落值=Clients wire 原文：emby/jellyfin 直传，drive115 映射 m115drive。
 * 胶水层 SW-safe：embyLibrary handlers 调用点经 reportWatchProgressWithRecordSourceSync 接入；
 * miscMessageRouter 调用点保留对 mediaWatchEvidence 的直接静态导入（tests/regression 的
 * SW 安全源码锁），在同处顺序调用 syncVideoRecordSourceForCode——语义与包装器逐字一致
 * （证据写入先行，失败照抛；记录侧异常吞掉不阻断）。
 */
import {
  loadWatchEvidenceState,
  reportWatchProgress,
  type MediaWatchEvidence,
  type MediaWatchEvidenceSource,
  type MediaWatchEvidenceStateV2,
} from './mediaWatchEvidence';
import { viewedGetAll, viewedPut } from '../../platform/storage/indexedDb';
import type { VideoRecord, VideoRecordSourceWire } from '../../types';

const WIRE_MAP: Readonly<Partial<Record<MediaWatchEvidenceSource, VideoRecordSourceWire>>> = {
  emby: 'emby',
  jellyfin: 'jellyfin',
  drive115: 'm115drive',
};

/** 证据源 → wire 值；无法产出源字段的源（manual/未知）→ null */
export function evidenceSourceToWire(source: string): VideoRecordSourceWire | null {
  const wire = (WIRE_MAP as Record<string, VideoRecordSourceWire | undefined>)[source];
  return wire ?? null;
}

export interface SourceWinner {
  sourceType: VideoRecordSourceWire;
  sourceId: string;
}

export type EvidenceBucket = {
  legacy?: MediaWatchEvidence | null;
  copies?: Record<string, MediaWatchEvidence>;
};

interface SourceCandidate {
  copyId: string;
  evidence: MediaWatchEvidence;
}

function toSourceCandidates(bucket: EvidenceBucket): SourceCandidate[] {
  const out: SourceCandidate[] = [];
  const push = (copyId: string, evidence: MediaWatchEvidence | null | undefined): void => {
    if (!evidence) return;
    if (evidenceSourceToWire(evidence.source) === null) return;
    const id = String(evidence.sourceItemId ?? '').trim();
    if (!id) return;
    out.push({ copyId, evidence });
  };
  push('', bucket.legacy ?? null);
  for (const [copyId, evidence] of Object.entries(bucket.copies ?? {})) {
    push(copyId, evidence);
  }
  return out;
}

/**
 * 多源确定性裁决（纯函数，测试锁）：T1 watched emby/JF → T2 唯一候选 → T3 弃
 */
export function resolveVideoRecordSource(bucket: EvidenceBucket): SourceWinner | null {
  const candidates = toSourceCandidates(bucket);
  if (candidates.length === 0) return null;

  const watchedEmbyJf = candidates.filter(
    (c) => c.evidence.watched === true && (c.evidence.source === 'emby' || c.evidence.source === 'jellyfin'),
  );
  let picked: SourceCandidate | null = null;
  if (watchedEmbyJf.length > 0) {
    // 排序取尾：lastPlayedAt 最大，并列取 copyId 字典序最大（与插入序无关，确定性）
    watchedEmbyJf.sort(
      (a, b) =>
        (a.evidence.lastPlayedAt - b.evidence.lastPlayedAt)
        || (a.copyId < b.copyId ? -1 : a.copyId > b.copyId ? 1 : 0),
    );
    picked = watchedEmbyJf[watchedEmbyJf.length - 1];
  } else if (candidates.length === 1) {
    picked = candidates[0];
  }
  if (!picked) return null;
  return {
    sourceType: evidenceSourceToWire(picked.evidence.source) as VideoRecordSourceWire,
    sourceId: String(picked.evidence.sourceItemId ?? '').trim(),
  };
}

export interface RecordSourceSyncResult {
  /** 规范化证据键（trim+upper，与证据存储键同口径） */
  code: string;
  winner: SourceWinner | null;
  /** 匹配到（case-fold 且非回收站）的记录数 */
  matched: number;
  /** 实际写入 viewedPut 的记录数（同值跳过不计） */
  written: number;
}

/**
 * 对给定 code 的证据桶裁决并把源字段写入匹配记录（videoCode case-fold 匹配，
 * 对齐 viewedStatusGetManyFolded 折叠先例）。
 * - winner=null（源未知/多源弃）→ 不读记录不写
 * - 记录已有同值 sourceType+sourceId → 跳过（幂等，不 bump updatedAt）
 * - 回收站（deletedAt）记录不匹配
 * - 共 code 多条记录全写（JAVDB 实际一 id 一记录，多命中属理论面）
 */
export async function syncVideoRecordSourceForCode(code: string): Promise<RecordSourceSyncResult> {
  const key = String(code ?? '').trim().toUpperCase();
  const result: RecordSourceSyncResult = { code: key, winner: null, matched: 0, written: 0 };
  if (!key) return result;

  const state: MediaWatchEvidenceStateV2 = await loadWatchEvidenceState();
  const winner = resolveVideoRecordSource(state.titles[key] ?? {});
  result.winner = winner;
  if (!winner) return result;

  const records = await viewedGetAll();
  const folded = key.toLowerCase();
  const now = Date.now();
  for (const record of records) {
    if (!record || record.deletedAt) continue;
    const rawCode = String(record.videoCode ?? '').trim().toLowerCase();
    if (rawCode !== folded) continue;
    result.matched += 1;
    if (record.sourceType === winner.sourceType && record.sourceId === winner.sourceId) continue;
    const next: VideoRecord = {
      ...record,
      sourceType: winner.sourceType,
      sourceId: winner.sourceId,
      updatedAt: now,
    };
    const putResult = await viewedPut(next);
    if (putResult?.success) result.written += 1;
  }
  return result;
}

/**
 * 证据上报 + 记录源字段同步的胶水包装（生产调用点入口）：
 * - reportWatchProgress 语义零改（自身失败仍向上抛，调用点既有 catch 不变）
 * - 记录源字段同步异常吞掉（只 warn），不阻断证据主路径
 */
export async function reportWatchProgressWithRecordSourceSync(
  input: Parameters<typeof reportWatchProgress>[0],
): Promise<ReturnType<typeof reportWatchProgress>> {
  const evidence = await reportWatchProgress(input);
  try {
    await syncVideoRecordSourceForCode(input.code);
  } catch (error) {
    console.warn('[videoRecordSource] 媒体源字段写入失败（不影响证据写入）', error);
  }
  return evidence;
}
