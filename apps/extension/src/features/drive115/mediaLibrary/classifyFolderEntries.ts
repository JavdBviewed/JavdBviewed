/**
 * @file classifyFolderEntries.ts
 * @description 将文件夹内文件分类为视频 / 封面 / NFO
 * @module features/drive115/mediaLibrary
 */

export type ClassifiedFolderFile = {
  fileId: string;
  fileName: string;
  fileSize: number;
  pickCode: string;
  kind: 'video' | 'cover' | 'nfo' | 'other';
};

export type ClassifiedFolderEntries = {
  videos: ClassifiedFolderFile[];
  covers: ClassifiedFolderFile[];
  nfos: ClassifiedFolderFile[];
  others: ClassifiedFolderFile[];
};

const VIDEO_EXT = /\.(mp4|mkv|avi|ts|m2ts|wmv|mov|flv|webm|iso|rmvb|mpg|mpeg)$/i;
const COVER_EXT = /\.(jpg|jpeg|png|webp|bmp|gif)$/i;
const NFO_EXT = /\.nfo$/i;

const COVER_NAME_HINT =
  /^(poster|cover|folder|thumb|fanart)(\.|$)/i;

function firstStringField(raw: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = raw[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function itemName(raw: Record<string, unknown>): string {
  return firstStringField(raw, ['fn', 'file_name', 'fileName', 'n', 'name']);
}

function itemFileId(raw: Record<string, unknown>): string {
  // 115 的不同列表端点对非视频文件偶尔只给 cid；文件夹会先被 isFolderItem 跳过。
  return firstStringField(raw, ['fid', 'file_id', 'fileId', 'id', 'cid']);
}

function itemPickCode(raw: Record<string, unknown>): string {
  return firstStringField(raw, ['pc', 'pick_code', 'pickcode', 'pickCode', 'pcd']);
}

function itemSize(raw: Record<string, unknown>): number {
  const n = Number(raw.fs ?? raw.file_size ?? raw.fileSize ?? raw.size ?? raw.s ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function isTruthyFolderFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  const text = String(value ?? '').trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'folder' || text === 'dir' || text === 'directory';
}

function isFolderItem(raw: Record<string, unknown>): boolean {
  const fc = String(raw.fc ?? raw.file_category ?? '').trim();
  // 0 文件夹；1 文件（文档原文）。部分返回会给布尔/文本目录标记。
  if (fc === '0') return true;
  return isTruthyFolderFlag(raw.is_dir)
    || isTruthyFolderFlag(raw.isDir)
    || isTruthyFolderFlag(raw.is_directory)
    || isTruthyFolderFlag(raw.isDirectory)
    || isTruthyFolderFlag(raw.type);
}

/**
 * 判定文件类型（仅文件，跳过子文件夹）
 */
export function classifyFileKind(fileName: string): ClassifiedFolderFile['kind'] {
  const name = String(fileName || '').trim();
  if (!name) return 'other';
  if (NFO_EXT.test(name)) return 'nfo';
  if (VIDEO_EXT.test(name)) return 'video';
  if (COVER_EXT.test(name)) return 'cover';
  return 'other';
}

/**
 * 将 listFiles 条目分类
 */
export function classifyFolderEntries(
  items: Array<Record<string, unknown>> | null | undefined,
): ClassifiedFolderEntries {
  const result: ClassifiedFolderEntries = {
    videos: [],
    covers: [],
    nfos: [],
    others: [],
  };
  if (!Array.isArray(items)) return result;

  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    if (isFolderItem(raw)) continue;
    const fileName = itemName(raw);
    const fileId = itemFileId(raw);
    if (!fileId || !fileName) continue;
    const kind = classifyFileKind(fileName);
    const entry: ClassifiedFolderFile = {
      fileId,
      fileName,
      fileSize: itemSize(raw),
      pickCode: itemPickCode(raw),
      kind,
    };
    if (kind === 'video') result.videos.push(entry);
    else if (kind === 'cover') result.covers.push(entry);
    else if (kind === 'nfo') result.nfos.push(entry);
    else result.others.push(entry);
  }
  return result;
}

/**
 * 选主视频：优先体积最大的视频文件
 */
export function pickPrimaryVideo(
  videos: ClassifiedFolderFile[],
): ClassifiedFolderFile | null {
  if (!videos.length) return null;
  return [...videos].sort((a, b) => b.fileSize - a.fileSize)[0] || null;
}

/**
 * 选封面：优先 poster/cover/folder 命名，否则取首个图片
 */
export function pickPrimaryCover(
  covers: ClassifiedFolderFile[],
  codeHint?: string,
): ClassifiedFolderFile | null {
  if (!covers.length) return null;
  const byHint = covers.find((c) => COVER_NAME_HINT.test(c.fileName));
  if (byHint) return byHint;
  const code = String(codeHint || '').trim().toUpperCase();
  if (code) {
    const byCode = covers.find((c) => c.fileName.toUpperCase().includes(code.replace(/-/g, '')));
    if (byCode) return byCode;
  }
  return covers[0] || null;
}

/**
 * 选 NFO：优先与主视频同名，否则首个
 */
export function pickPrimaryNfo(
  nfos: ClassifiedFolderFile[],
  videoFileName?: string,
): ClassifiedFolderFile | null {
  if (!nfos.length) return null;
  const base = String(videoFileName || '')
    .replace(/\.[^.]+$/, '')
    .trim()
    .toLowerCase();
  if (base) {
    const match = nfos.find((n) => n.fileName.replace(/\.nfo$/i, '').toLowerCase() === base);
    if (match) return match;
  }
  return nfos[0] || null;
}
