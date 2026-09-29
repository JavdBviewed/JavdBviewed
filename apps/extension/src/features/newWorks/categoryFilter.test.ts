/**
 * @file categoryFilter.test.ts
 * @description 新作品类别白名单（URL 侧）+ 黑名单（入库前剔除）纯函数单测
 * （08-29-actor-passthrough-category-filter P3）。
 * 黑名单取详情经 loadDetail 注入（collector=隐藏标签页+页内采集，SW 无 DOMParser），
 * 本测以 raw panels 桩覆盖缓存命中/miss/失败/登录墙/回填各路径。
 * @module features/newWorks
 */
import { describe, expect, it, vi } from 'vitest';
import {
  applyCategoryBlackFilter,
  buildCategoryUrlParams,
  isLegacyUnlimitedCategoryValues,
  looksLikeLoginPage,
  normalizeCategoryBlackValues,
  splitNewWorksFilterValues,
  type RawDetailDocument,
} from './categoryFilter';
import type {
  ActorPenetrationCacheResult,
} from '../listEnhancement/actorPenetration/actorPenetrationCache';
import type { RawDetailPanel } from './categoryFilter';

// ---------- raw panels fixture（结构对齐 collector extractDetailPanelsFunc 产出） ----------
const ACTOR_LINK_1 = {
  href: '/actors/aaaa1111',
  text: '測試女優',
  nextText: null,
  symbolClass: 'symbol female',
  symbolText: '♀',
  linkClass: null,
};

const CAT_PANEL_HIT: RawDetailPanel = {
  label: '類別:',
  tagHrefs: ['/tags?c6=93', '/tags?c4=17'],
  actorLinks: [],
  hasAnyLink: true,
  valueText: null,
};
const CAT_PANEL_EN: RawDetailPanel = {
  label: 'Tags:',
  tagHrefs: ['/tags?c6=93', '/tags?c2=20', '/tags?c6=60', '/tags?c7=28'],
  actorLinks: [],
  hasAnyLink: true,
  valueText: null,
};
const CAT_PANEL_MISS: RawDetailPanel = {
  label: '類別:',
  tagHrefs: ['/tags?c4=17'],
  actorLinks: [],
  hasAnyLink: true,
  valueText: null,
};
const ACTOR_PANEL: RawDetailPanel = {
  label: '演員:',
  tagHrefs: [],
  actorLinks: [ACTOR_LINK_1],
  hasAnyLink: true,
  valueText: null,
};
/** 顶部年龄验证面板（含 /tags?c 快链：必须被面板标签判定排除，不能当类别） */
const AGE_VERIFY_PANEL: RawDetailPanel = {
  label: 'Are you at least 18 years old?',
  tagHrefs: ['/tags?c10=1', '/tags?c4=17'],
  actorLinks: [],
  hasAnyLink: true,
  valueText: null,
};

const WORK_HIT = { id: 'BDSM-091', javdbId: 'Mb0WXv', title: 'BDSM-091 测试' };

interface StubBag {
  readCache: ReturnType<typeof vi.fn>;
  writeSuccess: ReturnType<typeof vi.fn>;
  writeFailure: ReturnType<typeof vi.fn>;
  writeLoginRequired: ReturnType<typeof vi.fn>;
  loadDetail: ReturnType<typeof vi.fn>;
  delay: ReturnType<typeof vi.fn>;
  decisions: Array<{ id: string; categories: string[] | null; removed: boolean }>;
  deps: Record<string, unknown>;
}

function makeStubs(
  cache: Record<string, ActorPenetrationCacheResult>,
  rawDoc?: RawDetailDocument | null,
): StubBag {
  const readCache = vi.fn(
    async (code: string) =>
      cache[code] ?? ({ status: 'miss' } as ActorPenetrationCacheResult),
  );
  const writeSuccess = vi.fn(async () => undefined);
  const writeFailure = vi.fn(async () => undefined);
  const writeLoginRequired = vi.fn(async () => undefined);
  // 缺省：正常返回 rawDoc；rawDoc===null 表示加载失败
  const loadDetail = vi.fn(async () => rawDoc);
  const delay = vi.fn(async () => undefined);
  const decisions: Array<{ id: string; categories: string[] | null; removed: boolean }> = [];
  const deps = {
    readCache,
    writeSuccess,
    writeFailure,
    writeLoginRequired,
    loadDetail,
    delay,
    buildDetailUrl: (id: string) => `https://javdb.com/v/${id}`,
    onDecision: (w: any, c: string[] | null, removed: boolean) => {
      decisions.push({ id: w.id, categories: c, removed });
    },
  };
  return {
    readCache,
    writeSuccess,
    writeFailure,
    writeLoginRequired,
    loadDetail,
    delay,
    decisions,
    deps,
  };
}

