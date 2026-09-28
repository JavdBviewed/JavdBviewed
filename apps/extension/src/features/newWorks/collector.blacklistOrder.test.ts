/**
 * @file collector.blacklistOrder.test.ts
 * @description 回归锁（run11b r165902 真机归因修复）：类别黑名单在存在性检查之后、
 * 只对新候选作品评估——已存在作品不触发 loadDetail（详情抓取）。
 * 修复前黑名单在存在性检查之前对全池作品执行：冷穿透缓存下
 * 510 作品 × (3s 延迟 + 隐藏标签页详情 8~13s) ≈ 50min，SW 120s 无响应。
 * 桩口径：parseActorWorksPage/applyGlobalFilters(WithStats)/delay/loadDetailInTab 实例桩，
 * newWorksGet（存在性）与 readActorPenetrationCache（穿透缓存）模块 mock。
 * @module features/newWorks
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NewWorksCollector } from './collector';
import { newWorksGet } from '../../platform/storage/indexedDb';
import { readActorPenetrationCache } from '../listEnhancement/actorPenetration/actorPenetrationCache';

vi.mock('../../platform/storage/indexedDb', () => ({
  newWorksGet: vi.fn(),
  viewedGetAll: vi.fn(async () => []),
}));
vi.mock('../listEnhancement/actorPenetration/actorPenetrationCache', () => ({
  readActorPenetrationCache: vi.fn(),
  writeActorPenetrationSuccess: vi.fn(async () => undefined),
  writeActorPenetrationFailure: vi.fn(async () => undefined),
  writeActorPenetrationLoginRequired: vi.fn(async () => undefined),
}));
vi.mock('../routeManagement', () => ({
  buildJavDBUrl: vi.fn(async (path: string) => `https://javdb.com${path}`),
}));
vi.mock('../../utils/storage', () => ({
  getSettings: vi.fn(async () => ({})),
}));

const makeWork = (id: string, javdbId: string, title: string) => ({
  id,
  javdbId,
  title,
  releaseDate: '2026-09-01',
  url: `https://javdb.com/v/${javdbId}`,
  coverImage: '',
  tags: [],
});

const hitCat = (categories: string[]) => ({ actors: [], hasMore: false, fetchedAt: 0, categories });

const makeConfig = (black: string[]) =>
  ({
    checkInterval: 24,
    requestInterval: 3,
    autoCheckEnabled: false,
    concurrency: 1,
    showActorPageScanButton: false,
    maxWorksPerCheck: 100,
    autoCleanup: true,
    cleanupDays: 30,
    filters: {
      excludeViewed: false,
      excludeBrowsed: false,
      excludeWant: false,
      excludeAR: false,
      applyContentFilter: false,
      dateRange: 0,
      categoryFilters: [],
      categoryBlackFilters: black,
    },
  }) as any;

const SUB = { actorId: 'B8gBr', actorName: '测试演员', enabled: true, subscribedAt: 0 } as any;

const EMPTY_STATS = () => ({ dateRange: 0, viewed: 0, browsed: 0, want: 0, ar: 0, categoryBlack: 0 });

describe('NewWorksCollector 类别黑名单 × 存在性检查顺序（run11b 回归锁）', () => {
  let collector: NewWorksCollector;
  let loadDetailSpy: ReturnType<typeof vi.fn>;
  let cacheMap: Map<string, ReturnType<typeof hitCat>>;
  let existing: Set<string>;
  let worksFixture: ReturnType<typeof makeWork>[];

  const stubPages = () => {
    vi.spyOn(collector as any, 'parseActorWorksPage').mockResolvedValue(worksFixture);
    vi.spyOn(collector as any, 'applyGlobalFilters').mockResolvedValue(worksFixture);
    vi.spyOn(collector as any, 'applyGlobalFiltersWithStats').mockResolvedValue({
      filteredWorks: worksFixture,
      filteredCount: EMPTY_STATS(),
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    cacheMap = new Map();
    existing = new Set();
    worksFixture = [];
    collector = new NewWorksCollector();
    vi.spyOn(collector as any, 'delay').mockResolvedValue(undefined);
    vi.spyOn(collector as any, 'parseActorWorksPage').mockResolvedValue([]);
    vi.spyOn(collector as any, 'applyGlobalFilters').mockResolvedValue([]);
    vi.spyOn(collector as any, 'applyGlobalFiltersWithStats').mockResolvedValue({
      filteredWorks: [],
      filteredCount: EMPTY_STATS(),
    });
    loadDetailSpy = vi.fn(async () => null);
    vi.spyOn(collector as any, 'loadDetailInTab').mockImplementation(loadDetailSpy);
    vi.mocked(newWorksGet).mockImplementation(async (id: string) =>
      existing.has(id) ? ({ id } as any) : null
    );
    vi.mocked(readActorPenetrationCache).mockImplementation(async (code: string) => {
      const v = cacheMap.get(code);
      return v ? { status: 'hit', value: v } : { status: 'miss' };
    });
  });

  it('已存在作品不触发 loadDetail：黑名单只评估新候选（detailed 路径）', async () => {
    const wExist1 = makeWork('AAA-001', 'aaaa1', '旧片一');
    const wExist2 = makeWork('AAA-002', 'aaaa2', '旧片二');
    const wNew = makeWork('AAA-003', 'aaaa3', '新片');
    worksFixture = [wExist1, wExist2, wNew];
    existing.add('AAA-001');
    existing.add('AAA-002');
    stubPages();
    // 穿透缓存全 miss：修复前已存在作品各自 delay(3000)+loadDetail（共 3 次调用），
    // 修复后只有新作品 AAA-003 可能触发（1 次）
    const r = await (collector as any).checkActorNewWorksDetailed(SUB, makeConfig(['c6=93']));
    expect(loadDetailSpy).toHaveBeenCalledTimes(1);
    expect(loadDetailSpy).toHaveBeenCalledWith('https://javdb.com/v/aaaa3');
    // loadDetail 返回 null = 加载失败 → 保守保留（不丢片）
    expect(r.works.map((w: any) => w.id)).toEqual(['AAA-003']);
    expect(r.filterBreakdown.categoryBlack).toBe(0);
    expect(r.existingCount).toBe(2);
    expect(r.effective).toBe(3);
    expect(r.filteredOut).toBe(0);
  });

  it('新候选黑名单命中即剔：categoryBlack 计数 + workIds 剔除（缓存命中零详情）', async () => {
    const t0 = makeWork('AAA-001', 'aaaa1', 'T0');
    const t1 = makeWork('AAA-002', 'aaaa2', 'T1');
    worksFixture = [t0, t1];
    cacheMap.set('AAA-001', hitCat(['c6=93'])); // 命中黑名单
    cacheMap.set('AAA-002', hitCat(['c4=17'])); // 未命中
    stubPages();
    const r = await (collector as any).checkActorNewWorksDetailed(SUB, makeConfig(['c6=93']));
    expect(r.filterBreakdown.categoryBlack).toBe(1);
    expect(r.works.map((w: any) => w.id)).toEqual(['AAA-002']);
    expect(loadDetailSpy).not.toHaveBeenCalled(); // 双缓存命中，零详情抓取
    expect(r.existingCount).toBe(0);
    expect(r.effective).toBe(1); // 2 - 1 剔除
    expect(r.filteredOut).toBe(1);
  });

  it('checkActorNewWorks（非 detailed）：已存在作品不进黑名单评估', async () => {
    const wExist = makeWork('BBB-001', 'bbbb1', '旧片');
    const wNew = makeWork('BBB-002', 'bbbb2', '新片');
    worksFixture = [wExist, wNew];
    existing.add('BBB-001');
    cacheMap.set('BBB-002', hitCat(['c6=93'])); // 新作品命中黑名单
    stubPages();
    const newWorks = await collector.checkActorNewWorks(SUB, makeConfig(['c6=93']));
    expect(newWorks).toEqual([]); // 新作品被剔；已存在作品不参与评估
    expect(loadDetailSpy).not.toHaveBeenCalled();
  });

  it('maxWorksPerCheck 切片口径保持：只对窗口内候选做存在性/黑名单', async () => {
    const a = makeWork('CCC-001', 'cccc1', 'A');
    const b = makeWork('CCC-002', 'cccc2', 'B');
    worksFixture = [a, b];
    cacheMap.set('CCC-001', hitCat(['c4=17']));
    cacheMap.set('CCC-002', hitCat(['c4=17']));
    stubPages();
    const cfg = makeConfig(['c6=93']);
    cfg.maxWorksPerCheck = 1;
    const newWorks = await collector.checkActorNewWorks(SUB, cfg);
    expect(newWorks.map((w) => w.id)).toEqual(['CCC-001']); // 窗口外 CCC-002 不处理
    expect(loadDetailSpy).not.toHaveBeenCalled();
  });

  it('空黑名单：零副作用（不读缓存、不取详情、全量返回）', async () => {
    const a = makeWork('DDD-001', 'dddd1', 'A');
    const b = makeWork('DDD-002', 'dddd2', 'B');
    worksFixture = [a, b];
    stubPages();
    const newWorks = await collector.checkActorNewWorks(SUB, makeConfig([]));
    expect(newWorks.map((w) => w.id)).toEqual(['DDD-001', 'DDD-002']);
    expect(loadDetailSpy).not.toHaveBeenCalled();
    expect(readActorPenetrationCache).not.toHaveBeenCalled();
  });
});
