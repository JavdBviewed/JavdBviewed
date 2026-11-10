/** SW-safe metadata parser for explicitly confirmed media-origin records. */
import type { MediaRecordMetadata } from '../../../../shared/records/mediaMetadataMerge';
import type { JavdbSearchResult } from '../domain/types';
import { parseDetailPage } from './javdbParsers';

function text(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&(?:nbsp|amp|lt|gt|quot|apos);|&#(?:x[\da-f]+|\d+);/gi, entity => {
    const named: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const hex = entity.toLowerCase().startsWith('&#x');
    const code = Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
  }).replace(/\s+/g, ' ').trim();
}
function hrefFrom(attributes: string): string | undefined {
  return attributes.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
}
function siteUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw, 'https://javdb.com');
    if (url.origin !== 'https://javdb.com' || url.username || url.password || !/^\/v\/[a-z\d]+\/?$/i.test(url.pathname)) return;
    return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
  } catch { return; }
}

export function findMediaMetadataMatch(html: string, code: string): JavdbSearchResult | null {
  const matches = new Map<string, JavdbSearchResult>();
  for (const anchor of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const strong = anchor[2].match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i);
    if (!strong || text(strong[1]).toUpperCase() !== code.trim().toUpperCase()) continue;
    const href = siteUrl(hrefFrom(anchor[1]) || '');
    if (!href) continue;
    const title = text(anchor[1].match(/\btitle=["']([^"']+)["']/i)?.[1] || anchor[2].replace(strong[0], ''));
    matches.set(href, { href, title });
  }
  if (matches.size > 1) throw new Error('源站存在多个同番号结果，请先核对影片版本');
  return [...matches.values()][0] || null;
}

export function parseMediaMetadata(html: string, code: string, url: string): MediaRecordMetadata {
  const blocks = new Map<string, string>();
  for (const block of html.matchAll(/<div\b[^>]*class=["'][^"']*\bpanel-block\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)) {
    const label = block[1].match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i);
    if (label) blocks.set(text(label[1]).replace(/[:：]\s*$/, '').toLowerCase(), block[1].slice(label.index! + label[0].length));
  }
  const value = (...labels: string[]) => labels.map(label => blocks.get(label.toLowerCase())).find(v => v !== undefined);
  const identity = text(value('番號', '番号', '識別碼', '识别码', 'ID') || '');
  if (!identity || identity.toUpperCase() !== code.toUpperCase()) throw new Error('源站详情番号不匹配或页面不可用，未写入资料');
  const heading = html.match(/<h2\b[^>]*class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i)?.[1];
  const rawTitle = text(heading || html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').split('|')[0].trim();
  const title = rawTitle.toUpperCase().startsWith(`${code.toUpperCase()} `) ? rawTitle.slice(code.length).trim() : rawTitle;
  if (!title || title.toUpperCase() === code.toUpperCase()) throw new Error('源站详情缺少影片标题，未写入资料');
  const base = parseDetailPage(html);
  const result: MediaRecordMetadata = { title, javdbUrl: url };
  if (base.javdbImage) {
    try { const cover = new URL(base.javdbImage, url); if (/^https?:$/.test(cover.protocol) && !cover.username && !cover.password) result.javdbImage = cover.href; } catch { /* malformed optional cover */ }
  }
  const date = text(value('日期', '發行日期', '发行日期', 'Release Date') || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date) result.releaseDate = date;
  }
  const duration = text(value('時長', '时长', 'Duration') || '').match(/^(\d+)\s*(?:分鐘|分钟|分鍾|mins?|minutes?)(?:\s|$)/i);
  if (duration && Number(duration[1]) > 0) result.duration = Number(duration[1]);
  const links = (raw: string | undefined, path: string) => [...(raw || '').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].flatMap(a => {
    try { const u = new URL(hrefFrom(a[1]) || '', url); const name = text(a[2]); return u.origin === 'https://javdb.com' && u.pathname.startsWith(path) && name ? [name] : []; } catch { return []; }
  });
  const actors = links(value('演員', '演员', 'Actor', 'Actors'), '/actors/');
  if (actors.length) result.actors = [...new Set(actors)];
  for (const [field, labels, path] of [
    ['director', ['導演', '导演', 'Director'], '/directors/'], ['maker', ['片商', 'Maker'], '/makers/'],
    ['publisher', ['發行', '发行', 'Publisher'], '/publishers/'], ['series', ['系列', 'Series'], '/series/'],
  ] as const) {
    const names = links(value(...labels), path); if (names.length === 1) result[field] = names[0];
  }
  const tags = [...new Set([...links(value('類別', '类别', 'Category'), '/tags'), ...links(value('類別', '类别', 'Category'), '/genres')])];
  if (tags.length) result.tags = tags;
  const score = text(value('評分', '评分', 'Rating') || '');
  const rating = score.match(/^(\d+(?:\.\d+)?)\s*(?:分|\/\s*5)/)?.[1];
  if (rating && Number(rating) >= 0 && Number(rating) <= 5) {
    result.rating = Number(rating);
    const count = score.match(/(\d+)\s*(?:人|votes?)/i)?.[1]; if (count) result.ratingCount = Number(count);
  }
  return result;
}
