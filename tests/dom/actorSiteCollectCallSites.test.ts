/**
 * @file actorSiteCollectCallSites.test.ts
 * @description 演员收藏站点同步两调用点锁（10-05-actor-site-collect）：
 *   调用点 A（影片/列表页快捷卡）：收藏 → 本地写入先行 + 站点 collect 恰一次
 *     （POST/credentials/头形状）；站点失败 → 本地结果不变 + 轻 toast「站点收藏失败」；
 *     取消收藏 → 本地删除 + 零站点调用（never-uncollect 负锁）。
 *   调用点 B（演员页页载对齐）：站点已收藏 ∧ 本地未收藏 → 静默补齐（零 toast）；
 *     favorited 缺省=已收藏（!== false 纪律）；站点未收藏/无锚点 → 零写。
 * @module tests/dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ actors: {} as Record<string, any> }));

vi.mock('../../apps/extension/src/features/actors', () => ({
  actorManager: {
    getActorById: vi.fn(async (id: string) => store.actors[id] ?? null),
    saveActor: vi.fn(async (a: any) => { store.actors[a.id] = a; }),
    deleteActor: vi.fn(async (id: string) => {
      const had = !!store.actors[id];
      delete store.actors[id];
      return had;
    }),
    setBlacklisted: vi.fn(async () => undefined),
  },
}));
vi.mock('../../apps/extension/src/features/newWorks', () => ({
  newWorksManager: {
    getSubscriptions: vi.fn(async () => []),
    addSubscription: vi.fn(async () => undefined),
    removeSubscription: vi.fn(async () => undefined),
  },
}));
vi.mock('../../apps/extension/src/utils/storage', () => ({
  getValue: vi.fn(),
  setValue: vi.fn(),
  getSettings: vi.fn(() => Promise.resolve({})),
}));
vi.mock('../../apps/extension/src/platform/browser/toast', () => ({
  showToast: vi.fn(),
}));
vi.mock('../../apps/extension/src/features/actorRemarks', () => ({
  actorExtraInfoService: {},
}));
vi.mock('../../apps/extension/src/platform/tasks', () => ({
  completeManagedTask: vi.fn(),
  createManagedTaskDescriptor: vi.fn(),
  ensureManagedTaskRegistered: vi.fn(),
  failManagedTask: vi.fn(),
  requestTaskLease: vi.fn(),
  trackActiveManagedTask: vi.fn(),
  untrackActiveManagedTask: vi.fn(),
}));
vi.mock('../../apps/extension/src/platform/browser/enhancementLoadingIndicator', () => ({
  showEnhancementDone: vi.fn(),
  showEnhancementLoading: vi.fn(),
}));

import { showToast } from '../../apps/extension/src/platform/browser/toast';
import { actorManager } from '../../apps/extension/src/features/actors';
import {
  actorQuickActionsManager,
  bindActorQuickActionsToLink,
} from '../../apps/extension/src/features/actorEnhancement/actorQuickActionsManager';
import { actorEnhancementManager } from '../../apps/extension/src/features/actorEnhancement/actorEnhancementManager';

const ACTOR_ID = 'abc123';

function makeCollectedRecord(over: Record<string, unknown> = {}): any {
  return {
    id: ACTOR_ID,
    name: '测试演员',
    aliases: [],
    gender: 'female',
    category: 'unknown',
    profileUrl: `${window.location.origin}/actors/${ACTOR_ID}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...over,
  };
}

function flushMicrotasks(n = 40): Promise<void> {
  let p: Promise<void> = Promise.resolve();
  for (let i = 0; i < n; i++) p = p.then(() => undefined);
  return p;
}

function siteResp(status = 200): any {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'text/javascript; charset=utf-8' : null) },
    text: async () => '// flip',
  };
}

async function openTooltipAndFindBtn(buttonText: string): Promise<HTMLElement | null> {
  const link = document.createElement('a');
  link.href = 'https://javdb.com/actors/abc123';
  link.textContent = '测试演员';
  document.body.appendChild(link);
  bindActorQuickActionsToLink(link);

  link.dispatchEvent(new Event('mouseenter'));
  await vi.advanceTimersByTimeAsync(350);
  const panel = document.querySelector('.x-actor-quick-tooltip');
  if (!panel) return null;
  return (
    Array.from(panel.querySelectorAll('.x-actor-quick-btn')).find(
      (b) => (b.querySelector('.x-actor-quick-btn-text')?.textContent ?? '') === buttonText,
    ) as HTMLElement | null
  ) ?? null;
}

describe('调用点 A：快捷卡收藏 → 本地先行 + 站点 collect（best-effort）', () => {
  afterEach(() => {
    actorQuickActionsManager.destroy();
    try {
      vi.runOnlyPendingTimers();
    } catch {
      /* 时钟已释放或无挂起定时器 */
    }
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    store.actors = {};
    vi.clearAllMocks();
  });

  it('收藏 → 本地写入一次 + 站点 collect 恰一次（POST/credentials/头形状）+ 本地成功 toast 保留', async () => {
    vi.useFakeTimers();
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'csrf-token');
    meta.setAttribute('content', 'tok-dom-1');
    document.head.appendChild(meta);
    const fetchMock = vi.fn(async () => siteResp(200));
    vi.stubGlobal('fetch', fetchMock);

    const btn = await openTooltipAndFindBtn('收藏');
    expect(btn).toBeTruthy();
    btn!.dispatchEvent(new Event('click'));
    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks();

    expect(actorManager.saveActor).toHaveBeenCalledTimes(1);
    const saved = (actorManager.saveActor as any).mock.calls[0][0];
    expect(saved.id).toBe(ACTOR_ID);
    expect(store.actors[ACTOR_ID]).toBeTruthy();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(url).toBe(`${window.location.origin}/actors/${ACTOR_ID}/collect`);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.headers['X-Requested-With']).toBe('XMLHttpRequest');
    expect(init.headers['X-CSRF-Token']).toBe('tok-dom-1');

    const toastMsgs = (showToast as any).mock.calls.map((c: any[]) => c[0]);
    expect(toastMsgs).toContain('收藏成功');
    expect(toastMsgs).not.toContain('站点收藏失败');
  });

  it('站点 403 → 本地结果不变 + 轻 toast「站点收藏失败」（不阻塞、不回滚）', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 403,
      headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'text/plain; charset=utf-8' : null) },
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const btn = await openTooltipAndFindBtn('收藏');
    expect(btn).toBeTruthy();
    btn!.dispatchEvent(new Event('click'));
    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks();

    expect(actorManager.saveActor).toHaveBeenCalledTimes(1);
    expect(store.actors[ACTOR_ID]).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const toastMsgs = (showToast as any).mock.calls.map((c: any[]) => c[0]);
    expect(toastMsgs).toContain('收藏成功');
    expect(toastMsgs).toContain('站点收藏失败');
  });

  it('取消收藏 → 本地删除 + 零站点调用（never-uncollect 负锁）', async () => {
    vi.useFakeTimers();
    store.actors[ACTOR_ID] = makeCollectedRecord();
    const fetchMock = vi.fn(async () => siteResp(200));
    vi.stubGlobal('fetch', fetchMock);

    const btn = await openTooltipAndFindBtn('取消收藏');
    expect(btn).toBeTruthy();
    btn!.dispatchEvent(new Event('click'));
    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks();

    expect(actorManager.deleteActor).toHaveBeenCalledTimes(1);
    expect((actorManager.deleteActor as any).mock.calls[0][0]).toBe(ACTOR_ID);
    expect(store.actors[ACTOR_ID]).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(actorManager.saveActor).not.toHaveBeenCalled();
  });
});

