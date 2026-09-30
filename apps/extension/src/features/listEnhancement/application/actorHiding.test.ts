/**
 * @file actorHiding.test.ts
 * @description 演员隐藏决策单测（09-28-actor-favorited-field：favorited 真白名单口径
 * + B2 空库保护锁定）。
 *
 * 口径：favorited 缺省 = 已收藏，显式 false = 未收藏（favorited !== false）；
 * 拉黑（blacklisted）与收藏正交、可并存，拉黑不改变收藏判定。
 */
import { describe, expect, it } from 'vitest';
import {
  decideActorHiding,
  type ActorHidingDecisionInput,
} from './actorHiding';
import { decideCategoryHide } from './actorHidingWorkflow';
import type { ActorIndexRecord } from '../../../types';

const actor = (id: string, over: Partial<ActorIndexRecord> = {}): ActorIndexRecord => ({
  id,
  name: id,
  aliases: [],
  ...over,
});

const input = (over: Partial<ActorHidingDecisionInput> = {}): ActorHidingDecisionInput => ({
  hideByBlacklist: false,
  hideByNonFavorited: true,
  hideUnrecognized: false,
  domActorIds: new Set(),
  actors: [],
  actorIndexSize: 0,
  ...over,
});

describe('decideActorHiding favorited 真白名单语义（09-28-actor-favorited-field）', () => {
  it('[fav 缺省] → 不隐藏（缺省 = 已收藏）', () => {
    const d = decideActorHiding(input({
      actors: [actor('a1')],
      actorIndexSize: 10,
    }));
    expect(d.reason).toBeNull();
    expect(d.matchedNonFavorited).toBe(false);
    expect(d.hasAnyFavoritedActor).toBe(true);
  });

  it('[fav 显式 true] → 不隐藏', () => {
    const d = decideActorHiding(input({
      actors: [actor('a1', { favorited: true })],
      actorIndexSize: 10,
    }));
    expect(d.reason).toBeNull();
    expect(d.hasAnyFavoritedActor).toBe(true);
  });

  it('[unfav] → 按 ACTOR_NOT_FAVORITED 隐藏', () => {
    const d = decideActorHiding(input({
      actors: [actor('a1', { favorited: false })],
      actorIndexSize: 10,
    }));
    expect(d.reason).toBe('ACTOR_NOT_FAVORITED');
    expect(d.matchedNonFavorited).toBe(true);
    expect(d.hasAnyFavoritedActor).toBe(false);
  });

  it('[unfav, fav] → 不隐藏（任一收藏即显示）', () => {
    const d = decideActorHiding(input({
      actors: [actor('a1', { favorited: false }), actor('a2')],
      actorIndexSize: 10,
    }));
    expect(d.reason).toBeNull();
    expect(d.matchedNonFavorited).toBe(false);
    expect(d.hasAnyFavoritedActor).toBe(true);
  });

  it('[unfav, unfav] → 隐藏', () => {
    const d = decideActorHiding(input({
      actors: [actor('a1', { favorited: false }), actor('a2', { favorited: false })],
      actorIndexSize: 10,
    }));
    expect(d.reason).toBe('ACTOR_NOT_FAVORITED');
    expect(d.matchedNonFavorited).toBe(true);
    expect(d.hasAnyFavoritedActor).toBe(false);
  });

  it('[blacklisted, fav 缺省] → 本开关不隐藏（拉黑与收藏正交，是黑名单开关职责）', () => {
    const d = decideActorHiding(input({
      actors: [actor('a1', { blacklisted: true }), actor('a2', { blacklisted: true })],
      actorIndexSize: 10,
    }));
    expect(d.reason).toBeNull();
    expect(d.matchedNonFavorited).toBe(false);
    expect(d.hasAnyFavoritedActor).toBe(true);
  });

  it('[blacklisted, unfav] + 黑名单开关开 → reason 取 ACTOR_BLACKLIST（优先级）', () => {
    const d = decideActorHiding(input({
      hideByBlacklist: true,
      actors: [actor('a1', { blacklisted: true, favorited: false })],
      actorIndexSize: 10,
    }));
    expect(d.reason).toBe('ACTOR_BLACKLIST');
    expect(d.matchedBlack).toBe(true);
    expect(d.matchedNonFavorited).toBe(true);
  });

  it('DOM 有演员链接但本地无记录 → 按 ACTOR_NOT_FAVORITED 隐藏（case1 照旧）', () => {
    const d = decideActorHiding(input({ domActorIds: new Set(['a-x']) }));
    expect(d.reason).toBe('ACTOR_NOT_FAVORITED');
    expect(d.matchedNonFavorited).toBe(true);
  });

  it('无任何演员信息 → 归 unrecognized 逻辑（unrecognized 开 + 库非空才隐藏）', () => {
    const hidden = decideActorHiding(input({ hideUnrecognized: true, actorIndexSize: 3 }));
    expect(hidden.reason).toBe('ACTOR_NOT_FAVORITED');

    const notHidden = decideActorHiding(input({ hideUnrecognized: false, actorIndexSize: 3 }));
    expect(notHidden.reason).toBeNull();
  });

  it('关闭 nonFavorited 开关时不参与该路径决策', () => {
    const d = decideActorHiding(input({
      hideByNonFavorited: false,
      actors: [actor('a1', { favorited: false })],
      actorIndexSize: 10,
    }));
    expect(d.reason).toBeNull();
    expect(d.hasAnyFavoritedActor).toBeNull();
  });
});

