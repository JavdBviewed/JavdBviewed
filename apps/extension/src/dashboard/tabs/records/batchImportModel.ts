import type { VideoRecord } from '../../../types';

export type BatchImportItemStatus = 'ready' | 'duplicate' | 'invalid';

export interface BatchImportNumberItem {
  code: string;
  sourceText: string;
  status: BatchImportItemStatus;
}

export interface BuildImportedRecordOptions {
  code: string;
  title?: string;
  isFavorite?: boolean;
  userTags?: string[];
  now?: number;
}

function canonicalizeCode(value: string): string {
  const normalized = String(value || '')
    .normalize('NFKC')
    .trim()
    .toUpperCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const compact = normalized.replace(/-/g, '');
  const compactMatch = compact.match(/^([A-Z]+)(\d+)$/);
  if (compactMatch) return `${compactMatch[1]}-${compactMatch[2]}`;

  return normalized;
}

function isLikelyVideoCode(code: string): boolean {
  return /^[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(code) && /[A-Z]/.test(code) && /\d/.test(code);
}

export function normalizeBatchNumbers(input: string): BatchImportNumberItem[] {
  const seen = new Set<string>();
  return String(input || '')
    .split(/[\r\n,，;；]+/)
    .map((sourceText) => sourceText.trim())
    .filter(Boolean)
    .map((sourceText) => {
      const code = canonicalizeCode(sourceText);
      if (!isLikelyVideoCode(code)) return { code: '', sourceText, status: 'invalid' as const };
      if (seen.has(code)) return { code, sourceText, status: 'duplicate' as const };
      seen.add(code);
      return { code, sourceText, status: 'ready' as const };
    });
}

export function mergeUserTags(existing: string[] | undefined, additions: string[] | undefined): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  [...(existing || []), ...(additions || [])].forEach((value) => {
    const tag = String(value || '').trim();
    if (!tag || seen.has(tag)) return;
    seen.add(tag);
    result.push(tag);
  });
  return result;
}

export function buildImportedRecord(
  existing: VideoRecord | undefined,
  options: BuildImportedRecordOptions,
): VideoRecord {
  const now = options.now ?? Date.now();
  const code = options.code.trim();
  const title = options.title?.trim() || existing?.title || code;

  return {
    ...(existing || {}),
    id: code,
    title,
    status: existing?.status || 'browsed',
    tags: existing?.tags,
    userTags: mergeUserTags(existing?.userTags, options.userTags),
    isFavorite: options.isFavorite ?? existing?.isFavorite,
    favoritedAt: options.isFavorite && !existing?.isFavorite
      ? now
      : existing?.favoritedAt,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}
