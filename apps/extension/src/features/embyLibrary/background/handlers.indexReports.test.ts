import { describe, expect, it, vi } from 'vitest';
import { handleEmbyLibrarySync, type EmbyLibraryHandlerDeps } from './handlers';
import type { EmbyLibraryState, EmbyMediaServer } from '../types';

const server: EmbyMediaServer = { id: 's1', type: 'emby', name: 'Media', url: 'https://media.example', apiKey: 'secret-key', enabled: true };
const empty: EmbyLibraryState = { entries: {}, updatedAt: 0 };
function setup(servers = [server], state = empty) {
  const queueIndexReport = vi.fn<(input: unknown) => Promise<void>>(async () => {});
  const reconcileIndexSources = vi.fn<(kind: string, sources: string[]) => Promise<void>>(async () => {});
  const deps: EmbyLibraryHandlerDeps & { queueIndexReport: typeof queueIndexReport; reconcileIndexSources: typeof reconcileIndexSources } = {
    getSettings: async () => ({ emby: { mediaServers: servers, libraryEnabled: true } }),
    saveSettings: async () => {}, getState: async () => state, saveState: vi.fn(async (_state: EmbyLibraryState) => {}), now: () => 1000,
    fetchImpl: vi.fn(async () => new Response(JSON.stringify({ Items: [{ Id: 'fresh', Name: 'ABC-123', ImageTags: { Primary: 'tag' } }], TotalRecordCount: 1 }))),
    queueIndexReport, reconcileIndexSources,
  };
  return deps;
}

