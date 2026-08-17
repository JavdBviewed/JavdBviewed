/**
 * @file resourceTagIndex.ts
 * @description 详情页已验证磁力结果的最小列表资源标签索引。
 */
import {
  detectMagnetSubtitle,
  isCrackedVersion,
  isValidMagnetResultName,
} from '../../magnets/application/resultMetadata';
import type { MagnetResult } from '../../magnets/domain/types';
import { getValue, setValue } from '../../../utils/storage';
import type { ResourceTagCacheEntry } from './resourceTags';

const RESOURCE_TAG_INDEX_STORAGE_KEY = 'resourceTagIndex';
export const RESOURCE_TAG_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type ResourceTagIndex = Record<string, ResourceTagCacheEntry>;

function normalizeVideoId(videoId: string): string {
  return String(videoId || '').trim().toUpperCase();
}

function isResourceTagCacheEntry(value: unknown): value is ResourceTagCacheEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<ResourceTagCacheEntry>;
  return Number.isFinite(entry.observedAt)
    && (entry.hasSubtitle === undefined || typeof entry.hasSubtitle === 'boolean')
    && (entry.isCracked === undefined || typeof entry.isCracked === 'boolean')
    && (entry.source === undefined || entry.source === 'validated-magnet-search');
}

async function readIndex(): Promise<ResourceTagIndex> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return {};
  const raw = await getValue<unknown>(RESOURCE_TAG_INDEX_STORAGE_KEY, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  return Object.fromEntries(
    Object.entries(raw).filter(([, entry]) => isResourceTagCacheEntry(entry)),
  );
}

export async function getResourceTagIndexEntry(
  videoId: string,
  now = Date.now(),
): Promise<ResourceTagCacheEntry | null> {
  const entries = await getResourceTagIndexEntries([videoId], now);
  return entries[normalizeVideoId(videoId)] || null;
}

/** 列表批处理一次读取索引，避免按卡片放大 Storage 调用。 */
export async function getResourceTagIndexEntries(
  videoIds: readonly string[],
  now = Date.now(),
): Promise<Record<string, ResourceTagCacheEntry>> {
  const keys = new Set(videoIds.map(normalizeVideoId).filter(Boolean));
  if (keys.size === 0) return {};
  const index = await readIndex();
  const entries: Record<string, ResourceTagCacheEntry> = {};
  for (const key of keys) {
    const entry = index[key];
    if (entry && entry.observedAt > now - RESOURCE_TAG_CACHE_TTL_MS) {
      entries[key] = entry;
    }
  }
  return entries;
}

/**
 * 只把详情页中通过番号校验的正向属性写入 Chrome Storage，不保存磁链或文件名。
 */
export async function writeResourceTagIndexFromMagnetResults(
  videoId: string,
  results: readonly Pick<MagnetResult, 'name' | 'hasSubtitle'>[],
  now = Date.now(),
): Promise<void> {
  const key = normalizeVideoId(videoId);
  if (!key || typeof chrome === 'undefined' || !chrome.storage?.local) return;

  const verified = results.filter((result) => isValidMagnetResultName(result.name, key));
  const hasSubtitle = verified.some((result) => result.hasSubtitle || detectMagnetSubtitle(result.name));
  const isCracked = verified.some((result) => isCrackedVersion(result.name));
  if (!hasSubtitle && !isCracked) return;

  const index = await readIndex();
  const previous = index[key];
  index[key] = {
    hasSubtitle: previous?.hasSubtitle === true || hasSubtitle || undefined,
    isCracked: previous?.isCracked === true || isCracked || undefined,
    source: 'validated-magnet-search',
    observedAt: now,
  };
  await setValue(RESOURCE_TAG_INDEX_STORAGE_KEY, index);
}
