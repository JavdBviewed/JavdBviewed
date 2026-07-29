/**
 * @file parseEntryMeta.ts
 * @description 115 媒体库条目番号与 NFO 摘要解析
 * @module features/drive115/mediaLibrary
 */
import { normalizeVideoCodeCandidate } from '../../../shared/utils/videoCodeExtractor';

export const NFO_SUMMARY_SCHEMA_VERSION = 4;

export type ParsedNfoSummary = {
  schemaVersion?: number;
  title?: string;
  originalTitle?: string;
  tagline?: string;
  plot?: string;
  year?: string;
  /** JAV 番号 <num>/<id>/<uniqueid> */
  num?: string;
  /** 演员：优先解析 <actor><name> */
  actors?: string[];
  /** 制作/发行信息：<studio>/<maker>/<label>/<producer> */
  studio?: string;
  /** Publisher/label info: <publisher>/<label> */
  publisher?: string;
  /** Country/region: <countrycode>/<country> */
  countryCode?: string;
  /** Content rating: <customrating>/<mpaa>/<certification> */
  contentRating?: string;
  /** Source website: <website>/<homepage> */
  website?: string;
  /** Remote cover URL from <cover> when it is an URL. */
  coverUrl?: string;
  /** Backdrop/fanart reference from <fanart>. */
  fanartRef?: string;
  /** 首映/发行日期 <premiered>/<releasedate> */
  releaseDate?: string;
  /** 类型/标签 <genre> + <tag> */
  genres?: string[];
  /** 评分 <rating> */
  rating?: string;
  /** 时长分钟 <runtime> */
  runtime?: string;
  /** 导演 <director> */
  director?: string;
  /** 系列 <set><name>/<series> */
  series?: string;
  /** NFO 中声明的图片引用 <poster>/<thumb>/<cover> */
  posterRef?: string;
};

const XML_ENTITY_MAP: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const key = entity.toLowerCase();
    if (key.startsWith('#x')) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (key.startsWith('#')) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return XML_ENTITY_MAP[key] ?? match;
  });
}

