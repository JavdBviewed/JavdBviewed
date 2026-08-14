import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PENDING_KEY = 'cloud_sync_pending_v1';
const PENDING_DELTA_KEY = 'cloud_sync_pending_delta_v1';

describe('chromePendingStore', () => {
  let storedValues: Record<string, unknown>;

  beforeEach(() => {
    vi.resetModules();
    storedValues = { [PENDING_KEY]: [] };
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn((_keys: string[], callback: (items: Record<string, unknown>) => void) => {
            queueMicrotask(() => callback(structuredClone(storedValues)));
          }),
          set: vi.fn((items: Record<string, unknown>, callback: () => void) => {
            queueMicrotask(() => {
              storedValues = { ...storedValues, ...structuredClone(items) };
              callback();
            });
          }),
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps every pending entity when two updates arrive before the first write finishes', async () => {
    const { listCloudPending, upsertCloudPending } = await import('./chromePendingStore');

    await Promise.all([
      upsertCloudPending([{ type: 'video', id: 'ABP-001' }] as any),
      upsertCloudPending([{ type: 'video', id: 'ABP-002' }] as any),
    ]);

    expect(await listCloudPending()).toEqual([
      { type: 'video', id: 'ABP-001' },
      { type: 'video', id: 'ABP-002' },
    ]);
  });

  it('appends a new entity to the small delta without rewriting the existing pending base', async () => {
    storedValues[PENDING_KEY] = [
      { type: 'video', id: 'ABP-001' },
      { type: 'video', id: 'ABP-002' },
    ];
    const { listCloudPending, upsertCloudPending } = await import('./chromePendingStore');

    await upsertCloudPending([{ type: 'video', id: 'ABP-003' }] as any);

    expect(storedValues[PENDING_KEY]).toEqual([
      { type: 'video', id: 'ABP-001' },
      { type: 'video', id: 'ABP-002' },
    ]);
    expect(storedValues[PENDING_DELTA_KEY]).toEqual({
      'video\u0000ABP-003': { type: 'video', id: 'ABP-003' },
    });
    expect(await listCloudPending()).toEqual([
      { type: 'video', id: 'ABP-001' },
      { type: 'video', id: 'ABP-002' },
      { type: 'video', id: 'ABP-003' },
    ]);
  });

  it('does not persist routine log entities in the pending delta', async () => {
    const { listCloudPending, upsertCloudPending } = await import('./chromePendingStore');

    await upsertCloudPending([
      { type: 'log', id: 'info-1', payload: { level: 'INFO' } },
      { type: 'log', id: 'debug-1', payload: { level: 'DEBUG' } },
      { type: 'log', id: 'warn-1', payload: { level: 'WARN' } },
      { type: 'log', id: 'error-1', payload: { level: 'ERROR' } },
      { type: 'video', id: 'ABP-004' },
    ] as any);

    expect(await listCloudPending()).toEqual([
      { type: 'log', id: 'warn-1', payload: { level: 'WARN' } },
      { type: 'log', id: 'error-1', payload: { level: 'ERROR' } },
      { type: 'video', id: 'ABP-004' },
    ]);
  });
});
