/**
 * @file collector.whitelistAnd.test.ts
 * @description 回归锁（10-08-newworks-whitelist-and）：类别白名单在演员扫描侧的
 * 「单请求 AND 交集（?t= 多值，D4 真机实证）+ 登录墙停演员 + 容错不丢演员 +
 * 非空白名单 0 命中排障告警」编排。并集多请求 fan-out / 超 5 降级已废止。
 * 桩口径同 collector.blacklistOrder.test.ts：parseActorWorksPage / applyGlobalFilters* / delay
 * 实例桩，newWorksGet（存在性）与穿透缓存模块 mock，buildJavDBUrl 同步拼 javdb.com。
 * @module features/newWorks
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActorLoginWallError, NewWorksCollector } from './collector';
import { newWorksGet } from '../../platform/storage/indexedDb';
import { readActorPenetrationCache } from '../listEnhancement/actorPenetration/actorPenetrationCache';

vi.mock('../../platform/storage/indexedDb', () => ({
  newWorksGet: vi.fn(async () => null),
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

const SUB = { actorId: 'B8gBr', actorName: '测试演员', enabled: true, subscribedAt: 0 } as any;
const SUB2 = { actorId: 'AzVy0', actorName: '二号演员', enabled: true, subscribedAt: 0 } as any;

const makeWork = (id: string, javdbId: string) => ({
  id,
  javdbId,
  title: `${id} 标题`,
  releaseDate: '2026-09-01',
  url: `https://javdb.com/v/${javdbId}`,
  coverImage: '',
  tags: [],
});

const makeConfig = (categoryFilters: string[]) =>
  ({
    checkInterval: 24,
    requestInterval: 0,
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
      categoryFilters,
      categoryBlackFilters: [],
    },
  }) as any;

const EMPTY_STATS = () => ({ dateRange: 0, viewed: 0, browsed: 0, want: 0, ar: 0, categoryBlack: 0 });

/** legacy「不限制(全选)」29 值签名（与 categoryFilter.test 同源：6 t 码 + 23 裸 id） */
const LEGACY_T = ['s', 'p', 'd', 'c', '4k', 'uncensored'];
const LEGACY_BARE = [
  '28', '17', '18', '37', '72', '14', '45', '68', '80', '110', '160', '190',
  '312', '330', '32', '26', '47', '48', '71', '135', '157', '200', '23',
];
const LEGACY_ALL = [...LEGACY_T, ...LEGACY_BARE];

