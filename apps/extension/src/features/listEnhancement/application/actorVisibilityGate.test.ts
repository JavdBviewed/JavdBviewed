import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSharedIntersectionObserversForTest } from '../../../ui/lib/sharedIntersectionObserver';
import { createActorVisibilityGate } from './actorVisibilityGate';

type FakeEntry = { target: Element; isIntersecting: boolean; intersectionRatio: number };

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly callback: (entries: FakeEntry[]) => void;
  readonly observed = new Set<Element>();

  constructor(callback: (entries: FakeEntry[]) => void) {
    this.callback = callback;
    FakeIntersectionObserver.instances.push(this);
  }

  observe(node: Element): void {
    this.observed.add(node);
  }

  unobserve(node: Element): void {
    this.observed.delete(node);
  }

  disconnect(): void {
    this.observed.clear();
  }
}

describe('actor visibility gate', () => {
  afterEach(() => {
    clearSharedIntersectionObserversForTest();
    FakeIntersectionObserver.instances = [];
    vi.unstubAllGlobals();
  });

  it('waits for visibility and registers one callback per item', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const gate = createActorVisibilityGate();
    const item = {} as HTMLElement;
    const run = vi.fn();

    expect(gate.defer(item, run)).toBe(true);
    expect(gate.defer(item, run)).toBe(true);
    expect(run).not.toHaveBeenCalled();

    const observer = FakeIntersectionObserver.instances[0];
    observer?.callback([{ target: item, isIntersecting: true, intersectionRatio: 1 }]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('cancels deferred work before the item becomes visible', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const gate = createActorVisibilityGate();
    const item = {} as HTMLElement;
    const run = vi.fn();

    gate.defer(item, run);
    gate.cancelAll();

    const observer = FakeIntersectionObserver.instances[0];
    observer?.callback([{ target: item, isIntersecting: true, intersectionRatio: 1 }]);
    expect(run).not.toHaveBeenCalled();
  });

  it('falls back to immediate work when IntersectionObserver is unavailable', () => {
    const gate = createActorVisibilityGate();
    const run = vi.fn();

    expect(gate.defer({} as HTMLElement, run)).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('actor visibility gate concerns（08-29 D 修复：concern 命名空间）', () => {
  afterEach(() => {
    clearSharedIntersectionObserversForTest();
    FakeIntersectionObserver.instances = [];
    vi.unstubAllGlobals();
  });

  it('fires all pending concerns for one item when it becomes visible', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const gate = createActorVisibilityGate();
    const item = {} as HTMLElement;
    const runA = vi.fn();
    const runB = vi.fn();

    expect(gate.defer(item, runA, 'actorEnhancement')).toBe(true);
    expect(gate.defer(item, runB, 'actorPenetration')).toBe(true);
    // 同 concern 幂等
    expect(gate.defer(item, runA, 'actorEnhancement')).toBe(true);

    const observer = FakeIntersectionObserver.instances[0];
    observer?.callback([{ target: item, isIntersecting: true, intersectionRatio: 1 }]);

    expect(runA).toHaveBeenCalledTimes(1);
    expect(runB).toHaveBeenCalledTimes(1);
  });

  it('cancelAll(concern) cancels only that concern, preserving the other', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const gate = createActorVisibilityGate();
    const item = {} as HTMLElement;
    const runA = vi.fn();
    const runB = vi.fn();

    gate.defer(item, runA, 'actorEnhancement');
    gate.defer(item, runB, 'actorPenetration');
    // 模拟 reapplyActorHidingForAll：只取消演员增强 concern
    gate.cancelAll('actorEnhancement');

    const observer = FakeIntersectionObserver.instances[0];
    observer?.callback([{ target: item, isIntersecting: true, intersectionRatio: 1 }]);

    expect(runA).not.toHaveBeenCalled();
    expect(runB).toHaveBeenCalledTimes(1);
  });

  it('cancel(item, concern) removes one concern without releasing the observation for others', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const gate = createActorVisibilityGate();
    const itemA = {} as HTMLElement;
    const itemB = {} as HTMLElement;
    const runA1 = vi.fn();
    const runA2 = vi.fn();
    const runB = vi.fn();

    gate.defer(itemA, runA1, 'actorEnhancement');
    gate.defer(itemA, runA2, 'actorPenetration');
    gate.defer(itemB, runB, 'actorEnhancement');

    gate.cancel(itemA, 'actorPenetration');

    // itemA 只剩 actorEnhancement 挂起；itemB 不受影响
    for (const observer of FakeIntersectionObserver.instances) {
      observer.callback([
        { target: itemA, isIntersecting: true, intersectionRatio: 1 },
        { target: itemB, isIntersecting: true, intersectionRatio: 1 },
      ]);
    }
    expect(runA1).toHaveBeenCalledTimes(1);
    expect(runA2).not.toHaveBeenCalled();
    expect(runB).toHaveBeenCalledTimes(1);
  });

  it('a single concern callback throwing does not block the other concerns', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const gate = createActorVisibilityGate();
    const item = {} as HTMLElement;
    const runB = vi.fn();
    const runA = vi.fn(() => {
      throw new Error('boom');
    });

    gate.defer(item, runA, 'actorEnhancement');
    gate.defer(item, runB, 'actorPenetration');

    const observer = FakeIntersectionObserver.instances[0];
    observer?.callback([{ target: item, isIntersecting: true, intersectionRatio: 1 }]);

    expect(runA).toHaveBeenCalledTimes(1);
    expect(runB).toHaveBeenCalledTimes(1);
  });
});