const rawHit = (): RawDetailDocument => ({
  finalUrl: 'https://javdb.com/v/Mb0WXv',
  panels: [CAT_PANEL_HIT, ACTOR_PANEL],
});
const rawMiss = (): RawDetailDocument => ({
  finalUrl: 'https://javdb.com/v/Mb0WXv',
  panels: [CAT_PANEL_MISS, ACTOR_PANEL],
});
const rawNoActor = (): RawDetailDocument => ({
  finalUrl: 'https://javdb.com/v/Mb0WXv',
  panels: [CAT_PANEL_HIT],
});

describe('splitNewWorksFilterValues', () => {
  it('t 码与类别 entryKey 拆分，未知丢弃（旧裸 id 透明迁移）', () => {
    const r = splitNewWorksFilterValues(['s', 'd', '17', '999999']);
    expect(r.t).toEqual(['s', 'd']);
    expect(r.categoryKeys).toEqual(['c4=17']);
    expect(r.dropped).toEqual(['999999']);
  });

  it('空输入', () => {
    expect(splitNewWorksFilterValues([])).toEqual({ t: [], categoryKeys: [], dropped: [] });
  });

  it('entryKey 值（含非 URL 维度）全部接受', () => {
    const r = splitNewWorksFilterValues(['c4=17', 'c6=93']);
    expect(r.categoryKeys).toEqual(['c4=17', 'c6=93']);
    expect(r.dropped).toEqual([]);
  });
});

// ── legacy「不限制(全选)」29 值全集签名（批2 review-batch2 #1）──
const LEGACY_T = ['s', 'p', 'd', 'c', '4k', 'uncensored'];
const LEGACY_BARE = [
  '28', '17', '18', '37', '72', '14', '45', '68', '80', '110', '160', '190',
  '312', '330', '32', '26', '47', '48', '71', '135', '157', '200', '23',
];
const LEGACY_ALL: string[] = [...LEGACY_T, ...LEGACY_BARE];

describe('isLegacyUnlimitedCategoryValues（legacy 不限制签名）', () => {
  it('全集签名（29 值，顺序无关）→ true，split 视为空（不限制）', () => {
    const shuffled = [...LEGACY_ALL].sort((a, b) => (a < b ? -1 : 1));
    expect(isLegacyUnlimitedCategoryValues(LEGACY_ALL)).toBe(true);
    expect(isLegacyUnlimitedCategoryValues(shuffled)).toBe(true);
    // 消费侧：collector 扫描（buildCategoryUrlParams）与 UI 计数（split）均视为不限制
    expect(splitNewWorksFilterValues(LEGACY_ALL)).toEqual({ t: [], categoryKeys: [], dropped: [] });
    expect(buildCategoryUrlParams(LEGACY_ALL)).toEqual({ t: [], byDim: {}, dropped: [], notUrlAppliable: [] });
  });

  it('缺 1 值（28 值）→ 非 legacy，正常拆分', () => {
    const missingOne = LEGACY_ALL.filter((v) => v !== '23');
    expect(missingOne).toHaveLength(28);
    expect(isLegacyUnlimitedCategoryValues(missingOne)).toBe(false);
    const r = splitNewWorksFilterValues(missingOne);
    expect(r.t.length).toBeGreaterThan(0); // t 码仍正常拆分
    expect(r.categoryKeys.length).toBeGreaterThan(0); // 裸 id 经字典归一
  });

  it('含 1 个 cN= 形 entryKey → 非 legacy，正常拆分', () => {
    const withEntryKey = [...LEGACY_ALL.slice(0, -1), 'c1=157'];
    expect(isLegacyUnlimitedCategoryValues(withEntryKey)).toBe(false);
    const r = splitNewWorksFilterValues(withEntryKey);
    expect(r.categoryKeys).toContain('c1=157');
  });

  it('重复值 / 空输入 / 未知值 → 均非 legacy', () => {
    const duped = [...LEGACY_ALL.slice(0, -1), 's']; // 重复 s，共 29 但缺 uncensored
    expect(isLegacyUnlimitedCategoryValues(duped)).toBe(false);
    expect(isLegacyUnlimitedCategoryValues([])).toBe(false);
    expect(isLegacyUnlimitedCategoryValues(null)).toBe(false);
    const unknown = [...LEGACY_ALL.slice(0, -1), '999999'];
    expect(isLegacyUnlimitedCategoryValues(unknown)).toBe(false);
  });
});

