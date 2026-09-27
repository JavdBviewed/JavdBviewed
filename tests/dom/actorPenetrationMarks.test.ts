/**
 * @file actorPenetrationMarks.test.ts
 * @description 列表演员行名称标识 DOM 测试（09-28-actor-favorited-field）：
 * 绿标状态（收藏/缺省收藏 → 绿色）与未收藏无绿标（favorited=false）。
 * @module tests/dom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { renderActorRow, type ActorRowRenderInput } from '../../apps/extension/src/features/listEnhancement/actorPenetration/renderActorRow';
import { resolveActorLinkMark } from '../../apps/extension/src/features/listEnhancement/actorPenetration/actorMarks';
import type { ActorIndexRecord } from '../../apps/extension/src/types';
import type { DetailActor } from '../../apps/extension/src/features/listEnhancement/actorPenetration/parseDetailActors';

function record(id: string, over: Partial<ActorIndexRecord> = {}): ActorIndexRecord {
  return {
    id,
    name: id,
    aliases: [],
    ...over,
  };
}

function renderItem(): HTMLElement {
  const item = document.createElement('div');
  item.className = 'item';
  item.innerHTML = `
    <div class="video-title"><a class="video-title-link" href="/v/abc123">ABC-123</a></div>
    <span class="video-date">2026-09-28</span>
  `;
  document.body.appendChild(item);
  return item;
}

/** 与 listEnhancementManager 同一套注入：按本地 slim 记录 + 订阅集合解析标识。 */
function makeGetActorMark(
  records: ActorIndexRecord[],
  subscribedActorIds: Set<string> = new Set(),
): NonNullable<ActorRowRenderInput['getActorMark']> {
  return (actorId: string) => {
    const rec = records.find(r => r.id === actorId) ?? null;
    return resolveActorLinkMark(actorId, rec, { subscribedActorIds });
  };
}

function renderRow(item: HTMLElement, actors: DetailActor[], getActorMark?: NonNullable<ActorRowRenderInput['getActorMark']>): void {
  renderActorRow({ item, actors, getActorMark });
}

describe('列表演员行绿标（favorited 口径）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('库内记录 fav 缺省 → 绿标（绿色 + 已收藏提示）', () => {
    const item = renderItem();
    renderRow(
      item,
      [{ id: 'a1', name: '演员甲', href: '/actors/a1', gender: 'female' }],
      makeGetActorMark([record('a1')]),
    );

    const link = item.querySelector<HTMLAnchorElement>('a.x-ap-actor[data-actor-id="a1"]');
    expect(link).not.toBeNull();
    // jsdom 将 hex 颜色规范化为 rgb() 读回（#2e7d32 = rgb(46, 125, 50)）
    expect(link!.style.color).toBe('rgb(46, 125, 50)');
    expect(link!.title).toBe('已收藏');
  });

  it('显式 favorited=true → 绿标', () => {
    const item = renderItem();
    renderRow(
      item,
      [{ id: 'a1', name: '演员甲', href: '/actors/a1', gender: 'female' }],
      makeGetActorMark([record('a1', { favorited: true })]),
    );

    const link = item.querySelector<HTMLAnchorElement>('a.x-ap-actor[data-actor-id="a1"]');
    // jsdom 将 hex 颜色规范化为 rgb() 读回（#2e7d32 = rgb(46, 125, 50)）
    expect(link!.style.color).toBe('rgb(46, 125, 50)');
    expect(link!.title).toBe('已收藏');
  });

  it('favorited=false（未收藏）→ 无绿标（颜色不置绿、提示保持默认名称）', () => {
    const item = renderItem();
    renderRow(
      item,
      [{ id: 'a1', name: '演员甲', href: '/actors/a1', gender: 'female' }],
      makeGetActorMark([record('a1', { favorited: false })]),
    );

    const link = item.querySelector<HTMLAnchorElement>('a.x-ap-actor[data-actor-id="a1"]');
    expect(link).not.toBeNull();
    expect(link!.style.color).toBe('');
    expect(link!.style.textDecoration).toBe('');
    expect(link!.title).toBe('演员甲');
  });

  it('favorited=false + 已订阅 → 无绿标但订阅 🔔 独立可叠加', () => {
    const item = renderItem();
    renderRow(
      item,
      [{ id: 'a1', name: '演员甲', href: '/actors/a1', gender: 'female' }],
      makeGetActorMark([record('a1', { favorited: false })], new Set(['a1'])),
    );

    const link = item.querySelector<HTMLAnchorElement>('a.x-ap-actor[data-actor-id="a1"]');
    expect(link!.style.color).toBe('');
    const badge = item.querySelector<HTMLSpanElement>('.x-ap-actor-sub');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe('🔔');
  });

  it('收藏 + 订阅 → 绿标且 title 组合「已收藏 · 已订阅」（不重复 🔔）', () => {
    const item = renderItem();
    renderRow(
      item,
      [{ id: 'a1', name: '演员甲', href: '/actors/a1', gender: 'female' }],
      makeGetActorMark([record('a1')], new Set(['a1'])),
    );

    const link = item.querySelector<HTMLAnchorElement>('a.x-ap-actor[data-actor-id="a1"]');
    // jsdom 将 hex 颜色规范化为 rgb() 读回（#2e7d32 = rgb(46, 125, 50)）
    expect(link!.style.color).toBe('rgb(46, 125, 50)');
    expect(link!.title).toBe('已收藏 · 已订阅');
    expect(item.querySelector('.x-ap-actor-sub')).toBeNull();
  });

  it('拉黑优先：favorited=false + blacklisted → 红字删除线（正交并存）', () => {
    const item = renderItem();
    renderRow(
      item,
      [{ id: 'a1', name: '演员甲', href: '/actors/a1', gender: 'female' }],
      makeGetActorMark([record('a1', { favorited: false, blacklisted: true })]),
    );

    const link = item.querySelector<HTMLAnchorElement>('a.x-ap-actor[data-actor-id="a1"]');
    // jsdom 规范化：#d32f2f = rgb(211, 47, 47)
    expect(link!.style.color).toBe('rgb(211, 47, 47)');
    expect(link!.style.textDecoration).toBe('line-through');
    expect(link!.title).toBe('黑名单');
  });
});
