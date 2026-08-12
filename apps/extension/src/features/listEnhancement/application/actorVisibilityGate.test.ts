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
