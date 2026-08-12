import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../utils/config';

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getValue: vi.fn(),
  setValue: vi.fn(),
  dbViewedCount: vi.fn(),
}));

vi.mock('../utils/storage', () => ({
  getSettings: mocks.getSettings,
  getValue: mocks.getValue,
  setValue: mocks.setValue,
}));

vi.mock('./dbClient', () => ({
  dbViewedCount: mocks.dbViewedCount,
}));

vi.mock('./logger', () => ({
  logAsync: vi.fn(),
}));

vi.mock('./ui/toast', () => ({
  showMessage: vi.fn(),
}));

describe('initializeGlobalState', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue(structuredClone(DEFAULT_SETTINGS));
    mocks.getValue.mockImplementation(async (key: string, fallback: unknown) => (
      key === STORAGE_KEYS.LOGS ? [] : fallback
    ));
  });

  it('does not hydrate legacy viewed records when IndexedDB already has records', async () => {
    mocks.dbViewedCount.mockResolvedValue(14_719);
    const { STATE, initializeGlobalState } = await import('./state');

    await initializeGlobalState();

    expect(mocks.dbViewedCount).toHaveBeenCalledOnce();
    expect(mocks.getValue).not.toHaveBeenCalledWith(STORAGE_KEYS.VIEWED_RECORDS, {});
    expect(STATE.records).toEqual([]);
  });

  it('hydrates legacy viewed records only when IndexedDB is empty', async () => {
    mocks.dbViewedCount.mockResolvedValue(0);
    mocks.getValue.mockImplementation(async (key: string, fallback: unknown) => (
      key === STORAGE_KEYS.VIEWED_RECORDS
        ? { 'ABP-001': { id: 'ABP-001' } }
        : key === STORAGE_KEYS.LOGS ? [] : fallback
    ));
    const { STATE, initializeGlobalState } = await import('./state');

    await initializeGlobalState();

    expect(mocks.getValue).toHaveBeenCalledWith(STORAGE_KEYS.VIEWED_RECORDS, {});
    expect(STATE.records).toEqual([{ id: 'ABP-001' }]);
  });
});
