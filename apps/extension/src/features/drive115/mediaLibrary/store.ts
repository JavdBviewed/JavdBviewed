/**
 * @file store.ts
 * @description 115 媒体库索引本地持久化
 * @module features/drive115/mediaLibrary
 */
import { STORAGE_KEYS } from '../../../utils/config';
import { getValue, setValue } from '../../../utils/storage';
import {
  DEFAULT_DRIVE115_LIBRARY_STATE,
  type Drive115LibraryEntry,
  type Drive115LibraryIndexState,
  type Drive115LibraryIndexStats,
} from './types';

function normalizeStats(raw: unknown): Drive115LibraryIndexStats {
  const s = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const num = (k: string) => {
    const n = Number(s[k]);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  };
  return {
    roots: num('roots'),
    foldersSeen: num('foldersSeen'),
    indexed: num('indexed'),
    skipped: num('skipped'),
    unrecognized: num('unrecognized'),
    apiCalls: num('apiCalls'),
    truncatedFolders: num('truncatedFolders'),
  };
}

function normalizeEntry(raw: unknown): Drive115LibraryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const folderCid = String(r.folderCid ?? '').trim();
  const videoFileId = String(r.videoFileId ?? '').trim();
  const pickCode = String(r.pickCode ?? '').trim();
  if (!folderCid || !videoFileId || !pickCode) return null;
  const key = String(r.key || `${folderCid}:${videoFileId}`).trim();
  const nfoSummary =
    r.nfoSummary && typeof r.nfoSummary === 'object'
      ? {
          title:
            typeof (r.nfoSummary as any).title === 'string'
              ? (r.nfoSummary as any).title
              : undefined,
          plot:
            typeof (r.nfoSummary as any).plot === 'string'
              ? (r.nfoSummary as any).plot
              : undefined,
          year:
            typeof (r.nfoSummary as any).year === 'string'
              ? (r.nfoSummary as any).year
              : undefined,
        }
      : undefined;

  return {
    key,
    code: String(r.code ?? '').trim(),
    title: String(r.title ?? r.code ?? r.folderName ?? r.fileName ?? '未命名').trim() || '未命名',
    folderCid,
    folderName: String(r.folderName ?? '').trim(),
    rootCid: String(r.rootCid ?? '').trim(),
    videoFileId,
    pickCode,
    fileName: String(r.fileName ?? '').trim(),
    fileSize: Number(r.fileSize) || 0,
    coverFileId: r.coverFileId ? String(r.coverFileId) : undefined,
    coverFileName: r.coverFileName ? String(r.coverFileName) : undefined,
    nfoFileId: r.nfoFileId ? String(r.nfoFileId) : undefined,
    nfoFileName: r.nfoFileName ? String(r.nfoFileName) : undefined,
    nfoPickCode: r.nfoPickCode ? String(r.nfoPickCode) : undefined,
    nfoSummary,
    updatedAt: Number(r.updatedAt) || 0,
  };
}

/**
 * 规范化索引 state（防脏数据）
 */
export function normalizeDrive115LibraryState(raw: unknown): Drive115LibraryIndexState {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_DRIVE115_LIBRARY_STATE, stats: { ...DEFAULT_DRIVE115_LIBRARY_STATE.stats } };
  }
  const r = raw as Record<string, unknown>;
  const entriesRaw = Array.isArray(r.entries) ? r.entries : [];
  const entries: Drive115LibraryEntry[] = [];
  const seen = new Set<string>();
  for (const item of entriesRaw) {
    const entry = normalizeEntry(item);
    if (!entry || seen.has(entry.key)) continue;
    seen.add(entry.key);
    entries.push(entry);
  }
  return {
    version: 1,
    updatedAt: Number(r.updatedAt) || 0,
    entries,
    stats: normalizeStats(r.stats),
    lastError: typeof r.lastError === 'string' && r.lastError.trim() ? r.lastError : undefined,
  };
}

export async function loadDrive115LibraryState(): Promise<Drive115LibraryIndexState> {
  const raw = await getValue<unknown>(
    STORAGE_KEYS.DRIVE115_LIBRARY_STATE,
    DEFAULT_DRIVE115_LIBRARY_STATE,
  );
  return normalizeDrive115LibraryState(raw);
}

export async function saveDrive115LibraryState(state: Drive115LibraryIndexState): Promise<void> {
  const normalized = normalizeDrive115LibraryState(state);
  await setValue(STORAGE_KEYS.DRIVE115_LIBRARY_STATE, normalized);
}

/**
 * 按番号查找（供后续角标/播放复用）
 */
export function lookupByCode(
  state: Drive115LibraryIndexState | null | undefined,
  code: string,
): Drive115LibraryEntry[] {
  const target = String(code || '').trim().toUpperCase();
  if (!target || !state?.entries?.length) return [];
  return state.entries.filter((e) => e.code && e.code.toUpperCase() === target);
}
