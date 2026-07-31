import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../media/mediaWatchEvidence', () => ({
  reportWatchProgress: vi.fn(async () => ({
    source: 'emby',
    percent: 50,
    watched: false,
    lastPlayedAt: 1000,
  })),
}));

import {
  handleEmbyLibraryCheckCodes,
  handleEmbyLibraryGetItemDetail,
  handleEmbyLibraryReportProgress,
  handleEmbyLibraryResolveStream,
  handleEmbyLibrarySetPlayed,
  handleEmbyLibrarySync,
  handleEmbyUserLogin,
} from './handlers';
import { reportWatchProgress } from '../../media/mediaWatchEvidence';
import type { EmbyLibraryState, EmbyMediaServer } from '../types';

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type FetchMock = ReturnType<typeof vi.fn<FetchImpl>>;

const server: EmbyMediaServer = {
  id: 'main',
  type: 'emby',
  name: 'Main',
  url: 'http://media.local:8096/',
  apiKey: 'api-secret',
  enabled: true,
};

function createFetchMock(impl: FetchImpl): FetchMock {
  return vi.fn<FetchImpl>(impl);
}

function createDeps(fetchImpl: typeof fetch, storedState: EmbyLibraryState = { entries: {}, updatedAt: 0 }) {
  return {
    getSettings: vi.fn(async () => ({
      emby: {
        mediaServers: [server],
        libraryStatus: {
          enabled: true,
          showOnList: true,
          showOnDetail: true,
        },
      },
    })),
    getState: vi.fn(async () => storedState),
    saveState: vi.fn(async () => {}),
    saveSettings: vi.fn(async () => {}),
    fetchImpl,
    now: vi.fn(() => 1000),
  };
}

