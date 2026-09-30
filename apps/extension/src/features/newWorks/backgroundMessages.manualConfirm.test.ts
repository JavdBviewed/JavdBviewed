/**
 * @file backgroundMessages.manualConfirm.test.ts
 * @description 新作品手动检查「收集-确认-入库」消息层单测：
 *              带 confirmRequired 标记的新链只收集不写入（跨演员聚合 pendingWorks + 六桶求和 +
 *              existingCount 累加 + cancelled 后已收集结果仍返回）；无标记调用方（演员选择器/
 *              演员页扫描按钮/调度器）当场直写语义逐字保留；new-works-manual-commit 白名单重建
 *              后单次批量入库。进度 payload 带 pendingTotal（与确认弹窗同口径）。
 * @module features/newWorks
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fns } = vi.hoisted(() => ({
  fns: {
    getGlobalConfig: vi.fn(),
    getSubscriptions: vi.fn(),
    addNewWorks: vi.fn(),
    markSubscriptionChecked: vi.fn(),
    updateGlobalConfig: vi.fn(),
    checkActorNewWorksDetailed: vi.fn(),
    sendMessage: vi.fn(),
  },
}));

// barrel 单例全桩：本测只验消息路由与聚合语义，采集/入库由 collector/manager 各自的测覆盖
vi.mock('./index', () => ({
  newWorksManager: {
    getGlobalConfig: fns.getGlobalConfig,
    getSubscriptions: fns.getSubscriptions,
    addNewWorks: fns.addNewWorks,
    markSubscriptionChecked: fns.markSubscriptionChecked,
    updateGlobalConfig: fns.updateGlobalConfig,
  },
  newWorksCollector: { checkActorNewWorksDetailed: fns.checkActorNewWorksDetailed },
  newWorksScheduler: { restart: vi.fn(), getStatus: vi.fn() },
}));

import { handleNewWorksRuntimeMessage } from './backgroundMessages';

const BASE_CONFIG = {
  checkInterval: 86400000,
  requestInterval: 0,
  concurrency: 1,
  maxWorksPerCheck: 100,
  filters: {},
};

function makeSub(actorId: string, actorName: string) {
  return { actorId, actorName, enabled: true, subscribedAt: 1 };
}

function makeWork(id: string, actorId = 'st1', actorName = 'Alice') {
  return {
    id,
    actorId,
    actorName,
    title: `title-${id}`,
    releaseDate: '2026-09-01',
    javdbUrl: `https://example.invalid/v/${id}`,
    coverImage: `https://example.invalid/c/${id}.jpg`,
    tags: ['chinese-subtitles'],
    discoveredAt: 1700000000000,
    isRead: false,
    status: 'new',
  };
}

function makeDetailed(over: Record<string, unknown> = {}) {
  return {
    works: [],
    identified: 0,
    effective: 0,
    filteredOut: 0,
    existingCount: 0,
    filterBreakdown: { dateRange: 0, viewed: 0, browsed: 0, want: 0, ar: 0, categoryBlack: 0 },
    ...over,
  };
}

/** 走真实消息入口，等 sendResponse */
function send(message: Record<string, unknown>): Promise<any> {
  return new Promise((resolve) => {
    const handled = handleNewWorksRuntimeMessage(message as any, resolve as any);
    if (handled === false) resolve({ __unhandled: true });
  });
}

async function flush(times = 12): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise(r => setTimeout(r, 0));
}

