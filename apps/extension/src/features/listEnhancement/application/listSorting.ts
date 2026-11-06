/**
 * @file listSorting.ts
 * @description 列表排序增强纯逻辑
 * @module features/listEnhancement
 */
import { parseRatingStatsText } from './popularityEffects';
import type {
  ListSortingAppendStrategy,
  ListSortingConfig,
  ListSortingPositionStrategy,
  ListSortMode,
} from '../domain/config';

export type {
  ListSortingAppendStrategy,
  ListSortingConfig,
  ListSortingPositionStrategy,
  ListSortMode,
} from '../domain/config';

const ORIGINAL_INDEX_ATTR = 'data-x-list-sort-original-index';

export interface ListSortableItem {
  element: HTMLElement;
  originalIndex: number;
  score: number | null;
  ratingCount: number | null;
}

export interface NativeSortCapabilities {
  hasNativeToolbar: boolean;
  activeLabel: string | null;
  hasRatingSort: boolean;
  hasRatingCountSort: boolean;
}

function parseOriginalIndex(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function readRatingText(item: HTMLElement): string {
  return item.querySelector('.score .value')?.textContent || item.querySelector('.score')?.textContent || '';
}

export function readSortableItems(root: ParentNode): ListSortableItem[] {
  const selector = root instanceof Element && root.matches('.movie-list') ? ':scope .item' : '.movie-list .item';
  const elements = Array.from(root.querySelectorAll<HTMLElement>(selector));
  const existingIndexes = elements
    .map(element => parseOriginalIndex(element.getAttribute(ORIGINAL_INDEX_ATTR)))
    .filter((index): index is number => index !== null);
  let nextOriginalIndex = existingIndexes.length > 0 ? Math.max(...existingIndexes) + 1 : 0;

  return elements.map((element) => {
    let originalIndex = parseOriginalIndex(element.getAttribute(ORIGINAL_INDEX_ATTR));
    if (originalIndex === null) {
      originalIndex = nextOriginalIndex;
      nextOriginalIndex += 1;
      element.setAttribute(ORIGINAL_INDEX_ATTR, String(originalIndex));
    }

    const stats = parseRatingStatsText(readRatingText(element));
    return {
      element,
      originalIndex,
      score: stats.score,
      ratingCount: stats.count,
    };
  });
}

function compareNullableNumberDesc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

export function sortSortableItems(items: ListSortableItem[], mode: ListSortMode): ListSortableItem[] {
  const sorted = [...items];
  sorted.sort((a, b) => {
    if (mode === 'rating-desc') {
      const compared = compareNullableNumberDesc(a.score, b.score);
      if (compared !== 0) return compared;
    }

    if (mode === 'rating-count-desc') {
      const compared = compareNullableNumberDesc(a.ratingCount, b.ratingCount);
      if (compared !== 0) return compared;
    }

    return a.originalIndex - b.originalIndex;
  });
  return sorted;
}

function normalizeSortText(value: string | null | undefined): string {
  return String(value || '').replace(/\s+/g, '');
}

export function detectNativeSortCapabilities(root: ParentNode): NativeSortCapabilities {
  const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('.toolbar .buttons.has-addons a, .buttons.has-addons a'));
  let activeLabel: string | null = null;
  let hasRatingSort = false;
  let hasRatingCountSort = false;

  links.forEach((link) => {
    const label = normalizeSortText(link.textContent);
    const href = link.getAttribute('href') || '';

    if (activeLabel === null && link.classList.contains('is-selected')) {
      activeLabel = label || null;
    }

    if (label.includes('评分') || label.includes('評分') || href.includes('sort_type=1')) {
      hasRatingSort = true;
    }

    if (label.includes('评价人数') || label.includes('評價人數')) {
      hasRatingCountSort = true;
    }
  });

  return {
    hasNativeToolbar: links.length > 0,
    activeLabel,
    hasRatingSort,
    hasRatingCountSort,
  };
}

export function getOriginalIndexAttributeName(): string {
  return ORIGINAL_INDEX_ATTR;
}
