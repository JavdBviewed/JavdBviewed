/**
 * @file actorCardDeleteButtonPosition.test.ts
 * @description 10-17-actor-card-delete-pos：卡片视图删除按钮移到卡片右上角（布局/DOM 源码锁）；
 *              列表视图底部行 7 按钮零改动（负锁）。
 * @module tests/dom
 */
import { describe, expect, it } from 'vitest';
import type { ActorRecord } from '../../apps/extension/types';
import { buildActorCardHtml } from '../../apps/extension/src/dashboard/tabs/actors/cardViewModel';

function actor(): ActorRecord {
  return {
    id: 'actor-1',
    name: 'Alice "Queen"',
    aliases: ['A-1'],
    gender: 'female',
    category: 'censored',
    profileUrl: 'https://javdb.com/actors/actor-1',
    createdAt: 1,
    updatedAt: 1,
    details: { worksCount: 8 },
    syncInfo: { source: 'javdb', lastSyncAt: new Date('2026-05-01T00:00:00Z').getTime(), syncStatus: 'success' },
  };
}

function renderCard(viewMode: 'list' | 'card'): HTMLElement {
  document.body.innerHTML = buildActorCardHtml(actor(), {
    viewMode,
    isSubscribed: true,
    showBlacklistBadge: false,
  });
  return document.querySelector('.actor-card') as HTMLElement;
}

function bottomButtons(card: HTMLElement): HTMLElement[] {
  return Array.from(card.querySelectorAll('.actor-card-actions button'));
}

// 卡片视图底部行 6 按钮目标顺序（顺序不变，删除移出后）
const CARD_BOTTOM_ORDER = [
  'actor-works-btn',
  'actor-edit-btn',
  'actor-refresh-btn',
  'actor-blacklist-toggle-btn',
  'actor-favorite-toggle-btn',
  'actor-subscribe-toggle-btn',
];

// 列表视图底部行 7 按钮原顺序（负锁：零改动）
const LIST_BOTTOM_ORDER = [
  'actor-works-btn',
  'actor-edit-btn',
  'actor-refresh-btn',
  'actor-delete-btn',
  'actor-blacklist-toggle-btn',
  'actor-favorite-toggle-btn',
  'actor-subscribe-toggle-btn',
];

function buttonKindClasses(el: HTMLElement): string[] {
  return Array.from(el.classList).filter(c => c !== 'actor-action-btn');
}

describe('actors card view：删除按钮移到卡片右上角（10-17 布局锁）', () => {
  it('底部 .actor-card-actions 恰 6 按钮且顺序不变（查看作品/编辑源数据/刷新元数据/拉黑/收藏/订阅）', () => {
    const card = renderCard('card');
    const bottom = bottomButtons(card);
    expect(bottom).toHaveLength(6);
    bottom.forEach((btn, i) => {
      expect(buttonKindClasses(btn)).toContain(CARD_BOTTOM_ORDER[i]);
    });
  });

  it('删除按钮不在底部操作行内', () => {
    const card = renderCard('card');
    expect(card.querySelector('.actor-card-actions .actor-delete-btn')).toBeNull();
  });

  it('删除按钮在卡片右上角：卡片根直接子 + 定位修饰类 + class/data-actor-id/title/fa-trash 全保留', () => {
    const card = renderCard('card');
    const del = card.querySelector('.actor-delete-btn') as HTMLElement;
    expect(del).toBeTruthy();
    // 绝对定位相对 .actor-card 根 → 结构上须为卡片根直接子
    expect(del.parentElement).toBe(card);
    expect(del.classList.contains('actor-action-btn')).toBe(true);
    expect(del.classList.contains('actor-delete-btn')).toBe(true);
    expect(del.classList.contains('actor-card-top-delete')).toBe(true);
    expect(del.dataset.actorId).toBe('actor-1');
    expect(del.getAttribute('title')).toBe('删除');
    expect(del.querySelector('i')?.className).toContain('fa-trash');
  });

  it('每卡唯一删除按钮（移出后不产生第二份）', () => {
    const card = renderCard('card');
    expect(card.querySelectorAll('.actor-delete-btn')).toHaveLength(1);
  });
});

describe('actors list view：底部 7 按钮零改动（负锁）', () => {
  it('列表视图底部行仍恰 7 按钮且原顺序（删除居第 4，刷新后、拉黑前）', () => {
    const card = renderCard('list');
    const bottom = bottomButtons(card);
    expect(bottom).toHaveLength(7);
    bottom.forEach((btn, i) => {
      expect(buttonKindClasses(btn)).toContain(LIST_BOTTOM_ORDER[i]);
    });
  });

  it('列表视图删除按钮仍在底部操作行内（未跟随卡片视图上移）', () => {
    const card = renderCard('list');
    const del = card.querySelector('.actor-delete-btn') as HTMLElement;
    expect(del).toBeTruthy();
    expect(del.closest('.actor-card-actions')).not.toBeNull();
    // 负锁：列表视图不加卡片右上角定位修饰类
    expect(del.classList.contains('actor-card-top-delete')).toBe(false);
  });
});
