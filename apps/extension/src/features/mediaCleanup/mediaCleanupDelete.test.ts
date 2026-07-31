import { describe, expect, it, vi } from 'vitest';
import type { MediaCleanupCopySnapshot } from './mediaCleanupModel';
import { deleteMediaCleanupCopy } from './mediaCleanupDelete';

describe('mediaCleanupDelete', () => {
  it('deletes an Emby copy through its configured server', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const copy: MediaCleanupCopySnapshot = {
      copyId: 'emby:http://home.local:item-1',
      source: 'emby',
      serverUrl: 'http://home.local/',
      itemId: 'item-1',
      lastFoundAt: 1,
    };

    const result = await deleteMediaCleanupCopy(copy, {
      getSettings: async () => ({
        emby: { mediaServers: [{
          id: 'home',
          type: 'emby',
          name: 'Home',
          url: 'http://home.local',
          apiKey: 'secret',
          enabled: true,
        }] },
      }),
      fetchImpl: fetchImpl as typeof fetch,
      deleteDrive115File: vi.fn(),
    });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://home.local/Items/item-1?api_key=secret',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('delegates a 115 copy deletion by file id', async () => {
    const deleteDrive115File = vi.fn(async () => ({ ok: true, message: '已删除' }));
    const result = await deleteMediaCleanupCopy({
      copyId: '115:file-1',
      source: '115',
      fileId: 'file-1',
      lastFoundAt: 1,
    }, {
      getSettings: async () => ({}),
      fetchImpl: fetch,
      deleteDrive115File,
    });

    expect(deleteDrive115File).toHaveBeenCalledWith('file-1');
    expect(result.ok).toBe(true);
  });
});
