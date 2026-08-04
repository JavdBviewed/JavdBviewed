/**
 * @file dbTagsMessageHandlers.ts
 * @description 标签数据的消息处理器 —— 从 IndexedDB 和 chrome.storage 聚合标签统计
 * @module apps/background
 */
import { STORAGE_KEYS } from '../../utils/config';
import {
  viewedGetAll as defaultViewedGetAll,
  viewedTagIndexGetAll as defaultViewedTagIndexGetAll,
} from '../../platform/storage/indexedDb';
import {
  buildViewedRecordSourceFromTagIndexRows,
  buildViewedTagStatsFromSources,
} from '../../features/records/tagStats';

type SendResponse = (response: any) => void;  // chrome.runtime 消息回调类型

const storageChunkPrefixFor = (key: string) => `__chunk__:${key}::`;        // 大对象分块存储键前缀
const storageChunkMetaFor = (key: string) => `__chunks_meta__:${key}`;       // 分块元信息键

/**
 * 读取旧版 chrome.storage.local 中分块存储的观看记录
 * 兼容迁移前的数据格式（chunks 存储结构）
 */
export async function getLegacyViewedRecordsFromStorage(): Promise<Record<string, unknown>> {
  const key = STORAGE_KEYS.VIEWED_RECORDS;
  const prefix = storageChunkPrefixFor(key);
  const metaKey = storageChunkMetaFor(key);
  const metaResult = await chrome.storage.local.get([metaKey]) as Record<string, any>;
  const meta = metaResult?.[metaKey];

  if (meta && typeof meta.chunks === 'number') {
    const count = Math.max(0, Number(meta.chunks || 0));
    if (count <= 0) return {};
    const chunkKeys = Array.from({ length: count }, (_value, index) => `${prefix}${index + 1}`);
    const chunks = await chrome.storage.local.get(chunkKeys) as Record<string, any>;
    const records: Record<string, unknown> = {};
    for (const chunkKey of chunkKeys) {
      const chunk = chunks?.[chunkKey];
      if (chunk && typeof chunk === 'object') Object.assign(records, chunk);
    }
    return records;
  }

  const direct = await chrome.storage.local.get([key]) as Record<string, any>;
  const value = direct?.[key];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export interface GetAllTagsDependencies {
  viewedGetAll?: typeof defaultViewedGetAll;                                // IndexedDB 观看记录全量查询
  viewedTagIndexGetAll?: typeof defaultViewedTagIndexGetAll;               // 标签索引全量查询
  getLegacyViewedRecords?: () => Promise<Record<string, unknown>>;         // 旧版分块存储兼容读取
  tagIndexIsCanonical?: boolean;                                             // 生产索引已覆盖当前记录时跳过全量记录读取
}

/**
 * 处理 DB:GET_ALL_TAGS 消息 —— 聚合 IndexedDB + chrome.storage 来源的标签统计
 */

export async function handleGetAllTags(
  message: any,
  sendResponse: SendResponse,
  deps: GetAllTagsDependencies = {},
): Promise<void> {
  const viewedGetAll = deps.viewedGetAll ?? defaultViewedGetAll;
  const viewedTagIndexGetAll = deps.viewedTagIndexGetAll ?? defaultViewedTagIndexGetAll;
  const getLegacyViewedRecords = deps.getLegacyViewedRecords ?? getLegacyViewedRecordsFromStorage;
  const tagIndexIsCanonical = deps.tagIndexIsCanonical === true;

  const limit = Number(message?.payload?.limit ?? 50);
  try {
    const [idbRecords, tagIndexRows, legacyRecords] = await Promise.all([
      tagIndexIsCanonical ? Promise.resolve([]) : viewedGetAll().catch(() => []),
      viewedTagIndexGetAll().catch(() => []),
      getLegacyViewedRecords().catch(() => ({})),
    ]);
    const tagIndexRecords = buildViewedRecordSourceFromTagIndexRows(tagIndexRows);
    const tags = buildViewedTagStatsFromSources([idbRecords, tagIndexRecords, legacyRecords], limit);
    sendResponse({ success: true, tags });
  } catch (error: any) {
    sendResponse({ success: false, error: error?.message || 'get tags failed', tags: [] });
  }
}
