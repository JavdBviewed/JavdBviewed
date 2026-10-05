/**
 * @file listRecordHelpers.ts
 * @description 清单记录的 ID 规范化、类型判断和匹配工具
 * @module shared/utils（跨上下文：background + content + UI）
 *
 * 清单 ID 体系：
 * - 普通清单（mine/favorite/local）：ID 由 JavDB 分配或用户自定义
 * - 系列清单（series）：ID 格式 `series:{externalId}`
 * - 番号清单（label）：ID 格式 `label:{externalId}`（大写）
 * - 片商清单（maker）：ID 格式 `maker:{externalId}`（保留原始大小写）
 * - 導演清单（director）：ID 格式 `director:{externalId}`（保留原始大小写）
 */
import type { ListRecord, VideoRecord } from '../../types';

export type CollectionListType = 'series' | 'label' | 'maker' | 'director';

/** 收藏类清单的 ID 前缀映射 */
const COLLECTION_PREFIX: Record<CollectionListType, string> = {
  series: 'series:',
  label: 'label:',
  maker: 'maker:',
  director: 'director:',
};

/** 判断类型是否为收藏类清单（series/label） */
export function isCollectionListType(type: unknown): type is CollectionListType {
  return type === 'series' || type === 'label' || type === 'maker' || type === 'director';
}

/** 判断记录是否为收藏类清单 */
export function isCollectionListRecord(record: Pick<ListRecord, 'type'> | null | undefined): boolean {
  return !!record && isCollectionListType(record.type);
}

/** 判断记录是否为视频类清单（mine/favorite/local） */
export function isVideoListRecord(record: Pick<ListRecord, 'type'> | null | undefined): boolean {
  return !!record && (record.type === 'mine' || record.type === 'favorite' || record.type === 'local');
}

/** 规范化收藏清单的外部 ID（label 强制大写；maker/director 保留原始大小写） */
export function normalizeCollectionExternalId(type: CollectionListType, raw: string): string {
  const value = String(raw || '').trim();
  return type === 'label' ? value.toUpperCase() : value;
}

/** 根据类型和外部 ID 生成内部记录 ID，如 `series:abc123` */
export function getCollectionRecordId(type: CollectionListType, externalId: string): string {
  return `${COLLECTION_PREFIX[type]}${normalizeCollectionExternalId(type, externalId)}`;
}

/** 移除记录 ID 中的收藏清单前缀（`series:` 或 `label:`） */
export function stripCollectionRecordPrefix(type: CollectionListType, id: string): string {
  const value = String(id || '').trim();
  const prefix = COLLECTION_PREFIX[type];
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

/** 获取收藏清单的真实外部 ID（优先用 externalId 字段，否则从 id 中剥离前缀） */
export function getCollectionExternalId(record: Pick<ListRecord, 'id' | 'type'> & Partial<Pick<ListRecord, 'externalId'>>): string {
  if (!isCollectionListType(record.type)) return String(record.id || '').trim();
  const raw = record.externalId || stripCollectionRecordPrefix(record.type, record.id);
  return normalizeCollectionExternalId(record.type, raw);
}

/** 规范化收藏清单记录：确保 id 和 externalId 一致且格式正确 */
export function normalizeCollectionRecord<T extends ListRecord>(record: T): T {
  if (!isCollectionListType(record.type)) return record;
  const externalId = getCollectionExternalId(record);
  return {
    ...record,
    id: getCollectionRecordId(record.type, externalId),
    externalId,
  };
}

/** 规范化清单记录供业务使用：收藏类走 normalize，普通类补 source 默认值 */
export function normalizeListRecordForUse<T extends ListRecord>(record: T): T {
  if (isCollectionListType(record.type)) {
    return normalizeCollectionRecord(record);
  }
  return {
    ...record,
    source: record.source ?? 'javdb',
  };
}

/** 从系列 URL 中提取外部 ID，如 `/series/abc` → `abc` */
export function getSeriesExternalIdFromUrl(seriesUrl?: string): string {
  const match = String(seriesUrl || '').match(/\/series\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]).trim() : '';
}

