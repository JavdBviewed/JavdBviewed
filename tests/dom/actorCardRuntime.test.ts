/**
 * @file actorCardRuntime.test.ts
 * @description actor card runtime 测试
 * @module tests/dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setupActorCardRuntime,
  type ActorCardRuntimeHandlers,
} from '../../apps/extension/src/dashboard/tabs/actors/actorCardRuntime';

function renderActorCard() {
  document.body.innerHTML = `
    <div class="actor-card" data-actor-id="actor-1" data-blacklisted="false" data-fav="1">
      <div class="actor-card-name" data-actor-id="actor-1" data-actor-name="Alice">
        <i class="actor-name-copy-icon fas fa-copy"></i>
      </div>
      <div class="actor-alias" data-actor-id="actor-1" data-actor-name="Alice Alt">
        <i class="actor-alias-copy-icon fas fa-copy"></i>
      </div>
      <button class="actor-works-btn" data-actor-id="actor-1"></button>
      <button class="actor-edit-btn" data-actor-id="actor-1"></button>
      <button class="actor-refresh-btn" data-actor-id="actor-1"></button>
      <button class="actor-delete-btn" data-actor-id="actor-1"></button>
      <button class="actor-blacklist-toggle-btn" data-actor-id="actor-1"></button>
      <button class="actor-favorite-toggle-btn" data-actor-id="actor-1" title="取消收藏">
        <i class="fas fa-star"></i>
      </button>
      <button class="aliases-toggle-btn" data-actor-id="actor-1"></button>
      <button class="actor-subscribe-toggle-btn" data-actor-id="actor-1" data-sub="0" title="订阅">
        <i class="fas fa-bell"></i>
      </button>
    </div>
  `;
}

function handlers(overrides: Partial<ActorCardRuntimeHandlers> = {}): ActorCardRuntimeHandlers {
  return {
    copyActorName: vi.fn(),
    openActorWorks: vi.fn(),
    editActorSourceData: vi.fn(),
    refreshActorMetadata: vi.fn().mockResolvedValue({
      success: true,
      changes: {
        nameChanged: false,
        avatarChanged: false,
        genderChanged: false,
        categoryChanged: false,
      },
    }),
    deleteActor: vi.fn(),
    toggleBlacklisted: vi.fn().mockResolvedValue(undefined),
    toggleFavorited: vi.fn().mockResolvedValue(undefined),
    toggleAliasesExpansion: vi.fn(),
    checkAliasesOverflow: vi.fn(),
    addSubscription: vi.fn().mockResolvedValue(undefined),
    removeSubscription: vi.fn().mockResolvedValue(undefined),
    isSubscribedOnly: () => false,
    reloadActors: vi.fn().mockResolvedValue(undefined),
    showMessage: vi.fn(),
    logError: vi.fn(),
    ...overrides,
  };
}

describe('actor card runtime', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('binds copy and command buttons for an actor card', () => {
    renderActorCard();
    const h = handlers();

    setupActorCardRuntime('actor-1', h);

    document.querySelector<HTMLElement>('.actor-card-name')?.click();
    document.querySelector<HTMLElement>('.actor-alias')?.click();
    document.querySelector<HTMLElement>('.actor-works-btn')?.click();
    document.querySelector<HTMLElement>('.actor-edit-btn')?.click();
    document.querySelector<HTMLElement>('.actor-delete-btn')?.click();
    document.querySelector<HTMLElement>('.aliases-toggle-btn')?.click();

    expect(h.copyActorName).toHaveBeenCalledWith('actor-1', 'Alice', expect.any(MouseEvent));
    expect(h.copyActorName).toHaveBeenCalledWith('actor-1', 'Alice Alt', expect.any(MouseEvent));
    expect(h.openActorWorks).toHaveBeenCalledWith('actor-1');
    expect(h.editActorSourceData).toHaveBeenCalledWith('actor-1');
    expect(h.deleteActor).toHaveBeenCalledWith('actor-1');
    expect(h.toggleAliasesExpansion).toHaveBeenCalledWith('actor-1');
    expect(h.checkAliasesOverflow).toHaveBeenCalledWith('actor-1');
  });

  it('guards refresh clicks and restores button state', async () => {
    renderActorCard();
    const h = handlers();

    setupActorCardRuntime('actor-1', h);
    const refreshBtn = document.querySelector<HTMLButtonElement>('.actor-refresh-btn')!;
    refreshBtn.click();
    refreshBtn.click();

    await vi.waitFor(() => {
      expect(h.refreshActorMetadata).toHaveBeenCalledTimes(1);
      expect(h.showMessage).toHaveBeenCalledWith(expect.stringContaining('演员元数据已刷新'), 'success');
    });
    expect(refreshBtn.disabled).toBe(false);
    expect(refreshBtn.classList.contains('refreshing')).toBe(false);
  });

  it('favorite toggle: 默认已收藏（data-fav 缺省/1）点击 → toggleFavorited(id, true)', async () => {
    renderActorCard();
    const h = handlers();
    setupActorCardRuntime('actor-1', h);

    document.querySelector<HTMLElement>('.actor-favorite-toggle-btn')?.click();
    await vi.waitFor(() => {
      expect(h.toggleFavorited).toHaveBeenCalledWith('actor-1', true);
    });
  });

  it('favorite toggle: data-fav=0（未收藏）点击 → toggleFavorited(id, false)', async () => {
    renderActorCard();
    const card = document.querySelector<HTMLElement>('.actor-card')!;
    card.dataset.fav = '0';
    const h = handlers();
    setupActorCardRuntime('actor-1', h);

    document.querySelector<HTMLElement>('.actor-favorite-toggle-btn')?.click();
    await vi.waitFor(() => {
      expect(h.toggleFavorited).toHaveBeenCalledWith('actor-1', false);
    });
  });

  it('favorite toggle: 切换失败 → 提示错误', async () => {
    renderActorCard();
    const h = handlers({ toggleFavorited: vi.fn().mockRejectedValue(new Error('boom')) });
    setupActorCardRuntime('actor-1', h);

    document.querySelector<HTMLElement>('.actor-favorite-toggle-btn')?.click();
    await vi.waitFor(() => {
      expect(h.showMessage).toHaveBeenCalledWith('切换收藏状态失败', 'error');
    });
  });

  it('shows wiki fetch failures from actor metadata refresh results', async () => {
    renderActorCard();
    const h = handlers({
      refreshActorMetadata: vi.fn().mockResolvedValue({
        success: true,
        changes: {
          nameChanged: false,
          avatarChanged: false,
          genderChanged: false,
          categoryChanged: false,
        },
        wikiFailures: [
          { source: 'xslist', message: 'HTTP 403', statusCode: 403, reason: 'cloudflare_challenge' },
        ],
      }),
    });

    setupActorCardRuntime('actor-1', h);
    document.querySelector<HTMLButtonElement>('.actor-refresh-btn')?.click();

    await vi.waitFor(() => {
      expect(h.showMessage).toHaveBeenCalledWith(
        expect.stringContaining('xslist: HTTP 403（Cloudflare challenge）'),
        'warning',
      );
    });
  });

  it('toggles blacklist and subscription states', async () => {
    renderActorCard();
    const h = handlers();

    setupActorCardRuntime('actor-1', h);
    document.querySelector<HTMLButtonElement>('.actor-blacklist-toggle-btn')?.click();
    document.querySelector<HTMLButtonElement>('.actor-subscribe-toggle-btn')?.click();

    await vi.waitFor(() => {
      expect(h.toggleBlacklisted).toHaveBeenCalledWith('actor-1', false);
      expect(h.addSubscription).toHaveBeenCalledWith('actor-1');
    });

    const subBtn = document.querySelector<HTMLButtonElement>('.actor-subscribe-toggle-btn')!;
    expect(subBtn.dataset.sub).toBe('1');
    expect(subBtn.title).toBe('取消订阅');
    expect(subBtn.querySelector('i')?.classList.contains('fa-bell-slash')).toBe(true);
  });
});
