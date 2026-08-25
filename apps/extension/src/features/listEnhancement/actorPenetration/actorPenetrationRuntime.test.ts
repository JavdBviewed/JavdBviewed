/**
 * @vitest-environment jsdom
 * @file actorPenetrationRuntime.test.ts
 * @description 演员穿透运行时测试：缓存命中、失败抑制、幂等、失败回退、清理
 * 通过注入 mock 缓存与快捷操作绑定，隔离 chrome.storage 依赖。
 * @module features/listEnhancement/actorPenetration
 */
import { describe, expect, it, vi } from 'vitest';
import { createActorPenetrationRuntime } from './actorPenetrationRuntime';
import type { ActorPenetrationCacheResult, ActorPenetrationCacheValue } from './actorPenetrationCache';
import type { DetailActor } from './parseDetailActors';

const FEMALE = [
  { id: 'a1', name: '演员一', href: '/actors/a1', gender: 'female' },
  { id: 'a2', name: '演员二', href: '/actors/a2', gender: 'female' },
] as DetailActor[];

function makeItem(): HTMLElement {
  const item = document.createElement('div');
  item.className = 'item';
  const title = document.createElement('div');
  title.className = 'video-title';
  title.innerHTML = '<strong>ABC-123</strong>';
  item.appendChild(title);
  document.body.appendChild(item);
  return item;
}

const FEMALE_HTML = `
<html><body><div class="panel-block"><strong>演員</strong>
<div class="value"><a href="/actors/a1">演员一</a><a href="/actors/a2">演员二</a></div>
</div></body></html>`;

/** 内存版缓存 mock。 */
function makeCacheMock() {
  const store = new Map<string, { value?: ActorPenetrationCacheValue; failed?: boolean }>();
  return {
    readCache: vi.fn(async (code: string): Promise<ActorPenetrationCacheResult> => {
      const entry = store.get(code);
      if (!entry) return { status: 'miss' };
      if (entry.failed) return { status: 'failed' };
      return { status: 'hit', value: entry.value! };
    }),
    writeSuccess: vi.fn(async (code: string, value: ActorPenetrationCacheValue) => {
      store.set(code, { value });
    }),
    writeFailure: vi.fn(async (code: string) => {
      store.set(code, { failed: true });
    }),
  };
}

const noopBind = vi.fn();

describe('ActorPenetrationRuntime', () => {
  it('缓存命中时直接渲染，不发起详情请求', async () => {
    const cache = makeCacheMock();
    await cache.writeSuccess('ABC-123', { actors: FEMALE, hasMore: false, fetchedAt: Date.now() });
    const fetchText = vi.fn(async () => { throw new Error('should not fetch'); });
    const runtime = createActorPenetrationRuntime({ ...cache, fetchText, bindQuickActions: noopBind });
    const item = makeItem();
    await runtime.process({ item, code: 'ABC-123', detailUrl: '/v/ABC-123' });
    expect(fetchText).not.toHaveBeenCalled();
    expect(item.querySelectorAll('a.x-ap-actor').length).toBe(2);
    item.remove();
  });

  it('未命中时请求详情并渲染，随后写成功缓存', async () => {
    const cache = makeCacheMock();
    const fetchText = vi.fn(async () => FEMALE_HTML);
    const runtime = createActorPenetrationRuntime({ ...cache, fetchText, bindQuickActions: noopBind });
    const item = makeItem();
    await runtime.process({ item, code: 'XYZ-001', detailUrl: '/v/XYZ-001' });
    expect(fetchText).toHaveBeenCalledTimes(1);
    expect(item.querySelectorAll('a.x-ap-actor').length).toBe(2);
    expect(cache.writeSuccess).toHaveBeenCalledWith('XYZ-001', expect.objectContaining({ hasMore: false }));
    item.remove();
  });

  it('请求失败后写失败缓存并抑制重试', async () => {
    const cache = makeCacheMock();
    const fetchText = vi.fn(async () => { throw new Error('network down'); });
    const runtime = createActorPenetrationRuntime({ ...cache, fetchText, bindQuickActions: noopBind, timeoutMs: 50 });
    const item = makeItem();
    await runtime.process({ item, code: 'ERR-999', detailUrl: '/v/ERR-999' });
    expect(item.querySelector('a.x-ap-actor')).toBeNull();
    expect(cache.writeFailure).toHaveBeenCalledWith('ERR-999');

    // 第二次：失败短缓存抑制，不再请求
    await runtime.process({ item, code: 'ERR-999', detailUrl: '/v/ERR-999' });
    expect(fetchText).toHaveBeenCalledTimes(1);
    item.remove();
  });

  it('同一番号并发时只请求一次（幂等）', async () => {
    const cache = makeCacheMock();
    let release!: () => void;
    const pending = new Promise<void>(r => { release = r; });
    const fetchText = vi.fn(async () => {
      await pending;
      return FEMALE_HTML;
    });
    const runtime = createActorPenetrationRuntime({ ...cache, fetchText, bindQuickActions: noopBind, timeoutMs: 5000 });
    const item = makeItem();
    void runtime.process({ item, code: 'DUP-1', detailUrl: '/v/DUP-1' });
    void runtime.process({ item, code: 'DUP-1', detailUrl: '/v/DUP-1' });
    release();
    await vi.waitFor(() => expect(fetchText).toHaveBeenCalledTimes(1));
    item.remove();
  });

  it('clear 移除演员行', async () => {
    const cache = makeCacheMock();
    await cache.writeSuccess('CLR-1', { actors: FEMALE, hasMore: false, fetchedAt: Date.now() });
    const runtime = createActorPenetrationRuntime({ ...cache, fetchText: async () => FEMALE_HTML, bindQuickActions: noopBind });
    const item = makeItem();
    await runtime.process({ item, code: 'CLR-1', detailUrl: '/v/CLR-1' });
    expect(item.querySelectorAll('a.x-ap-actor').length).toBe(2);
    runtime.clear(item);
    expect(item.querySelector('[data-x-ap-actor-row]')).toBeNull();
    item.remove();
  });
});
