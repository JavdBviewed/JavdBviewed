/**
 * @file actorSync.merge.test.ts
 * @description JavDB 收藏同步合并逻辑单测（09-28-actor-favorited-field）：
 * 手动编辑字段（manuallyEditedFields）同步保护——模拟同步写不覆盖 fav=false，
 * 以及既有合并口径（别名合并 / 创建时间保留 / 性别分类非 forceUpdate 不覆盖）。
 */
import { describe, expect, it } from 'vitest';
import { mergeSyncedActor } from './actorSync';
import type { ActorRecord } from '../../types';

function actor(over: Partial<ActorRecord>): ActorRecord {
  return {
    id: 'a1',
    name: '测试演员',
    aliases: [],
    gender: 'unknown',
    category: 'unknown',
    profileUrl: 'https://javdb.com/actors/a1',
    createdAt: 1_000_000,
    updatedAt: 1_000_000,
    ...over,
  };
}

const NOW = 2_000_000;

describe('mergeSyncedActor favorited 同步保护', () => {
  it('手动设未收藏（favorited=false + manuallyEditedFields 含 favorited）→ 同步写不覆盖', () => {
    const existing = actor({
      name: '本地名',
      gender: 'female',
      favorited: false,
      manuallyEditedFields: ['favorited'],
    });
    // JavDB 侧下发的记录从不带 favorited（收藏是本地概念，同步只拉收藏列表成员）
    const incoming = actor({ name: '远端名', aliases: ['远端别名'] });

    const merged = mergeSyncedActor(existing, incoming, false, NOW);

    expect(merged.favorited).toBe(false);
    expect(merged.favorited !== false).toBe(false);
    expect(merged.manuallyEditedFields).toEqual(['favorited']);
  });

  it('取消收藏后再次收藏（favorited=true + 标记保留）→ 同步写不覆盖', () => {
    const existing = actor({
      favorited: true,
      manuallyEditedFields: ['favorited'],
    });
    const incoming = actor({});

    const merged = mergeSyncedActor(existing, incoming, false, NOW);

    expect(merged.favorited).toBe(true);
    expect(merged.manuallyEditedFields).toEqual(['favorited']);
  });

  it('无手动标记（favorited absent）→ 同步不写该字段（缺省 = 已收藏，零回填）', () => {
    const existing = actor({});
    const incoming = actor({});

    const merged = mergeSyncedActor(existing, incoming, false, NOW);

    expect('favorited' in merged).toBe(false);
    expect(merged.manuallyEditedFields).toBeUndefined();
  });

  it('多个手动编辑字段并存：favorited 与其他锁定字段同时受保护', () => {
    const existing = actor({
      name: '本地锁定名',
      gender: 'unknown', // 未锁定：unknown 时按同步策略取远端
      blacklisted: true,
      favorited: false,
      manuallyEditedFields: ['name', 'blacklisted', 'favorited'],
    });
    const incoming = actor({ name: '远端名', gender: 'male', category: 'uncensored' });

    const merged = mergeSyncedActor(existing, incoming, false, NOW);

    expect(merged.name).toBe('本地锁定名');
    expect(merged.gender).toBe('male'); // 未锁定字段仍按同步策略
    expect(merged.category).toBe('uncensored'); // 未锁定字段仍按同步策略
    expect(merged.blacklisted).toBe(true);
    expect(merged.favorited).toBe(false);
    expect(merged.manuallyEditedFields).toEqual(['name', 'blacklisted', 'favorited']);
  });
});

describe('mergeSyncedActor 既有合并口径不回归', () => {
  it('别名合并去重 / 创建时间保留 / updatedAt 更新', () => {
    const existing = actor({ aliases: ['本地别名'] });
    const incoming = actor({ aliases: ['远端别名', '本地别名'], createdAt: 999 });

    const merged = mergeSyncedActor(existing, incoming, false, NOW);

    expect(merged.aliases).toEqual(['本地别名', '远端别名']);
    expect(merged.createdAt).toBe(1_000_000);
    expect(merged.updatedAt).toBe(NOW);
  });

  it('非 forceUpdate：性别/分类已有值时保留本地', () => {
    const existing = actor({ gender: 'female', category: 'censored' });
    const incoming = actor({ gender: 'male', category: 'uncensored' });

    const merged = mergeSyncedActor(existing, incoming, false, NOW);

    expect(merged.gender).toBe('female');
    expect(merged.category).toBe('censored');
  });

  it('forceUpdate：性别/分类以远端为准（未手动锁定）', () => {
    const existing = actor({ gender: 'female', category: 'censored' });
    const incoming = actor({ gender: 'male', category: 'uncensored' });

    const merged = mergeSyncedActor(existing, incoming, true, NOW);

    expect(merged.gender).toBe('male');
    expect(merged.category).toBe('uncensored');
  });
});
