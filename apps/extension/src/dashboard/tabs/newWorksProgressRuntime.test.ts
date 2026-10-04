/**
 * @file newWorksProgressRuntime.test.ts
 * @description 进度消息监听映射单测（增量面）：SW 终态广播（finished/cancelled/error/resultSummary）
 *              透传到 NewWorksProgressData，finished → done 语义合并（进度 UI 收口「检查完成」）；
 *              常规进度消息字段映射逐字保留。
 * @module dashboard/tabs
 */
import { describe, expect, it, vi } from 'vitest';
import {
  attachNewWorksProgressListener,
  detachNewWorksProgressListener,
  type NewWorksProgressData,
} from './newWorksProgressRuntime';

function makeBus() {
  const handlers: Array<(message: any) => void> = [];
  return {
    handlers,
    onMessage: {
      addListener: vi.fn((listener: (message: any) => void) => { handlers.push(listener); }),
      removeListener: vi.fn((listener: (message: any) => void) => {
        const idx = handlers.indexOf(listener);
        if (idx >= 0) handlers.splice(idx, 1);
      }),
    },
  };
}

function emit(bus: ReturnType<typeof makeBus>, payload: Record<string, unknown>) {
  for (const handler of [...bus.handlers]) handler({ type: 'new-works-progress', payload });
}

describe('attachNewWorksProgressListener 映射', () => {
  it('常规进度消息：既有字段映射逐字保留，无终态标记', () => {
    const bus = makeBus();
    const onProgress = vi.fn();
    const listener = attachNewWorksProgressListener(undefined, onProgress, bus as any);

    emit(bus, { processed: 2, total: 5, identifiedTotal: 1, effectiveTotal: 1, pendingTotal: 1, actorName: 'A', activeActorNames: ['B', 'C'], concurrency: 2 });

    expect(onProgress).toHaveBeenCalledTimes(1);
    const data = onProgress.mock.calls[0][0] as NewWorksProgressData;
    expect(data).toMatchObject({ processed: 2, total: 5, identifiedTotal: 1, effectiveTotal: 1, pendingTotal: 1, actorName: 'A', activeActorNames: ['B', 'C'], concurrency: 2 });
    expect(data.finished).toBeUndefined();
    expect(data.cancelled).toBeUndefined();
    expect(data.error).toBeUndefined();
    expect(data.resultSummary).toBeUndefined();

    detachNewWorksProgressListener(listener, bus as any);
    expect(bus.onMessage.removeListener).toHaveBeenCalledWith(listener);
  });

  it('终态广播：finished + cancelled + resultSummary 透传，done 语义合并', () => {
    const bus = makeBus();
    const onProgress = vi.fn();
    attachNewWorksProgressListener(undefined, onProgress, bus as any);
    const resultSummary = { discovered: 2, identifiedTotal: 3, pendingCount: 2, existingCount: 1, cancelled: true, errorCount: 0 };

    emit(bus, { processed: 5, total: 5, identifiedTotal: 3, pendingTotal: 2, activeActorNames: [], concurrency: 1, finished: true, cancelled: true, resultSummary });

    expect(onProgress).toHaveBeenCalledTimes(1);
    const data = onProgress.mock.calls[0][0] as NewWorksProgressData;
    expect(data.done).toBe(true);
    expect(data.finished).toBe(true);
    expect(data.cancelled).toBe(true);
    expect(data.resultSummary).toEqual(resultSummary);
    expect(data.error).toBeUndefined();
  });

  it('SW 异常终态广播：error 标记透传', () => {
    const bus = makeBus();
    const onProgress = vi.fn();
    attachNewWorksProgressListener(undefined, onProgress, bus as any);

    emit(bus, { finished: true, error: true });

    const data = onProgress.mock.calls[0][0] as NewWorksProgressData;
    expect(data.done).toBe(true);
    expect(data.finished).toBe(true);
    expect(data.error).toBe(true);
    expect(data.resultSummary).toBeUndefined();
  });

  it('非 new-works-progress 消息不触发', () => {
    const bus = makeBus();
    const onProgress = vi.fn();
    attachNewWorksProgressListener(undefined, onProgress, bus as any);

    for (const handler of [...bus.handlers]) handler({ type: 'other-message', payload: { finished: true } });

    expect(onProgress).not.toHaveBeenCalled();
  });
});
