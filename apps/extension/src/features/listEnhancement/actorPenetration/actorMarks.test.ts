/**
 * @file actorMarks.test.ts
 * @description 演员名称标识判定测试（纯函数 + 异常回退）
 * @module features/listEnhancement/actorPenetration
 */
import { describe, expect, it, vi } from 'vitest';
import { resolveActorLinkMark, resolveActorMarkFor } from './actorMarks';
import type { ActorRecord } from '../../../types';

const record = (over: Partial<ActorRecord>): ActorRecord => ({
  id: 'a1',
  name: '演员',
  aliases: [],
  gender: 'female',
  category: 'unknown',
  profileUrl: '/actors/a1',
  createdAt: 0,
  updatedAt: 0,
  syncInfo: { source: 'javdb', lastSyncAt: 0, syncStatus: 'success' },
  ...over,
});

const subs = (ids: string[]) => ({ subscribedActorIds: new Set(ids) });

describe('resolveActorLinkMark', () => {
  it('无任何状态时返回 undefined', () => {
    expect(resolveActorLinkMark('a1', null, subs([]))).toBeUndefined();
  });

  it('黑名单优先：红 + 删除线标识', () => {
    const mark = resolveActorLinkMark('a1', record({ blacklisted: true }), subs([]));
    expect(mark).toEqual({ status: 'blacklisted', title: '黑名单' });
  });

  it('已收藏（非黑名单）→ 绿色标识', () => {
    const mark = resolveActorLinkMark('a1', record({}), subs([]));
    expect(mark).toEqual({ status: 'collected', title: '已收藏' });
  });

  it('已收藏且已订阅 → 收藏标识 + 订阅提示', () => {
    const mark = resolveActorLinkMark('a1', record({}), subs(['a1']));
    expect(mark).toEqual({ status: 'collected', title: '已收藏 · 已订阅' });
  });

  it('仅订阅（未收藏）→ 订阅标识', () => {
    const mark = resolveActorLinkMark('a1', null, subs(['a1']));
    expect(mark).toEqual({ status: 'subscribed', title: '已订阅' });
  });
});

describe('resolveActorMarkFor', () => {
  it('按 id 查询记录并合并订阅', async () => {
    const getActorById = vi.fn().mockResolvedValue(record({}));
    const mark = await resolveActorMarkFor('a1', { getActorById, subscribedActorIds: new Set(['a1']) });
    expect(mark).toEqual({ status: 'collected', title: '已收藏 · 已订阅' });
    expect(getActorById).toHaveBeenCalledWith('a1');
  });

  it('空 id 直接返回 undefined', async () => {
    const getActorById = vi.fn();
    expect(await resolveActorMarkFor('', { getActorById, subscribedActorIds: new Set() })).toBeUndefined();
    expect(getActorById).not.toHaveBeenCalled();
  });

  it('查询抛错时回退 undefined', async () => {
    const getActorById = vi.fn().mockRejectedValue(new Error('boom'));
    expect(await resolveActorMarkFor('a1', { getActorById, subscribedActorIds: new Set() })).toBeUndefined();
  });
});