beforeEach(() => {
  fns.getGlobalConfig.mockResolvedValue({ ...BASE_CONFIG });
  fns.getSubscriptions.mockResolvedValue([]);
  fns.addNewWorks.mockResolvedValue({ total: 0, saved: 0, failed: 0 });
  fns.markSubscriptionChecked.mockResolvedValue(undefined);
  fns.updateGlobalConfig.mockResolvedValue(undefined);
  fns.checkActorNewWorksDetailed.mockResolvedValue(makeDetailed());
  fns.sendMessage.mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("'new-works-manual-check' confirmRequired=true（收集-确认-入库新链）", () => {
  it('跨演员聚合完整 pendingWorks、六桶逐项求和、existingCount 累加，全程零写入', async () => {
    fns.getSubscriptions.mockResolvedValue([
      makeSub('st1', 'Alice'),
      makeSub('st2', 'Bob'),
      { actorId: 'off', actorName: 'Zoe', enabled: false, subscribedAt: 1 },
    ]);
    fns.checkActorNewWorksDetailed
      .mockImplementationOnce(async () => makeDetailed({
        works: [makeWork('AAA111'), makeWork('AAA222', 'st1', 'Alice')],
        identified: 30,
        effective: 28,
        filteredOut: 2,
        existingCount: 3,
        filterBreakdown: { dateRange: 20, viewed: 4, browsed: 2, want: 1, ar: 1, categoryBlack: 0 },
      }))
      .mockImplementationOnce(async () => makeDetailed({
        works: [makeWork('BBB333', 'st2', 'Bob')],
        identified: 13,
        effective: 12,
        filteredOut: 1,
        existingCount: 1,
        filterBreakdown: { dateRange: 10, viewed: 0, browsed: 1, want: 0, ar: 1, categoryBlack: 0 },
      }));

    const response = await send({ type: 'new-works-manual-check', confirmRequired: true });
    await flush();

    expect(response.success).toBe(true);
    const result = response.result;
    // 只收集不写入
    expect(fns.addNewWorks).not.toHaveBeenCalled();
    expect(result.savedTotal).toBe(0);
    expect(result.failedTotal).toBe(0);
    // 完整记录原样交回（不裁剪字段：裁剪会丢 coverImage/releaseDate/tags）
    expect(result.pendingWorks.map((w: any) => w.id)).toEqual(['AAA111', 'AAA222', 'BBB333']);
    expect(result.pendingWorks[0]).toEqual(makeWork('AAA111'));
    expect(result.breakdown).toEqual({ dateRange: 30, viewed: 4, browsed: 3, want: 1, ar: 2, categoryBlack: 0 });
    expect(result.existingCount).toBe(4);
    // 旧字段语义不变
    expect(result).toMatchObject({ discovered: 3, identifiedTotal: 43, effectiveTotal: 40, cancelled: false, errors: [] });
    // 停用订阅不参与
    expect(fns.checkActorNewWorksDetailed).toHaveBeenCalledTimes(2);
    expect(fns.checkActorNewWorksDetailed.mock.calls[0][0].actorName).toBe('Alice');
    // 固定剔除三件在后台侧强制开启（旧语义保留）
    const cfgArg = fns.checkActorNewWorksDetailed.mock.calls[0][1];
    expect(cfgArg.filters).toMatchObject({ excludeViewed: true, excludeBrowsed: true, excludeWant: true });
  });

  it('进度 payload 带 pendingTotal，与确认弹窗「可入库」同一口径', async () => {
    vi.stubGlobal('chrome', { runtime: { sendMessage: fns.sendMessage } });
    fns.getSubscriptions.mockResolvedValue([makeSub('st1', 'Alice')]);
    fns.checkActorNewWorksDetailed.mockResolvedValue(makeDetailed({
      works: [makeWork('AAA111'), makeWork('AAA222')],
      identified: 9,
      effective: 9,
    }));

    await send({ type: 'new-works-manual-check', confirmRequired: true });
    await flush();

    const payloads = fns.sendMessage.mock.calls
      .map(call => call[0])
      .filter((msg: any) => msg?.type === 'new-works-progress')
      .map((msg: any) => msg.payload);
    expect(payloads.length).toBeGreaterThan(1);
    expect(payloads[0]).toMatchObject({ processed: 0, pendingTotal: 0 });
    expect(payloads[payloads.length - 1]).toMatchObject({
      processed: 1,
      total: 1,
      identifiedTotal: 9,
      pendingTotal: 2,
    });
    // effectiveTotal 降级为纯内部字段但仍随 payload 传（不破坏旧消费者）
    expect(payloads[payloads.length - 1].effectiveTotal).toBe(9);
  });

  it('取消后停止后续演员，已收集结果仍完整返回且 cancelled=true', async () => {
    fns.getSubscriptions.mockResolvedValue([
      makeSub('st1', 'Alice'),
      makeSub('st2', 'Bob'),
      makeSub('st3', 'Eve'),
    ]);
    fns.checkActorNewWorksDetailed
      .mockImplementationOnce(async () => makeDetailed({ works: [makeWork('AAA111')], identified: 5 }))
      // 第二位演员检查过程中用户点取消
      .mockImplementationOnce(async () => {
        handleNewWorksRuntimeMessage({ type: 'new-works-manual-cancel' }, () => undefined);
        return makeDetailed({ works: [makeWork('BBB222', 'st2', 'Bob')], identified: 4 });
      })
      .mockImplementationOnce(async () => makeDetailed({ works: [makeWork('CCC333')], identified: 3 }));

    const response = await send({ type: 'new-works-manual-check', confirmRequired: true });
    await flush();

    expect(fns.checkActorNewWorksDetailed).toHaveBeenCalledTimes(2);
    expect(response.result.cancelled).toBe(true);
    expect(response.result.identifiedTotal).toBe(9);
    expect(response.result.pendingWorks.map((w: any) => w.id)).toEqual(['AAA111', 'BBB222']);
    expect(fns.addNewWorks).not.toHaveBeenCalled();
  });

  it('采集异常按演员进 errors，不影响其余演员与新链收集', async () => {
    fns.getSubscriptions.mockResolvedValue([makeSub('st1', 'Alice'), makeSub('st2', 'Bob')]);
    fns.checkActorNewWorksDetailed
      .mockRejectedValueOnce(new Error('站点 A 失败'))
      .mockImplementationOnce(async () => makeDetailed({ works: [makeWork('BBB222')], identified: 2 }));

    const response = await send({ type: 'new-works-manual-check', confirmRequired: true });
    await flush();

    expect(response.success).toBe(true);
    expect(response.result.errors).toEqual(['检查演员 Alice 失败: 站点 A 失败']);
    expect(response.result.pendingWorks).toHaveLength(1);
  });
});

describe("'new-works-manual-check' 无标记（旧当场直写语义逐字保留）", () => {
  it('addNewWorks 仍按演员即时调用，响应不含 pendingWorks/breakdown/existingCount，失败计入 errors', async () => {
    fns.getSubscriptions.mockResolvedValue([makeSub('st1', 'Alice'), makeSub('st2', 'Bob')]);
    fns.checkActorNewWorksDetailed
      .mockImplementationOnce(async () => makeDetailed({ works: [makeWork('AAA111')], identified: 1 }))
      .mockImplementationOnce(async () => makeDetailed({ works: [makeWork('BBB222', 'st2', 'Bob')], identified: 1 }));
    fns.addNewWorks
      .mockResolvedValueOnce({ total: 1, saved: 1, failed: 0 })
      .mockResolvedValueOnce({ total: 1, saved: 0, failed: 1 });

    const response = await send({ type: 'new-works-manual-check' });
    await flush();

    expect(fns.addNewWorks).toHaveBeenCalledTimes(2);
    expect(fns.addNewWorks.mock.calls[0][0]).toEqual([makeWork('AAA111')]);
    expect(response.result.savedTotal).toBe(1);
    expect(response.result.failedTotal).toBe(1);
    expect(response.result.errors).toEqual(['Bob: 0/1 个新作品未持久化到 IndexedDB']);
    expect('pendingWorks' in response.result).toBe(false);
    expect('breakdown' in response.result).toBe(false);
    expect('existingCount' in response.result).toBe(false);
  });

  it('入库抛错时按作品数计失败（旧兜底不变），且不进入收集字段', async () => {
    fns.getSubscriptions.mockResolvedValue([makeSub('st1', 'Alice')]);
    fns.checkActorNewWorksDetailed.mockResolvedValue(makeDetailed({
      works: [makeWork('AAA111'), makeWork('AAA222')],
      identified: 2,
    }));
    fns.addNewWorks.mockRejectedValue(new Error('idb boom'));

    const response = await send({ type: 'new-works-manual-check', confirmRequired: false });
    await flush();

    expect(response.result.failedTotal).toBe(2);
    expect(response.result.savedTotal).toBe(0);
    expect(response.result.errors).toEqual(['Alice: 新作品持久化异常 idb boom']);
    expect('pendingWorks' in response.result).toBe(false);
  });
});

describe("'new-works-manual-commit'（确认后统一落库）", () => {
  it('白名单重建后单次批量入库，多余字段丢弃、可选字段仅非空保留', async () => {
    fns.addNewWorks.mockResolvedValue({ total: 2, saved: 2, failed: 0 });
    const response = await send({
      type: 'new-works-manual-commit',
      works: [
        {
          ...makeWork('AAA111'),
          isRead: true,
          status: 'read',
          evil: 'x',
          nested: { deeper: true },
        },
        {
          id: ' AAA222 ',
          actorId: 'st1',
          actorName: 'Alice',
          title: ' no-trim ',
          tags: ['ok', 7, null],
          discoveredAt: '1700000000001',
          releaseDate: '   ',
          coverImage: '',
          javdbUrl: 'u',
        },
      ],
    } as any);
    await flush();

    expect(response).toEqual({ success: true, result: { requested: 2, total: 2, saved: 2, failed: 0 } });
    expect(fns.addNewWorks).toHaveBeenCalledTimes(1);
    const works = fns.addNewWorks.mock.calls[0][0];
    expect(works[0]).toEqual({
      id: 'AAA111',
      actorId: 'st1',
      actorName: 'Alice',
      title: 'title-AAA111',
      releaseDate: '2026-09-01',
      coverImage: 'https://example.invalid/c/AAA111.jpg',
      javdbUrl: 'https://example.invalid/v/AAA111',
      tags: ['chinese-subtitles'],
      discoveredAt: 1700000000000,
      isRead: true,
      status: 'new',
    });
    expect(Object.keys(works[1]).sort()).toEqual([
      'actorId', 'actorName', 'discoveredAt', 'id', 'isRead', 'javdbUrl', 'status', 'tags', 'title',
    ]);
    expect(works[1]).toMatchObject({ id: 'AAA222', title: 'no-trim', tags: ['ok'], discoveredAt: 1700000000001, isRead: false, status: 'new' });
  });

  it('缺 id 与重复 id 被剔除，全部非法时零写入仍回 success', async () => {
    fns.addNewWorks.mockResolvedValue({ total: 1, saved: 1, failed: 0 });
    const response = await send({
      type: 'new-works-manual-commit',
      works: [{ id: '   ' }, { id: 'AAA111' }, { id: 'AAA111' }, {}],
    } as any);
    await flush();

    expect(fns.addNewWorks).toHaveBeenCalledTimes(1);
    expect(fns.addNewWorks.mock.calls[0][0]).toHaveLength(1);
    expect(response.result).toEqual({ requested: 4, total: 1, saved: 1, failed: 0 });
  });

  it('空提交不调用入库，响应请求数为 0', async () => {
    const response = await send({ type: 'new-works-manual-commit', works: [] });
    await flush();
    expect(fns.addNewWorks).not.toHaveBeenCalled();
    expect(response).toEqual({ success: true, result: { requested: 0, total: 0, saved: 0, failed: 0 } });

    const malformed = await send({ type: 'new-works-manual-commit' } as any);
    await flush();
    expect(fns.addNewWorks).not.toHaveBeenCalled();
    expect(malformed.result.total).toBe(0);
  });

  it('入库异常回 success:false 带原因（UI 转 error toast 并 logError）', async () => {
    fns.addNewWorks.mockRejectedValue(new Error('quota exceeded'));
    const response = await send({ type: 'new-works-manual-commit', works: [makeWork('AAA111')] });
    await flush();
    expect(response).toEqual({ success: false, error: 'quota exceeded' });
  });

  it('commit 消息被路由接管（return true）', () => {
    const resolved: any[] = [];
    const handled = handleNewWorksRuntimeMessage({ type: 'new-works-manual-commit', works: [] } as any, r => resolved.push(r));
    expect(handled).toBe(true);
  });
});

describe("'new-works-check-single-actor'（订阅弹窗单演员扫描）", () => {
  const single = makeDetailed({
    works: [makeWork('AAA111')],
    identified: 6,
    effective: 5,
    filteredOut: 1,
    existingCount: 2,
    filterBreakdown: { dateRange: 1, viewed: 0, browsed: 0, want: 0, ar: 0, categoryBlack: 0 },
  });

  it('带标记：零写入，markSubscriptionChecked 仍在扫描完成时执行，响应追加 pendingWorks/breakdown', async () => {
    fns.checkActorNewWorksDetailed.mockResolvedValue(makeDetailed(single));

    const response = await send({
      type: 'new-works-check-single-actor',
      actorId: 'st1',
      actorName: 'Alice',
      confirmRequired: true,
    });
    await flush();

    expect(fns.addNewWorks).not.toHaveBeenCalled();
    expect(fns.markSubscriptionChecked).toHaveBeenCalledTimes(1);
    expect(fns.markSubscriptionChecked).toHaveBeenCalledWith('st1');
    expect(response.result).toMatchObject({
      discovered: 1,
      identified: 6,
      effective: 5,
      filteredOut: 1,
      existingCount: 2,
      workIds: ['AAA111'],
      saved: 0,
      failed: 0,
    });
    expect(response.result.pendingWorks).toEqual([makeWork('AAA111')]);
    expect(response.result.breakdown).toEqual(single.filterBreakdown);
  });

  it('无标记：照旧当场入库且响应不含收集字段（演员选择器/演员页按钮语义不变）', async () => {
    fns.checkActorNewWorksDetailed.mockResolvedValue(makeDetailed(single));
    fns.addNewWorks.mockResolvedValue({ total: 1, saved: 1, failed: 0 });

    const response = await send({ type: 'new-works-check-single-actor', actorId: 'st1', actorName: 'Alice' });
    await flush();

    expect(fns.addNewWorks).toHaveBeenCalledTimes(1);
    expect(fns.addNewWorks.mock.calls[0][0]).toEqual([makeWork('AAA111')]);
    expect(fns.markSubscriptionChecked).toHaveBeenCalledTimes(1);
    expect(response.result.saved).toBe(1);
    expect('pendingWorks' in response.result).toBe(false);
    expect('breakdown' in response.result).toBe(false);
  });

  it('缺演员信息仍直接拒绝（旧行为）', async () => {
    const response = await send({ type: 'new-works-check-single-actor', confirmRequired: true });
    await flush();
    expect(response).toEqual({ success: false, error: '缺少演员信息' });
    expect(fns.checkActorNewWorksDetailed).not.toHaveBeenCalled();
  });
});
