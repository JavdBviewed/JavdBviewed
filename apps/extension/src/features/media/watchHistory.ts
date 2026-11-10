/** @file watchHistory.ts @description 与物理文件存在性分离的观看事实、来源撤销和旧历史归一 @module features/media */
import type { MediaWatchEvidence, MediaWatchEvidenceStateV2 } from './mediaWatchEvidence';
import type { EmbyLibraryIndex } from '../embyLibrary/types';
import { normalizeServerUrl } from '../embyLibrary/domain/libraryIndex';
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const time = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
export function hasWatchedEvidence(v: unknown): v is MediaWatchEvidence {
  if (!object(v)) return false;
  if (time(v.revokedAt) && time(v.lastPlayedAt) <= time(v.revokedAt)) return false;
  return v.watched === true || (typeof v.percent === 'number' && Number.isFinite(v.percent) && v.percent >= 90 && v.percent <= 100);
}
function valid(v: unknown): v is MediaWatchEvidence {
  return object(v) && ['emby', 'jellyfin', 'drive115', 'manual'].includes(v.source)
    && typeof v.watched === 'boolean' && typeof v.percent === 'number' && Number.isFinite(v.percent) && v.percent >= 0 && v.percent <= 100;
}
/** 缺/坏的远端对象不清本地；保留同来源显式撤销，普通false不撤销历史。 */
export function normalizeWatchEvidence(value: unknown): MediaWatchEvidenceStateV2 {
  const out: MediaWatchEvidenceStateV2 = { version: 2, titles: {} };
  if (!object(value)) return out;
  const v2 = value.version === 2 && object(value.titles);
  for (const [rawKey, raw] of Object.entries(v2 ? value.titles : value)) {
    const key = rawKey.trim().toUpperCase(); if (!key || !object(raw)) continue;
    const bucket: MediaWatchEvidenceStateV2['titles'][string] = { copies: {} };
    if (v2) {
      if (valid(raw.legacy)) bucket.legacy = { ...raw.legacy };
      if (object(raw.copies)) for (const [id, item] of Object.entries(raw.copies)) if (valid(item)) bucket.copies[id] = { ...item };
    } else if (valid(raw)) bucket.legacy = { ...raw };
    if (bucket.legacy || Object.keys(bucket.copies).length) out.titles[key] = bucket;
  }
  return out;
}
function mergeFact(a: MediaWatchEvidence | undefined, b: MediaWatchEvidence): MediaWatchEvidence {
  if (!a) a = b;
  const revokedAt = Math.max(time(a.revokedAt), time(b.revokedAt));
  const all = [a, b].filter(f => !revokedAt || time(f.lastPlayedAt) > revokedAt);
  if (!all.length) return { ...b, watched: false, percent: 0, positionSec: 0, lastPlayedAt: Math.max(time(a.lastPlayedAt), time(b.lastPlayedAt)), revokedAt };
  const best = [...all].sort((x, y) => Number(hasWatchedEvidence(y)) - Number(hasWatchedEvidence(x)) || y.percent - x.percent || time(y.lastPlayedAt) - time(x.lastPlayedAt))[0];
  return { ...best, watched: all.some(hasWatchedEvidence), percent: Math.max(...all.map(f => f.percent)), lastPlayedAt: Math.max(...all.map(f => time(f.lastPlayedAt))), ...(revokedAt ? { revokedAt } : {}) };
}
export function mergeWatchEvidenceStates(local: unknown, incoming: unknown): MediaWatchEvidenceStateV2 {
  const next = normalizeWatchEvidence(local);
  for (const [key, bucket] of Object.entries(normalizeWatchEvidence(incoming).titles)) {
    const current = next.titles[key] ?? { copies: {} };
    if (bucket.legacy) current.legacy = mergeFact(current.legacy, bucket.legacy);
    for (const [id, fact] of Object.entries(bucket.copies)) current.copies[id] = mergeFact(current.copies[id], fact);
    next.titles[key] = current;
  }
  // Older backups may keep the same source fact in the v1 legacy slot. Only an
  // unambiguous source/item match can carry the explicit cancellation across it.
  for (const bucket of Object.values(next.titles)) {
    const legacy = bucket.legacy;
    if (!legacy?.sourceItemId) continue;
    const matching = Object.values(bucket.copies).filter(f => f.source === legacy.source && f.sourceItemId === legacy.sourceItemId);
    const proven = legacy.copyId ? bucket.copies[legacy.copyId] : matching.length === 1 ? matching[0] : undefined;
    if (proven && time(proven.revokedAt)) {
      bucket.legacy = mergeFact(legacy, { ...legacy, watched: false, percent: 0, revokedAt: proven.revokedAt });
    }
  }
  return next;
}
export function collectWatchedKeys(raw: unknown): Set<string> {
  return new Set(Object.entries(normalizeWatchEvidence(raw).titles).filter(([, b]) => [b.legacy, ...Object.values(b.copies)].some(hasWatchedEvidence)).map(([key]) => key));
}
export function evidenceFromLibrary(index: EmbyLibraryIndex | null | undefined): MediaWatchEvidenceStateV2 {
  const state: MediaWatchEvidenceStateV2 = { version: 2, titles: {} };
  for (const [key, entries] of [...Object.entries(index?.entries || {}), ...Object.entries(index?.catalog || {}).map(([id, entry]) => [id, [entry]] as const)]) for (const entry of entries) {
    const ud = entry.userData;
    if (!ud || !hasWatchedEvidence({ watched: ud.played, percent: ud.percent })) continue;
    const copyId = `${entry.serverType}:${normalizeServerUrl(entry.serverUrl)}:${entry.itemId}`;
    const bucket = state.titles[key.toUpperCase()] ??= { copies: {} };
    bucket.copies[copyId] = { source: entry.serverType, sourceItemId: entry.itemId, copyId, fileName: entry.itemName, watched: true, percent: Math.min(100, Math.max(90, Number(ud.percent) || 100)), lastPlayedAt: time(ud.lastPlayedAt), observedAt: time(entry.updatedAt) };
  }
  return state;
}
export function evidenceFromDeletionHistory(raw: unknown): MediaWatchEvidenceStateV2 {
  const state: MediaWatchEvidenceStateV2 = { version: 2, titles: {} };
  if (!object(raw) || !object(raw.records)) return state;
  for (const record of Object.values(raw.records)) {
    if (!object(record) || String(record.id || '').startsWith('legacy115:')) continue;
    const key = String(record.code || record.titleId || '').trim().toUpperCase(); if (!key) continue;
    for (const copy of (Array.isArray(record.copies) ? record.copies : [record])) {
      if (!object(copy) || !time(copy.watchedAt) || !copy.copyId || !['emby', 'jellyfin', '115'].includes(copy.source)) continue;
      (state.titles[key] ??= { copies: {} }).copies[copy.copyId] = { source: copy.source === '115' ? 'drive115' : copy.source, sourceItemId: copy.itemId || copy.fileId || copy.pickCode, copyId: copy.copyId, watched: true, percent: 100, lastPlayedAt: copy.watchedAt, fileName: copy.fileName || record.title };
    }
  }
  return state;
}