describe('NewWorksCollector 类别白名单 AND 扫描（10-08-newworks-whitelist-and）', () => {
  let collector: NewWorksCollector;
  let parseSpy: ReturnType<typeof vi.fn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  const stubPipes = () => {
    vi.spyOn(collector as any, 'applyGlobalFilters').mockImplementation(async (works: any[]) => works);
    vi.spyOn(collector as any, 'applyGlobalFiltersWithStats').mockImplementation(
      async (works: any[]) => ({ filteredWorks: works, filteredCount: EMPTY_STATS() })
    );
    parseSpy = vi.fn(async () => [] as any[]);
    vi.spyOn(collector as any, 'parseActorWorksPage').mockImplementation(parseSpy);
  };

  /** 按 URL 里的 t 值返回响应（单请求 AND 形态） */
  const respondByT = (map: Record<string, any[]>) => {
    parseSpy.mockImplementation(async (url: string) => {
      const m = /[?&]t=([^&]+)/.exec(url as string);
      const key = m ? m[1] : '';
      if (key in map) {
        const v = map[key];
        if (v instanceof Error) throw v;
        return v;
      }
      return [];
    });
  };

  const requestedUrls = () => parseSpy.mock.calls.map((c) => String(c[0]));

  beforeEach(() => {
    vi.clearAllMocks();
    collector = new NewWorksCollector();
    vi.spyOn(collector as any, 'delay').mockResolvedValue(undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(newWorksGet).mockImplementation(async () => null);
    vi.mocked(readActorPenetrationCache).mockResolvedValue({ status: 'miss' } as any);
    stubPipes();
  });

  it('2 个数字类别 → 单请求（?t= 多值 = AND 交集），维度渲染序（c4 先于 c6）', async () => {
    respondByT({ '17,93': [makeWork('AAA-001', 'x1'), makeWork('AAA-002', 'x2')] });
    const works = await collector.checkActorNewWorks(SUB, makeConfig(['c4=17', 'c6=93']));
    expect(requestedUrls()).toEqual(['https://javdb.com/actors/B8gBr?t=17,93&sort_type=0']);
    expect(works.map((w) => w.id)).toEqual(['AAA-001', 'AAA-002']);
  });

  it('属性 + 数字混合 → 单请求，属性字母居前（p,d,c 序 → c1..c9 维度序）', async () => {
    respondByT({ 'p,157,28': [makeWork('BBB-001', 'y1')] });
    const res = await collector.checkActorNewWorksDetailed(
      SUB,
      makeConfig(['p', 'c1=157', 'c7=28']),
    );
    expect(requestedUrls()).toEqual(['https://javdb.com/actors/B8gBr?t=p,157,28&sort_type=0']);
    expect(res.works.map((w) => w.id)).toEqual(['BBB-001']);
    expect(res.identified).toBe(1);
  });

  it('演员页永不拼 cN=（旧实现拼 cN 被站点静默忽略 = 白名单实际不生效）', async () => {
    respondByT({ '17,93,28': [makeWork('CCC-001', 'z1')] });
    await collector.checkActorNewWorks(SUB, makeConfig(['c4=17', 'c6=93', 'c7=28']));
    expect(requestedUrls().every((u) => !/c\d=/.test(u))).toBe(true);
  });

  it('>5 个类别仍单请求（无并集 fan-out / 无降级档）', async () => {
    respondByT({ '23,1,3,15,14,21,28': [makeWork('DDD-001', 'w1')] });
    await collector.checkActorNewWorks(
      SUB,
      makeConfig(['c1=23', 'c2=1', 'c3=3', 'c4=15', 'c5=14', 'c6=21', 'c7=28']),
    );
    expect(requestedUrls()).toEqual([
      'https://javdb.com/actors/B8gBr?t=23,1,3,15,14,21,28&sort_type=0',
    ]);
  });

  it('legacy「不限制(全选)」29 值 → 单请求且为裸演员 URL（零迁移口径）', async () => {
    respondByT({ '': [makeWork('GGG-001', 'r1')] });
    const works = await collector.checkActorNewWorks(SUB, makeConfig(LEGACY_ALL));
    expect(requestedUrls()).toEqual(['https://javdb.com/actors/B8gBr']);
    expect(works.map((w) => w.id)).toEqual(['GGG-001']);
  });

  it('仅属性字母 → 单请求（?t=p,d,c），D3 真机验证的有效 AND 约束', async () => {
    respondByT({ 'p,d,c': [makeWork('HHH-001', 't1')] });
    await collector.checkActorNewWorks(SUB, makeConfig(['p', 'd', 'c']));
    expect(requestedUrls()).toEqual(['https://javdb.com/actors/B8gBr?t=p,d,c&sort_type=0']);
  });

  it('非空白名单解析 0 条 → 排障 warn（白名单 AND 命中 0 / 条件可能过严）', async () => {
    respondByT({ '17,28': [] });
    const works = await collector.checkActorNewWorks(SUB, makeConfig(['c4=17', 'c7=28']));
    expect(requestedUrls()).toEqual(['https://javdb.com/actors/B8gBr?t=17,28&sort_type=0']);
    expect(works).toEqual([]);
    const warns = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(warns.some((m) => m.includes('白名单 AND 命中 0'))).toBe(true);
    expect(warns.some((m) => m.includes('条件可能过严'))).toBe(true);
  });

  it('请求遇登录墙 → 标记 wallDetected（1 次调用），该演员本轮无结果', async () => {
    parseSpy.mockRejectedValue(
      new ActorLoginWallError('u', 'https://javdb.com/login?return_to=%2Factors'),
    );
    const works = await collector.checkActorNewWorks(SUB, makeConfig(['c4=17', 'c7=28']));
    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(works).toEqual([]);
    expect(warnSpy.mock.calls.map((c) => String(c[0])).some((m) => m.includes('[ACTOR][WALL]'))).toBe(true);
  });

  it('非墙错误（网络/解析失败）→ 记日志并保留空结果，不抛错不丢演员入口', async () => {
    parseSpy.mockRejectedValue(new Error('解析作品数据超时'));
    const works = await collector.checkActorNewWorks(SUB, makeConfig(['c4=17', 'c7=28']));
    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(works).toEqual([]);
    expect(errorSpy.mock.calls.map((c) => String(c[0])).some((m) => m.includes('请求失败'))).toBe(true);
  });

  it('批量扫描：登录墙按轮次汇总一次（不因单演员刷屏）', async () => {
    parseSpy.mockRejectedValue(
      new ActorLoginWallError('u', 'https://javdb.com/login?return_to=%2Factors'),
    );
    const res = await collector.checkMultipleActors([SUB, SUB2], makeConfig(['c4=17', 'c6=93']));
    expect(res.newWorks).toHaveLength(0);
    const summaries = warnSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes('[NEWWORKS][WALL]'));
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toContain('批量扫描');
    expect(summaries[0]).toContain('测试演员');
    expect(summaries[0]).toContain('二号演员');
  });

  it('单演员入口（非轮次）：墙即时上报一次，不累积到后续轮次', async () => {
    parseSpy.mockRejectedValue(
      new ActorLoginWallError('u', 'https://javdb.com/login?return_to=%2Factors'),
    );
    await collector.checkActorNewWorks(SUB, makeConfig(['c4=17']));
    let summaries = warnSpy.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('[NEWWORKS][WALL]'));
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toContain('单演员扫描');
    await collector.checkActorNewWorks(SUB, makeConfig(['c4=17']));
    summaries = warnSpy.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('[NEWWORKS][WALL]'));
    expect(summaries).toHaveLength(2);
  });

  it('墙错误判定按 name（测试桩跨上下文实例亦识别）', async () => {
    parseSpy.mockRejectedValue(Object.assign(new Error('boom'), { name: 'ActorLoginWallError' }) as any);
    const works = await collector.checkActorNewWorks(SUB, makeConfig(['c4=17', 'c6=93']));
    expect(parseSpy).toHaveBeenCalledTimes(1); // 视为墙
    expect(works).toEqual([]);
    expect(warnSpy.mock.calls.map((c) => String(c[0])).some((m) => m.includes('[ACTOR][WALL]'))).toBe(true);
  });
});
