import { describe, expect, it } from 'vitest';
import type { VideoRecord } from '../../../types';
import { evaluateRecordsAdvancedCondition } from './advancedConditionModel';

const baseRecord: VideoRecord = {
  id: 'MKMP-577',
  title: '测试标题',
  status: 'viewed',
  tags: ['中文字幕', '高清'],
  createdAt: 1000,
  updatedAt: 2000,
  releaseDate: '2026-05-27',
  javdbUrl: 'https://javdb.com/v/test',
  javdbImage: '',
};

describe('records advanced condition model', () => {
  it('evaluates text field comparators', () => {
    expect(evaluateRecordsAdvancedCondition(baseRecord, { id: 'c1', field: 'id', op: 'contains', value: 'mkmp' })).toBe(true);
    expect(evaluateRecordsAdvancedCondition(baseRecord, { id: 'c2', field: 'title', op: 'starts_with', value: '测试' })).toBe(true);
    expect(evaluateRecordsAdvancedCondition(baseRecord, { id: 'c3', field: 'releaseDate', op: 'ends_with', value: '27' })).toBe(true);
  });

  it('evaluates timestamp comparators', () => {
    expect(evaluateRecordsAdvancedCondition(baseRecord, { id: 'c1', field: 'createdAt', op: 'gte', value: '1000' })).toBe(true);
    expect(evaluateRecordsAdvancedCondition(baseRecord, { id: 'c2', field: 'updatedAt', op: 'lt', value: '2000' })).toBe(false);
  });

  it('evaluates official and personal rating comparators', () => {
    const rated = { ...baseRecord, rating: 8.5, userRating: 4 };
    expect(evaluateRecordsAdvancedCondition(rated, { id: 'c1', field: 'rating', op: 'gte', value: '8' })).toBe(true);
    expect(evaluateRecordsAdvancedCondition(rated, { id: 'c2', field: 'rating', op: 'lt', value: '9' })).toBe(true);
    expect(evaluateRecordsAdvancedCondition(rated, { id: 'c3', field: 'userRating', op: 'eq', value: '4' })).toBe(true);
    expect(evaluateRecordsAdvancedCondition(rated, { id: 'c4', field: 'userRating', op: 'gt', value: '4' })).toBe(false);
  });

  it('treats zero, null, and undefined ratings as unrated', () => {
    expect(evaluateRecordsAdvancedCondition({ ...baseRecord, rating: 0 }, { id: 'c1', field: 'rating', op: 'empty' })).toBe(true);
    expect(evaluateRecordsAdvancedCondition({ ...baseRecord, userRating: undefined }, { id: 'c2', field: 'userRating', op: 'empty' })).toBe(true);
    expect(evaluateRecordsAdvancedCondition({ ...baseRecord, rating: null as unknown as number }, { id: 'c3', field: 'rating', op: 'empty' })).toBe(true);
    expect(evaluateRecordsAdvancedCondition({ ...baseRecord, rating: 0 }, { id: 'c4', field: 'rating', op: 'not_empty' })).toBe(false);
    expect(evaluateRecordsAdvancedCondition({ ...baseRecord, rating: 0 }, { id: 'c5', field: 'rating', op: 'gte', value: '0' })).toBe(false);
    expect(evaluateRecordsAdvancedCondition({ ...baseRecord, rating: undefined }, { id: 'c6', field: 'rating', op: 'eq', value: '8' })).toBe(false);
  });

  it('evaluates tag inclusion and length comparators', () => {
    expect(evaluateRecordsAdvancedCondition(baseRecord, { id: 'c1', field: 'tags', op: 'includes_all', value: '中文 高清' })).toBe(true);
    expect(evaluateRecordsAdvancedCondition(baseRecord, { id: 'c2', field: 'tags', op: 'includes_any', value: '蓝光,高清' })).toBe(true);
    expect(evaluateRecordsAdvancedCondition(baseRecord, { id: 'c3', field: 'tags', op: 'includes', value: '高清' })).toBe(true);
    expect(evaluateRecordsAdvancedCondition(baseRecord, { id: 'c4', field: 'tags', op: 'length_gte', value: '2' })).toBe(true);
  });

  it('evaluates empty and not empty for scalar and array fields', () => {
    expect(evaluateRecordsAdvancedCondition({ ...baseRecord, tags: [] }, { id: 'c1', field: 'tags', op: 'empty' })).toBe(true);
    expect(evaluateRecordsAdvancedCondition(baseRecord, { id: 'c2', field: 'javdbUrl', op: 'not_empty' })).toBe(true);
  });
});