describe('调用点 B：演员页页载对齐（站点已收藏 ∧ 本地未收藏 → 静默补齐）', () => {
  afterEach(() => {
    (actorEnhancementManager as any).currentActorId = '';
    document.body.innerHTML = '';
    store.actors = {};
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function setupSiteAnchors(collected: boolean, withAnchors = true): void {
    if (!withAnchors) return;
    const collect = document.createElement('a');
    collect.id = 'button-collect-actor';
    collect.style.display = collected ? 'none' : '';
    const uncollect = document.createElement('a');
    uncollect.id = 'button-uncollect-actor';
    uncollect.style.display = collected ? '' : 'none';
    document.body.appendChild(collect);
    document.body.appendChild(uncollect);
  }

  function setupName(name = '测试演员 · 9 部作品'): void {
    const el = document.createElement('div');
    el.className = 'actor-section-name';
    el.textContent = name;
    document.body.appendChild(el);
  }

  async function runBackfill(): Promise<void> {
    const m = actorEnhancementManager as unknown as {
      currentActorId: string;
      backfillLocalIfSiteCollected: () => Promise<void>;
    };
    m.currentActorId = ACTOR_ID;
    await m.backfillLocalIfSiteCollected();
  }

  it('站点已收藏 ∧ 本地无记录 → 补齐一次 + 零 toast（静默锁）', async () => {
    setupSiteAnchors(true);
    setupName();
    await runBackfill();
    expect(actorManager.saveActor).toHaveBeenCalledTimes(1);
    const saved = (actorManager.saveActor as any).mock.calls[0][0];
    expect(saved.id).toBe(ACTOR_ID);
    expect(saved.name).toContain('测试演员');
    expect(showToast).not.toHaveBeenCalled();
  });

  it('站点已收藏 ∧ 本地 favorited===false → 回填 favorited=true', async () => {
    store.actors[ACTOR_ID] = makeCollectedRecord({ favorited: false });
    setupSiteAnchors(true);
    setupName();
    await runBackfill();
    expect(actorManager.saveActor).toHaveBeenCalledTimes(1);
    const saved = (actorManager.saveActor as any).mock.calls[0][0];
    expect(saved.id).toBe(ACTOR_ID);
    expect(saved.favorited).toBe(true);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('站点已收藏 ∧ 本地已收藏（favorited 缺省=已收藏）→ 零写', async () => {
    store.actors[ACTOR_ID] = makeCollectedRecord();
    setupSiteAnchors(true);
    setupName();
    await runBackfill();
    expect(actorManager.saveActor).not.toHaveBeenCalled();
  });

  it('站点未收藏 → 零写', async () => {
    store.actors[ACTOR_ID] = makeCollectedRecord({ favorited: false });
    setupSiteAnchors(false);
    setupName();
    await runBackfill();
    expect(actorManager.saveActor).not.toHaveBeenCalled();
  });

  it('无锚点（非演员页形态）→ 零写', async () => {
    store.actors[ACTOR_ID] = makeCollectedRecord({ favorited: false });
    setupSiteAnchors(true, false);
    setupName();
    await runBackfill();
    expect(actorManager.saveActor).not.toHaveBeenCalled();
  });
});
