/**
 * @file resourceTags.ts
 * @description 列表卡片资源标签的证据解析与渲染。
 */
import { getResourceTagIndexEntries, RESOURCE_TAG_CACHE_TTL_MS } from './resourceTagIndex';

const RESOURCE_TAG_SELECTOR = '.jdb-resource-tag';

export interface NativeResourceTags {
  hasSubtitle: boolean;
  hasMagnet: boolean;
  hasNewMagnet: boolean;
}

export interface ResourceTagCacheEntry {
  hasSubtitle?: boolean;
  isCracked?: boolean;
  source?: 'validated-magnet-search';
  observedAt: number;
}

export interface ResourceTagView {
  key: 'subtitle' | 'cracked';
  text: '中字' | '破解';
}

export interface ResourceTagTarget {
  item: HTMLElement;
  videoId: string;
}

function getTagTexts(item: HTMLElement): string[] {
  return Array.from(item.querySelectorAll<HTMLElement>('.tags .tag'))
    .filter((tag) => !tag.matches(RESOURCE_TAG_SELECTOR))
    .map((tag) => tag.textContent?.trim() || '')
    .filter(Boolean);
}

/** 只从列表原生 tag 读取正向证据，绝不从影片标题猜测。 */
export function parseNativeResourceTags(item: HTMLElement): NativeResourceTags {
  const texts = getTagTexts(item);
  return {
    hasSubtitle: texts.some((text) => /含字幕|中文字幕|中字/i.test(text)),
    hasMagnet: texts.some((text) => /含磁鏈|含磁链/i.test(text)),
    hasNewMagnet: texts.some((text) => /今日新種|今日新种|新磁鏈|新磁链/i.test(text)),
  };
}

function isFreshCacheEntry(entry: ResourceTagCacheEntry | null, now: number): entry is ResourceTagCacheEntry {
  return Boolean(entry && Number.isFinite(entry.observedAt) && entry.observedAt > now - RESOURCE_TAG_CACHE_TTL_MS);
}

export function resolveResourceTags(
  nativeTags: NativeResourceTags,
  cached: ResourceTagCacheEntry | null,
  now: number,
): ResourceTagView[] {
  const freshCache = isFreshCacheEntry(cached, now) ? cached : null;
  const tags: ResourceTagView[] = [];
  if (nativeTags.hasSubtitle || freshCache?.hasSubtitle === true) {
    tags.push({ key: 'subtitle', text: '中字' });
  }
  if (freshCache?.isCracked === true) {
    tags.push({ key: 'cracked', text: '破解' });
  }
  return tags;
}

function findTagContainer(item: HTMLElement): HTMLElement | null {
  return item.querySelector<HTMLElement>('.tags.has-addons')
    || item.querySelector<HTMLElement>('.tags');
}

/** 仅管理 feature 自己的 DOM 节点，禁用和重复处理都不会影响其它卡片标签。 */
export function renderResourceTags(
  item: HTMLElement,
  enabled: boolean,
  cached: ResourceTagCacheEntry | null,
  now = Date.now(),
): void {
  item.querySelectorAll(RESOURCE_TAG_SELECTOR).forEach((tag) => tag.remove());
  if (!enabled) return;

  const container = findTagContainer(item);
  if (!container) return;

  for (const tagView of resolveResourceTags(parseNativeResourceTags(item), cached, now)) {
    const tag = document.createElement('span');
    const style = tagView.key === 'cracked' ? 'is-danger' : 'is-info';
    tag.className = `tag ${style} is-light jdb-resource-tag jdb-resource-tag-${tagView.key}`;
    tag.textContent = tagView.text;
    tag.title = tagView.key === 'cracked'
      ? '来自已验证的详情页磁力结果'
      : '来自列表原生标签或已验证的详情页磁力结果';
    container.appendChild(tag);
  }
}

/**
 * 对同一列表批次只读取一次索引，再重绘 feature 自己的标签。
 */
export async function renderResourceTagsForItems(
  targets: readonly ResourceTagTarget[],
  enabled: boolean,
  now = Date.now(),
): Promise<void> {
  if (!enabled) {
    targets.forEach(({ item }) => renderResourceTags(item, false, null, now));
    return;
  }

  const entries = await getResourceTagIndexEntries(targets.map(({ videoId }) => videoId), now);
  targets.forEach(({ item, videoId }) => {
    if (!item.isConnected) return;
    renderResourceTags(item, true, entries[String(videoId || '').trim().toUpperCase()] || null, now);
  });
}