describe('buildCategoryUrlParams', () => {
  it('仅 appliesToUrl 维度进 byDim，其余进 notUrlAppliable', () => {
    const r = buildCategoryUrlParams(['s', 'c4=17', 'c6=93', 'c1=157']);
    expect(r.t).toEqual(['s']);
    expect(r.byDim).toEqual({ c1: ['157'], c4: ['17'] });
    expect(r.notUrlAppliable).toEqual(['c6=93']);
    expect(r.dropped).toEqual([]);
  });

  it('空输入', () => {
    expect(buildCategoryUrlParams([])).toEqual({ t: [], byDim: {}, dropped: [], notUrlAppliable: [] });
  });
});

describe('normalizeCategoryBlackValues', () => {
  it('entryKey/裸 id 归一；t 码与未知丢弃', () => {
    const r = normalizeCategoryBlackValues(['c6=93', '28', 's', '999999']);
    expect([...r.keys].sort()).toEqual(['c6=93', 'c7=28']);
    expect(r.dropped).toEqual(['s', '999999']);
  });

  it('空输入', () => {
    const r = normalizeCategoryBlackValues([]);
    expect(r.keys.size).toBe(0);
    expect(r.dropped).toEqual([]);
  });
});

describe('looksLikeLoginPage', () => {
  it('302 到 login 路径', () => {
    expect(looksLikeLoginPage('https://javdb.com/login?return_to=%2Fv%2Fabc')).toBe(true);
  });

  it('302 到 sign_in 路径', () => {
    expect(looksLikeLoginPage('https://javdb.com/sign_in')).toBe(true);
  });

  it('详情页正常（html 缺省）', () => {
    expect(looksLikeLoginPage('https://javdb.com/v/abc123')).toBe(false);
  });

  it('无 finalUrl → title 兜底', () => {
    expect(looksLikeLoginPage(undefined, '<html><head><title>Log In - JavDB</title></head></html>')).toBe(true);
    expect(looksLikeLoginPage(undefined, '<html><head><title>影片</title></head></html>')).toBe(false);
  });
});

