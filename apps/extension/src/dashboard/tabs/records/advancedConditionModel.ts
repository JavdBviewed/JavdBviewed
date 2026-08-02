import type { VideoRecord } from '../../../types';

export type RecordsAdvancedFieldKey =
  | 'id'
  | 'title'
  | 'status'
  | 'tags'
  | 'releaseDate'
  | 'createdAt'
  | 'updatedAt'
  | 'rating'
  | 'userRating'
  | 'javdbUrl'
  | 'javdbImage';

export type RecordsAdvancedComparator =
  | 'contains'
  | 'equals'
  | 'starts_with'
  | 'ends_with'
  | 'empty'
  | 'not_empty'
  | 'eq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'includes'
  | 'includes_all'
  | 'includes_any'
  | 'length_eq'
  | 'length_gt'
  | 'length_gte'
  | 'length_lt';

export interface RecordsAdvancedCondition {
  id: string;
  field: RecordsAdvancedFieldKey;
  op: RecordsAdvancedComparator;
  value?: string;
}

function getRecordAdvancedField(record: VideoRecord, key: RecordsAdvancedFieldKey): unknown {
  switch (key) {
    case 'id': return record.id ?? '';
    case 'title': return record.title ?? '';
    case 'status': return record.status ?? '';
    case 'tags': return Array.isArray(record.tags) ? record.tags : [];
    case 'releaseDate': return record.releaseDate ?? '';
    case 'createdAt': return record.createdAt;
    case 'updatedAt': return record.updatedAt;
    case 'rating': return record.rating;
    case 'userRating': return record.userRating;
    case 'javdbUrl': return record.javdbUrl ?? '';
    case 'javdbImage': return record.javdbImage ?? '';
  }
}

function isEmptyAdvancedValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

function isRatingField(field: RecordsAdvancedFieldKey): boolean {
  return field === 'rating' || field === 'userRating';
}

function isRatedScore(value: unknown): boolean {
  const score = Number(value);
  return Number.isFinite(score) && score > 0;
}

const TEXT_FIELDS = new Set<RecordsAdvancedFieldKey>([
  'id',
  'title',
  'status',
  'releaseDate',
  'javdbUrl',
  'javdbImage',
]);

export function evaluateRecordsAdvancedCondition(record: VideoRecord, condition: RecordsAdvancedCondition): boolean {
  const value = getRecordAdvancedField(record, condition.field);
  const compareValue = condition.value ?? '';

  if (condition.op === 'empty') {
    return isRatingField(condition.field) ? !isRatedScore(value) : isEmptyAdvancedValue(value);
  }
  if (condition.op === 'not_empty') {
    return isRatingField(condition.field) ? isRatedScore(value) : !isEmptyAdvancedValue(value);
  }

  if (TEXT_FIELDS.has(condition.field)) {
    const source = String(value).toLowerCase();
    const expected = String(compareValue).toLowerCase();
    switch (condition.op) {
      case 'contains': return source.includes(expected);
      case 'equals': return source === expected;
      case 'starts_with': return source.startsWith(expected);
      case 'ends_with': return source.endsWith(expected);
      default: return true;
    }
  }

  if (condition.field === 'createdAt' || condition.field === 'updatedAt') {
    const source = Number(value);
    const expected = Number(compareValue);
    if (Number.isNaN(source)) return false;
    switch (condition.op) {
      case 'eq': return source === expected;
      case 'gt': return source > expected;
      case 'gte': return source >= expected;
      case 'lt': return source < expected;
      case 'lte': return source <= expected;
      default: return true;
    }
  }

  if (isRatingField(condition.field)) {
    if (!isRatedScore(value)) return false;
    const source = Number(value);
    const expected = Number(compareValue);
    if (Number.isNaN(expected)) return false;
    switch (condition.op) {
      case 'eq': return source === expected;
      case 'gt': return source > expected;
      case 'gte': return source >= expected;
      case 'lt': return source < expected;
      case 'lte': return source <= expected;
      default: return true;
    }
  }

  if (condition.field === 'tags') {
    const tags = Array.isArray(value) ? value.map((item) => String(item)) : [];
    const tagsLower = tags.map((tag) => tag.toLowerCase());
    const tokens = String(compareValue || '')
      .split(/[，,;；\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => item.toLowerCase());

    switch (condition.op) {
      case 'includes_all':
        return tokens.length === 0 ? false : tokens.every((token) => tagsLower.some((tag) => tag.includes(token)));
      case 'includes_any':
        return tokens.length === 0 ? false : tokens.some((token) => tagsLower.some((tag) => tag.includes(token)));
      case 'includes':
        return compareValue ? tags.includes(compareValue) : false;
      case 'length_eq': return tags.length === Number(compareValue || 0);
      case 'length_gt': return tags.length > Number(compareValue || 0);
      case 'length_gte': return tags.length >= Number(compareValue || 0);
      case 'length_lt': return tags.length < Number(compareValue || 0);
      default: return true;
    }
  }

  return true;
}
