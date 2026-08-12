import { describe, expect, it, vi } from 'vitest';
import { createActorWorkQueue } from './actorWorkQueue';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('actor work queue', () => {
  it('limits concurrent actor enhancement work and drains all tasks', async () => {
    const first = deferred();
    const second = deferred();
    const starts: number[] = [];
    const queue = createActorWorkQueue({ concurrency: 2 });

    queue.enqueue(async () => {
      starts.push(1);
      await first.promise;
    });
    queue.enqueue(async () => {
      starts.push(2);
      await second.promise;
    });
    queue.enqueue(async () => {
      starts.push(3);
    });

    await Promise.resolve();
    expect(starts).toEqual([1, 2]);
    expect(queue.getStatus()).toEqual({ active: 2, pending: 1 });

    first.resolve();
    second.resolve();
    await vi.waitFor(() => expect(starts).toEqual([1, 2, 3]));
    expect(queue.getStatus()).toEqual({ active: 0, pending: 0 });
  });

  it('continues draining after a task fails', async () => {
    const logger = vi.fn();
    const queue = createActorWorkQueue({ concurrency: 1, logger });
    const completed = vi.fn();

    queue.enqueue(async () => {
      throw new Error('actor task failed');
    });
    queue.enqueue(async () => {
      completed();
    });

    await vi.waitFor(() => expect(completed).toHaveBeenCalledTimes(1));
    expect(logger).toHaveBeenCalledWith(expect.any(Error));
    expect(queue.getStatus()).toEqual({ active: 0, pending: 0 });
  });

  it('yields before starting the next task after completion', async () => {
    const active = deferred();
    const starts: string[] = [];
    const queue = createActorWorkQueue({ concurrency: 1 });

    queue.enqueue(async () => {
      starts.push('first');
      await active.promise;
    });
    queue.enqueue(async () => {
      starts.push('second');
    });

    await vi.waitFor(() => expect(starts).toEqual(['first']));
    active.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(starts).toEqual(['first']);
    await vi.waitFor(() => expect(starts).toEqual(['first', 'second']));
  });

  it('clears pending work without cancelling active work', async () => {
    const active = deferred();
    const completed = vi.fn();
    const queue = createActorWorkQueue({ concurrency: 1 });

    queue.enqueue(async () => active.promise);
    queue.enqueue(async () => completed());
    await Promise.resolve();

    queue.clearPending();
    expect(queue.getStatus()).toEqual({ active: 1, pending: 0 });
    active.resolve();
    await vi.waitFor(() => expect(queue.getStatus()).toEqual({ active: 0, pending: 0 }));
    expect(completed).not.toHaveBeenCalled();
  });

  it('deduplicates work for the same item while it is active or pending', async () => {
    const active = deferred();
    const starts: string[] = [];
    const queue = createActorWorkQueue({ concurrency: 1 });

    queue.enqueue(async () => {
      starts.push('item-1');
      await active.promise;
    }, 'item-1');
    queue.enqueue(async () => {
      starts.push('item-1-duplicate');
    }, 'item-1');
    queue.enqueue(async () => {
      starts.push('item-2');
    }, 'item-2');

    await Promise.resolve();
    expect(starts).toEqual(['item-1']);
    expect(queue.getStatus()).toEqual({ active: 1, pending: 1 });

    active.resolve();
    await vi.waitFor(() => expect(starts).toEqual(['item-1', 'item-2']));
    expect(queue.getStatus()).toEqual({ active: 0, pending: 0 });
  });
});
