/** Cloud 本地文件聚合的只读形状与入库匹配；文件身份不按番号合并。 */
import { normalizeVideoCodeCandidate } from '../../shared/utils/videoCodeExtractor';

export interface LocalMediaLibraryEntry {
  serverType: 'local';
  serverName: string;
  relativePath: string;
  fileName: string;
  code: string;
  size: number;
  mtime: number;
  updatedAt: number;
  producerId: string;
  sourceId: string;
  key: string;
}

export interface LocalMediaLibraryIndex {
  version: 1;
  updatedAt: number;
  entries: LocalMediaLibraryEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isEntry(value: unknown): value is LocalMediaLibraryEntry {
  if (!isRecord(value) || value.serverType !== 'local') return false;
  if (typeof value.serverName !== 'string' || typeof value.code !== 'string') return false;
  if (!normalizeVideoCodeCandidate(value.code)) return false;
  for (const field of ['producerId', 'sourceId', 'relativePath', 'fileName', 'key']) {
    if (typeof value[field] !== 'string' || !value[field]) return false;
  }
  if (!isTimestamp(value.size) || !isTimestamp(value.mtime) || !isTimestamp(value.updatedAt)) return false;
  try {
    const identity: unknown = JSON.parse(String(value.key));
    return Array.isArray(identity) && identity.length === 3
      && identity[0] === value.producerId && identity[1] === value.sourceId && identity[2] === value.relativePath;
  } catch {
    return false;
  }
}

/** 非法响应不能被当作合法空索引完成迁移，也不应覆盖已保存的有效快照。 */
export function parseLocalMediaLibraryIndex(value: unknown): LocalMediaLibraryIndex | null {
  if (!isRecord(value) || value.version !== 1 || !isTimestamp(value.updatedAt)) return null;
  if (!Array.isArray(value.entries) || !value.entries.every(isEntry)) return null;
  return { ...value, version: 1, updatedAt: value.updatedAt, entries: value.entries };
}

export function buildLocalMediaCodeSet(index: LocalMediaLibraryIndex | null | undefined): ReadonlySet<string> {
  const codes = new Set<string>();
  for (const entry of index?.entries ?? []) {
    const code = normalizeVideoCodeCandidate(entry.code)?.toUpperCase();
    if (code) codes.add(code);
  }
  return codes;
}

export function hasLocalMediaHit(codes: ReadonlySet<string>, candidate: string): boolean {
  const code = normalizeVideoCodeCandidate(candidate)?.toUpperCase();
  return code !== undefined && codes.has(code);
}
