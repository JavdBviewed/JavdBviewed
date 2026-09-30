/**
 * @file subscribedActorIds.test.ts
 * @description 演员订阅 ID 数据源单测（09-30-popup-actorfilter-subscribed）
 *
 * 锁三条口径：
 * 1) 只计 enabled === true（缺 enabled 的存量记录按未启用处理 = 零命中零误隐方向）；
 * 2) 惰性读 + 单飞 + TTL 缓存（并发卡片共用一次 storage 读）；
 * 3) invalidate 后重读；读取失败按空集合且不写缓存（下次重试）。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  collectEnabledActorIds,
  createSubscribedActorIdsSource,
} from './subscribedActorIds';

describe('collectEnabledActorIds 只计启用中的订阅', () => {
  it('enabled===true 计入；false/缺省/非法条目一律不计', () => {
    const ids = collectEnabledActorIds({
      k1: { actorId: 'a1', enabled: true },
      k2: { actorId: 'a2', enabled: false },
      k3: { actorId: 'a3' }, // 存量记录缺 enabled → 按未启用（不误隐）
      k4: { actorId: '', enabled: true }, // 无有效 actorId → 丢弃
      k5: { enabled: true }, // 无 actorId 字段 → 丢弃
      k6: null,
      k7: 'not-an-object',
    });
    expect([...ids].sort()).toEqual(['a1']);
  });

  it('非对象入参（null / 数组 / undefined）→ 空集合', () => {
    expect(collectEnabledActorIds(undefined).size).toBe(0);
    expect(collectEnabledActorIds(null).size).toBe(0);
    expect(collectEnabledActorIds([]).size).toBe(0);
    expect(collectEnabledActorIds({}).size).toBe(0);
  });
});

describe('createSubscribedActorIdsSource 惰性读 + 缓存 + 失效', () => {
  it('构造时不读；首次 get 读一次；后续命中缓存', async () => {
    const read = vi.fn(async () => ({ a: { actorId: 'a1', enabled: true } }));
    const source = createSubscribedActorIdsSource({ readSubscriptions: read });

    expect(read).not.toHaveBeenCalled();
    const first = await source.get();
    expect(first).toEqual(new Set(['a1']));
    await source.get();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('并发 get 单飞（同一次 storage 读）', async () => {
    let resolveRead: ((v: unknown) => void) | null = null;
    const read = vi.fn(() => new Promise<unknown>((resolve) => {
      resolveRead = resolve;
    }));
    const source = createSubscribedActorIdsSource({ readSubscriptions: read });

    const p1 = source.get();
    const p2 = source.get();
    resolveRead!({ a: { actorId: 'x', enabled: true } });
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(read).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(new Set(['x']));
    expect(r2).toEqual(r1);
  });

  it('invalidate → 下次 get 重读（storage.onChanged 接线口径）', async () => {
    let payload: unknown = { a: { actorId: 'a1', enabled: true } };
    const read = vi.fn(async () => payload);
    const source = createSubscribedActorIdsSource({ readSubscriptions: read });

    expect(await source.get()).toEqual(new Set(['a1']));
    payload = { b: { actorId: 'b2', enabled: true }, c: { actorId: 'c3', enabled: false } };
    // 未失效前仍是旧缓存（写侧刚变更但缓存未清 → 不重复打 storage）
    expect(await source.get()).toEqual(new Set(['a1']));
    source.invalidate();
    expect(await source.get()).toEqual(new Set(['b2']));
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('TTL 过期 → 自动重读', async () => {
    const read = vi.fn(async () => ({ a: { actorId: 'a1', enabled: true } }));
    const source = createSubscribedActorIdsSource({ readSubscriptions: read, ttlMs: 1 });

    await source.get();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await source.get();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('读取失败 → 空集合且不写缓存（下次重试），不抛到调用方', async () => {
    const read = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce({ a: { actorId: 'a1', enabled: true } });
    const logger = vi.fn();
    const source = createSubscribedActorIdsSource({ readSubscriptions: read, logger });

    expect(await source.get()).toEqual(new Set());
    expect(await source.get()).toEqual(new Set(['a1']));
    expect(read).toHaveBeenCalledTimes(2);
    expect(logger).toHaveBeenCalled();
  });
});