/** 去掉 CDATA/标签/控制字符，得到适合展示或二次过滤的纯文本。 */
function cleanNfoText(value: string): string {
  return decodeXmlEntities(String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildTagPattern(tag: string, flags: string): RegExp {
  const escaped = escapeRegExp(tag);
  return new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, flags);
}

function pickInnerFrom(source: string, tag: string): string | undefined {
  const match = source.match(buildTagPattern(tag, 'i'));
  return match?.[1];
}

function pickAllFrom(source: string, tag: string): string[] {
  const re = buildTagPattern(tag, 'gi');
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const value = cleanNfoText(match[1]);
    if (value) out.push(value);
  }
  return out;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = String(value || '').trim();
    if (!text) continue;
    const key = text.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function pickFirst(raw: string, tags: string[]): string | undefined {
  for (const tag of tags) {
    const inner = pickInnerFrom(raw, tag);
    if (inner == null) continue;
    const value = cleanNfoText(inner);
    if (value) return value;
  }
  return undefined;
}

function normalizeYear(value?: string): string | undefined {
  const match = String(value || '').match(/(?:19|20)\d{2}/);
  return match?.[0];
}

function normalizeRuntime(value?: string): string | undefined {
  const text = cleanNfoText(String(value || ''));
  if (!text) return undefined;
  const match = text.match(/\d{1,4}/);
  return match?.[0] || text;
}

function normalizeRating(value?: string): string | undefined {
  const text = cleanNfoText(String(value || ''));
  if (!text) return undefined;
  const match = text.match(/\d+(?:\.\d+)?/);
  return match?.[0] || text;
}

function normalizeTagline(value?: string): string | undefined {
  const text = cleanNfoText(String(value || ''));
  if (!text) return undefined;
  if (/^(?:\u53d1\u884c\u65e5\u671f|\u53d1\u884c\u65e5|release\s*date|released)\s*[\uff1a:=]/i.test(text)) return undefined;
  return text;
}

function normalizeShortText(value?: string, maxLength = 120): string | undefined {
  const text = cleanNfoText(String(value || ''));
  if (!text) return undefined;
  if (text.length > maxLength) return undefined;
  return text;
}

function normalizeUrl(value?: string): string | undefined {
  const text = cleanNfoText(String(value || ''));
  if (!/^https?:\/\//i.test(text)) return undefined;
  return text;
}

function pickNestedRatingValue(raw: string): string | undefined {
  const ratingsInner = pickInnerFrom(raw, 'ratings');
  if (!ratingsInner) return undefined;
  const ratingBlock = pickInnerFrom(ratingsInner, 'rating') || ratingsInner;
  return normalizeRating(pickFirst(ratingBlock, ['value']));
}

function normalizeActorName(value: string): string | undefined {
  const text = cleanNfoText(value);
  if (!text) return undefined;
  if (text.length > 80) return undefined;
  if (/[：:=]/.test(text)) return undefined;
  return text;
}

function normalizeGenreToken(value: string, excludedValues: string[]): string | undefined {
  const text = cleanNfoText(value);
  if (!text) return undefined;
  if (text.length > 24) return undefined;
  if (/[：:=]/.test(text)) return undefined;
  if (/[。.!！？?]/.test(text)) return undefined;
  if (/\s{2,}/.test(text)) return undefined;
  if (/^(?:19|20)\d{2}(?:[-/年]\d{1,2})?/.test(text)) return undefined;
  if (/^(?:JP[-\s]?)?18\+$/i.test(text)) return undefined;
  if (/\.(?:jpg|jpeg|png|webp|gif|nfo|mp4|mkv|avi)$/i.test(text)) return undefined;
  if (/^(?:poster|thumb|fanart|cover)$/i.test(text)) return undefined;
  const normalizedCode = normalizeVideoCodeCandidate(text);
  if (normalizedCode && normalizedCode === text.toUpperCase()) return undefined;
  // 片商/系列短码（390JNT、GARA、736DW 等）不是用户期望看到的类型标签。
  if (/^[a-z]{2,}\d+[a-z0-9]*$/i.test(text)) return undefined;
  if (/^[a-z0-9]{4,}$/i.test(text) && /\d/.test(text) && !/^(?:4k|8k|vr)$/i.test(text)) return undefined;

  const lower = text.toLocaleLowerCase();
  if (excludedValues.some((item) => item && item.toLocaleLowerCase() === lower)) return undefined;
  return text;
}

function splitNfoListText(value: string, excludedValues: string[]): string[] {
  const text = cleanNfoText(value);
  if (!text) return [];
  // 整段简介/说明常带句号、感叹号或很长，不能先按逗号切碎后误判为多个短标签。
  if (text.length > 60 || /[。.!！？?]/.test(text)) return [];
  return text
    .split(/[,，、;；/|]+/g)
    .map((item) => normalizeGenreToken(item, excludedValues))
    .filter((item): item is string => Boolean(item));
}

function parseActorBlocks(raw: string): string[] {
  const out: string[] = [];
  const re = /<actor\b[^>]*>([\s\S]*?)<\/actor>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    const block = match[1];
    const nameInner = pickInnerFrom(block, 'name')
      ?? pickInnerFrom(block, 'displayname')
      ?? pickInnerFrom(block, 'person')
      ?? pickInnerFrom(block, 'value');
    const name = normalizeActorName(nameInner ?? block);
    if (name) out.push(name);
  }
  return uniqueStrings(out);
}

function parseSeries(raw: string): string | undefined {
  const setInner = pickInnerFrom(raw, 'set');
  if (setInner != null) {
    const nestedName = pickInnerFrom(setInner, 'name');
    const value = cleanNfoText(nestedName ?? setInner);
    if (value) return value;
  }
  return pickFirst(raw, ['series']);
}

function parseNum(raw: string, title?: string, originalTitle?: string): string | undefined {
  const direct = pickFirst(raw, ['num', 'id']);
  const uniqueIds = pickAllFrom(raw, 'uniqueid');
  const candidate = direct || uniqueIds.find((item) => normalizeVideoCodeCandidate(item));
  const normalized = normalizeVideoCodeCandidate(candidate || '')
    || normalizeVideoCodeCandidate(originalTitle || '')
    || normalizeVideoCodeCandidate(title || '');
  return normalized || candidate || undefined;
}

/**
 * 从文件夹/文件名中提取番号。
 */
export function parseCodeFromName(name: string): string {
  const text = String(name || '').trim();
  if (!text) return '';
  // 先去扩展名，避免 mp4/nfo 干扰。
  const withoutExt = text.replace(/\.[a-z0-9]{1,5}$/i, '');
  return normalizeVideoCodeCandidate(withoutExt) || normalizeVideoCodeCandidate(text) || '';
}

/**
 * 条目番号优先级：文件夹名 > 视频文件名 > nfo 文件名。
 */
export function resolveEntryCode(params: {
  folderName?: string;
  videoFileName?: string;
  nfoFileName?: string;
}): { code: string; source: 'folder' | 'video' | 'nfo' | 'none' } {
  const folderCode = parseCodeFromName(params.folderName || '');
  if (folderCode) return { code: folderCode, source: 'folder' };
  const videoCode = parseCodeFromName(params.videoFileName || '');
  if (videoCode) return { code: videoCode, source: 'video' };
  const nfoCode = parseCodeFromName(params.nfoFileName || '');
  if (nfoCode) return { code: nfoCode, source: 'nfo' };
  return { code: '', source: 'none' };
}

/**
 * 解析 Kodi/Emby 常见 NFO 字段，并收紧 genre/tag，避免把整段简介或 key-value 行塞进“类别”。
 */
export function parseNfoSummary(text: string | null | undefined): ParsedNfoSummary | undefined {
  const raw = String(text || '').trim();
  if (!raw) return undefined;

  const originalTitle = pickFirst(raw, ['originaltitle', 'localtitle']);
  const title = pickFirst(raw, ['title']) || originalTitle;
  const tagline = normalizeTagline(pickFirst(raw, ['tagline']));
  const plot = pickFirst(raw, ['plot', 'outline', 'description']);
  const releaseDate = pickFirst(raw, ['premiered', 'releasedate', 'release', 'released']);
  const year = normalizeYear(pickFirst(raw, ['year']) || releaseDate);
  const num = parseNum(raw, title, originalTitle);
  const productionValues = uniqueStrings([
    ...pickAllFrom(raw, 'studio'),
    ...pickAllFrom(raw, 'maker'),
    ...pickAllFrom(raw, 'producer'),
  ]);
  const studio = productionValues[0];
  const publisherValues = uniqueStrings([
    ...pickAllFrom(raw, 'publisher'),
    ...pickAllFrom(raw, 'label'),
  ]);
  const publisher = publisherValues[0];
  const countryCode = normalizeShortText(pickFirst(raw, ['countrycode', 'country']), 24);
  const contentRating = normalizeShortText(pickFirst(raw, ['customrating', 'mpaa', 'certification']), 32);
  const website = normalizeUrl(pickFirst(raw, ['website', 'homepage']));
  const rating = pickNestedRatingValue(raw) || normalizeRating(pickFirst(raw, ['rating', 'criticrating']));
  const runtime = normalizeRuntime(pickFirst(raw, ['runtime']));
  const director = pickFirst(raw, ['director']);
  const posterRef = pickFirst(raw, ['poster', 'thumb']);
  const rawCover = pickFirst(raw, ['cover']);
  const coverUrl = normalizeUrl(rawCover);
  const fanartRef = pickFirst(raw, ['fanart']);
  const actors = parseActorBlocks(raw);
  const series = parseSeries(raw);

  const excludedGenreValues = uniqueStrings([
    title,
    originalTitle,
    tagline,
    plot,
    releaseDate,
    year,
    num,
    rating,
    runtime,
    director,
    series,
    posterRef,
    rawCover,
    fanartRef,
    countryCode,
    contentRating,
    website,
    ...productionValues,
    ...publisherValues,
    ...actors,
  ]);
  const genres = uniqueStrings([
    ...pickAllFrom(raw, 'tag').flatMap((item) => splitNfoListText(item, excludedGenreValues)),
    ...pickAllFrom(raw, 'genre').flatMap((item) => splitNfoListText(item, excludedGenreValues)),
  ]);

  const hasAny =
    title || originalTitle || tagline || plot || year || num || studio || publisher || countryCode || contentRating ||
    website || coverUrl || releaseDate || rating || runtime || director || series || posterRef || fanartRef ||
    actors.length || genres.length;
  if (!hasAny) return undefined;

  return {
    schemaVersion: NFO_SUMMARY_SCHEMA_VERSION,
    title,
    originalTitle,
    tagline,
    plot,
    year,
    num,
    actors: actors.length ? actors : undefined,
    studio,
    publisher,
    countryCode,
    contentRating,
    website,
    coverUrl,
    releaseDate,
    genres: genres.length ? genres : undefined,
    rating,
    runtime,
    director,
    series,
    posterRef,
    fanartRef,
  };
}

/**
 * 展示标题：优先 NFO 标题，其次番号，否则文件夹名/文件名。
 */
export function resolveEntryTitle(params: {
  code?: string;
  folderName?: string;
  videoFileName?: string;
  nfoTitle?: string;
}): string {
  const nfoTitle = String(params.nfoTitle || '').trim();
  if (nfoTitle) return nfoTitle;
  const code = String(params.code || '').trim();
  if (code) return code;
  const folder = String(params.folderName || '').trim();
  if (folder) return folder;
  const video = String(params.videoFileName || '').trim();
  return video || '未命名';
}
