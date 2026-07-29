/**
 * @file mediaWatchEvidence.ts
 * @description 本地真实观看证据（与 JavDB 原站 status 分离）
 * @module features/media
 */
import { STORAGE_KEYS } from '../../utils/config';
import { getValue, setValue } from '../../utils/storage';

export type MediaWatchEvidenceSource = 'drive115' | 'emby' | 'jellyfin' | 'manual';

export type MediaWatchEvidence = {
  source: MediaWatchEvidenceSource;
  sourceItemId?: string;
  /** 0–100 */
  percent: number;
  watched: boolean;
  lastPlayedAt: number;
  pickCode?: string;
  fileId?: string;
  fileName?: string;
  positionSec?: number;
  durationSec?: number;
};

export type MediaWatchEvidenceMap = Record<string, MediaWatchEvidence>;

export type MediaPlaybackProgress = {
  source: MediaWatchEvidenceSource;
  sourceItemId: string;
  code: string;
  positionSeconds: number;
  durationSeconds: number;
  percent: number;
  completed: boolean;
  lastPlayedAt: number;
  updatedAt: number;
  pickCode?: string;
  fileId?: string;
  fileName?: string;
};

const EMPTY: MediaWatchEvidenceMap = {};

/** 真实已看阈值（与 Emby watchState 默认一致） */
export const LOCAL_WATCHED_PERCENT_THRESHOLD = 90;

/**
 * 读取全部本地观看证据
 */
export async function loadWatchEvidenceMap(): Promise<MediaWatchEvidenceMap> {
  const map = await getValue<MediaWatchEvidenceMap>(STORAGE_KEYS.MEDIA_WATCH_EVIDENCE, EMPTY);
  return { ...map };
}

/**
 * 读取单番号证据
 */
export async function getWatchEvidence(code: string): Promise<MediaWatchEvidence | null> {
  const key = normalizeCodeKey(code);
  if (!key) return null;
  const map = await loadWatchEvidenceMap();
  return map[key] || null;
}

/**
 * 将底层观看证据解释为统一播放进度列表，供继续观看、备份恢复和 Cloud 同步消费。
 */
export async function loadMediaPlaybackProgressList(): Promise<MediaPlaybackProgress[]> {
  const map = await loadWatchEvidenceMap();
  return Object.entries(map)
    .map(([code, evidence]) => watchEvidenceToPlaybackProgress(code, evidence))
    .filter((item): item is MediaPlaybackProgress => Boolean(item))
    .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
}

export function watchEvidenceToPlaybackProgress(
  code: string,
  evidence: MediaWatchEvidence | null | undefined,
): MediaPlaybackProgress | null {
  if (!evidence) return null;
  const normalizedCode = normalizeCodeKey(code);
  if (!normalizedCode) return null;
  const positionSeconds = toNonNegativeNumber(evidence.positionSec) ?? 0;
  const durationSeconds = toNonNegativeNumber(evidence.durationSec) ?? 0;
  const percent = Math.max(0, Math.min(100, Number(evidence.percent) || 0));
  return {
    source: evidence.source,
    sourceItemId: resolveSourceItemId(normalizedCode, evidence),
    code: normalizedCode,
    positionSeconds,
    durationSeconds,
    percent,
    completed: evidence.watched === true || percent >= LOCAL_WATCHED_PERCENT_THRESHOLD,
    lastPlayedAt: Number(evidence.lastPlayedAt) || 0,
    updatedAt: Number(evidence.lastPlayedAt) || 0,
    pickCode: evidence.pickCode,
    fileId: evidence.fileId,
    fileName: evidence.fileName,
  };
}

/**
 * 上报/合并播放进度（取较高进度，不降级）
 */
export async function reportWatchProgress(input: {
  code: string;
  source: MediaWatchEvidenceSource;
  sourceItemId?: string;
  percent?: number;
  positionSec?: number;
  durationSec?: number;
  pickCode?: string;
  fileId?: string;
  fileName?: string;
  forceWatched?: boolean;
}): Promise<MediaWatchEvidence> {
  const key = normalizeCodeKey(input.code);
  if (!key) {
    throw new Error('无效番号');
  }

  let percent = Number(input.percent);
  if (!Number.isFinite(percent) || percent < 0) {
    if (
      Number.isFinite(input.positionSec)
      && Number.isFinite(input.durationSec)
      && (input.durationSec as number) > 0
    ) {
      percent = Math.min(100, ((input.positionSec as number) / (input.durationSec as number)) * 100);
    } else {
      percent = 0;
    }
  }
  percent = Math.max(0, Math.min(100, percent));

  const map = await loadWatchEvidenceMap();
  const prev = map[key];
  const now = Date.now();
  const nextPercent = Math.max(prev?.percent || 0, percent);
  const watched =
    input.forceWatched === true
    || nextPercent >= LOCAL_WATCHED_PERCENT_THRESHOLD
    || prev?.watched === true;

  const incomingPosition = toNonNegativeNumber(input.positionSec);
  const incomingDuration = toNonNegativeNumber(input.durationSec);
  const prevPosition = toNonNegativeNumber(prev?.positionSec);
  const prevDuration = toNonNegativeNumber(prev?.durationSec);

  const nextPositionSec = input.forceWatched === true
    ? (incomingDuration ?? incomingPosition ?? prevPosition)
    : maxDefined(prevPosition, incomingPosition);
  const nextDurationSec = maxDefined(prevDuration, incomingDuration);

  const next: MediaWatchEvidence = {
    source: input.source,
    sourceItemId: input.sourceItemId || input.pickCode || input.fileId || prev?.sourceItemId,
    percent: nextPercent,
    watched,
    lastPlayedAt: now,
    pickCode: input.pickCode || prev?.pickCode,
    fileId: input.fileId || prev?.fileId,
    fileName: input.fileName || prev?.fileName,
    positionSec: nextPositionSec,
    durationSec: nextDurationSec,
  };

  map[key] = next;
  await setValue(STORAGE_KEYS.MEDIA_WATCH_EVIDENCE, map);
  return next;
}

function resolveSourceItemId(code: string, evidence: MediaWatchEvidence): string {
  return (
    String(evidence.sourceItemId || '').trim()
    || String(evidence.pickCode || '').trim()
    || String(evidence.fileId || '').trim()
    || code
  );
}

function toNonNegativeNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function maxDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

function normalizeCodeKey(code: string): string {
  return String(code || '').trim().toUpperCase();
}
