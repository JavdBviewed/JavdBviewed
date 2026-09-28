/**
 * @vitest-environment jsdom
 * @file actorPenetrationCategories.test.ts
 * @description 穿透运行时类别解析/回调单测（08-29-actor-passthrough-category-filter P1）：
 * - 一次 fetch 同时产出 actors + categories（写缓存合并）
 * - onCategoriesResolved：新抓取与缓存命中均触发；旧缓存（无 categories）不触发、不崩
 * @module features/listEnhancement/actorPenetration
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActorPenetrationRuntime } from './actorPenetrationRuntime';
import type { ActorPenetrationCacheResult, ActorPenetrationCacheValue } from './actorPenetrationCache';
import type { DetailActor } from './parseDetailActors';

const FEMALE = [
  { id: 'a1', name: '演员一', href: '/actors/a1', gender: 'female' },
] as DetailActor[];

/** 详情页 HTML：演員面板 + 類別面板（c4=17 巨乳 / c7=28 單體作品，均在内置字典内）。 */
const DETAIL_HTML = `
<html><body>
  <div class="panel-block"><strong>演員:</strong>
    <span class="value"><a class="actor-female" href="/actors/a1">演员一</a></span>
  </div>
  <div class="panel-block"><strong>類別:</strong>
    <span class="value"><a href="/tags?c4=17">巨乳</a>, <a href="/tags?c7=28">單體作品</a></span>
  </div>
</body></html>`;

function makeItem(): HTMLElement {
  const item = document.createElement('div');
  item.className = 'item';
  item.innerHTML = '<div class="video-title"><strong>ABC-123</strong></div>';
  document.body.appendChild(item);
  return item;
}

