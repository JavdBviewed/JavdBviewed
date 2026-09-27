import { describe, expect, it } from 'vitest';
import type { ActorRecord } from '../../../types';
import { buildActorCardHtml, getActorCategoryText, getActorSyncStatusText } from './cardViewModel';

function actor(overrides: Partial<ActorRecord> = {}): ActorRecord {
  return {
    id: 'actor-1',
    name: 'Alice "Queen"',
    aliases: ['A-1', "Alice's Alt"],
    gender: 'female',
    category: 'censored',
    profileUrl: 'https://javdb.com/actors/actor-1',
    createdAt: 1,
    updatedAt: 1,
    details: { worksCount: 8 },
    syncInfo: { source: 'javdb', lastSyncAt: new Date('2026-05-01T00:00:00Z').getTime(), syncStatus: 'success' },
    ...overrides,
  };
}

describe('actors card view model', () => {
  it('renders identity, aliases, actions and subscription state', () => {
    const html = buildActorCardHtml(actor(), { isSubscribed: true, showBlacklistBadge: false });

    expect(html).toContain('data-actor-id="actor-1"');
    expect(html).toContain('data-actor-name="Alice \\"Queen\\""');
    expect(html).toContain('actor-subscribed-icon');
    expect(html).toContain('Alice&#39;s Alt');
    expect(html).toContain('actor-works-count">8 作品');
    expect(html).toContain('data-sub="1"');
    expect(html).toContain('fa-bell-slash');
  });

  it('renders blacklist badge and opacity when enabled', () => {
    const html = buildActorCardHtml(actor({ blacklisted: true }), {
      isSubscribed: false,
      showBlacklistBadge: true,
    });

    expect(html).toContain('data-blacklisted="true"');
    expect(html).toContain('style="opacity:0.5;"');
    expect(html).toContain('actor-badge-blacklisted');
    expect(html).toContain('title="取消拉黑"');
  });

  it('renders favorite toggle: 缺省已收藏（实心星 + 取消收藏）', () => {
    const html = buildActorCardHtml(actor(), { isSubscribed: false, showBlacklistBadge: false });

    expect(html).toContain('actor-favorite-toggle-btn');
    expect(html).toContain('data-fav="1"');
    expect(html).toContain('title="取消收藏"');
    expect(html).toContain('fas fa-star');
  });

  it('renders favorite toggle: 显式未收藏（空心星 + 收藏）', () => {
    const html = buildActorCardHtml(actor({ favorited: false }), {
      isSubscribed: false,
      showBlacklistBadge: false,
    });

    expect(html).toContain('data-fav="0"');
    expect(html).toContain('title="收藏"');
    expect(html).toContain('far fa-star');
  });

  it('renders category and sync text helpers', () => {
    expect(getActorCategoryText('uncensored')).toBe('无码');
    expect(getActorCategoryText('western')).toBe('欧美');
    expect(getActorCategoryText('unknown')).toBe('未知');
    expect(getActorSyncStatusText('success')).toBe('已同步');
    expect(getActorSyncStatusText('failed')).toBe('同步失败');
    expect(getActorSyncStatusText('pending')).toBe('同步中');
    expect(getActorSyncStatusText(undefined)).toBe('未同步');
  });
});
