/**
 * @file defaultTagsSelection.test.ts
 * @description 演员页默认过滤条件归一/拆分/URL 参数纯函数单测
 * （08-29-actor-passthrough-category-filter P2：旧数组混排 → { t, categories } 迁移）。
 * @module features/actorEnhancement
 */
import { describe, expect, it } from 'vitest';
import {
  ACTOR_T_TAG_CODES,
  actorTagOptionLabel,
  buildActorCategoryUrlParams,
  normalizeActorDefaultTags,
  splitTagValues,
} from './defaultTagsSelection';

describe('normalizeActorDefaultTags', () => {
  it('旧混排数组：t 码与裸类别 id 拆分，未知丢弃', () => {
    const r = normalizeActorDefaultTags(['s', 'd', '17', '4k', '999999']);
    expect(r.t).toEqual(['s', 'd', '4k']);
    expect(r.categories).toEqual(['c4=17']);
    expect(r.dropped).toEqual(['999999']);
  });

  it('裸数字 id 跨维度反查归一', () => {
    expect(normalizeActorDefaultTags(['28']).categories).toEqual(['c7=28']);
    expect(normalizeActorDefaultTags(['157']).categories).toEqual(['c1=157']);
  });

  it('对象形（新存储形）净化两数组', () => {
    const r = normalizeActorDefaultTags({ t: ['s', 'x'], categories: ['c4=17', 'c6=93', 'bogus'] });
    expect(r.t).toEqual(['s']);
    expect(r.categories).toEqual(['c4=17', 'c6=93']);
    expect(r.dropped).toEqual(['x', 'bogus']);
  });

  it('缺失 → 默认 s+d、类别空、无丢弃', () => {
    expect(normalizeActorDefaultTags(undefined)).toEqual({ t: ['s', 'd'], categories: [], dropped: [] });
    expect(normalizeActorDefaultTags(null)).toEqual({ t: ['s', 'd'], categories: [], dropped: [] });
  });

  it('显式 [] = 无默认（对齐旧 truthy 语义）', () => {
    expect(normalizeActorDefaultTags([])).toEqual({ t: [], categories: [], dropped: [] });
  });

  it('非法形式 → 默认值', () => {
    expect(normalizeActorDefaultTags('not-array').t).toEqual(['s', 'd']);
    expect(normalizeActorDefaultTags(42).categories).toEqual([]);
  });

  it('对象形但字段非数组 → 双空（显式对象优先于默认）', () => {
    const r = normalizeActorDefaultTags({ t: 's', categories: 'x' });
    expect(r.t).toEqual([]);
    expect(r.categories).toEqual([]);
    expect(r.dropped).toEqual([]);
  });

  it('去重：t 码去重；entryKey 与同维度裸 id 互认', () => {
    const r = normalizeActorDefaultTags(['s', 's', 'c4=17', '17']);
    expect(r.t).toEqual(['s']);
    expect(r.categories).toEqual(['c4=17']);
  });
});

describe('ACTOR_T_TAG_CODES', () => {
  it('= basic + quality 两组（6 项，不含类别维度）', () => {
    expect(ACTOR_T_TAG_CODES).toEqual(['s', 'p', 'd', 'c', '4k', 'uncensored']);
  });
});

describe('splitTagValues', () => {
  it('与 normalizeActorDefaultTags 数组分支等价', () => {
    expect(splitTagValues(['s', '17'])).toEqual(normalizeActorDefaultTags(['s', '17']));
  });
});

describe('actorTagOptionLabel', () => {
  it('t 码显示名', () => {
    expect(actorTagOptionLabel('s')).toBe('单体作品');
    expect(actorTagOptionLabel('4k')).toBe('4K');
  });

  it('entryKey 显示名（字典内）', () => {
    expect(actorTagOptionLabel('c4=17')).toBe('巨乳');
    expect(actorTagOptionLabel('c6=93')).toBe('拘束');
  });

  it('裸数字 id 反查显示名', () => {
    expect(actorTagOptionLabel('28')).toBe('單體作品');
  });

  it('未知值原样返回', () => {
    expect(actorTagOptionLabel('zzz')).toBe('zzz');
    expect(actorTagOptionLabel('')).toBe('');
  });
});

describe('buildActorCategoryUrlParams', () => {
  it('t 码校验去重；c1/c4/c7 按维度分组（多值逗号由调用方 join）', () => {
    const r = buildActorCategoryUrlParams(['s', '4k', 'zzz', 's'], ['c1=157', 'c4=17', 'c7=28', 'c4=17']);
    expect(r.t).toEqual(['s', '4k']);
    expect(r.byDim).toEqual({ c1: ['157'], c4: ['17'], c7: ['28'] });
    expect(r.excluded).toEqual([]);
  });

  it('未验证维度（c2/c6）进 excluded、不拼 URL', () => {
    const r = buildActorCategoryUrlParams([], ['c6=93', 'c2=20']);
    expect(r.byDim).toEqual({});
    expect(r.excluded).toEqual(['c6=93', 'c2=20']);
  });

  it('字典外值进 excluded', () => {
    const r = buildActorCategoryUrlParams([], ['999999', 'c4=999999']);
    expect(r.byDim).toEqual({});
    expect(r.excluded).toEqual(['999999', 'c4=999999']);
  });

  it('双空输入', () => {
    expect(buildActorCategoryUrlParams([], [])).toEqual({ t: [], byDim: {}, excluded: [] });
  });
});