describe('emby library background handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('syncs enabled servers and saves a redacted library state', async () => {
    const sendResponse = vi.fn();
    const fetchImpl = createFetchMock(async () => new Response(JSON.stringify({
      Items: [
        {
          Id: 'item-1',
          Name: 'ABC-101 Sample',
          Path: '/movies/ABC-101.mkv',
          ImageTags: { Primary: 'cover-tag' },
        },
      ],
    }), { status: 200 }));
    const deps = createDeps(fetchImpl);

    await handleEmbyLibrarySync({ manual: true }, sendResponse, deps);

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://media.local:8096/Items?Recursive=true&IncludeItemTypes=Movie&Fields=Path%2CPrimaryImageAspectRatio%2CImageTags%2CPrimaryImageTag%2CBackdropImageTags%2CUserData%2CRunTimeTicks&api_key=api-secret',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(deps.saveState).toHaveBeenCalledWith(expect.objectContaining({
      updatedAt: 1000,
      serverResults: [
        expect.objectContaining({ serverId: 'main', success: true, itemCount: 1 }),
      ],
    }));
    const savedState = deps.saveState.mock.calls[0][0] as EmbyLibraryState;
    expect(savedState.entries['ABC-101'][0]).toMatchObject({
      serverName: 'Main',
      serverUrl: 'http://media.local:8096',
      itemId: 'item-1',
    });
    expect(savedState.entries['ABC-101'][0].coverImageUrl).toContain(
      'http://media.local:8096/Items/item-1/Images/Primary?',
    );
    expect(savedState.entries['ABC-101'][0].coverImageUrl).toContain('api_key=api-secret');
    expect(savedState.entries['ABC-101'][0].coverImageUrl).toContain('tag=cover-tag');
    // api_key 会出现在封面 URL 中，但响应其它字段不应泄露
    expect(JSON.stringify(savedState.serverResults)).not.toContain('api-secret');
    expect(sendResponse).toHaveBeenCalledWith({
      success: true,
      synced: 1,
      failed: 0,
      serverResults: [
        expect.objectContaining({
          serverId: 'main',
          success: true,
          itemCount: 1,
          indexedCount: 1,
        }),
      ],
    });
  });

  it('updates cleanup and deletion history after a successful server sync', async () => {
    const sendResponse = vi.fn();
    const fetchImpl = createFetchMock(async () => new Response(JSON.stringify({
      Items: [{
        Id: 'item-watched',
        Name: 'ABC-111',
        Path: '/movies/ABC-111.mkv',
        UserData: { Played: true, PlayedPercentage: 100 },
        RunTimeTicks: 100,
      }],
    }), { status: 200 }));
    const processCleanupSync = vi.fn(async () => ({
      enqueuedCount: 2,
      baselineCount: 5,
    }));
    const deps = { ...createDeps(fetchImpl), processCleanupSync };

    await handleEmbyLibrarySync({ manual: true }, sendResponse, deps);

    expect(processCleanupSync).toHaveBeenCalledWith(expect.objectContaining({
      successfulServerKeys: new Set(['emby:http://media.local:8096']),
      now: 1000,
    }));
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      newCleanupItems: 2,
      historicalWatchedCandidates: 5,
    }));
  });

  it('resolves the configured API-key username and saves user-scoped played state', async () => {
    const sendResponse = vi.fn();
    const usernameServer: EmbyMediaServer = {
      ...server,
      name: 'Emby-134',
      username: 'ryen',
      libraryIds: ['library-1'],
    };
    const fetchImpl = createFetchMock(async (input) => {
      const url = String(input);
      if (url.includes('/Users?')) {
        return new Response(JSON.stringify([{
          Id: 'user-ryen',
          Name: 'ryen',
          Policy: { IsDisabled: false },
        }]), { status: 200 });
      }
      if (url.includes('/Users/user-ryen/Items?')) {
        return new Response(JSON.stringify({
          Items: [{
            Id: 'item-mida-440',
            Name: 'MIDA-440',
            Path: '/movies/MIDA-440/MIDA-440.mkv',
            RunTimeTicks: 7_200_000_000,
            UserData: {
              Played: true,
              PlayCount: 1,
              PlaybackPositionTicks: 0,
              LastPlayedDate: '2026-07-13T15:07:37.0000000Z',
            },
          }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ Items: [] }), { status: 200 });
    });
    const deps = {
      ...createDeps(fetchImpl),
      getSettings: vi.fn(async () => ({
        emby: {
          mediaServers: [usernameServer],
          libraryStatus: { enabled: true, showOnList: true, showOnDetail: true },
        },
      })),
    };

    await handleEmbyLibrarySync({ manual: true }, sendResponse, deps);

    const savedState = deps.saveState.mock.calls[0][0] as EmbyLibraryState;
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/Users?'),
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/Users/user-ryen/Items?'),
      expect.objectContaining({ method: 'GET' }),
    );
    expect(savedState.entries['MIDA-440'][0].userData).toMatchObject({
      played: true,
      percent: 100,
    });
  });

  it('keeps previous successful entries when a server returns 401', async () => {
    const sendResponse = vi.fn();
    const fetchImpl = createFetchMock(async () => new Response('unauthorized', { status: 401 }));
    const previousState: EmbyLibraryState = {
      entries: {
        'ABC-102': [{
          serverType: 'emby',
          serverName: 'Main',
          serverUrl: 'http://media.local:8096',
          itemId: 'old-item',
          itemName: 'ABC-102',
          updatedAt: 500,
        }],
      },
      updatedAt: 500,
    };
    const deps = createDeps(fetchImpl, previousState);

    await handleEmbyLibrarySync({ manual: true }, sendResponse, deps);

    expect(deps.saveState).toHaveBeenCalledWith(expect.objectContaining({
      entries: previousState.entries,
      serverResults: [
        expect.objectContaining({ serverId: 'main', success: false, error: 'API Key 错误' }),
      ],
    }));
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      synced: 0,
      failed: 1,
      error: 'API Key 错误',
      serverResults: [
        expect.objectContaining({ serverId: 'main', success: false, error: 'API Key 错误' }),
      ],
    });
  });

  it('returns per-server diagnostics for manual sync failures', async () => {
    const sendResponse = vi.fn();
    const fetchImpl = createFetchMock(async () => new Response('unauthorized', { status: 401 }));
    const deps = createDeps(fetchImpl);

    await handleEmbyLibrarySync({ manual: true }, sendResponse, deps);

    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      synced: 0,
      failed: 1,
      error: 'API Key 错误',
      serverResults: [
        expect.objectContaining({
          serverId: 'main',
          serverName: 'Main',
          serverType: 'emby',
          success: false,
          error: 'API Key 错误',
        }),
      ],
    });
  });

  it('preserves the last successful index timestamp when every server fails', async () => {
    const sendResponse = vi.fn();
    const fetchImpl = createFetchMock(async () => new Response('server error', { status: 500 }));
    const previousState: EmbyLibraryState = {
      entries: {
        'ABC-103': [{
          serverType: 'emby',
          serverName: 'Main',
          serverUrl: 'http://media.local:8096',
          itemId: 'old-item',
          itemName: 'ABC-103',
          updatedAt: 500,
        }],
      },
      updatedAt: 500,
    };
    const deps = createDeps(fetchImpl, previousState);

    await handleEmbyLibrarySync({ manual: true }, sendResponse, deps);

    expect(deps.saveState).toHaveBeenCalledWith(expect.objectContaining({
      entries: previousState.entries,
      updatedAt: 500,
      serverResults: [
        expect.objectContaining({ serverId: 'main', success: false, error: '连接失败 (500)' }),
      ],
    }));
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      synced: 0,
      failed: 1,
      error: '连接失败 (500)',
      serverResults: [
        expect.objectContaining({ serverId: 'main', success: false, error: '连接失败 (500)' }),
      ],
    });
  });

  it('times out stalled media server requests and keeps the previous index', async () => {
    vi.useFakeTimers();
    try {
      const sendResponse = vi.fn();
      const fetchImpl = createFetchMock((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      }));
      const previousState: EmbyLibraryState = {
        entries: {
          'ABC-104': [{
            serverType: 'emby',
            serverName: 'Main',
            serverUrl: 'http://media.local:8096',
            itemId: 'old-item',
            itemName: 'ABC-104',
            updatedAt: 500,
          }],
        },
        updatedAt: 500,
      };
      const deps = createDeps(fetchImpl, previousState);

      const syncPromise = handleEmbyLibrarySync({ manual: true }, sendResponse, deps);
      await vi.advanceTimersByTimeAsync(45000);
      await syncPromise;

      expect(deps.saveState).toHaveBeenCalledWith(expect.objectContaining({
        entries: previousState.entries,
        updatedAt: 500,
        serverResults: [
          expect.objectContaining({ success: false, error: '连接超时' }),
        ],
      }));
      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        synced: 0,
        failed: 1,
        error: '连接超时',
        serverResults: [
          expect.objectContaining({ serverId: 'main', success: false, error: '连接超时' }),
        ],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('replaces previous entries for the same server URL after a server is renamed', async () => {
    const sendResponse = vi.fn();
    const fetchImpl = createFetchMock(async () => new Response(JSON.stringify({
      Items: [
        { Id: 'new-item', Name: 'ABC-105 Renamed Server Hit', Path: '/movies/ABC-105.mkv' },
      ],
    }), { status: 200 }));
    const previousState: EmbyLibraryState = {
      entries: {
        'ABC-105': [{
          serverType: 'emby',
          serverName: 'Old Name',
          serverUrl: 'http://media.local:8096',
          itemId: 'old-item',
          itemName: 'ABC-105',
          updatedAt: 500,
        }],
      },
      updatedAt: 500,
    };
    const deps = createDeps(fetchImpl, previousState);

    await handleEmbyLibrarySync({ manual: true }, sendResponse, deps);

    const savedState = deps.saveState.mock.calls[0][0] as EmbyLibraryState;
    expect(savedState.entries['ABC-105']).toHaveLength(1);
    expect(savedState.entries['ABC-105'][0]).toMatchObject({
      serverName: 'Main',
      itemId: 'new-item',
    });
  });

  it('checks duplicate codes once with search variants and filters noisy server results', async () => {
    const sendResponse = vi.fn();
    const fetchImpl = createFetchMock(async (input: RequestInfo | URL) => {
      const searchTerm = new URL(String(input)).searchParams.get('SearchTerm');
      const itemsByTerm: Record<string, unknown[]> = {
        'ABC-201': [
          { Id: 'item-201', Name: 'ABC-201 Search Hit', Path: '/movies/ABC-201.mkv' },
          { Id: 'noise-999', Name: 'ABC-999 Noisy Hit', Path: '/movies/ABC-999.mkv' },
        ],
        ABC201: [
          { Id: 'item-201', Name: 'ABC-201 Search Hit', Path: '/movies/ABC-201.mkv' },
          { Id: 'item-201-compact', Name: 'ABC201 Compact Hit', Path: '/movies/ABC201.mkv' },
        ],
      };

      return new Response(JSON.stringify({
        Items: itemsByTerm[searchTerm || ''] || [],
      }), { status: 200 });
    });
    const deps = createDeps(fetchImpl);

    await handleEmbyLibraryCheckCodes({ codes: ['abc-201', 'ABC_201'] }, sendResponse, deps);

    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(fetchImpl.mock.calls.map(([url]) => new URL(String(url)).searchParams.get('SearchTerm'))).toEqual([
      'ABC-201',
      'ABC201',
      'ABC_201',
      'abc-201',
      'abc201',
      'abc_201',
    ]);
    expect(deps.saveState).toHaveBeenCalledWith(expect.objectContaining({
      entries: expect.objectContaining({
        'ABC-201': [
          expect.objectContaining({ itemId: 'item-201' }),
          expect.objectContaining({ itemId: 'item-201-compact' }),
        ],
      }),
    }));
    const savedState = deps.saveState.mock.calls[0][0] as EmbyLibraryState;
    expect(savedState.entries['ABC-201'].map((entry) => entry.itemId)).toEqual([
      'item-201',
      'item-201-compact',
    ]);
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      checked: 1,
      matches: {
        'ABC-201': [
          expect.objectContaining({ itemId: 'item-201' }),
          expect.objectContaining({ itemId: 'item-201-compact' }),
        ],
      },
    }));
  });


  it('syncs only the selected media server when serverId is provided', async () => {
    const sendResponse = vi.fn();
    const secondaryServer: EmbyMediaServer = {
      ...server,
      id: 'second',
      type: 'jellyfin',
      name: 'Second JF',
      url: 'http://jf.local:8096/',
      apiKey: 'jf-secret',
    };
    const fetchImpl = createFetchMock(async (input) => {
      const url = String(input);
      if (url.startsWith('http://jf.local:8096/')) {
        return new Response(JSON.stringify({
          Items: [{ Id: 'jf-item-1', Name: 'JF-001 Selected', Path: '/m/JF-001.mkv' }],
        }), { status: 200 });
      }
      throw new Error(`unexpected server fetched: ${url}`);
    });
    const previousState: EmbyLibraryState = {
      entries: {
        'ABC-101': [{
          serverType: 'emby',
          serverName: 'Main',
          serverUrl: 'http://media.local:8096',
          itemId: 'main-old',
          itemName: 'ABC-101',
          updatedAt: 500,
        }],
        'JF-OLD': [{
          serverType: 'jellyfin',
          serverName: 'Second JF',
          serverUrl: 'http://jf.local:8096',
          itemId: 'jf-old',
          itemName: 'JF-OLD',
          updatedAt: 500,
        }],
      },
      updatedAt: 500,
    };
    const deps = {
      ...createDeps(fetchImpl, previousState),
      getSettings: vi.fn(async () => ({
        emby: {
          mediaServers: [server, secondaryServer],
          libraryStatus: { enabled: true, showOnList: true, showOnDetail: true },
        },
      })),
    };

    await handleEmbyLibrarySync({ manual: true, serverId: 'second' }, sendResponse, deps);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toContain('http://jf.local:8096/Items?');
    const savedState = deps.saveState.mock.calls[0][0] as EmbyLibraryState;
    expect(savedState.entries['ABC-101']).toEqual(previousState.entries['ABC-101']);
    expect(savedState.entries['JF-OLD']).toBeUndefined();
    expect(savedState.entries['JF-001'][0]).toMatchObject({
      serverType: 'jellyfin',
      serverName: 'Second JF',
      itemId: 'jf-item-1',
    });
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      synced: 1,
      failed: 0,
      serverResults: [expect.objectContaining({ serverId: 'second', success: true })],
    }));
  });

  it('scopes movie fetch to selected library ParentIds when configured', async () => {
    const sendResponse = vi.fn();
    const fetchImpl = createFetchMock(async (input) => {
      const url = String(input);
      if (url.includes('ParentId=lib-movies')) {
        return new Response(JSON.stringify({
          Items: [{ Id: 'm1', Name: 'MOV-1', Path: '/m/MOV-1.mkv' }],
        }), { status: 200 });
      }
      if (url.includes('ParentId=')) {
        return new Response(JSON.stringify({ Items: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({
        Items: [
          { Id: 'm1', Name: 'MOV-1', Path: '/m/MOV-1.mkv' },
          { Id: 't1', Name: 'TV-1', Path: '/t/TV-1.mkv' },
        ],
      }), { status: 200 });
    });
    const scopedServer: EmbyMediaServer = {
      ...server,
      libraryIds: ['lib-movies'],
    };
    const deps = {
      ...createDeps(fetchImpl),
      getSettings: vi.fn(async () => ({
        emby: {
          mediaServers: [scopedServer],
          libraryStatus: { enabled: true, showOnList: true, showOnDetail: true },
        },
      })),
    };

    await handleEmbyLibrarySync({ manual: true }, sendResponse, deps);

    const calledUrls = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(calledUrls.some((u) => u.includes('ParentId=lib-movies'))).toBe(true);
    expect(deps.saveState).toHaveBeenCalled();
    const saved = deps.saveState.mock.calls[0][0] as EmbyLibraryState;
    expect(Object.keys(saved.entries)).toContain('MOV-1');
  });

  it('rejects played writes without a configured media user', async () => {
    const sendResponse = vi.fn();
    const fetchImpl = createFetchMock(async () => new Response('{}', { status: 200 }));
    const previousState: EmbyLibraryState = {
      entries: {
        'ABC-300': [{
          serverType: 'emby',
          serverName: 'Main',
          serverUrl: 'http://media.local:8096',
          itemId: 'item-300',
          itemName: 'ABC-300',
          userData: {
            played: false,
            positionTicks: 10,
            runtimeTicks: 100,
            percent: 10,
            lastPlayedAt: 0,
          },
          updatedAt: 500,
        }],
      },
      updatedAt: 500,
    };
    const deps = createDeps(fetchImpl, previousState);

    await handleEmbyLibrarySetPlayed(
      {
        itemId: 'item-300',
        serverUrl: 'http://media.local:8096/',
        played: true,
      },
      sendResponse,
      deps,
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(deps.saveState).not.toHaveBeenCalled();
    expect(reportWatchProgress).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: '请在媒体库来源中配置用户名或登录用户账号后再写回观看状态',
    });
  });

  it('writes played flag via user session PlayedItems', async () => {
    const sendResponse = vi.fn();
    const fetchImpl = createFetchMock(async () => new Response('{}', { status: 200 }));
    const previousState: EmbyLibraryState = {
      entries: {
        'ABC-301': [{
          serverType: 'emby',
          serverName: 'Main',
          serverUrl: 'http://media.local:8096',
          itemId: 'item-301',
          itemName: 'ABC-301',
          updatedAt: 500,
        }],
      },
      updatedAt: 500,
    };
    const sessionServer: EmbyMediaServer = {
      ...server,
      accessToken: 'user-token',
      userId: 'user-1',
    };
    const deps = {
      ...createDeps(fetchImpl, previousState),
      getSettings: vi.fn(async () => ({
        emby: {
          mediaServers: [sessionServer],
          libraryStatus: { enabled: true, showOnList: true, showOnDetail: true },
        },
      })),
    };

    await handleEmbyLibrarySetPlayed(
      {
        itemId: 'item-301',
        serverUrl: 'http://media.local:8096/',
        played: true,
      },
      sendResponse,
      deps,
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://media.local:8096/Users/user-1/PlayedItems/item-301',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Emby-Token': 'user-token' }),
      }),
    );
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      usedUserSession: true,
      localIndexUpdated: true,
    }));
  });

  it('resolves and persists the configured username before writing played state', async () => {
    const sendResponse = vi.fn();
    const usernameServer: EmbyMediaServer = { ...server, username: 'ryen' };
    const settings = {
      emby: {
        mediaServers: [usernameServer],
        libraryStatus: { enabled: true, showOnList: true, showOnDetail: true },
      },
    };
    const fetchImpl = createFetchMock(async (input) => {
      const url = String(input);
      if (url.includes('/Users?')) {
        return new Response(JSON.stringify([{ Id: 'user-ryen', Name: 'ryen' }]), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    const deps = {
      ...createDeps(fetchImpl),
      getSettings: vi.fn(async () => settings),
    };

    await handleEmbyLibrarySetPlayed({
      itemId: 'item-user-scope',
      serverUrl: server.url,
      played: true,
    }, sendResponse, deps);

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/Users/user-ryen/Items/item-user-scope/UserData?api_key='),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(deps.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      emby: expect.objectContaining({
        mediaServers: [expect.objectContaining({ id: 'main', userId: 'user-ryen' })],
      }),
    }));
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('resolves the configured username before reporting playback progress', async () => {
    const sendResponse = vi.fn();
    const usernameServer: EmbyMediaServer = { ...server, username: 'ryen' };
    const fetchImpl = createFetchMock(async (input) => {
      const url = String(input);
      if (url.includes('/Users?')) {
        return new Response(JSON.stringify([{ Id: 'user-ryen', Name: 'ryen' }]), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    const deps = {
      ...createDeps(fetchImpl),
      getSettings: vi.fn(async () => ({ emby: { mediaServers: [usernameServer] } })),
    };

    await handleEmbyLibraryReportProgress({
      itemId: 'item-progress-scope',
      serverUrl: server.url,
      positionSeconds: 30,
      durationSeconds: 100,
    }, sendResponse, deps);

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/Users/user-ryen/Items/item-progress-scope/UserData?api_key='),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(deps.saveSettings).toHaveBeenCalled();
  });

  it('resolves the configured username before loading item detail', async () => {
    const sendResponse = vi.fn();
    const usernameServer: EmbyMediaServer = { ...server, username: 'ryen' };
    const fetchImpl = createFetchMock(async (input) => {
      const url = String(input);
      if (url.includes('/Users?')) {
        return new Response(JSON.stringify([{ Id: 'user-ryen', Name: 'ryen' }]), { status: 200 });
      }
      if (url.includes('/Users/user-ryen/Items/item-detail-scope?')) {
        return new Response(JSON.stringify({ Id: 'item-detail-scope', Name: 'ABC-500' }), { status: 200 });
      }
      return new Response(JSON.stringify({ Items: [] }), { status: 200 });
    });
    const deps = {
      ...createDeps(fetchImpl),
      getSettings: vi.fn(async () => ({ emby: { mediaServers: [usernameServer] } })),
    };

    await handleEmbyLibraryGetItemDetail({
      itemId: 'item-detail-scope',
      serverUrl: server.url,
    }, sendResponse, deps);

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/Users/user-ryen/Items/item-detail-scope?'),
      expect.objectContaining({ method: 'GET' }),
    );
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('resolves the configured username before requesting playback info', async () => {
    const sendResponse = vi.fn();
    const usernameServer: EmbyMediaServer = { ...server, username: 'ryen' };
    const fetchImpl = createFetchMock(async (input) => {
      const url = String(input);
      if (url.includes('/Users?')) {
        return new Response(JSON.stringify([{ Id: 'user-ryen', Name: 'ryen' }]), { status: 200 });
      }
      if (url.includes('/PlaybackInfo?')) {
        return new Response(JSON.stringify({
          PlaySessionId: 'play-session',
          MediaSources: [{ Id: 'source-1', Container: 'mp4', SupportsDirectPlay: true }],
        }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    const deps = {
      ...createDeps(fetchImpl),
      getSettings: vi.fn(async () => ({ emby: { mediaServers: [usernameServer] } })),
    };

    await handleEmbyLibraryResolveStream({
      itemId: 'item-stream-scope',
      serverUrl: server.url,
    }, sendResponse, deps);

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/Items/item-stream-scope/PlaybackInfo?UserId=user-ryen'),
      expect.objectContaining({ method: 'GET' }),
    );
    expect(deps.saveSettings).toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('caches Emby playback progress as local watch evidence after report progress', async () => {
    const sendResponse = vi.fn();
    const fetchImpl = createFetchMock(async () => new Response('{}', { status: 200 }));
    const previousState: EmbyLibraryState = {
      entries: {
        'ABC-400': [{
          serverType: 'emby',
          serverName: 'Main',
          serverUrl: 'http://media.local:8096',
          itemId: 'item-400',
          itemName: 'ABC-400 测试影片',
          updatedAt: 500,
        }],
      },
      updatedAt: 500,
    };
    const deps = createDeps(fetchImpl, previousState);

    await handleEmbyLibraryReportProgress(
      {
        itemId: 'item-400',
        serverUrl: 'http://media.local:8096/',
        positionSeconds: 600,
        durationSeconds: 1200,
      },
      sendResponse,
      deps,
    );

    expect(deps.saveState).toHaveBeenCalledWith(expect.objectContaining({
      entries: expect.objectContaining({
        'ABC-400': [
          expect.objectContaining({
            itemId: 'item-400',
            userData: expect.objectContaining({ percent: 50 }),
          }),
        ],
      }),
    }));
    expect(reportWatchProgress).toHaveBeenCalledWith(expect.objectContaining({
      code: 'ABC-400',
      source: 'emby',
      sourceItemId: 'item-400',
      positionSec: 600,
      durationSec: 1200,
      percent: 50,
      forceWatched: false,
      fileName: 'ABC-400 测试影片',
    }));
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      localIndexUpdated: true,
    }));
  });

  it('preserves Jellyfin source when caching local watch evidence', async () => {
    const sendResponse = vi.fn();
    const fetchImpl = createFetchMock(async () => new Response('{}', { status: 200 }));
    const jellyfinServer: EmbyMediaServer = {
      ...server,
      id: 'jf-main',
      type: 'jellyfin',
      name: 'JF',
    };
    const previousState: EmbyLibraryState = {
      entries: {
        'JF-401': [{
          serverType: 'jellyfin',
          serverName: 'JF',
          serverUrl: 'http://media.local:8096',
          itemId: 'jf-item-401',
          itemName: 'JF-401',
          updatedAt: 500,
        }],
      },
      updatedAt: 500,
    };
    const deps = {
      ...createDeps(fetchImpl, previousState),
      getSettings: vi.fn(async () => ({
        emby: {
          mediaServers: [jellyfinServer],
          libraryStatus: { enabled: true, showOnList: true, showOnDetail: true },
        },
      })),
    };

    await handleEmbyLibraryReportProgress(
      {
        itemId: 'jf-item-401',
        serverUrl: 'http://media.local:8096/',
        positionSeconds: 30,
        durationSeconds: 100,
      },
      sendResponse,
      deps,
    );

    expect(reportWatchProgress).toHaveBeenCalledWith(expect.objectContaining({
      code: 'JF-401',
      source: 'jellyfin',
      sourceItemId: 'jf-item-401',
      percent: 30,
    }));
  });

  it('logs in user via AuthenticateByName', async () => {
    const sendResponse = vi.fn();
    const fetchImpl = createFetchMock(async () => new Response(JSON.stringify({
      AccessToken: 'tok',
      User: { Id: 'u1', Name: 'alice' },
      ServerId: 's1',
    }), { status: 200 }));
    const deps = createDeps(fetchImpl);

    await handleEmbyUserLogin(
      {
        serverUrl: 'http://media.local:8096/',
        username: 'alice',
        password: 'pw',
      },
      sendResponse,
      deps,
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://media.local:8096/Users/AuthenticateByName',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      accessToken: 'tok',
      userId: 'u1',
      userName: 'alice',
    }));
  });

  it('keeps the full sync timestamp when realtime checks update entries', async () => {
    const sendResponse = vi.fn();
    const fetchImpl = createFetchMock(async () => new Response(JSON.stringify({
      Items: [
        { Id: 'item-202', Name: 'ABC-202 Search Hit', Path: '/movies/ABC-202.mkv' },
      ],
    }), { status: 200 }));
    const previousState: EmbyLibraryState = {
      entries: {},
      updatedAt: 500,
    };
    const deps = createDeps(fetchImpl, previousState);

    await handleEmbyLibraryCheckCodes({ codes: ['ABC-202'] }, sendResponse, deps);

    expect(deps.saveState).toHaveBeenCalledWith(expect.objectContaining({
      entries: expect.objectContaining({
        'ABC-202': [
          expect.objectContaining({ itemId: 'item-202', updatedAt: 1000 }),
        ],
      }),
      updatedAt: 500,
    }));
  });
});