function makeCacheMock() {
  const store = new Map<string, { value?: ActorPenetrationCacheValue; failed?: boolean }>();
  return {
    store,
    readCache: vi.fn(async (code: string): Promise<ActorPenetrationCacheResult> => {
      const entry = store.get(code);
      if (!entry) return { status: 'miss' };
      if (entry.failed) return { status: 'failed' };
      return { status: 'hit', value: entry.value! };
    }),
    writeSuccess: vi.fn(async (code: string, value: ActorPenetrationCacheValue) => {
      store.set(code, { value });
    }),
    writeFailure: vi.fn(async () => undefined),
    writeLoginRequired: vi.fn(async () => undefined),
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

/** 英文详情页变体（镜像 Accept-Language）：面板标签 "Tags:"，演员标签 "Actor(s):"。 */
const DETAIL_HTML_EN = `
<html><body>
  <div class="panel-block"><strong>Actor(s):</strong>
    <span class="value"><a class="actor-female" href="/actors/a1">演员一</a></span>
  </div>
  <div class="panel-block"><strong>Tags:</strong>
    <span class="value"><a href="/tags?c4=17">Big Breasts</a>, <a href="/tags?c7=28">Solowork</a></span>
  </div>
</body></html>`;

describe('ActorPenetrationRuntime 类别解析（P1）', () => {
  it('新鲜抓取：categories 写入缓存并触发 onCategoriesResolved', async () => {
    const cache = makeCacheMock();
    const onCategoriesResolved = vi.fn();
    const fetchText = vi.fn(async () => ({ html: DETAIL_HTML, finalUrl: 'https://javdb.com/v/abc-123' }));
    const runtime = createActorPenetrationRuntime({
      ...cache,
      fetchText,
      bindQuickActions: vi.fn(),
      onCategoriesResolved,
    });
    const item = makeItem();
    await runtime.process({ item, code: 'ABC-123', detailUrl: 'https://javdb.com/v/abc-123' });

    expect(fetchText).toHaveBeenCalledOnce();
    // 演员行仍正常渲染
    expect(item.querySelectorAll('a.x-ap-actor').length).toBe(1);
    // 缓存值携带 categories
    expect(cache.writeSuccess).toHaveBeenCalledOnce();
    const written = (cache.writeSuccess.mock.calls[0] as [string, ActorPenetrationCacheValue])[1];
    expect(written.categories).toEqual(['c4=17', 'c7=28']);
    // 回调收到同一列表
    expect(onCategoriesResolved).toHaveBeenCalledOnce();
    expect(onCategoriesResolved).toHaveBeenCalledWith(item, ['c4=17', 'c7=28']);
  });

  it('英文详情页变体（Tags 面板）：categories 同样解析并回调（09-28 真机根因回归）', async () => {
    const cache = makeCacheMock();
    const onCategoriesResolved = vi.fn();
    const fetchText = vi.fn(async () => ({ html: DETAIL_HTML_EN, finalUrl: 'https://javdb.com/v/abc-123' }));
    const runtime = createActorPenetrationRuntime({
      ...cache,
      fetchText,
      bindQuickActions: vi.fn(),
      onCategoriesResolved,
    });
    const item = makeItem();
    await runtime.process({ item, code: 'ABC-123', detailUrl: 'https://javdb.com/v/abc-123' });

    expect(item.querySelectorAll('a.x-ap-actor').length).toBe(1);
    const written = (cache.writeSuccess.mock.calls[0] as [string, ActorPenetrationCacheValue])[1];
    expect(written.categories).toEqual(['c4=17', 'c7=28']);
    expect(onCategoriesResolved).toHaveBeenCalledOnce();
    expect(onCategoriesResolved).toHaveBeenCalledWith(item, ['c4=17', 'c7=28']);
  });

  it('缓存命中（新格式含 categories）：不请求，仍触发 onCategoriesResolved', async () => {
    const cache = makeCacheMock();
    await cache.writeSuccess('ABC-123', {
      actors: FEMALE,
      hasMore: false,
      fetchedAt: Date.now(),
      categories: ['c7=330'],
    });
    const fetchText = vi.fn(async () => { throw new Error('should not fetch'); });
    const onCategoriesResolved = vi.fn();
    const runtime = createActorPenetrationRuntime({
      ...cache,
      fetchText,
      bindQuickActions: vi.fn(),
      onCategoriesResolved,
    });
    const item = makeItem();
    await runtime.process({ item, code: 'ABC-123', detailUrl: 'https://javdb.com/v/abc-123' });

    expect(fetchText).not.toHaveBeenCalled();
    expect(onCategoriesResolved).toHaveBeenCalledWith(item, ['c7=330']);
  });

  it('缓存命中（旧格式无 categories）：不触发回调、不崩、演员行照常', async () => {
    const cache = makeCacheMock();
    // 旧值：无 categories 字段（存量 7 天缓存兼容路径）
    await cache.writeSuccess('ABC-123', { actors: FEMALE, hasMore: false, fetchedAt: Date.now() });
    const onCategoriesResolved = vi.fn();
    const runtime = createActorPenetrationRuntime({
      ...cache,
      bindQuickActions: vi.fn(),
      onCategoriesResolved,
    });
    const item = makeItem();
    await expect(
      runtime.process({ item, code: 'ABC-123', detailUrl: 'https://javdb.com/v/abc-123' }),
    ).resolves.toBeUndefined();
    expect(onCategoriesResolved).not.toHaveBeenCalled();
    expect(item.querySelectorAll('a.x-ap-actor').length).toBe(1);
  });

  it('详情页无類別面板：categories 为空数组（稳定事实），回调仍触发', async () => {
    const cache = makeCacheMock();
    const onCategoriesResolved = vi.fn();
    const noCategoryHtml = `
<html><body>
  <div class="panel-block"><strong>演員:</strong>
    <span class="value"><a class="actor-female" href="/actors/a1">演员一</a></span>
  </div>
</body></html>`;
    const runtime = createActorPenetrationRuntime({
      ...cache,
      fetchText: vi.fn(async () => ({ html: noCategoryHtml, finalUrl: 'https://javdb.com/v/abc-123' })),
      bindQuickActions: vi.fn(),
      onCategoriesResolved,
    });
    const item = makeItem();
    await runtime.process({ item, code: 'ABC-123', detailUrl: 'https://javdb.com/v/abc-123' });
    expect(onCategoriesResolved).toHaveBeenCalledWith(item, []);
  });
});
