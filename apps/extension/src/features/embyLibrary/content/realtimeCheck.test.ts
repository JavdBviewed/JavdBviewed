import { describe, expect, it, vi } from 'vitest';
import { EmbyLibraryRealtimeCheckQueue } from './realtimeCheck';

describe('Emby library realtime check queue', () => {
  it('normalizes duplicate codes and updates local state from the background result', async () => {
    const sendMessage = vi.fn(async () => ({
      success: true,
      state: {
        entries: {
          'ABC-401': [
            {
              serverType: 'emby',
              serverName: 'Main',
              serverUrl: 'http://media.local:8096',
              itemId: 'item-401',
              itemName: 'ABC-401',
              updatedAt: 1000,
            },
          ],
        },
        updatedAt: 1000,
      },
    }));
    const onState = vi.fn();
    const onReprocess = vi.fn();
    const queue = new EmbyLibraryRealtimeCheckQueue({
      sendMessage,
      now: () => 1000,
      onState,
      onReprocess,
    });

    queue.enqueue(['abc-401', 'ABC_401'], {
      enabled: true,
      batchSize: 20,
      cacheTtlMs: 60000,
      debounceMs: 0,
    });
    await queue.flush();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'EMBY_LIBRARY_CHECK_CODES',
      codes: ['ABC-401'],
    });
    expect(onState).toHaveBeenCalledWith(expect.objectContaining({
      entries: expect.objectContaining({
        'ABC-401': [
          expect.objectContaining({ itemId: 'item-401' }),
        ],
      }),
    }));
    expect(onReprocess).toHaveBeenCalledTimes(1);
    expect(onReprocess).toHaveBeenCalledWith(['ABC-401']);
  });

  it('respects batch size and short-term duplicate cache', async () => {
    const sendMessage = vi.fn(async () => ({ success: true }));
    const queue = new EmbyLibraryRealtimeCheckQueue({
      sendMessage,
      now: () => 2000,
      onState: vi.fn(),
      onReprocess: vi.fn(),
    });

    queue.enqueue(['ABC-501', 'ABC-502', 'ABC-503'], {
      enabled: true,
      batchSize: 2,
      cacheTtlMs: 60000,
      debounceMs: 0,
    });
    await queue.flush();
    queue.enqueue(['ABC-501'], {
      enabled: true,
      batchSize: 2,
      cacheTtlMs: 60000,
      debounceMs: 0,
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'EMBY_LIBRARY_CHECK_CODES',
      codes: ['ABC-501', 'ABC-502'],
    });
  });
});
