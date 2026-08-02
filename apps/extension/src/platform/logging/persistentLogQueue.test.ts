import { describe, expect, it, vi } from 'vitest';
import { LogPersistenceQueue } from './persistentLogQueue';

describe('LogPersistenceQueue', () => {
  it('batches entries when the threshold is reached', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const queue = new LogPersistenceQueue({ batchSize: 2, send });
    queue.enqueue({ timestamp: '2026-08-02T00:00:00.000Z', level: 'INFO', message: 'one' });
    queue.enqueue({ timestamp: '2026-08-02T00:00:01.000Z', level: 'INFO', message: 'two' });

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][0]).toHaveLength(2);
    expect(queue.pendingCount()).toBe(0);
  });

  it('keeps a failed batch for retry instead of growing unbounded promises', async () => {
    let reject = true;
    const send = vi.fn(async () => {
      if (reject) throw new Error('temporary failure');
    });
    const queue = new LogPersistenceQueue({ batchSize: 2, send, retryDelayMs: 60_000 });
    queue.enqueue({ timestamp: '2026-08-02T00:00:00.000Z', level: 'WARN', message: 'one' });
    queue.enqueue({ timestamp: '2026-08-02T00:00:01.000Z', level: 'WARN', message: 'two' });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(queue.pendingCount()).toBe(2);

    reject = false;
    await queue.flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(queue.pendingCount()).toBe(0);
  });
});
