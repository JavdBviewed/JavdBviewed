/**
 * @vitest-environment jsdom
 * @file listHiding.test.ts
 * @description 列表隐藏来源标记单测：新增 category（类别黑名单）来源的
 * 重算/恢复/开关读取语义（08-29-actor-passthrough-category-filter P1）。
 * @module features/list-hiding
 */
import { describe, expect, it } from 'vitest';
import {
  clearHidingSources,
  computeEffectiveHiding,
  getActiveHidingSources,
  isCategoryFilterExemptPage,
  isStatusAggregatePage,
  recomputeListHiding,
  readListHidingEnablement,
  setHidingSource,
  type ListHidingEnablement,
} from './listHiding';

const FULL_ON: ListHidingEnablement = {
  viewed: false,
  browsed: false,
  want: false,
  vr: false,
  actor: false,
  category: true,
};

function makeItem(): HTMLElement {
  const item = document.createElement('div');
  item.className = 'item';
  document.body.appendChild(item);
  return item;
}

describe('category hiding source', () => {
  it('category 标记 + 开关开启 → 隐藏且 data-hide-reason 含 CATEGORY_BLACKLIST', () => {
    const item = makeItem();
    setHidingSource(item, 'category', true);
    const effective = recomputeListHiding(item, FULL_ON);
    expect(effective).toEqual(['category']);
    expect(item.style.display).toBe('none');
    expect(item.getAttribute('data-hide-reason')).toBe('CATEGORY_BLACKLIST');
    expect(item.hasAttribute('data-hidden-by-default')).toBe(true);
    document.body.innerHTML = '';
  });

  it('category 标记但开关关闭 → 不隐藏（开关=隐藏生效前提）', () => {
    const item = makeItem();
    setHidingSource(item, 'category', true);
    const effective = recomputeListHiding(item, { ...FULL_ON, category: false });
    expect(effective).toEqual([]);
    expect(item.style.display).not.toBe('none');
    expect(item.hasAttribute('data-hide-reason')).toBe(false);
    document.body.innerHTML = '';
  });

  it('category 与 actor 同时命中 → reason 合并；仅清 category 仍保持隐藏（无半恢复）', () => {
    const item = makeItem();
    setHidingSource(item, 'actor', true);
    setHidingSource(item, 'category', true);
    recomputeListHiding(item, { ...FULL_ON, actor: true });
    expect(item.style.display).toBe('none');
    expect(item.getAttribute('data-hide-reason')).toBe('ACTOR,CATEGORY_BLACKLIST');

    setHidingSource(item, 'category', false);
    recomputeListHiding(item, { ...FULL_ON, actor: true });
    expect(item.style.display).toBe('none');
    expect(item.getAttribute('data-hide-reason')).toBe('ACTOR');

    setHidingSource(item, 'actor', false);
    recomputeListHiding(item, { ...FULL_ON, actor: true });
    expect(item.style.display).not.toBe('none');
    document.body.innerHTML = '';
  });

  it('clearHidingSources 覆盖 category 来源标记', () => {
    const item = makeItem();
    setHidingSource(item, 'category', true);
    setHidingSource(item, 'vr', true);
    expect(getActiveHidingSources(item).sort()).toEqual(['category', 'vr']);
    clearHidingSources(item);
    expect(computeEffectiveHiding(item, { ...FULL_ON, vr: true })).toEqual([]);
    document.body.innerHTML = '';
  });
});

describe('readListHidingEnablement（category 分支）', () => {
  it('enableCategoryFilter=true 且 black 非空 → category=true', () => {
    const e = readListHidingEnablement({
      listEnhancement: { enableCategoryFilter: true, categoryFilter: { black: ['c4=17'] } },
    });
    expect(e.category).toBe(true);
  });

  it('enableCategoryFilter=true 但 black 为空 → category=false（空=不过滤）', () => {
    const e = readListHidingEnablement({
      listEnhancement: { enableCategoryFilter: true, categoryFilter: { black: [] } },
    });
    expect(e.category).toBe(false);
  });

  it('enableCategoryFilter 缺失/关闭 → category=false（默认零变化）', () => {
    expect(readListHidingEnablement({}).category).toBe(false);
    expect(
      readListHidingEnablement({
        listEnhancement: { enableCategoryFilter: false, categoryFilter: { black: ['c7=28'] } },
      }).category,
    ).toBe(false);
  });

  it('black 非数组（脏数据）→ category=false 不抛错', () => {
    const e = readListHidingEnablement({
      listEnhancement: { enableCategoryFilter: true, categoryFilter: { black: 'c4=17' } },
    });
    expect(e.category).toBe(false);
  });
});

describe('页面豁免', () => {
  it('isStatusAggregatePage 命中想看/已看聚合页', () => {
    expect(isStatusAggregatePage('/users/want_watch_videos')).toBe(true);
    expect(isStatusAggregatePage('/users/watched_videos')).toBe(true);
    expect(isStatusAggregatePage('/users/watched_videos?x=1')).toBe(true);
    expect(isStatusAggregatePage('/list')).toBe(false);
  });

  it('isCategoryFilterExemptPage：搜索页或聚合页均豁免', () => {
    expect(isCategoryFilterExemptPage('/search?q=x', true)).toBe(true);
    expect(isCategoryFilterExemptPage('/users/want_watch_videos', false)).toBe(true);
    expect(isCategoryFilterExemptPage('/list', false)).toBe(false);
  });
});