describe('applyCategoryBlackFilter', () => {
  it('空黑名单 = 零变化（不读缓存、不取详情）', async () => {
    const { readCache, loadDetail, deps } = makeStubs({}, rawHit());
    const r = await applyCategoryBlackFilter([WORK_HIT], [], deps as any);
    expect(r).toEqual({ kept: [WORK_HIT], removed: 0, removedIds: [] });
    expect(readCache).not.toHaveBeenCalled();
    expect(loadDetail).not.toHaveBeenCalled();
  });

  it('不可识别黑名单值 → 零变化', async () => {
    const { readCache, deps } = makeStubs({}, rawHit());
    const r = await applyCategoryBlackFilter([WORK_HIT], ['s', '999999'], deps as any);
    expect(r.removed).toBe(0);
    expect(readCache).not.toHaveBeenCalled();
  });

  it('缓存命中带 categories → 命中即剔（不取详情、无写缓存）', async () => {
    const { readCache, loadDetail, writeSuccess, deps } = makeStubs({
      'BDSM-091': {
        status: 'hit',
        value: {
          actors: [ACTOR_LINK_1 && { id: 'aaaa1111', name: '測試女優', href: null, gender: 'female' }],
          hasMore: false,
          fetchedAt: 1,
          categories: ['c6=93'],
        },
      },
    });
    const r = await applyCategoryBlackFilter([WORK_HIT], ['c6=93'], deps as any);
    expect(r.removed).toBe(1);
    expect(r.removedIds).toEqual(['BDSM-091']);
    expect(loadDetail).not.toHaveBeenCalled();
    expect(writeSuccess).not.toHaveBeenCalled();
    expect(readCache).toHaveBeenCalledWith('BDSM-091');
  });

  it('缓存命中但类别未命中 → 保留', async () => {
    const { deps, loadDetail } = makeStubs({
      'BDSM-091': {
        status: 'hit',
        value: {
          actors: [],
          hasMore: false,
          fetchedAt: 1,
          categories: ['c4=17'],
        },
      },
    });
    const r = await applyCategoryBlackFilter([WORK_HIT], ['c6=93'], deps as any);
    expect(r.removed).toBe(0);
    expect(r.kept).toEqual([WORK_HIT]);
    expect(loadDetail).not.toHaveBeenCalled();
  });

  it('旧缓存无 categories → 取详情解析 + 命中剔除 + 回填合并写回（保留原 actors）', async () => {
    const originalActors = [{ id: 'aaaa1111', name: '原女優', href: null, gender: 'female' }];
    const { loadDetail, writeSuccess, delay, deps } = makeStubs({
      'BDSM-091': {
        status: 'hit',
        value: { actors: originalActors, hasMore: false, fetchedAt: 1 },
      },
    }, rawHit());
    const r = await applyCategoryBlackFilter([WORK_HIT], ['c6=93'], deps as any);
    expect(r.removed).toBe(1);
    expect(loadDetail).toHaveBeenCalledTimes(1);
    expect(loadDetail).toHaveBeenCalledWith('https://javdb.com/v/Mb0WXv');
    expect(delay).toHaveBeenCalledWith(3000);
    expect(writeSuccess).toHaveBeenCalledTimes(1);
    const [code, value] = writeSuccess.mock.calls[0];
    expect(code).toBe('BDSM-091');
    expect(value.actors).toEqual(originalActors); // 回填合并：保留原 actors
    expect(value.categories).toEqual(['c6=93', 'c4=17']); // 页面顺序
    expect(value.fetchedAt).toBeGreaterThan(1);
  });

  it('miss → 取详情解析 + 剔除 + 写成功缓存（有女演员才写）', async () => {
    const { loadDetail, writeSuccess, deps } = makeStubs({}, rawHit());
    const r = await applyCategoryBlackFilter([WORK_HIT], ['c6=93'], deps as any);
    expect(r.removed).toBe(1);
    expect(loadDetail).toHaveBeenCalledTimes(1);
    expect(writeSuccess).toHaveBeenCalledTimes(1);
    const [, value] = writeSuccess.mock.calls[0];
    expect(value.actors).toHaveLength(1);
    expect(value.actors[0].name).toBe('測試女優');
    expect(value.hasMore).toBe(false);
    expect(value.categories).toEqual(['c6=93', 'c4=17']);
  });

  it('miss + 女演员 >4 → 截断 4 且 hasMore=true', async () => {
    const manyActors = [1, 2, 3, 4, 5].map((n) => ({
      label: '演員:',
      tagHrefs: [],
      actorLinks: [
        { href: `/actors/a${n}`, text: `女優${n}`, nextText: null, symbolClass: 'symbol female', symbolText: '♀', linkClass: null },
      ],
      hasAnyLink: true,
      valueText: null,
    }));
    const { writeSuccess, deps } = makeStubs({}, { finalUrl: 'https://javdb.com/v/Mb0WXv', panels: [CAT_PANEL_HIT, ...manyActors] });
    const r = await applyCategoryBlackFilter([WORK_HIT], ['c6=93'], deps as any);
    expect(r.removed).toBe(1);
    const [, value] = writeSuccess.mock.calls[0];
    expect(value.actors).toHaveLength(4);
    expect(value.hasMore).toBe(true);
  });

  it('miss + 无女演员 → 剔除但仍不写缓存（避免空 actors 写）', async () => {
    const { writeSuccess, deps } = makeStubs({}, rawNoActor());
    const r = await applyCategoryBlackFilter([WORK_HIT], ['c6=93'], deps as any);
    expect(r.removed).toBe(1);
    expect(writeSuccess).not.toHaveBeenCalled();
  });

  it('缓存失败抑制期 → 保留（不取详情）', async () => {
    const { loadDetail, deps } = makeStubs({ 'BDSM-091': { status: 'failed', loginRequired: true } }, rawHit());
    const r = await applyCategoryBlackFilter([WORK_HIT], ['c6=93'], deps as any);
    expect(r.removed).toBe(0);
    expect(r.kept).toEqual([WORK_HIT]);
    expect(loadDetail).not.toHaveBeenCalled();
  });

  it('详情加载失败（超时/脚本错误）→ 保守保留 + 写 10 分钟失败抑制', async () => {
    const { writeFailure, deps } = makeStubs({}, null);
    const r = await applyCategoryBlackFilter([WORK_HIT], ['c6=93'], deps as any);
    expect(r.removed).toBe(0);
    expect(r.kept).toEqual([WORK_HIT]);
    expect(writeFailure).toHaveBeenCalledWith('BDSM-091');
  });

  it('loadDetail 抛错 → 保守保留 + 写失败抑制', async () => {
    const { writeFailure, deps } = makeStubs({}, rawHit());
    (deps as any).loadDetail = vi.fn(async () => { throw new Error('tab timeout'); });
    const r = await applyCategoryBlackFilter([WORK_HIT], ['c6=93'], deps as any);
    expect(r.removed).toBe(0);
    expect(r.kept).toEqual([WORK_HIT]);
    expect(writeFailure).toHaveBeenCalledWith('BDSM-091');
  });

  it('302 到登录页 → 保留 + 写「需登录」缓存（不写成功缓存）', async () => {
    const { writeSuccess, writeLoginRequired, deps } = makeStubs({}, {
      finalUrl: 'https://javdb.com/login?return_to=%2Fv%2FMb0WXv',
      panels: [],
    });
    const r = await applyCategoryBlackFilter([WORK_HIT], ['c6=93'], deps as any);
    expect(r.removed).toBe(0);
    expect(r.kept).toEqual([WORK_HIT]);
    expect(writeLoginRequired).toHaveBeenCalledWith('BDSM-091');
    expect(writeSuccess).not.toHaveBeenCalled();
  });

  it('限流/404 页（无面板无女演员）→ 保留，不写任何缓存（下次可重试）', async () => {
    const { writeSuccess, writeFailure, deps } = makeStubs({}, {
      finalUrl: 'https://javdb.com/v/Mb0WXv',
      panels: [],
    });
    const r = await applyCategoryBlackFilter([WORK_HIT], ['c6=93'], deps as any);
    expect(r.removed).toBe(0);
    expect(r.kept).toEqual([WORK_HIT]);
    expect(writeSuccess).not.toHaveBeenCalled();
    expect(writeFailure).not.toHaveBeenCalled();
  });

  it('解析出类别但未命中黑名单 → 保留（onDecision 记录解析结果）', async () => {
    const { decisions, deps } = makeStubs({}, rawMiss());
    const r = await applyCategoryBlackFilter([WORK_HIT], ['c6=93'], deps as any);
    expect(r.removed).toBe(0);
    expect(decisions).toEqual([{ id: 'BDSM-091', categories: ['c4=17'], removed: false }]);
  });

  it('英文页（Tags: 面板）同样命中剔除', async () => {
    const { deps } = makeStubs({}, {
      finalUrl: 'https://javdb.com/v/Mb0WXv',
      panels: [CAT_PANEL_EN, ACTOR_PANEL],
    });
    const r = await applyCategoryBlackFilter([WORK_HIT], ['c6=93'], deps as any);
    expect(r.removed).toBe(1);
  });

  it('年龄验证面板的 /tags?c 链接不被当类别（面板标签限定）', async () => {
    // 仅年龄验证面板带 c4=17 快链、真实类别面板无 c4=17 → 黑名单 ['c4=17'] 不应命中
    const { decisions, deps } = makeStubs({}, {
      finalUrl: 'https://javdb.com/v/Mb0WXv',
      panels: [AGE_VERIFY_PANEL, { ...CAT_PANEL_MISS, tagHrefs: [] }, ACTOR_PANEL],
    });
    const r = await applyCategoryBlackFilter([WORK_HIT], ['c4=17'], deps as any);
    expect(r.removed).toBe(0);
    expect(decisions).toEqual([{ id: 'BDSM-091', categories: [], removed: false }]);
  });

  it('无 id 的作品 → 保留', async () => {
    const { deps } = makeStubs({}, rawHit());
    const r = await applyCategoryBlackFilter([{ id: '', javdbId: 'x' }], ['c6=93'], deps as any);
    expect(r.removed).toBe(0);
    expect(r.kept).toHaveLength(1);
  });

  it('多片混合：命中剔、未中留', async () => {
    const works = [WORK_HIT, { id: 'OTHER-001', javdbId: 'Ywz5k8', title: 'OTHER-001' }];
    const { deps } = makeStubs({
      'BDSM-091': {
        status: 'hit',
        value: { actors: [], hasMore: false, fetchedAt: 1, categories: ['c6=93'] },
      },
      'OTHER-001': {
        status: 'hit',
        value: { actors: [], hasMore: false, fetchedAt: 1, categories: ['c4=17'] },
      },
    });
    const r = await applyCategoryBlackFilter(works, ['c6=93'], deps as any);
    expect(r.removed).toBe(1);
    expect(r.removedIds).toEqual(['BDSM-091']);
    expect(r.kept).toEqual([works[1]]);
  });
});
