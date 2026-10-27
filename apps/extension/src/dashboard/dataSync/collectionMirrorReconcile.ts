/**
 * @file collectionMirrorReconcile.ts
 * @description 收藏全量同步对账迁移：检测旧裸 ID 站侧镜像，匹配新前缀实体并合并（纯函数，无 DB 依赖）
 * @module dashboard/dataSync
 *
 * 背景（ID 约定见 listRecordHelpers.ts）：
 * - 旧：早期站侧收藏镜像为「裸 ID」清单记录（id=q8e6，无 series: 前缀）
 * - 新：id = {prefix}{externalId}（label 强制大写）
 * 对账规则：
 * - 已前缀存量：保持现有整替语义（不在新结果中则按 raw id 删除）
 * - 裸 ID 镜像：按 externalId 归一（label 大写）主键、url 归一（去 query/fragment+尾斜杠，大小写按现状）辅键
 *   匹配新前缀实体；命中 → 字段级并集（新实体缺失且旧镜像非空则拷入，冲突以新实体为准）后删旧
 * - 裸 ID 镜像未命中：保留不删，返回调用方留可查日志（安全优先，用户可手动删）
 * - 幂等：迁移后无裸 ID 存量 → 重复执行零额外删除
 */
import type { ListRecord } from '../../types';
import {
  type CollectionListType,
  getCollectionExternalId,
  getCollectionRecordId,
  normalizeCollectionExternalId,
  stripCollectionRecordPrefix,
} from '../../shared/utils/listRecordHelpers';

/** 未匹配的裸 ID 镜像（保留，由调用方留可查日志） */
export interface KeptBareMirror {
  rawId: string;
  externalId: string;
}

export interface CollectionMirrorReconcileResult {
  /** 待写入的新记录（命中的裸镜像已按字段并集合并进去） */
  finalRecords: ListRecord[];
  /** 待删除的存量 raw id：已前缀且不在新结果（现有整替语义）+ 命中的裸镜像 */
  deleteIds: string[];
  /** 未匹配的裸 ID 镜像 */
  keptBareMirrors: KeptBareMirror[];
}

/** 用户可见可维护字段：新实体缺失且旧镜像非空 → 拷入；冲突以新实体为准（站点侧最新） */
const MERGE_FILL_FIELDS = ['name', 'url', 'moviesCount', 'clickedCount'] as const;

/** 非空判定：string=trim 非空；number=有限数（0 有效）；undefined/null=空 */
function hasValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  return true;
}

/** raw ID 是否不含该 type 前缀（即旧裸 ID 镜像） */
function isBareCollectionId(type: CollectionListType, rawId: string): boolean {
  return stripCollectionRecordPrefix(type, rawId) === rawId;
}

/** url 归一：首个 ?/# 截断 + 去尾斜杠，大小写按现状（与既有无折叠约定一致） */
function normalizeCollectionUrl(url: unknown): string {
  if (typeof url !== 'string') return '';
  let value = url.trim();
  const cut = value.search(/[?#]/);
  if (cut >= 0) value = value.slice(0, cut);
  while (value.length > 0 && value.endsWith('/')) value = value.slice(0, -1);
  return value;
}

/** 字段级并集：镜像只供 MERGE_FILL_FIELDS；不覆盖新实体非空值；不触碰 id/timestamp/deletedAt */
function mergeMirrorFields(target: ListRecord, mirror: ListRecord): void {
  for (const field of MERGE_FILL_FIELDS) {
    const fromMirror = mirror[field];
    if (!hasValue(fromMirror) || hasValue(target[field])) continue;
    if (field === 'name') target.name = fromMirror as string;
    else if (field === 'url') target.url = fromMirror as string;
    else if (field === 'moviesCount') target.moviesCount = fromMirror as number;
    else target.clickedCount = fromMirror as number;
  }
}

/**
 * 收藏全量同步对账（纯函数）
 * @param type 收藏清单类型（series/label/maker/director）
 * @param normalizedNewRecords 已 normalize 的新记录（id={prefix}{externalId}）
 * @param existingRecords 同 type 的 DB 存量记录（raw id，未过滤前缀）
 */
export function reconcileCollectionListRecords(
  type: CollectionListType,
  normalizedNewRecords: ListRecord[],
  existingRecords: ListRecord[],
): CollectionMirrorReconcileResult {
  const newIdSet = new Set(normalizedNewRecords.map(record => String(record.id || '')));
  // externalId → 首个新记录下标（防御重复键）
  const newByExternalId = new Map<string, number>();
  normalizedNewRecords.forEach((record, index) => {
    const extId = getCollectionExternalId(record);
    if (!newByExternalId.has(extId)) newByExternalId.set(extId, index);
  });

  const finalRecords: ListRecord[] = normalizedNewRecords.map(record => ({ ...record }));
  const deleteIds: string[] = [];
  const deleteIdSet = new Set<string>();
  const keptBareMirrors: KeptBareMirror[] = [];

  const markDelete = (rawId: string): void => {
    if (!deleteIdSet.has(rawId)) {
      deleteIdSet.add(rawId);
      deleteIds.push(rawId);
    }
  };

  for (const existing of existingRecords) {
    const rawId = String(existing.id || '');
    if (!rawId) continue;

    if (!isBareCollectionId(type, rawId)) {
      // 已前缀存量：保持现有整替语义（归一 id 不在新结果中 → 删）
      const normalizedId = getCollectionRecordId(type, getCollectionExternalId(existing));
      if (!newIdSet.has(normalizedId)) markDelete(rawId);
      continue;
    }

    // 裸 ID 镜像：externalId 主键（归一，label 大写），url 归一辅键
    const mirrorExtId = normalizeCollectionExternalId(type, stripCollectionRecordPrefix(type, rawId));
    let matchedIndex = newByExternalId.get(mirrorExtId);
    if (matchedIndex === undefined) {
      const mirrorUrl = normalizeCollectionUrl(existing.url);
      if (mirrorUrl) {
        for (let i = 0; i < normalizedNewRecords.length; i++) {
          if (normalizeCollectionUrl(normalizedNewRecords[i].url) === mirrorUrl) {
            matchedIndex = i;
            break;
          }
        }
      }
    }
    if (matchedIndex === undefined) {
      keptBareMirrors.push({ rawId, externalId: mirrorExtId });
      continue;
    }
    mergeMirrorFields(finalRecords[matchedIndex], existing);
    markDelete(rawId);
  }

  return { finalRecords, deleteIds, keptBareMirrors };
}
