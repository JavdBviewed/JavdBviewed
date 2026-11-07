import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VideoRecord } from '../../../types';
import { buildMediaStateHitMap } from './mediaStateFilterModel';
import { createMediaStateFilterRuntime } from './mediaStateFilterRuntime';

vi.mock('../../state', () => ({ STATE: { settings: { emby: { mediaServers: [] } } } }));
vi.mock('../../../features/drive115/mediaLibrary', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../features/drive115/mediaLibrary')>(),
  loadDrive115LibraryState: async () => null,
}));
const KEY = 'local_media_library_state';
const record = (id: string, overrides?: VideoRecord['mediaStateOverrides']): VideoRecord => ({
  id, videoCode: id, title: id, status: 'browsed', tags: [], createdAt: 1, updatedAt: 2, mediaStateOverrides: overrides,
});
const entry = (code: string, producerId = 'device-a', sourceId = 'source-a') => ({
  serverType: 'local' as const, serverName: 'Movies', relativePath: `${code}.mp4`, fileName: `${code}.mp4`,
  code, size: 1, mtime: 10, updatedAt: 20, producerId, sourceId,
  key: JSON.stringify([producerId, sourceId, `${code}.mp4`]),
});
const localState = { version: 1 as const, updatedAt: 20, entries: [entry('abc-123'), entry('abc-123', 'device-b'), entry('FC2-PPV-1234567'), entry('Vixen.2026.11.03')] };

describe('local index derived inLibrary', () => {
  it('normalizes codes and adds local membership without setting realWatched or changing the file array', () => {
    const original = structuredClone(localState);
    const hits = buildMediaStateHitMap({
      records: [record('ABC-123'), record('fc2-1234567'), record('VIXEN.2026.11.03'), record('ABC-999')],
      embyIndex: null, drive115State: null, servers: [], localState,
    });
    expect([...hits.keys()]).toEqual(['ABC-123', 'fc2-1234567', 'VIXEN.2026.11.03']);
    for (const hit of hits.values()) expect(hit).toEqual({ inLibrary: true, realWatched: false });
    expect(localState).toEqual(original);
  });

  it('preserves manual override precedence and falls back from invalid videoCode to id', () => {
    const hits = buildMediaStateHitMap({
      records: [record('ABC-123', { inLibrary: false }), { ...record('FC2-1234567', { realWatched: true }), videoCode: 'invalid' }],
      embyIndex: null, drive115State: null, servers: [], localState,
    });
    expect(hits.has('ABC-123')).toBe(false);
    expect(hits.get('FC2-1234567')).toEqual({ inLibrary: true, realWatched: true, pinned: { realWatched: true } });
  });
});

describe('local index runtime changes', () => {
  let storage: Record<string, unknown>;
  let listener: ((changes: Record<string, chrome.storage.StorageChange>, area: string) => void) | undefined;
  beforeEach(() => {
    storage = { [KEY]: structuredClone(localState) };
    listener = undefined;
    vi.stubGlobal('chrome', { storage: {
      local: { get: async (key: string) => ({ [key]: storage[key] }) },
      onChanged: { addListener: (fn: typeof listener) => { listener = fn; }, removeListener: vi.fn() },
    } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('loads local membership and removes it after retirement even with no filter selected', async () => {
    const changed = vi.fn();
    const runtime = createMediaStateFilterRuntime({
      getRecords: () => [record('ABC-123')], getInLibraryActive: () => false, getRealWatchedActive: () => false, onIndicesChanged: changed,
    });
    await runtime.ensureLoaded();
    expect(runtime.getHits()?.get('ABC-123')).toEqual({ inLibrary: true, realWatched: false });
    expect(changed).toHaveBeenCalledTimes(1);
    storage[KEY] = { version: 1, updatedAt: 21, entries: [] };
    listener?.({ [KEY]: { newValue: storage[KEY] } }, 'local');
    await runtime.ensureLoaded();
    expect(runtime.getHits()?.size).toBe(0);
    expect(changed).toHaveBeenCalledTimes(2);
    runtime.dispose();
  });

  it('refreshes when an index arrives after initial loading and clears on deletion', async () => {
    delete storage[KEY];
    const runtime = createMediaStateFilterRuntime({
      getRecords: () => [record('ABC-123')], getInLibraryActive: () => true, getRealWatchedActive: () => false, onIndicesChanged: vi.fn(),
    });
    await runtime.ensureLoaded();
    expect(runtime.getHits()?.size).toBe(0);
    storage[KEY] = localState;
    listener?.({ [KEY]: { newValue: localState } }, 'local');
    await runtime.ensureLoaded();
    expect(runtime.getHits()?.get('ABC-123')?.inLibrary).toBe(true);
    delete storage[KEY];
    listener?.({ [KEY]: { oldValue: localState } }, 'local');
    await runtime.ensureLoaded();
    expect(runtime.getHits()?.size).toBe(0);
    runtime.dispose();
  });

  it('does not lose a retirement notification while an older snapshot read is still in flight', async () => {
    let release: ((value: Record<string, unknown>) => void) | undefined;
    const get = vi.fn(async (key: string): Promise<Record<string, unknown>> => {
      if (key === KEY && !release) return new Promise((resolve) => { release = resolve; });
      return { [key]: storage[key] };
    });
    chrome.storage.local.get = get as typeof chrome.storage.local.get;
    const runtime = createMediaStateFilterRuntime({
      getRecords: () => [record('ABC-123')], getInLibraryActive: () => true, getRealWatchedActive: () => false, onIndicesChanged: vi.fn(),
    });
    const loading = runtime.ensureLoaded();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    storage[KEY] = { version: 1, updatedAt: 21, entries: [] };
    listener?.({ [KEY]: { newValue: storage[KEY] } }, 'local');
    release?.({ [KEY]: localState });
    await loading;
    expect(runtime.getHits()?.size).toBe(0);
    runtime.dispose();
  });

});
