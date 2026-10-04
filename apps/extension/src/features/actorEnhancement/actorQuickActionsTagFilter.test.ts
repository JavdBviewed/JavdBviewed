/**
 * @file actorQuickActionsTagFilter.test.ts
 * @description 演员页「类别标签过滤链接」守卫纯函数单测（10-15-issue-53-actor-cat-hover）。
 *
 * 背景：站点演员页（/actors/<ID>）的类别标签云是同演员 URL 的查询变体
 * （/actors/<ID>?t=<N>&sort_type=<K>），此前被 a[href*="/actors/"] 选择器误当演员链接增强，
 * hover 弹出「演员快捷操作」卡（issue #53 现象）。守卫 isActorTagFilterLink 判定这类链接，
 * enhanceActorLink 对其直接跳过（不置 data 标）。
 */
import { describe, expect, it } from 'vitest';
import { isActorTagFilterLink } from './actorQuickActionsManager';

const ACTOR_PAGE = 'https://javdb.com/actors/MmnyQ';

describe('isActorTagFilterLink（守卫：同 pathname + 有 query = 标签过滤链接）', () => {
  it('演员页 + 同 pathname + 查询变体 → true（绝对/相对 href 均可）', () => {
    expect(isActorTagFilterLink('https://javdb.com/actors/MmnyQ?t=48&sort_type=0', ACTOR_PAGE)).toBe(true);
    expect(isActorTagFilterLink('/actors/MmnyQ?t=s&sort_type=0', ACTOR_PAGE)).toBe(true);
  });

  it('演员页 + 同 pathname + 裸链接（无 query，演员自己名链接）→ false（行为不变）', () => {
    expect(isActorTagFilterLink('/actors/MmnyQ', ACTOR_PAGE)).toBe(false);
  });

  it('演员页 + 异 pathname（其他演员链接，带不带 query 都）→ false（行为不变）', () => {
    expect(isActorTagFilterLink('/actors/OtherId', ACTOR_PAGE)).toBe(false);
    expect(isActorTagFilterLink('/actors/OtherId?t=48', ACTOR_PAGE)).toBe(false);
  });

  it('非演员页（影片页）→ false（守卫仅演员页生效，影片页链接行为零变化）', () => {
    expect(isActorTagFilterLink('/v/NQ6pPb?foo=1', 'https://javdb.com/v/NQ6pPb')).toBe(false);
    expect(isActorTagFilterLink('/actors/MmnyQ?t=48', 'https://javdb.com/v/NQ6pPb')).toBe(false);
  });

  it('畸形 URL 不抛错，返回 false', () => {
    expect(isActorTagFilterLink('', '')).toBe(false);
    expect(isActorTagFilterLink('/actors/MmnyQ?t=48', 'not-a-url')).toBe(false);
  });
});
