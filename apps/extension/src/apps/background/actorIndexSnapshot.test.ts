/**
 * @file actorIndexSnapshot.test.ts
 * @description SW 侧共享演员索引快照单测（S1-1a：列表 cold 相位治理）
 */
import { describe, expect, it, vi } from 'vitest';
import { ACTOR_INDEX_SNAPSHOT_TTL_MS, createActorIndexSnapshot } from './actorIndexSnapshot';
import type { ActorRecord } from '../../types';

function makeActor(over: Partial<ActorRecord>): ActorRecord {
  return {
    id: 'a1',
    name: '测试演员',
    aliases: [],
    gender: 'female',
    category: 'unknown',
    profileUrl: '/actors/a1',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe('actorIndexSnapshot', () => {
  it('默认 TTL 与内容侧 actorDataCache 对齐（5 分钟）', () => {
    expect(ACTOR_INDEX_SNAPSHOT_TTL_MS).toBe(5 * 60 * 1000);
  });

  it('并发 get 合并为一次 loadAll，且返回相同结果', async () => {
    const loadAll = vi.fn().mockResolvedValue([makeActor({ id: 'a1', name: '甲' })]);
    const snap = createActorIndexSnapshot({ loadAll });

    const [r1, r2] = await Promise.all([snap.get(), snap.get()]);

    expect(loadAll).toHaveBeenCalledTimes(1);
    expect(r1.items).toEqual(r2.items);
    expect(snap.hasSnapshot()).toBe(true);
  });

  it('TTL 内命中缓存，过期后重新读取', async () => {
    let nowMs = 1_000_000;
    const loadAll = vi
      .fn()
      .mockResolvedValueOnce([makeActor({ id: 'a1', name: '甲' })])
      .mockResolvedValueOnce([makeActor({ id: 'a1', name: '甲改' })]);
    const snap = createActorIndexSnapshot({ loadAll, ttlMs: 60_000, now: () => nowMs });

    const first = await snap.get();
    expect(first.items[0].name).toBe('甲');
    expect(loadAll).toHaveBeenCalledTimes(1);

    nowMs += 30_000; // TTL 内
    const cached = await snap.get();
    expect(cached.items[0].name).toBe('甲');
    expect(loadAll).toHaveBeenCalledTimes(1);

    nowMs += 31_000; // 超出 TTL
    const reloaded = await snap.get();
    expect(reloaded.items[0].name).toBe('甲改');
    expect(loadAll).toHaveBeenCalledTimes(2);
  });

  it('invalidate 后强制重新读取', async () => {
    const loadAll = vi
      .fn()
      .mockResolvedValueOnce([makeActor({ id: 'a1', name: '甲' })])
      .mockResolvedValueOnce([makeActor({ id: 'a1', name: '甲改' })]);
    const snap = createActorIndexSnapshot({ loadAll });

    await snap.get();
    snap.invalidate();
    expect(snap.hasSnapshot()).toBe(false);
    const next = await snap.get();
    expect(next.items[0].name).toBe('甲改');
    expect(loadAll).toHaveBeenCalledTimes(2);
  });

  it('构建期间失效（generation 竞态）：结果不落入快照，响应仍返回构建值，下次 get 重读', async () => {
    let invalidateDuringBuild: (() => void) | null = null;
    let call = 0;
    const loadAll = vi.fn().mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return new Promise<ActorRecord[]>(resolve => {
          invalidateDuringBuild = () => {
            snap.invalidate();
            resolve([makeActor({ id: 'a1', name: '甲' })]);
          };
        });
      }
      return Promise.resolve([makeActor({ id: 'a1', name: '甲改' })]);
    });
    const snap = createActorIndexSnapshot({ loadAll });

    const p = snap.get();
    expect(invalidateDuringBuild).not.toBeNull();
    invalidateDuringBuild!();
    const built = await p;
    expect(built.items[0].name).toBe('甲'); // 响应仍返回本次构建值
    expect(snap.hasSnapshot()).toBe(false); // 但未落入快照

    const next = await snap.get();
    expect(next.items[0].name).toBe('甲改'); // 下次 get 重新读取
    expect(loadAll).toHaveBeenCalledTimes(2);
  });

  it('slim 投影：aliases 是副本、blacklisted 归一、重字段剔除', async () => {
    const source = makeActor({
      id: 'a1',
      name: '甲',
      aliases: ['别名1', '别名2'],
      blacklisted: true,
      wikiData: { age: 30, heightCm: 160 },
      syncInfo: { source: 'javdb', lastSyncAt: 0, syncStatus: 'success' },
    });
    const snap = createActorIndexSnapshot({ loadAll: () => Promise.resolve([source]) });
    const { items } = await snap.get();

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ id: 'a1', name: '甲', aliases: ['别名1', '别名2'], blacklisted: true });
    expect('wikiData' in items[0]).toBe(false);
    expect('syncInfo' in items[0]).toBe(false);
    expect(items[0].aliases).not.toBe(source.aliases); // 副本而非引用

    // 修改投影结果不影响源数据
    items[0].aliases.push('篡改');
    expect(source.aliases).toEqual(['别名1', '别名2']);
  });

  it('blacklisted 为 undefined 时归一为 false', async () => {
    const snap = createActorIndexSnapshot({ loadAll: () => Promise.resolve([makeActor({ id: 'a2' })]) });
    const { items } = await snap.get();
    expect(items[0].blacklisted).toBe(false);
  });

  it('favorited absent 时省略不序列化（快照保持小，内容侧按 !== false 判为已收藏）', async () => {
    const snap = createActorIndexSnapshot({ loadAll: () => Promise.resolve([makeActor({ id: 'a1' })]) });
    const { items } = await snap.get();
    expect('favorited' in items[0]).toBe(false);
    // 内容侧判定口径：缺省 = 已收藏
    expect(items[0].favorited !== false).toBe(true);
  });

  it('favorited 显式 false / true 时原样透传', async () => {
    const snap = createActorIndexSnapshot({
      loadAll: () =>
        Promise.resolve([
          makeActor({ id: 'a1', name: '未收藏', favorited: false }),
          makeActor({ id: 'a2', name: '显式收藏', favorited: true }),
        ]),
    });
    const { items } = await snap.get();
    // 按 id 取（items 按名称 localeCompare 升序，下标不表达语义）
    const byId = new Map(items.map(a => [a.id, a]));
    expect(byId.get('a1')?.favorited).toBe(false);
    expect(byId.get('a1')?.favorited !== false).toBe(false);
    expect(byId.get('a2')?.favorited).toBe(true);
    expect(byId.get('a2')?.favorited !== false).toBe(true);
  });

  it('排除软删除记录（deletedAt）', async () => {
    const snap = createActorIndexSnapshot({
      loadAll: () =>
        Promise.resolve([
          makeActor({ id: 'a1', name: '在' }),
          makeActor({ id: 'a2', name: '删', deletedAt: 123 }),
        ]),
    });
    const { items, total } = await snap.get();
    expect(items.map(a => a.id)).toEqual(['a1']);
    expect(total).toBe(1);
  });

  it('按名称升序（忽略大小写）', async () => {
    const snap = createActorIndexSnapshot({
      loadAll: () =>
        Promise.resolve([
          makeActor({ id: 'b', name: 'bob' }),
          makeActor({ id: 'a', name: 'Alice' }),
          makeActor({ id: 'c', name: 'carol' }),
        ]),
    });
    const { items } = await snap.get();
    expect(items.map(a => a.id)).toEqual(['a', 'b', 'c']);
  });
});
