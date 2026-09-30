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
  migrateCategoryFilterState,
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
  mediaLibrary: false,
  realWatched: false,
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

describe('readListHidingEnablement（category 分支，09-29-cftabs 总开关口径）', () => {
  it('旧键迁移：enableCategoryFilter=true + black 非空 + 穿透开 → category=true', () => {
    const e = readListHidingEnablement({
      listEnhancement: {
        enableActorPenetration: true,
        enableCategoryFilter: true,
        categoryFilter: { black: ['c4=17'] },
      },
    });
    expect(e.category).toBe(true);
  });

  it('显式 enabled=true + black 非空 + 穿透开 → category=true', () => {
    const e = readListHidingEnablement({
      listEnhancement: {
        enableActorPenetration: true,
        categoryFilter: { enabled: true, black: ['c4=17'] },
      },
    });
    expect(e.category).toBe(true);
  });

  it('显式 enabled=false 优先于旧键 true → category=false', () => {
    const e = readListHidingEnablement({
      listEnhancement: {
        enableActorPenetration: true,
        enableCategoryFilter: true,
        categoryFilter: { enabled: false, black: ['c4=17'] },
      },
    });
    expect(e.category).toBe(false);
  });

  it('mode 迁移（无 enabled）：mode=off / whitelist + 穿透开 → category=false', () => {
    expect(
      readListHidingEnablement({
        listEnhancement: {
          enableActorPenetration: true,
          categoryFilter: { mode: 'off', black: ['c4=17'] },
        },
      }).category,
    ).toBe(false);
    expect(
      readListHidingEnablement({
        listEnhancement: {
          enableActorPenetration: true,
          categoryFilter: { mode: 'whitelist', black: ['c4=17'] },
        },
      }).category,
    ).toBe(false);
  });

  it('演员穿透关 → category=false（共同前提，含旧键 true / 显式 enabled true）', () => {
    expect(
      readListHidingEnablement({
        listEnhancement: {
          enableCategoryFilter: true,
          categoryFilter: { black: ['c4=17'] },
        },
      }).category,
    ).toBe(false);
    expect(
      readListHidingEnablement({
        listEnhancement: {
          enableActorPenetration: false,
          categoryFilter: { enabled: true, black: ['c4=17'] },
        },
      }).category,
    ).toBe(false);
  });

  it('black 为空 → category=false（未勾任何类别=无操作）', () => {
    const e = readListHidingEnablement({
      listEnhancement: {
        enableActorPenetration: true,
        categoryFilter: { enabled: true, black: [] },
      },
    });
    expect(e.category).toBe(false);
  });

  it('旧键缺失/关闭且 enabled/mode 缺失 → category=false（默认零变化）', () => {
    expect(readListHidingEnablement({}).category).toBe(false);
    expect(
      readListHidingEnablement({
        listEnhancement: {
          enableActorPenetration: true,
          enableCategoryFilter: false,
          categoryFilter: { black: ['c7=28'] },
        },
      }).category,
    ).toBe(false);
  });

  it('black 非数组（脏数据）→ category=false 不抛错', () => {
    const e = readListHidingEnablement({
      listEnhancement: {
        enableActorPenetration: true,
        enableCategoryFilter: true,
        categoryFilter: { black: 'c4=17' },
      },
    });
    expect(e.category).toBe(false);
  });
});

