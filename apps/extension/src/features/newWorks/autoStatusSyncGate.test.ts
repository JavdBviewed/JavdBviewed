import { describe, expect, it, vi } from 'vitest';
import { createNewWorksAutoStatusSyncGate } from './autoStatusSyncGate';

describe('new works automatic status sync gate', () => {
  it('runs the first automatic sync and skips repeated calls within the TTL', async () => {
    let now = 1_000;
    const run = vi.fn(async () => 'synced');
    const gate = createNewWorksAutoStatusSyncGate({
      ttlMs: 5_000,
      now: () => now,
      createSkipped: () => 'skipped',
    });

    await expect(gate.run(run)).resolves.toBe('synced');
    await expect(gate.run(run)).resolves.toBe('skipped');
    expect(run).toHaveBeenCalledTimes(1);

    now += 5_001;
    await expect(gate.run(run)).resolves.toBe('synced');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight automatic sync between concurrent callers', async () => {
    let resolveTask: ((value: string) => void) | undefined;
    const run = vi.fn(() => new Promise<string>((resolve) => {
      resolveTask = resolve;
    }));
    const gate = createNewWorksAutoStatusSyncGate({
      ttlMs: 5_000,
      createSkipped: () => 'skipped',
    });

    const first = gate.run(run);
    const second = gate.run(run);
    expect(first).toBe(second);
    expect(run).toHaveBeenCalledTimes(1);

    resolveTask?.('synced');
    await expect(first).resolves.toBe('synced');
    await expect(gate.run(run)).resolves.toBe('skipped');
  });

  it('allows a manual forced sync and retries after a failed automatic sync', async () => {
    let attempts = 0;
    const run = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary failure');
      return 'synced';
    });
    const gate = createNewWorksAutoStatusSyncGate({
      ttlMs: 5_000,
      createSkipped: () => 'skipped',
    });

    await expect(gate.run(run)).rejects.toThrow('temporary failure');
    await expect(gate.run(run)).resolves.toBe('synced');
    await expect(gate.run(run, { force: true })).resolves.toBe('synced');
    expect(run).toHaveBeenCalledTimes(3);
  });
});
