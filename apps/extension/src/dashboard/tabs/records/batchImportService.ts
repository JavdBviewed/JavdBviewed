import type { VideoRecord } from '../../../types';
import { buildImportedRecord } from './batchImportModel';

export type BatchImportMode = 'search-import' | 'search-only' | 'direct-import';
export type BatchImportResultStatus = 'matched' | 'imported' | 'existing' | 'placeholder' | 'not-found' | 'failed';

export interface BatchImportMatch {
  href: string;
  title: string;
}

export type BatchImportMetadata = Pick<
  VideoRecord,
  'title' | 'releaseDate' | 'javdbUrl' | 'javdbImage' | 'coverImage' | 'tags' | 'actors' | 'genres' | 'categories' | 'duration' | 'director' | 'maker' | 'publisher' | 'series' | 'rating' | 'ratingCount'
>;

export interface BatchImportDependencies {
  findExactMatch: (code: string) => Promise<BatchImportMatch | null>;
  fetchMatchMetadata: (match: BatchImportMatch, code: string) => Promise<BatchImportMetadata>;
  getRecord: (code: string) => Promise<VideoRecord | undefined>;
  putRecord: (record: VideoRecord) => Promise<unknown>;
  now?: () => number;
}

export interface BatchImportResult {
  code: string;
  status: BatchImportResultStatus;
  title?: string;
  match?: BatchImportMatch;
  error?: string;
}

const SCRAPED_FIELDS: Array<keyof BatchImportMetadata> = [
  'title',
  'releaseDate',
  'javdbUrl',
  'javdbImage',
  'coverImage',
  'tags',
  'actors',
  'genres',
  'categories',
  'duration',
  'director',
  'maker',
  'publisher',
  'series',
  'rating',
  'ratingCount',
];

function applyScrapedMetadata(record: VideoRecord, metadata: BatchImportMetadata, match: BatchImportMatch): VideoRecord {
  const next: VideoRecord = { ...record };
  SCRAPED_FIELDS.forEach((field) => {
    const value = metadata[field];
    if (value === undefined || value === null) return;
    if (Array.isArray(value) && value.length === 0) return;
    (next as unknown as Record<string, unknown>)[field] = value;
  });

  next.javdbUrl = next.javdbUrl || match.href;
  next.title = String(next.title || match.title || next.id);
  return next;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error || '处理失败');
}

export async function processBatchImportItem(
  code: string,
  mode: BatchImportMode,
  userTags: string[],
  dependencies: BatchImportDependencies,
): Promise<BatchImportResult> {
  const normalizedCode = code.trim().toUpperCase();

  try {
    if (mode === 'direct-import') {
      const existing = await dependencies.getRecord(normalizedCode);
      const record = buildImportedRecord(existing, {
        code: normalizedCode,
        isFavorite: true,
        userTags,
        now: dependencies.now?.(),
      });
      await dependencies.putRecord(record);
      return {
        code: normalizedCode,
        status: existing ? 'existing' : 'placeholder',
        title: record.title,
      };
    }

    const match = await dependencies.findExactMatch(normalizedCode);
    if (!match) {
      if (mode === 'search-only') return { code: normalizedCode, status: 'not-found' };

      const existing = await dependencies.getRecord(normalizedCode);
      const record = buildImportedRecord(existing, {
        code: normalizedCode,
        isFavorite: true,
        userTags,
        now: dependencies.now?.(),
      });
      await dependencies.putRecord(record);
      return { code: normalizedCode, status: 'placeholder', title: record.title };
    }

    if (mode === 'search-only') {
      return { code: normalizedCode, status: 'matched', title: match.title, match };
    }

    const existing = await dependencies.getRecord(normalizedCode);
    const base = buildImportedRecord(existing, {
      code: normalizedCode,
      title: match.title,
      isFavorite: true,
      userTags,
      now: dependencies.now?.(),
    });
    const metadata = await dependencies.fetchMatchMetadata(match, normalizedCode);
    const record = applyScrapedMetadata(base, metadata, match);
    await dependencies.putRecord(record);

    return {
      code: normalizedCode,
      status: existing ? 'imported' : 'imported',
      title: record.title,
      match,
    };
  } catch (error) {
    return {
      code: normalizedCode,
      status: 'failed',
      error: getErrorMessage(error),
    };
  }
}
