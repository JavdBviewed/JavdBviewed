/**
 * @file actorPenetrationCache.test.ts
 * @description 穿透缓存值扩展 categories 的兼容性单测
 * （08-29-actor-passthrough-category-filter P1）：
 * - 旧缓存（无 categories 字段）读回 → undefined，不触发类别隐藏
 * - 新缓存（含 categories）读回/写回保持
 * 通过 mock platform/storage/cache 隔离 chrome.storage。
 * @module features/listEnhancement/actorPenetration
 */
import { describe, expect, it, vi, type MockedFunction } from 'vitest';

const getMock = vi.fn();
const setMock = vi.fn(async () => undefined);
vi.mock('../../../platform/storage/cache', () => ({
  globalCache: {
    get: (...args: unknown[]) => getMock(...args),
    set: (...args: unknown[]) => setMock(...args),
  },
}));

import {
  readActorPenetrationCache,
  writeActorPenetrationSuccess,
} from './actorPenetrationCache';

const NOW = Date.now();

describe('ActorPenetrationCacheValue.categories 兼容', () => {
  it('旧缓存（无 categories 字段）读回为 undefined，其余字段完整', async () => {
    getMock.mockResolvedValue({
      actors: [{ id: 'a1', name: '演员一', href: '/actors/a1', gender: 'female' }],
      hasMore: false,
      fetchedAt: NOW,
    });
    const result = await readActorPenetrationCache('ABC-123');
    expect(result.status).toBe('hit');
    if (result.status !== 'hit') throw new Error('unreachable');
    expect(result.value.categories).toBeUndefined();
    expect(result.value.actors).toHaveLength(1);
    expect(result.value.hasMore).toBe(false);
    expect(result.value.fetchedAt).toBe(NOW);
  });

  it('新缓存（含 categories）读回保持 entryKey 列表', async () => {
    getMock.mockResolvedValue({
      actors: [],
      hasMore: false,
      fetchedAt: NOW,
      categories: ['c4=17', 'c7=28'],
    });
    const result = await readActorPenetrationCache('abc-123'); // 键规范化
    expect(result.status).toBe('hit');
    if (result.status !== 'hit') throw new Error('unreachable');
    expect(result.value.categories).toEqual(['c4=17', 'c7=28']);
  });

  it('categories 为 null（脏数据）读回归一为 undefined', async () => {
    getMock.mockResolvedValue({ actors: [], hasMore: false, fetchedAt: NOW, categories: null });
    const result = await readActorPenetrationCache('ABC-123');
    expect(result.status).toBe('hit');
    if (result.status !== 'hit') throw new Error('unreachable');
    expect(result.value.categories).toBeUndefined();
  });

  it('写成功缓存时 categories 一并持久化', async () => {
    await writeActorPenetrationSuccess('ABC-123', {
      actors: [],
      hasMore: false,
      fetchedAt: NOW,
      categories: ['c1=157'],
    });
    expect(setMock).toHaveBeenCalledOnce();
    const [key, value, ttl] = setMock.mock.calls[0] as [string, unknown, number];
    expect(key).toBe('actorPenetration:abc-123');
    expect((value as { categories?: string[] }).categories).toEqual(['c1=157']);
    expect(ttl).toBeGreaterThan(0);
  });
});
