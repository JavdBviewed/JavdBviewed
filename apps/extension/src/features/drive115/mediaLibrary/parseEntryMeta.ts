/**
 * @file parseEntryMeta.ts
 * @description 番号解析与最小 NFO 文本摘要
 * @module features/drive115/mediaLibrary
 */
import { normalizeVideoCodeCandidate } from '../../../shared/utils/videoCodeExtractor';

export type ParsedNfoSummary = {
  title?: string;
  plot?: string;
  year?: string;
  /** 番号 <num> */
  num?: string;
  /** 演员名（<actor><name>） */
  actors?: string[];
  /** 制作商/发行商 <studio>/<maker>/<label> */
  studio?: string;
  /** 发行/首映日期 <premiered>/<releasedate> */
  releaseDate?: string;
  /** 类别/标签 <genre>+<tag> */
  genres?: string[];
  /** 评分 <rating> */
  rating?: string;
  /** 时长（分钟）<runtime> */
  runtime?: string;
  /** 导演 <director> */
  director?: string;
  /** 系列 <set><name>/<series> */
  series?: string;
  /** 封面引用文件名 <poster>/<thumb>/<cover> */
  posterRef?: string;
};

/**
 * 从单个名称提取规范化番号
 */
export function parseCodeFromName(name: string): string {
  const text = String(name || '').trim();
  if (!text) return '';
  // 去掉扩展名再解析
  const withoutExt = text.replace(/\.[a-z0-9]{1,5}$/i, '');
  return normalizeVideoCodeCandidate(withoutExt) || normalizeVideoCodeCandidate(text) || '';
}

/**
 * 按优先级解析番号：文件夹名 → 主视频文件名 → nfo 文件名
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

/** 去 CDATA 包裹并去除残留 XML 标签，返回纯文本 */
function cleanNfoText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Kodi/Emby 风格 NFO 解析：抽取标题/简介/年份 + JAV 常见字段（番号/演员/制作商/日期/类别/评分/时长/系列/封面引用）。
 * 网盘 NFO 需扩展自行解析（Emby 由服务器返回，115 无此能力）。
 */
export function parseNfoSummary(text: string | null | undefined): ParsedNfoSummary | undefined {
  const raw = String(text || '').trim();
  if (!raw) return undefined;

  // 取首个匹配标签的内层原文（未清洗，供需要进一步解析的块使用）
  const pickInner = (tag: string): string | undefined => {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
    const m = raw.match(re);
    return m?.[1];
  };
  // 取首个标签的纯文本
  const pickTag = (tag: string): string | undefined => {
    const inner = pickInner(tag);
    if (inner == null) return undefined;
    const value = cleanNfoText(inner);
    return value || undefined;
  };
  // 取所有同名标签的纯文本
  const pickAll = (tag: string): string[] => {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      const value = cleanNfoText(m[1]);
      if (value) out.push(value);
    }
    return out;
  };

  const title = pickTag('title') || pickTag('originaltitle');
  const plot = pickTag('plot') || pickTag('outline') || pickTag('description');
  const releaseDate = pickTag('premiered') || pickTag('releasedate') || pickTag('release');
  const year = pickTag('year') || releaseDate?.slice(0, 4);
  const num = pickTag('num');
  const studio = pickTag('studio') || pickTag('maker') || pickTag('label');
  const rating = pickTag('rating') || pickTag('criticrating');
  const runtime = pickTag('runtime');
  const director = pickTag('director');
  const posterRef = pickTag('poster') || pickTag('thumb') || pickTag('cover');

  // 演员：每个 <actor> 优先取 <name>，否则整块纯文本
  const actorBlocks = (() => {
    const re = /<actor[^>]*>([\s\S]*?)<\/actor>/gi;
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      const nameMatch = m[1].match(/<name[^>]*>([\s\S]*?)<\/name>/i);
      const name = cleanNfoText(nameMatch?.[1] ?? m[1]);
      if (name) out.push(name);
    }
    return Array.from(new Set(out));
  })();

  // 系列：<set> 内可能嵌套 <name>
  const setInner = pickInner('set');
  const series = setInner
    ? cleanNfoText(setInner.match(/<name[^>]*>([\s\S]*?)<\/name>/i)?.[1] ?? setInner) || undefined
    : pickTag('series');

  const genres = Array.from(new Set([...pickAll('genre'), ...pickAll('tag')]));

  const hasAny =
    title || plot || year || num || studio || releaseDate || rating || runtime ||
    director || series || posterRef || actorBlocks.length || genres.length;
  if (!hasAny) return undefined;

  return {
    title,
    plot,
    year,
    num,
    actors: actorBlocks.length ? actorBlocks : undefined,
    studio,
    releaseDate,
    genres: genres.length ? genres : undefined,
    rating,
    runtime,
    director,
    series,
    posterRef,
  };
}

/**
 * 展示标题：优先番号，否则文件夹名/文件名
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