describe('migrateCategoryFilterState（读时旧数据迁移，09-29-cftabs）', () => {
  it('显式 enabled 布尔 → 照用，black 原样保留（含脏项过滤）', () => {
    expect(migrateCategoryFilterState({
      categoryFilter: { enabled: true, black: ['c4=17', 42, 'c7=28'] },
    })).toEqual({ enabled: true, black: ['c4=17', 'c7=28'] });
    expect(migrateCategoryFilterState({
      enableCategoryFilter: true,
      categoryFilter: { enabled: false, mode: 'whitelist', black: ['c4=17'] },
    })).toEqual({ enabled: false, black: ['c4=17'] });
  });

  it('无 enabled：旧键 true（mode 缺失）→ 开 + black 保留（blacklist 语义等价）', () => {
    expect(migrateCategoryFilterState({
      enableCategoryFilter: true,
      categoryFilter: { black: ['c4=17'] },
    })).toEqual({ enabled: true, black: ['c4=17'] });
  });

  it('无 enabled：mode=whitelist → 关 + black 清空（无法无损映射，重置为关）', () => {
    expect(migrateCategoryFilterState({
      categoryFilter: { mode: 'whitelist', black: ['c1=157', 'c7=28'] },
    })).toEqual({ enabled: false, black: [] });
  });

  it('无 enabled：mode=off / 旧键 false / 全缺失 → 关 + black 保留（零回填口径）', () => {
    expect(migrateCategoryFilterState({
      categoryFilter: { mode: 'off', black: ['c4=17'] },
    })).toEqual({ enabled: false, black: ['c4=17'] });
    expect(migrateCategoryFilterState({
      enableCategoryFilter: false,
      categoryFilter: { black: ['c4=17'] },
    })).toEqual({ enabled: false, black: ['c4=17'] });
    expect(migrateCategoryFilterState(null)).toEqual({ enabled: false, black: [] });
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


describe('mediaLibrary / realWatched 隐藏来源（09-30-media-library-hide-filter）', () => {
  it('mediaLibrary 标记 + 开关开启 → 隐藏且 data-hide-reason=MEDIA_LIBRARY', () => {
    const item = makeItem();
    setHidingSource(item, 'mediaLibrary', true);
    const effective = recomputeListHiding(item, { ...FULL_ON, mediaLibrary: true });
    expect(effective).toEqual(['mediaLibrary']);
    expect(item.style.display).toBe('none');
    expect(item.getAttribute('data-hide-reason')).toBe('MEDIA_LIBRARY');
    document.body.innerHTML = '';
  });

  it('realWatched 标记 + 开关开启 → 隐藏且 data-hide-reason=REAL_WATCHED', () => {
    const item = makeItem();
    setHidingSource(item, 'realWatched', true);
    const effective = recomputeListHiding(item, { ...FULL_ON, realWatched: true });
    expect(effective).toEqual(['realWatched']);
    expect(item.style.display).toBe('none');
    expect(item.getAttribute('data-hide-reason')).toBe('REAL_WATCHED');
    document.body.innerHTML = '';
  });

  it('mediaLibrary+realWatched 同时命中 → reason 合并；标记在、开关关 → 恢复显隐', () => {
    const item = makeItem();
    setHidingSource(item, 'mediaLibrary', true);
    setHidingSource(item, 'realWatched', true);
    const effective = recomputeListHiding(item, {
      ...FULL_ON,
      mediaLibrary: true,
      realWatched: true,
    });
    expect(effective.sort()).toEqual(['mediaLibrary', 'realWatched']);
    expect(item.getAttribute('data-hide-reason').split(',').sort()).toEqual(['MEDIA_LIBRARY', 'REAL_WATCHED']);
    const restored = recomputeListHiding(item, {
      ...FULL_ON,
      mediaLibrary: false,
      realWatched: false,
    });
    expect(restored).toEqual([]);
    expect(item.style.display).not.toBe('none');
    expect(item.hasAttribute('data-hide-reason')).toBe(false);
    document.body.innerHTML = '';
  });

  it('getActiveHidingSources / clearHidingSources 覆盖新来源', () => {
    const item = makeItem();
    setHidingSource(item, 'mediaLibrary', true);
    setHidingSource(item, 'realWatched', true);
    setHidingSource(item, 'viewed', true);
    expect(getActiveHidingSources(item).sort()).toEqual(['mediaLibrary', 'realWatched', 'viewed']);
    clearHidingSources(item);
    expect(getActiveHidingSources(item)).toEqual([]);
    document.body.innerHTML = '';
  });
});

describe('readListHidingEnablement（display 媒体库两开关，09-30-media-library-hide-filter）', () => {
  it('读 display.hideInMediaLibrary / display.hideRealWatched（零回填，缺省 false）', () => {
    const e = readListHidingEnablement({
      display: { hideInMediaLibrary: true, hideRealWatched: true },
    });
    expect(e.mediaLibrary).toBe(true);
    expect(e.realWatched).toBe(true);
  });

  it('缺省 → false（存量设置零变化）；非布尔与既有 viewed 字段同 !! 强转口径', () => {
    expect(readListHidingEnablement({}).mediaLibrary).toBe(false);
    expect(readListHidingEnablement({}).realWatched).toBe(false);
    // 与既有 7 字段同一 !! 强转（零漂移一致性），不单独收紧新字段的布尔口径
    const legacy = readListHidingEnablement({ display: { hideViewed: 'yes' } } as any).viewed;
    const fresh = readListHidingEnablement({ display: { hideInMediaLibrary: 'yes' } } as any).mediaLibrary;
    expect(fresh).toBe(legacy);
  });

  it('媒体库开关与既有来源互不影响', () => {
    const e = readListHidingEnablement({
      display: { hideViewed: true, hideInMediaLibrary: true },
      listEnhancement: { hideBlacklistedActorsInList: true },
    });
    expect(e.viewed).toBe(true);
    expect(e.actor).toBe(true);
    expect(e.mediaLibrary).toBe(true);
    expect(e.realWatched).toBe(false);
    expect(e.category).toBe(false);
  });
});
