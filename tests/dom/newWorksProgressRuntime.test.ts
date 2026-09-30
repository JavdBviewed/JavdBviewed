/**
 * @file newWorksProgressRuntime.test.ts
 * @description new works progress runtime 测试
 * @module tests/dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachNewWorksProgressListener,
  detachNewWorksProgressListener,
  ensureNewWorksProgressUI,
  formatActiveActorsLabel,
  hideNewWorksProgressUIAfter,
  updateNewWorksProgressUI,
} from '../../apps/extension/src/dashboard/tabs/newWorksProgressRuntime';

function renderHost() {
  document.body.innerHTML = '<div class="new-works-controls"></div>';
}

function messageBus() {
  const listeners = new Set<(message: any) => void>();
  return {
    listeners,
    onMessage: {
      addListener: vi.fn((listener: (message: any) => void) => listeners.add(listener)),
      removeListener: vi.fn((listener: (message: any) => void) => listeners.delete(listener)),
    },
  };
}

describe('new works progress runtime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    renderHost();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('creates progress UI and sends cancel message once', () => {
    const sendCancelMessage = vi.fn();
    const progressEl = ensureNewWorksProgressUI(undefined, { sendCancelMessage });

    expect(progressEl?.id).toBe('newWorksProgress');
    expect(document.querySelector('.new-works-controls #newWorksProgress')).toBe(progressEl);
    expect(progressEl?.querySelector('.text')?.textContent).toBe('准备中...');

    const cancelBtn = progressEl?.querySelector<HTMLButtonElement>('#newWorksCancelBtn')!;
    cancelBtn.click();
    cancelBtn.click();

    expect(cancelBtn.disabled).toBe(true);
    expect(cancelBtn.textContent).toBe('取消中...');
    expect(sendCancelMessage).toHaveBeenCalledTimes(1);
  });

  it('reuses existing progress element while it is still mounted', () => {
    const first = ensureNewWorksProgressUI(undefined, { sendCancelMessage: vi.fn() });
    const second = ensureNewWorksProgressUI(first, { sendCancelMessage: vi.fn() });

    expect(second).toBe(first);
    expect(document.querySelectorAll('#newWorksProgress')).toHaveLength(1);
  });

  it('formats concurrent active actors in the progress label', () => {
    expect(formatActiveActorsLabel(['Alice', 'Bob', 'Carol'])).toBe('，正在检查（3）：Alice、Bob、Carol');
    expect(formatActiveActorsLabel(['Alice'])).toBe('，正在检查：Alice');
    expect(formatActiveActorsLabel([], 'Alice')).toBe('，当前：Alice');
  });

  it('updates progress text, percent, concurrent actors and done state', () => {
    const progressEl = ensureNewWorksProgressUI(undefined, { sendCancelMessage: vi.fn() })!;

    updateNewWorksProgressUI(progressEl, {
      processed: 2,
      total: 4,
      identifiedTotal: 8,
      pendingTotal: 3,
      activeActorNames: ['Alice', 'Bob'],
      actorName: 'Alice',
    });

    expect(progressEl.querySelector('.text')?.textContent).toBe('进度 2/4，已识别 8，可入库 3，正在检查（2）：Alice、Bob');
    expect((progressEl.querySelector('.progress-bar-fill') as HTMLElement).style.width).toBe('50%');
    expect(progressEl.querySelector('.progress-active-actors')?.textContent).toBe('并发进行中（2）：Alice、Bob');
    expect((progressEl.querySelector('.progress-active-actors') as HTMLElement).style.display).toBe('block');

    updateNewWorksProgressUI(progressEl, { done: true });
    expect(progressEl.querySelector('.text')?.textContent).toBe('检查完成');
    expect((progressEl.querySelector('.progress-bar-fill') as HTMLElement).style.width).toBe('100%');
    expect((progressEl.querySelector('.progress-active-actors') as HTMLElement).style.display).toBe('none');
  });

  it('hides progress UI after delay and clears owner reference', () => {
    const progressEl = ensureNewWorksProgressUI(undefined, { sendCancelMessage: vi.fn() })!;
    const onRemoved = vi.fn();

    hideNewWorksProgressUIAfter(progressEl, 1500, onRemoved);
    expect(document.body.contains(progressEl)).toBe(true);

    vi.advanceTimersByTime(1500);
    expect(document.body.contains(progressEl)).toBe(false);
    expect(onRemoved).toHaveBeenCalledTimes(1);
  });

  it('attaches progress listener, maps payload and detaches previous listener', () => {
    const bus = messageBus();
    const onProgress = vi.fn();
    const previous = vi.fn();

    const listener = attachNewWorksProgressListener(previous, onProgress, bus);
    expect(bus.onMessage.removeListener).toHaveBeenCalledWith(previous);
    expect(bus.onMessage.addListener).toHaveBeenCalledWith(listener);

    listener({
      type: 'new-works-progress',
      payload: {
        processed: 1,
        total: 3,
        actorName: 'Alice',
        activeActorNames: ['Alice', 'Bob'],
        concurrency: 3,
      },
    });
    listener({ type: 'ignored', payload: { processed: 9 } });

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith({
      processed: 1,
      total: 3,
      identifiedTotal: undefined,
      effectiveTotal: undefined,
      pendingTotal: undefined,
      actorName: 'Alice',
      activeActorNames: ['Alice', 'Bob'],
      concurrency: 3,
    });

    const detached = detachNewWorksProgressListener(listener, bus);
    expect(detached).toBeUndefined();
    expect(bus.onMessage.removeListener).toHaveBeenCalledWith(listener);
  });
});
