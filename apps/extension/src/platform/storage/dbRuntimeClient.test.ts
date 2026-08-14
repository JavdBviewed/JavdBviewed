// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { dbViewedPut } from './dbRuntimeClient';

const record = {
  id: 'diagnostic-put-record',
  title: 'Diagnostic put record',
  status: 'viewed',
} as any;

describe('dbRuntimeClient message timeout behavior', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (globalThis as any).chrome;
  });

  it('keeps waiting for a diagnostic viewed put after its response threshold', async () => {
    vi.useFakeTimers();
    let respond: ((response: unknown) => void) | undefined;
    (globalThis as any).chrome = {
      runtime: {
        id: 'test-extension',
        lastError: undefined,
        sendMessage: vi.fn((_message: unknown, callback: (response: unknown) => void) => {
          respond = callback;
        }),
      },
    };

    const pending = dbViewedPut(record, { timeoutBehavior: 'diagnostic' });
    let settled = false;
    void pending.then(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(8_000);
    expect(settled).toBe(false);

    respond?.({ success: true });
    await expect(pending).resolves.toMatchObject({ success: true });
  });

  it('keeps the default viewed put timeout as a hard failure', async () => {
    vi.useFakeTimers();
    (globalThis as any).chrome = {
      runtime: {
        id: 'test-extension',
        lastError: undefined,
        sendMessage: vi.fn(),
      },
    };

    const pending = dbViewedPut(record);
    const assertion = expect(pending).rejects.toThrow('DB message timeout: DB:VIEWED_PUT');
    await vi.advanceTimersByTimeAsync(8_000);

    await assertion;
  });
});
