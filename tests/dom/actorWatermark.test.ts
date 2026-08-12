/**
 * @file actorWatermark.test.ts
 * @description actor watermark helpers 测试
 * @module tests/dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createActorDataCache,
  extractActorIdsFromListItem,
  extractActorsFromListItem,
  renderActorWatermark,
} from '../../apps/extension/src/features/listEnhancement/application/actorWatermark';
import type { ActorRecord } from '../../apps/extension/src/types';

function createActor(id: string, name: string, overrides: Partial<ActorRecord> = {}): ActorRecord {
  return {
    id,
    name,
    aliases: [],
    gender: 'female',
    category: 'unknown',
    profileUrl: `https://javdb.com/actors/${id}`,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function createListItem(actorIds: string[]): HTMLElement {
  const item = document.createElement('div');
  item.className = 'item';
  item.innerHTML = `
    <a class="cover" href="/v/test-code"></a>
    <div class="meta">
      ${actorIds.map(id => `<a href="/actors/${id}">${id}</a>`).join('')}
    </div>
  `;
  document.body.appendChild(item);
  return item;
}

describe('actor watermark helpers', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('extracts unique actor ids from a list item', () => {
    const item = createListItem(['actor-a', 'actor-b', 'actor-a']);

    expect(Array.from(extractActorIdsFromListItem(item))).toEqual(['actor-a', 'actor-b']);
  });

  it('loads actor records from DOM actor links with an upper bound', async () => {
    const actorA = createActor('actor-a', 'Actor A');
    const getActorById = vi.fn(async (id: string) => id === 'actor-a' ? actorA : null);
    const item = createListItem(['actor-a', 'actor-missing']);

    await expect(extractActorsFromListItem(item, { getActorById })).resolves.toEqual([actorA]);
    expect(getActorById).toHaveBeenCalledWith('actor-a');
    expect(getActorById).toHaveBeenCalledWith('actor-missing');
  });

  it('renders actor watermark badges with blacklist, subscription and favorite states', () => {
    const cover = document.createElement('a');
    cover.className = 'cover';
    document.body.appendChild(cover);

    renderActorWatermark(cover, [
      { actor: createActor('actor-black', 'Black Actor', { blacklisted: true }), isBlack: true, isSub: false },
      { actor: createActor('actor-sub', 'Sub Actor'), isBlack: false, isSub: true },
      { actor: createActor('actor-fav', 'Fav Actor'), isBlack: false, isSub: false },
    ], {
      opacity: 0.65,
      position: 'bottom-left',
    });

    const watermark = cover.querySelector('.x-actor-wm') as HTMLElement;
    expect(watermark).toBeTruthy();
    expect(watermark.classList.contains('pos-bottom-left')).toBe(true);
    expect(watermark.style.opacity).toBe('0.65');
    expect(Array.from(watermark.querySelectorAll('.x-actor-badge')).map(el => el.textContent)).toEqual(['黑', '订', '藏']);
  });

  it('reuses cached actor index until ttl expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    const actor = createActor('actor-a', 'Actor A', { aliases: ['A Alias'] });
    const getAllActors = vi.fn()
      .mockResolvedValueOnce([actor])
      .mockResolvedValueOnce([createActor('actor-b', 'Actor B')]);
    const getSubscriptions = vi.fn().mockResolvedValue([]);
    const cache = createActorDataCache({
      ttlMs: 5 * 60 * 1000,
      getAllActors,
      getSubscriptions,
    });

    const firstIndex = await cache.ensureActorIndex();
    const secondIndex = await cache.ensureActorIndex();
    expect(firstIndex).toBe(secondIndex);
    expect(firstIndex.get('actor a')).toEqual(actor);
    expect(firstIndex.get('a alias')).toEqual(actor);
    expect(getAllActors).toHaveBeenCalledTimes(1);

    vi.setSystemTime(1_000 + 5 * 60 * 1000 + 1);
    const refreshedIndex = await cache.ensureActorIndex();
    expect(refreshedIndex).not.toBe(firstIndex);
    expect(getAllActors).toHaveBeenCalledTimes(2);
  });

  it('resolves actor ids from the shared index without extra per-card reads', async () => {
    const actor = createActor('actor-a', 'Actor A');
    const getAllActors = vi.fn().mockResolvedValue([actor]);
    const getSubscriptions = vi.fn().mockResolvedValue([]);
    const cache = createActorDataCache({ getAllActors, getSubscriptions });

    await expect(cache.getActorById('actor-a')).resolves.toBe(actor);
    await expect(cache.getActorById('actor-a')).resolves.toBe(actor);

    expect(getAllActors).toHaveBeenCalledTimes(1);
  });
});
