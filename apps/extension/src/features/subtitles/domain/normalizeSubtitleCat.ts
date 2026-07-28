/**
 * @file normalizeSubtitleCat.ts
 * @description SubTitleCat 页面解析
 * @module features/subtitles
 */
import type { SubtitleCatLanguageDownload, SubtitleCatSearchItem } from './types';

const MAX_SUBTITLECAT_SEARCH_ITEMS = 30;

export function normalizeSubtitleCatSearchItems(
  document: Document,
  searchUrl: string,
  videoId: string,
): SubtitleCatSearchItem[] {
  const exactKey = normalizeSubtitleCatMatchKey(videoId);
  const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>('table.sub-table tbody tr, .sub-table tr'));
  const items = rows
    .map(row => normalizeSubtitleCatSearchRow(row, searchUrl))
    .filter((item): item is SubtitleCatSearchItem => item !== null)
    .filter(item => exactKey.length === 0 || normalizeSubtitleCatMatchKey(item.name).includes(exactKey));

  return items.slice(0, MAX_SUBTITLECAT_SEARCH_ITEMS);
}

export function normalizeSubtitleCatLanguageDownloads(
  document: Document,
  detailUrl: string,
): SubtitleCatLanguageDownload[] {
  const blocks = Array.from(document.querySelectorAll<HTMLElement>('.sub-single'));
  const downloads = blocks
    .map(block => normalizeSubtitleCatLanguageBlock(block, detailUrl))
    .filter((item): item is SubtitleCatLanguageDownload => item !== null);

  return downloads;
}

function normalizeSubtitleCatSearchRow(row: HTMLTableRowElement, searchUrl: string): SubtitleCatSearchItem | null {
  const link = row.querySelector<HTMLAnchorElement>('td a[href]');
  if (!link) return null;

  const cells = Array.from(row.querySelectorAll<HTMLTableCellElement>('td'));
  const name = normalizeSubtitleCatText(link.textContent);
  const pageUrl = resolveSubtitleCatUrl(link.getAttribute('href') || '', searchUrl);
  if (!name || !pageUrl) return null;

  const sourceText = normalizeSubtitleCatText(cells[0]?.textContent);
  const translatedFrom = sourceText.match(/translated from\s+([^\)]+)/i)?.[1]?.trim();
  const ratingText = normalizeSubtitleCatText(cells[1]?.textContent);
  const rating = ratingText.includes('👍') ? '好评' : ratingText.includes('👎') ? '差评' : '';
  const size = normalizeSubtitleCatText(cells[2]?.querySelector('.sub-table__metric-value')?.textContent || cells[2]?.textContent).replace(/^SIZE\s*/i, '');

  return {
    name,
    pageUrl,
    translatedFrom,
    rating,
    size,
    downloads: normalizeSubtitleCatText(cells[3]?.textContent),
    languageCount: normalizeSubtitleCatText(cells[4]?.textContent),
  };
}

function normalizeSubtitleCatLanguageBlock(block: HTMLElement, detailUrl: string): SubtitleCatLanguageDownload | null {
  const link = block.querySelector<HTMLAnchorElement>('a.green-link[href], a[id^="download_"][href]');
  if (!link) return null;

  const href = link.getAttribute('href') || '';
  const downloadUrl = resolveSubtitleCatUrl(href, detailUrl);
  if (!downloadUrl) return null;

  const code = normalizeSubtitleCatLanguageCode(link.id.replace(/^download_/, '') || block.querySelector<HTMLImageElement>('img.flag')?.alt || '');
  const language = normalizeSubtitleCatLanguageLabel(block) || code || '未知语言';

  return {
    code,
    language,
    downloadUrl,
    ext: inferSubtitleCatExtension(downloadUrl),
  };
}

function normalizeSubtitleCatLanguageLabel(block: HTMLElement): string {
  const spans = Array.from(block.querySelectorAll<HTMLSpanElement>('span'));
  for (const span of spans) {
    const text = normalizeSubtitleCatText(span.textContent);
    if (!text || /^Download$/i.test(text) || /^Translate$/i.test(text)) continue;
    return text;
  }
  return '';
}

function normalizeSubtitleCatText(value: string | null | undefined): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeSubtitleCatLanguageCode(value: string): string {
  return String(value || '').trim().replace(/[^a-z0-9-]/gi, '');
}

function resolveSubtitleCatUrl(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return '';
  }
}

function inferSubtitleCatExtension(url: string): string {
  const ext = url.match(/\.([a-z0-9]{1,8})(?:[?#].*)?$/i)?.[1]?.toLowerCase();
  return ext || 'srt';
}

function normalizeSubtitleCatMatchKey(value: string): string {
  return String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
}
