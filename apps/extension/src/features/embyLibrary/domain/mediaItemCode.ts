import { extractVideoCodesFromText } from '../../../shared/utils/videoCodeExtractor';
import type { EmbyMediaItem } from '../types';

type MediaCodeResult = { kind: 'matched'; code: string } | { kind: 'unrecognized' | 'ambiguous' };

const VIDEO_EXTENSION = /\.(?:mp4|mkv|avi|wmv|mov|m4v|ts|m2ts|webm|mpg|mpeg|strm|iso)$/i;
// Only separated file annotations are removable. Preserve code suffix letters and numeric episodes.
const FILE_ANNOTATIONS = /([0-9][a-z]{0,3})(?:[-_](?:UC|CHS|CHT|CH|C|U|4K|1080P|720P|CD\d+))+(?=$|[\s.\[\(])/gi;

function candidates(values: string[]): MediaCodeResult {
  const codes = new Set<string>();
  for (const value of values) {
    const text = value.replace(VIDEO_EXTENSION, '').replace(FILE_ANNOTATIONS, '$1');
    for (const candidate of extractVideoCodesFromText(text)) codes.add(candidate.normalized);
    // Preserve existing explicit short codes without accepting arbitrary numeric filenames.
    for (const match of text.matchAll(/(?<![A-Z0-9])([A-Z]{2,8})[-_](\d[A-Z]{0,3})(?![-_A-Z0-9])/gi)) {
      if (!/^(THE|THIS|WHAT|WITH|MOVIE|VIDEO|SAMPLE)$/i.test(match[1])) codes.add(`${match[1].toUpperCase()}-${match[2].toUpperCase()}`);
    }
  }
  if (codes.size > 1) return { kind: 'ambiguous' };
  const code = codes.values().next().value;
  return code ? { kind: 'matched', code } : { kind: 'unrecognized' };
}

function pathParts(raw: string): string[] {
  let path = raw;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    try { path = new URL(path).pathname; } catch { return []; }
  }
  return path.replace(/\\/g, '/').split('/').filter(Boolean).map(part => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
}

/** Prefer filenames, then the title, then direct parents. Never choose among conflicting peers. */
export function resolveMediaItemCode(item: EmbyMediaItem): MediaCodeResult {
  const paths = [item.Path, ...(Array.isArray(item.MediaSources) ? item.MediaSources.map(source => source?.Path) : [])]
    .filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
    .map(pathParts);
  const files = candidates(paths.map(parts => parts.at(-1) || ''));
  if (files.kind !== 'unrecognized') return files;
  const title = candidates([typeof item.Name === 'string' ? item.Name : '']);
  if (title.kind !== 'unrecognized') return title;
  return candidates(paths.map(parts => parts.at(-2) || ''));
}
