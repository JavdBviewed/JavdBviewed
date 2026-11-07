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
    saveSettings: async () => {}, getState: async () => state, saveState: vi.fn(async () => {}), now: () => 1000,
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
  it('marks prematurely empty pagination partial without discarding locally found files', async () => {
    const deps = setup(); let call = 0;
    const pages = [{ Items: [{ Id: '1', Name: 'ABC-123' }], TotalRecordCount: 2 }, { Items: [] }];
    deps.fetchImpl = vi.fn(async () => new Response(JSON.stringify(pages[Math.min(call++, 1)])));
    await handleEmbyLibrarySync({ manual: true }, vi.fn(), deps);
    expect(deps.queueIndexReport).toHaveBeenCalledWith(expect.objectContaining({ complete: false, entries: [expect.objectContaining({ code: 'ABC-123' })] }));
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