describe('local Emby source reports', () => {
  it('reports local enumeration without inherited cloud entries or image credentials', async () => {
    const deps = setup([server], { entries: { 'OLD-001': [{ serverUrl: server.url, itemId: 'remote' } as never] }, updatedAt: 0 });
    await handleEmbyLibrarySync({ manual: true }, vi.fn(), deps);
    expect(deps.queueIndexReport).toHaveBeenCalledTimes(1);
    const input = deps.queueIndexReport.mock.calls[0]?.[0];
    expect(input).toMatchObject({ kind: 'emby', sourceId: server.url, complete: true, entries: [{ code: 'ABC-123', data: { itemId: 'fresh' } }] });
    expect(JSON.stringify(input)).not.toContain('secret-key');
    expect(JSON.stringify(input)).not.toContain('remote');
    expect(deps.reconcileIndexSources).toHaveBeenCalledWith('emby', [server.url]);
  });
  it('reports an exhausted empty library as a complete empty source', async () => {
    const deps = setup(); deps.fetchImpl = vi.fn(async () => new Response('{"Items":[],"TotalRecordCount":0}'));
    await handleEmbyLibrarySync({ manual: true }, vi.fn(), deps);
    expect(deps.queueIndexReport).toHaveBeenCalledWith({ kind: 'emby', sourceId: server.url, entries: [], complete: true });
  });
  it('keeps an offline configured source active and never publishes it as empty', async () => {
    const deps = setup(); deps.fetchImpl = vi.fn(async () => new Response('', { status: 503 }));
    await handleEmbyLibrarySync({ manual: true }, vi.fn(), deps);
    expect(deps.queueIndexReport).not.toHaveBeenCalled();
    expect(deps.reconcileIndexSources).toHaveBeenCalledWith('emby', [server.url]);
  });
  it('retires removed sources even when no server remains', async () => {
    const deps = setup([]);
    await handleEmbyLibrarySync({ manual: true }, vi.fn(), deps);
    expect(deps.reconcileIndexSources).toHaveBeenCalledWith('emby', []);
  });
  it('does not turn local scanning into failure when durable report storage fails', async () => {
    const deps = setup(); deps.queueIndexReport.mockRejectedValueOnce(new Error('storage unavailable'));
    const reply = vi.fn();
    await handleEmbyLibrarySync({ manual: true }, reply, deps);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ success: true, synced: 1, failed: 0 }));
    expect(deps.saveState).toHaveBeenCalled();
  });
  it('keeps the previous partial source entry when a page ends before the reported total', async () => {
    const previous: EmbyLibraryState = {
      entries: {
        'OLD-001': [{
          serverType: 'emby', serverName: 'Media', serverUrl: server.url, itemId: 'old-item',
          itemName: 'OLD-001', updatedAt: 900,
        }],
      },
      updatedAt: 900,
    };
    const deps = setup([server], previous);
    let call = 0;
    const pages = [
      { Items: [{ Id: 'fresh-item', Name: 'ABC-123', Path: '/movies/ABC-123.mp4' }], TotalRecordCount: 2 },
      { Items: [] },
    ];
    deps.fetchImpl = vi.fn(async () => new Response(JSON.stringify(pages[Math.min(call++, 1)])));

    await handleEmbyLibrarySync({ manual: true }, vi.fn(), deps);

    const saved = vi.mocked(deps.saveState).mock.calls[0]?.[0];
    expect(saved.entries['OLD-001']).toHaveLength(1);
    expect(saved.entries['ABC-123']).toHaveLength(1);
    expect(deps.reconcileIndexSources).toHaveBeenCalledWith('emby', [server.url]);
    const response = (vi.mocked(deps.queueIndexReport).mock.calls[0]?.[0] || {}) as Record<string, unknown>;
    expect(response.complete).toBe(false);
  });

  it('marks prematurely empty pagination partial without discarding locally found files', async () => {
    const deps = setup(); let call = 0;
    const pages = [{ Items: [{ Id: '1', Name: 'ABC-123' }], TotalRecordCount: 2 }, { Items: [] }];
    deps.fetchImpl = vi.fn(async () => new Response(JSON.stringify(pages[Math.min(call++, 1)])));
    await handleEmbyLibrarySync({ manual: true }, vi.fn(), deps);
    expect(deps.queueIndexReport).toHaveBeenCalledWith(expect.objectContaining({ complete: false, entries: [expect.objectContaining({ code: 'ABC-123' })] }));
  });
  it('does not use a partial scan for deletion reconciliation, even with another complete server', async () => {
    const other = { ...server, id: 's2', url: 'https://other.example' };
    const deps = setup([server, other]);
    const cleanup = vi.fn<NonNullable<EmbyLibraryHandlerDeps['processCleanupSync']>>(async () => ({ enqueuedCount: 0, baselineCount: 0 }));
    deps.processCleanupSync = cleanup;
    deps.fetchImpl = vi.fn(async input => {
      const u = new URL(String(input));
      return new Response(JSON.stringify(u.hostname === 'other.example'
        ? { Items: [], TotalRecordCount: 0 }
        : u.searchParams.get('StartIndex') === '0'
          ? { Items: [{ Id: '1', Name: 'ABC-123' }], TotalRecordCount: 2 }
          : { Items: [] }));
    });
    const reply = vi.fn();
    await handleEmbyLibrarySync({ manual: true }, reply, deps);
    expect(reply.mock.calls[0][0].serverResults[0]).toMatchObject({ complete: false });
    expect([...cleanup.mock.calls[0][0].successfulServerKeys]).toEqual(['emby:https://other.example']);
  });

  it('updates a partial item by source and itemId without duplicating its old code', async () => {
    const deps = setup([server], { updatedAt: 1, entries: {
      'OLD-123': [{ serverType: 'emby', serverName: 'Media', serverUrl: server.url, itemId: '1', itemName: 'old', updatedAt: 1 }],
    } });
    let call = 0;
    deps.fetchImpl = vi.fn(async () => new Response(JSON.stringify(call++ === 0
      ? { Items: [{ Id: '1', Name: 'NEW-123' }], TotalRecordCount: 2 }
      : { Items: [] })));
    await handleEmbyLibrarySync({ manual: true }, vi.fn(), deps);
    const saved = vi.mocked(deps.saveState).mock.calls[0][0];
    expect(saved.entries['OLD-123']).toBeUndefined();
    expect(saved.entries['NEW-123']).toHaveLength(1);
  });

  it('reports 2096 read and 689 indexed as extraction statistics, not pagination loss', async () => {
    const deps = setup([{ ...server, type: 'jellyfin' }]);
    const items = Array.from({ length: 2096 }, (_, i) => ({ Id: String(i), Name: i < 689 ? `ABC-${String(i).padStart(4, '0')}` : '中文片名' }));
    const offsets: number[] = [];
    deps.fetchImpl = vi.fn(async input => {
      const offset = Number(new URL(String(input)).searchParams.get('StartIndex'));
      offsets.push(offset);
      return new Response(JSON.stringify({ Items: items.slice(offset, offset + 500), TotalRecordCount: 2096 }));
    });
    const reply = vi.fn();
    await handleEmbyLibrarySync({ manual: true }, reply, deps);
    expect(offsets).toEqual([0, 500, 1000, 1500, 2000]);
    expect(reply.mock.calls[0][0].serverResults[0]).toMatchObject({ itemCount: 2096, indexedCount: 689, uniqueCodeCount: 689, unrecognizedCount: 1407, ambiguousCount: 0, complete: true });
  });

  it('never publishes malformed responses as a complete empty library', async () => {
    const deps = setup(); deps.fetchImpl = vi.fn(async () => new Response('{"error":"unavailable"}'));
    await handleEmbyLibrarySync({ manual: true }, vi.fn(), deps);
    expect(deps.queueIndexReport).not.toHaveBeenCalled();
  });
  it('does not retire an enabled source just because its credentials are missing', async () => {
    const deps = setup([{ ...server, apiKey: '' }]);
    await handleEmbyLibrarySync({ manual: true }, vi.fn(), deps);
    expect(deps.reconcileIndexSources).toHaveBeenCalledWith('emby', [server.url]);
  });

});