describe('decideActorHiding B2 空演员库保护（空库 → 不隐藏）', () => {
  it('空演员库 + 无任何演员信息 + nonFavorited 开 → 不隐藏（空库保护）', () => {
    const d = decideActorHiding(input({
      hideUnrecognized: true,
      actorIndexSize: 0,
    }));
    expect(d.reason).toBeNull();
    expect(d.matchedNonFavorited).toBe(false);
  });

  it('非空库 + 无任何演员信息 + nonFavorited 开 + unrecognized 开 → 按 ACTOR_NOT_FAVORITED 隐藏', () => {
    const d = decideActorHiding(input({
      hideUnrecognized: true,
      actorIndexSize: 3,
    }));
    expect(d.reason).toBe('ACTOR_NOT_FAVORITED');
  });

  it('非空库 + 无任何演员信息 + nonFavorited 开 + unrecognized 关 → 不隐藏（「无匹配」不等于「全未收藏」）', () => {
    const d = decideActorHiding(input({
      actorIndexSize: 3,
    }));
    expect(d.reason).toBeNull();
  });
});


describe('decideActorHiding 已订阅演员命中（09-30-popup-actorfilter-subscribed）', () => {
  it('不传 hideBySubscribed（存量调用）→ 即便订阅集合命中也不隐藏（零行为漂移）', () => {
    const d = decideActorHiding(input({
      hideByNonFavorited: false,
      subscribedActorIds: new Set(['a1']),
      domActorIds: new Set(['a1']),
    }));
    expect(d.matchedSubscribed).toBe(false);
    expect(d.reason).toBeNull();
  });

  it('hideBySubscribed=true + DOM 演员 ID 命中 → ACTOR_SUBSCRIBED', () => {
    const d = decideActorHiding(input({
      hideByNonFavorited: false,
      hideBySubscribed: true,
      subscribedActorIds: new Set(['a1']),
      domActorIds: new Set(['a1']),
    }));
    expect(d.matchedSubscribed).toBe(true);
    expect(d.reason).toBe('ACTOR_SUBSCRIBED');
  });

  it('hideBySubscribed=true + 本地匹配演员 ID 命中 → ACTOR_SUBSCRIBED', () => {
    const d = decideActorHiding(input({
      hideByNonFavorited: false,
      hideBySubscribed: true,
      subscribedActorIds: new Set(['a2']),
      actors: [actor('a2')],
      actorIndexSize: 10,
    }));
    expect(d.matchedSubscribed).toBe(true);
    expect(d.reason).toBe('ACTOR_SUBSCRIBED');
  });

  it('hideBySubscribed=true + 订阅集合为空/未命中 → 不隐藏（匹配不到演员不受影响）', () => {
    const empty = decideActorHiding(input({
      hideByNonFavorited: false,
      hideBySubscribed: true,
      subscribedActorIds: new Set(),
      domActorIds: new Set(['a1']),
    }));
    expect(empty.matchedSubscribed).toBe(false);
    expect(empty.reason).toBeNull();

    const miss = decideActorHiding(input({
      hideByNonFavorited: false,
      hideBySubscribed: true,
      subscribedActorIds: new Set(['other']),
      domActorIds: new Set(['a1']),
      actors: [actor('a1')],
      actorIndexSize: 10,
    }));
    expect(miss.matchedSubscribed).toBe(false);
    expect(miss.reason).toBeNull();
  });

  it('既有 reason 优先（订阅命中排末位）：黑名单+订阅同时命中 → ACTOR_BLACKLIST', () => {
    const d = decideActorHiding(input({
      hideByBlacklist: true,
      hideByNonFavorited: false,
      hideBySubscribed: true,
      subscribedActorIds: new Set(['a1']),
      domActorIds: new Set(['a1']),
      actors: [actor('a1', { blacklisted: true })],
      actorIndexSize: 10,
    }));
    expect(d.reason).toBe('ACTOR_BLACKLIST');
    expect(d.matchedSubscribed).toBe(true);
  });
});


describe('decideCategoryHide（命中隐藏纯判定，09-29-cftabs）', () => {
  const sel = (keys: string[]) => new Set(keys);

  it('勾选集合为空 → no-op 不隐藏', () => {
    expect(decideCategoryHide(['c4=17'], sel([]))).toBe(false);
    expect(decideCategoryHide([], sel([]))).toBe(false);
  });

  it('命中勾选集合 = 隐藏；未命中 = 放行', () => {
    expect(decideCategoryHide(['c4=17', 'c1=157'], sel(['c7=28', 'c4=17']))).toBe(true);
    expect(decideCategoryHide(['c1=157'], sel(['c7=28']))).toBe(false);
  });

  it('卡片类别未解析（空集合）→ 放行', () => {
    expect(decideCategoryHide([], sel(['c4=17']))).toBe(false);
  });
});