import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearSharedIntersectionObserversForTest,
  observeWhenVisible,
} from './sharedIntersectionObserver';

type FakeEntry = { target: Element; isIntersecting: boolean; intersectionRatio: number };

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly callback: (entries: FakeEntry[]) => void;
  readonly observed = new Set<Element>();
  disconnect = vi.fn(() => this.observed.clear());
  unobserve = vi.fn((node: Element) => this.observed.delete(node));

  constructor(callback: (entries: FakeEntry[]) => void) {
    this.callback = callback;
    FakeIntersectionObserver.instances.push(this);
  }

  observe(node: Element): void {
    this.observed.add(node);
  }
}

describe('shared intersection observer', () => {
  afterEach(() => {
    clearSharedIntersectionObserversForTest();
    FakeIntersectionObserver.instances = [];
    vi.unstubAllGlobals();
  });

  it('shares one observer for nodes with the same options and releases it when idle', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const first = {} as Element;
    const second = {} as Element;
    const onFirst = vi.fn();
    const onSecond = vi.fn();

    const stopFirst = observeWhenVisible(first, onFirst, { rootMargin: '180px' });
    const stopSecond = observeWhenVisible(second, onSecond, { rootMargin: '180px' });

    expect(FakeIntersectionObserver.instances).toHaveLength(1);
    const observer = FakeIntersectionObserver.instances[0];
    expect(observer).toBeDefined();
    observer?.callback([
      { target: first, isIntersecting: true, intersectionRatio: 1 },
      { target: second, isIntersecting: false, intersectionRatio: 0 },
    ]);

    expect(onFirst).toHaveBeenCalledTimes(1);
    expect(onSecond).not.toHaveBeenCalled();
    stopFirst();
    stopSecond();
    expect(observer?.disconnect).toHaveBeenCalled();
  });

  it('does not invoke a callback after its node is cleaned up', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const node = {} as Element;
    const callback = vi.fn();
    const stop = observeWhenVisible(node, callback);
    stop();

    const observer = FakeIntersectionObserver.instances[0];
    observer?.callback([{ target: node, isIntersecting: true, intersectionRatio: 1 }]);
    expect(callback).not.toHaveBeenCalled();
  });
});
