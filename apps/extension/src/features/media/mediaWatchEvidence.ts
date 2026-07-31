/**
 * @file mediaWatchEvidence.ts
 * @description 本地真实观看证据（与 JavDB 原站 status 分离）
 * @module features/media
 */

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
  copyId?: string;
};

export type MediaWatchEvidenceMap = Record<string, MediaWatchEvidence>;

export type MediaWatchEvidenceStateV2 = {
  version: 2;
  titles: Record<string, {
    legacy?: MediaWatchEvidence;
    copies: Record<string, MediaWatchEvidence>;
  }>;
};

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

const EMPTY_STATE: MediaWatchEvidenceStateV2 = { version: 2, titles: {} };
/** 后台也会动态 import 本模块，禁止从 utils/config 或 storage 封装引入，避免把 DOM 依赖带进 MV3 service worker。 */
const MEDIA_WATCH_EVIDENCE_STORAGE_KEY = 'media_watch_evidence';

/** 真实已看阈值（与 Emby watchState 默认一致） */
export const LOCAL_WATCHED_PERCENT_THRESHOLD = 90;

/**
 * 读取全部本地观看证据
 */
export async function loadWatchEvidenceMap(): Promise<MediaWatchEvidenceMap> {
  const state = await loadWatchEvidenceState();
  const map: MediaWatchEvidenceMap = {};
  for (const [code, bucket] of Object.entries(state.titles)) {
    if (bucket.legacy) map[code] = bucket.legacy;
    for (const [copyId, evidence] of Object.entries(bucket.copies)) {
      map[`${code}::${copyId}`] = { ...evidence, copyId };
    }
  }
  return map;
}

export async function loadWatchEvidenceState(): Promise<MediaWatchEvidenceStateV2> {
  const raw = await chromeLocalGet<unknown>(MEDIA_WATCH_EVIDENCE_STORAGE_KEY, EMPTY_STATE);
  if (isWatchEvidenceStateV2(raw)) return normalizeState(raw);
  return migrateLegacyEvidenceMap(raw);
}

/**
 * 读取单番号证据
 */
export async function getWatchEvidence(code: string, copyId?: string): Promise<MediaWatchEvidence | null> {
  const key = normalizeCodeKey(code);
  if (!key) return null;
  const state = await loadWatchEvidenceState();
  const bucket = state.titles[key];
  if (!bucket) return null;
  if (copyId) return bucket.copies[copyId] || null;
  return aggregateEvidence(bucket.legacy, Object.values(bucket.copies));
}

/**
 * 将底层观看证据解释为统一播放进度列表，供继续观看、备份恢复和 Cloud 同步消费。
 */
export async function loadMediaPlaybackProgressList(): Promise<MediaPlaybackProgress[]> {
  const state = await loadWatchEvidenceState();
  return Object.entries(state.titles)
    .flatMap(([code, bucket]) => [
      ...(bucket.legacy ? [bucket.legacy] : []),
      ...Object.values(bucket.copies),
    ].map((evidence) => watchEvidenceToPlaybackProgress(code, evidence)))
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
  copyId?: string;
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

  const state = await loadWatchEvidenceState();
  const bucket = state.titles[key] || { copies: {} };
  const resolvedCopyId = String(input.copyId || '').trim();
  const prev = resolvedCopyId ? bucket.copies[resolvedCopyId] : bucket.legacy;
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
    copyId: resolvedCopyId || undefined,
  };

  state.titles[key] = resolvedCopyId
    ? { ...bucket, copies: { ...bucket.copies, [resolvedCopyId]: next } }
    : { ...bucket, legacy: next };
  await chromeLocalSet(MEDIA_WATCH_EVIDENCE_STORAGE_KEY, state);
  return next;
}

function isWatchEvidenceStateV2(value: unknown): value is MediaWatchEvidenceStateV2 {
  if (!value || typeof value !== 'object') return false;
  const input = value as Partial<MediaWatchEvidenceStateV2>;
  return input.version === 2 && Boolean(input.titles) && typeof input.titles === 'object';
}

function normalizeState(state: MediaWatchEvidenceStateV2): MediaWatchEvidenceStateV2 {
  const titles: MediaWatchEvidenceStateV2['titles'] = {};
  for (const [rawCode, rawBucket] of Object.entries(state.titles || {})) {
    const code = normalizeCodeKey(rawCode);
    if (!code || !rawBucket || typeof rawBucket !== 'object') continue;
    titles[code] = {
      ...(rawBucket.legacy ? { legacy: rawBucket.legacy } : {}),
      copies: { ...(rawBucket.copies || {}) },
    };
  }
  return { version: 2, titles };
}

function migrateLegacyEvidenceMap(value: unknown): MediaWatchEvidenceStateV2 {
  if (!value || typeof value !== 'object') return { version: 2, titles: {} };
  const titles: MediaWatchEvidenceStateV2['titles'] = {};
  for (const [rawCode, evidence] of Object.entries(value as MediaWatchEvidenceMap)) {
    const code = normalizeCodeKey(rawCode);
    if (!code || !evidence || typeof evidence !== 'object') continue;
    titles[code] = { legacy: evidence, copies: {} };
  }
  return { version: 2, titles };
}

function aggregateEvidence(
  legacy: MediaWatchEvidence | undefined,
  copies: MediaWatchEvidence[],
): MediaWatchEvidence | null {
  const all = [...(legacy ? [legacy] : []), ...copies];
  if (!all.length) return null;
  return all.reduce((best, current) => {
    if (current.watched !== best.watched) return current.watched ? current : best;
    if (current.percent !== best.percent) return current.percent > best.percent ? current : best;
    return current.lastPlayedAt > best.lastPlayedAt ? current : best;
  });
}

function resolveChromeLocalStorage(): chrome.storage.StorageArea | null {
  if (typeof chrome === 'undefined') return null;
  return chrome.storage?.local ?? null;
}

function readChromeLastErrorMessage(): string {
  if (typeof chrome === 'undefined') return '';
  try {
    return chrome.runtime?.lastError?.message || '';
  } catch {
    return '';
  }
}

function chromeLocalGet<T>(key: string, fallback: T): Promise<T> {
  const area = resolveChromeLocalStorage();
  if (!area) return Promise.resolve(fallback);
  return new Promise<T>((resolve, reject) => {
    try {
      area.get([key], (items) => {
        const errorMessage = readChromeLastErrorMessage();
        if (errorMessage) {
          reject(new Error(errorMessage));
          return;
        }
        const value = items?.[key];
        resolve((value !== undefined && value !== null ? value : fallback) as T);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function chromeLocalSet<T>(key: string, value: T): Promise<void> {
  const area = resolveChromeLocalStorage();
  if (!area) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    try {
      area.set({ [key]: value }, () => {
        const errorMessage = readChromeLastErrorMessage();
        if (errorMessage) {
          reject(new Error(errorMessage));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
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