/** 从片商 URL 中提取外部 ID，如 `/makers/AEO` → `AEO`（保留原始大小写） */
export function getMakerExternalIdFromUrl(makerUrl?: string): string {
  const match = String(makerUrl || '').match(/\/makers\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]).trim() : '';
}

/** 从導演 URL 中提取外部 ID，如 `/directors/dekM` → `dekM`（保留原始大小写） */
export function getDirectorExternalIdFromUrl(directorUrl?: string): string {
  const match = String(directorUrl || '').match(/\/directors\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]).trim() : '';
}

/** 规范化名称用于比较：NFKC 标准化 + 去多余空格 + 小写 */
function normalizeComparableName(value: unknown): string {
  return String(value || '').trim().normalize('NFKC').replace(/\s+/g, ' ').toLowerCase();
}

/** 判断视频记录是否属于某个系列（通过 URL 或名称匹配） */
export function matchesSeriesRecord(
  record: Partial<VideoRecord>,
  series: Pick<ListRecord, 'id' | 'name' | 'type'> & Partial<Pick<ListRecord, 'externalId'>>
): boolean {
  const externalId = getCollectionExternalId(series);
  const urlId = getSeriesExternalIdFromUrl(record.seriesUrl);
  if (urlId && externalId && urlId === externalId) return true;

  const recordSeries = normalizeComparableName(record.series);
  if (!recordSeries) return false;

  const seriesName = normalizeComparableName(series.name);
  const seriesId = normalizeComparableName(externalId);
  return (!!seriesName && recordSeries === seriesName) || (!!seriesId && recordSeries === seriesId);
}

/** 片商/導演名称比较：NFKC 标准化 + 移除全部空白 + 小写（片商名常以空格分写） */
function normalizeNoSpaceName(value: unknown): string {
  return String(value || '').trim().normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

/** 判断视频记录是否属于某个片商（URL id 精确匹配或名称匹配） */
export function matchesMakerRecord(
  record: Partial<VideoRecord>,
  maker: Pick<ListRecord, 'id' | 'name' | 'type'> & Partial<Pick<ListRecord, 'externalId'>>
): boolean {
  const externalId = getCollectionExternalId(maker);
  const urlId = getMakerExternalIdFromUrl(record.makerUrl);
  if (urlId && externalId && urlId === externalId) return true;

  const recordMaker = normalizeNoSpaceName(record.maker);
  if (!recordMaker) return false;

  const makerName = normalizeNoSpaceName(maker.name);
  const makerId = normalizeNoSpaceName(externalId);
  return (!!makerName && recordMaker === makerName) || (!!makerId && recordMaker === makerId);
}

/** 判断视频记录是否属于某个導演（URL id 精确匹配或名称匹配） */
export function matchesDirectorRecord(
  record: Partial<VideoRecord>,
  director: Pick<ListRecord, 'id' | 'name' | 'type'> & Partial<Pick<ListRecord, 'externalId'>>
): boolean {
  const externalId = getCollectionExternalId(director);
  const urlId = getDirectorExternalIdFromUrl(record.directorUrl);
  if (urlId && externalId && urlId === externalId) return true;

  const recordDirector = normalizeNoSpaceName(record.director);
  if (!recordDirector) return false;

  const directorName = normalizeNoSpaceName(director.name);
  const directorId = normalizeNoSpaceName(externalId);
  return (!!directorName && recordDirector === directorName) || (!!directorId && recordDirector === directorId);
}

/** 判断视频记录是否属于某个番号标签（ID 精确匹配或前缀匹配，如 `ABC-123` 匹配 `ABC`） */
export function matchesLabelRecord(record: Pick<VideoRecord, 'id'> | Partial<VideoRecord>, label: Pick<ListRecord, 'id' | 'type'> & Partial<Pick<ListRecord, 'externalId'>>): boolean {
  const prefix = getCollectionExternalId(label).toUpperCase();
  const id = String(record.id || '').toUpperCase();
  return !!prefix && (id === prefix || id.startsWith(`${prefix}-`));
}
