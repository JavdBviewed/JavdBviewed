/**
 * @file actorQuickActionsTooltipLifecycle.test.ts
 * @description 演员快捷操作面板显隐生命周期回归锁（09-30-actor-quick-tooltip-recycle）
 *   真机场景复刻：hover 演员链接出面板 → 指针从面板单跳回链接 → 新面板必须存活。
 *   修复前实现（hideTooltip 的延迟回收在定时器里回读 this.currentTooltip）在此节奏下
 *   会把**新弹出**的面板误删（面板一闪即没），本文件即锁死该缺陷不再复发。
 * @module tests/dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../apps/extension/src/features/actors', () => ({
  actorManager: {
    getActorById: vi.fn(async () => null),
    saveActor: vi.fn(async () => undefined),
    deleteActor: vi.fn(async () => undefined),
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
vi.mock('../../apps/extension/src/platform/browser/toast', () => ({
  showToast: vi.fn(),
}));

import {
  actorQuickActionsManager,
  bindActorQuickActionsToLink,
} from '../../apps/extension/src/features/actorEnhancement/actorQuickActionsManager';

const TOOLTIP_SELECTOR = '.x-actor-quick-tooltip';

function createActorLink(name = '有栖花绯'): HTMLAnchorElement {
  const link = document.createElement('a');
  link.href = 'https://javdb.com/actors/abc123';
  link.textContent = name;
  document.body.appendChild(link);
  return link;
}

function panels(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(TOOLTIP_SELECTOR));
}

describe('演员快捷操作面板显隐生命周期（回收目标绑定）', () => {
  afterEach(() => {
    actorQuickActionsManager.destroy();
    try {
      vi.runOnlyPendingTimers();
    } catch {
      /* 时钟已释放或无挂起定时器 */
    }
    vi.useRealTimers();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('hover 演员链接 300ms 后弹出面板并带 show 类', async () => {
    vi.useFakeTimers();
    const link = createActorLink();
    bindActorQuickActionsToLink(link);

    link.dispatchEvent(new Event('mouseenter'));
    await vi.advanceTimersByTimeAsync(299);
    expect(panels().length).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    const [panel] = panels();
    expect(panel).toBeTruthy();
    // show 类由 requestAnimationFrame 补上，再推一帧
    await vi.advanceTimersByTimeAsync(50);
    expect(panel.classList.contains('show')).toBe(true);
  });

  it('★ 指针从面板单跳回链接：旧面板回收定时器不得删除新面板（面板必须存活）', async () => {
    vi.useFakeTimers();
    const link = createActorLink();
    bindActorQuickActionsToLink(link);

    // 1) hover 链接 → 弹出面板 A
    link.dispatchEvent(new Event('mouseenter'));
    await vi.advanceTimersByTimeAsync(300);
    const panelA = panels()[0];
    expect(panelA).toBeTruthy();

    // 2) 指针离开面板 A（排定 +200ms 隐藏 → 内部再排定 +200ms 回收）
    panelA.dispatchEvent(new Event('mouseleave'));
    // 3) 立刻单跳回链接本身（+300ms 后弹新面板 B）
    link.dispatchEvent(new Event('mouseenter'));

    // 到 t=+300：旧面板 A 已走 hideTooltip、新面板 B 已弹出
    await vi.advanceTimersByTimeAsync(300);
    const panelB = panels()[panels().length - 1];
    expect(panelB).toBeTruthy();
    expect(panelB).not.toBe(panelA);

    // 到 t=+500：A 自己的回收定时器到点，只能删 A，不得动 B（★ 修复前此处 B 被误删）
    await vi.advanceTimersByTimeAsync(200);
    expect(panelB.isConnected).toBe(true);
    expect(panelA.isConnected).toBe(false);
    expect(panels().length).toBe(1);

    // 再推一段：B 不得被任何遗留定时器删掉（面板一闪即没 = 本线要锁的观感）
    await vi.advanceTimersByTimeAsync(600);
    expect(panelB.isConnected).toBe(true);
    expect(panels().length).toBe(1);
  });

  it('单次离开面板：旧面板在回收定时器到点后从 DOM 移除且不泄漏', async () => {
    vi.useFakeTimers();
    const link = createActorLink();
    bindActorQuickActionsToLink(link);

    link.dispatchEvent(new Event('mouseenter'));
    await vi.advanceTimersByTimeAsync(300);
    const panelA = panels()[0];
    expect(panelA).toBeTruthy();

    panelA.dispatchEvent(new Event('mouseleave'));
    await vi.advanceTimersByTimeAsync(200);
    expect(panelA.classList.contains('show')).toBe(false);

    await vi.advanceTimersByTimeAsync(200);
    expect(panelA.isConnected).toBe(false);
    expect(panels().length).toBe(0);
  });

  it('连续两次离开面板不重复排定同一面板的回收（第二次早退）', async () => {
    vi.useFakeTimers();
    const link = createActorLink();
    bindActorQuickActionsToLink(link);
    const removeSpy = vi.spyOn(HTMLElement.prototype, 'remove');

    link.dispatchEvent(new Event('mouseenter'));
    await vi.advanceTimersByTimeAsync(300);
    const panelA = panels()[0];

    panelA.dispatchEvent(new Event('mouseleave'));
    await vi.advanceTimersByTimeAsync(200);
    const callsAfterFirstHide = removeSpy.mock.calls.length;
    panelA.dispatchEvent(new Event('mouseleave'));
    await vi.advanceTimersByTimeAsync(400);
    // 第二次 hideTooltip 因 currentTooltip 已置 null 直接早退，不再新增回收定时器
    expect(removeSpy.mock.calls.length).toBe(callsAfterFirstHide + 1);
    expect(panels().length).toBe(0);
  });
});
