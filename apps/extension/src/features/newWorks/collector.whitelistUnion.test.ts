/**
 * @file collector.whitelistUnion.test.ts
 * @description 回归锁（10-01-newworks-whitelist-merge）：类别白名单在演员扫描侧的
 * 「多请求并集 + 交集降级 + 登录墙停剩余请求 + 容错不丢演员」编排。
 * 数字类别此前拼 ?cN= 被演员页静默忽略（实际不生效），现经 ?t= 一类别一请求真实生效。
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

/** 数字类别 1..3 的裸 id（c1/c4/c7 维，字典内有效） */
const THREE_NUMS = ['c4=17', 'c6=93', 'c7=28'];
/** legacy「不限制(全选)」29 值签名（与 categoryFilter.test 同源：6 t 码 + 23 裸 id） */
const LEGACY_T = ['s', 'p', 'd', 'c', '4k', 'uncensored'];
const LEGACY_BARE = [
  '28', '17', '18', '37', '72', '14', '45', '68', '80', '110', '160', '190',
  '312', '330', '32', '26', '47', '48', '71', '135', '157', '200', '23',
];
const LEGACY_ALL = [...LEGACY_T, ...LEGACY_BARE];

describe('NewWorksCollector 类别白名单并集扫描（10-01-newworks-whitelist-merge）', () => {
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

  /** 按 URL 里的 t 值返回不同响应（并集/降级各档共用） */
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

  it('2 个数字类别 → 2 个请求（?t= 单值），按 video ID 并集去重、首现顺序', async () => {
    respondByT({
      '17': [makeWork('AAA-001', 'x1'), makeWork('AAA-002', 'x2')],
      '93': [makeWork('AAA-002', 'x2'), makeWork('AAA-003', 'x3')],
    });
    const works = await collector.checkActorNewWorks(SUB, makeConfig(['c4=17', 'c6=93']));
    expect(requestedUrls()).toEqual([
      'https://javdb.com/actors/B8gBr?t=17&sort_type=0',
      'https://javdb.com/actors/B8gBr?t=93&sort_type=0',
    ]);
    expect(works.map((w) => w.id)).toEqual(['AAA-001', 'AAA-002', 'AAA-003']);
  });

  it('字母码 + 数字类别混选 → 每请求都带字母（基础过滤为必满足条件）', async () => {
    respondByT({ 's,17': [makeWork('BBB-001', 'y1')], 's,93': [] });
    await collector.checkActorNewWorksDetailed(SUB, makeConfig(['s', 'c4=17', 'c6=93']));
    expect(requestedUrls()).toEqual([
      'https://javdb.com/actors/B8gBr?t=s,17&sort_type=0',
      'https://javdb.com/actors/B8gBr?t=s,93&sort_type=0',
    ]);
  });

  it('演员页永不拼 cN=（旧实现拼 cN 被站点静默忽略 = 白名单实际不生效）', async () => {
    respondByT({ '17': [makeWork('CCC-001', 'z1')] });
    await collector.checkActorNewWorks(SUB, makeConfig(THREE_NUMS));
    expect(requestedUrls().every((u) => !/c\d=/.test(u))).toBe(true);
  });

  it('第 2 个请求遇登录墙 → 停该演员剩余请求，保留第 1 个请求结果', async () => {
    respondByT({
      '17': [makeWork('DDD-001', 'w1')],
      '93': new ActorLoginWallError('u', 'https://javdb.com/login?return_to=%2Factors'),
      '28': [makeWork('DDD-002', 'w2')],
    });
    const works = await collector.checkActorNewWorks(SUB, makeConfig(THREE_NUMS));
    expect(parseSpy).toHaveBeenCalledTimes(2); // 第 3 个请求不再发起
    expect(works.map((w) => w.id)).toEqual(['DDD-001']);
    expect(warnSpy.mock.calls.map((c) => String(c[0])).some((m) => m.includes('[ACTOR][WALL]'))).toBe(true);
  });

  it('非墙错误（网络/解析失败）→ 记日志并继续下一个请求，不丢整个演员', async () => {
    respondByT({
      '17': new Error('解析作品数据超时'),
      '93': [makeWork('EEE-001', 'v1')],
      '28': [makeWork('EEE-002', 'v2')],
    });
    const works = await collector.checkActorNewWorks(SUB, makeConfig(THREE_NUMS));
    expect(parseSpy).toHaveBeenCalledTimes(3);
    expect(works.map((w) => w.id)).toEqual(['EEE-001', 'EEE-002']);
    expect(errorSpy.mock.calls.map((c) => String(c[0])).some((m) => m.includes('单个类别请求失败'))).toBe(true);
  });

  it('6 个数字类别 → 降级 1 个请求（字母 + 全部数字 = AND 交集）并告警', async () => {
    const nums = ['28', '17', '18', '37', '72', '14']; // 6 项字典类别（裸 id 经字典归一）
    respondByT({ [nums.join(',')]: [makeWork('FFF-001', 'q1')] });
    await collector.checkActorNewWorks(SUB, makeConfig(nums));
    expect(requestedUrls()).toEqual([`https://javdb.com/actors/B8gBr?t=${nums.join(',')}&sort_type=0`]);
    expect(warnSpy.mock.calls.map((c) => String(c[0])).some((m) => m.includes('降级为「同时满足全部（交集）」'))).toBe(true);
  });

  it('legacy「不限制(全选)」29 值 → 1 个请求且为裸演员 URL（零迁移口径）', async () => {
    respondByT({ '': [makeWork('GGG-001', 'r1')] });
    const works = await collector.checkActorNewWorks(SUB, makeConfig(LEGACY_ALL));
    expect(requestedUrls()).toEqual(['https://javdb.com/actors/B8gBr']);
    expect(works.map((w) => w.id)).toEqual(['GGG-001']);
  });

  it('仅字母无数字 → 1 个请求（?t= 逗号拼全部字母），既有基础过滤语义不变', async () => {
    respondByT({ 's,4k': [makeWork('HHH-001', 't1')] });
    await collector.checkActorNewWorks(SUB, makeConfig(['s', '4k']));
    expect(requestedUrls()).toEqual(['https://javdb.com/actors/B8gBr?t=s,4k&sort_type=0']);
  });

  it('批量扫描：登录墙按轮次汇总一次（不因单演员刷屏）', async () => {
    parseSpy.mockRejectedValue(
      new ActorLoginWallError('u', 'https://javdb.com/login?return_to=%2Factors')
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
      new ActorLoginWallError('u', 'https://javdb.com/login?return_to=%2Factors')
    );
    await collector.checkActorNewWorks(SUB, makeConfig(['c4=17']));
    const summaries = warnSpy.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('[NEWWORKS][WALL]'));
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toContain('单演员扫描');
    await collector.checkActorNewWorks(SUB, makeConfig(['c4=17']));
    expect(warnSpy.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('[NEWWORKS][WALL]'))).toHaveLength(2);
  });

  it('墙错误判定按 name（测试桩跨上下文实例亦识别）', async () => {
    respondByT({
      '17': Object.assign(new Error('boom'), { name: 'ActorLoginWallError' }) as any,
      '93': [makeWork('III-001', 'u1')],
    });
    await collector.checkActorNewWorks(SUB, makeConfig(['c4=17', 'c6=93']));
    expect(parseSpy).toHaveBeenCalledTimes(1); // 视为墙 → 停剩余请求
  });
});
