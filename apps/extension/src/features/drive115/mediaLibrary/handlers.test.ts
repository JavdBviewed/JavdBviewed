/**
 * @file handlers.test.ts
 * @description 115 media library background handler regression tests
 * @module features/drive115/mediaLibrary
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../../../utils/config';
import { getSettings } from '../../../utils/storage';
import { getDrive115V2Service } from '../v2';
import {
  DRIVE115_LIBRARY_INDEX_RESUME_ALARM,
  ensureDrive115MediaLibraryResumeAlarm,
  handleDrive115MediaLibraryCancelIndex,
  handleDrive115MediaLibraryIndex,
  handleDrive115MediaLibraryResolveCoverUrl,
  handleDrive115MediaLibraryResolveNfo,
} from './handlers';
import { indexDrive115Roots } from './indexer';
import { loadDrive115LibraryState, saveDrive115LibraryState } from './store';

const storageMock = vi.hoisted(() => {
  const state: { progress: unknown; checkpoint: unknown; history: unknown } = {
    progress: null,
    checkpoint: null,
    history: null,
  };
  const setValue = vi.fn(async (key: string, value: unknown) => {
    if (key === 'drive115_library_index_history') state.history = value;
    else state.progress = value;
  });
  const getValue = vi.fn(async (key: string, fallback: unknown) => {
    if (key === 'drive115_library_index_history') return state.history ?? fallback;
    return state.progress ?? fallback;
  });
  return { state, setValue, getValue };
});

vi.mock('../../../utils/storage', () => ({
  getSettings: vi.fn(),
  getValue: storageMock.getValue,
  saveSettings: vi.fn(),
  setValue: storageMock.setValue,
}));

vi.mock('../../embyLibrary/mediaLibraryLogger', () => ({
  mediaLog: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../v2', () => ({
  getDrive115V2Service: vi.fn(),
}));

vi.mock('./indexer', () => ({
  indexDrive115Roots: vi.fn(),
}));

vi.mock('./store', () => ({
  loadDrive115LibraryState: vi.fn(),
  saveDrive115LibraryState: vi.fn(),
  loadDrive115IndexCheckpoint: vi.fn(async () => storageMock.state.checkpoint),
  saveDrive115IndexCheckpoint: vi.fn(async (checkpoint: unknown) => { storageMock.state.checkpoint = checkpoint; }),
  clearDrive115IndexCheckpoint: vi.fn(async () => { storageMock.state.checkpoint = null; }),
}));

const emptyState = {
  version: 1 as const,
  updatedAt: 0,
  entries: [],
  stats: {
    roots: 0,
    foldersSeen: 0,
    indexed: 0,
    skipped: 0,
    unrecognized: 0,
    apiCalls: 0,
    truncatedFolders: 0,
  },
};

function callCancel(): Promise<unknown> {
  return new Promise((resolve) => {
    const handled = handleDrive115MediaLibraryCancelIndex({}, resolve);
    expect(handled).toBe(true);
  });
}

function callIndex(message: unknown = {}): Promise<unknown> {
  return new Promise((resolve) => {
    const handled = handleDrive115MediaLibraryIndex(message, resolve);
    expect(handled).toBe(true);
  });
}

async function waitForIndexCall(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (vi.mocked(indexDrive115Roots).mock.calls.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(indexDrive115Roots).toHaveBeenCalled();
}

describe('handleDrive115MediaLibraryCancelIndex', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.state.progress = null;
    storageMock.state.checkpoint = null;
    storageMock.state.history = null;
    vi.mocked(loadDrive115LibraryState).mockResolvedValue(emptyState);
    vi.mocked(saveDrive115LibraryState).mockResolvedValue(undefined);
    vi.mocked(getSettings).mockResolvedValue({
      drive115: {
        enabled: true,
        mediaLibraryRoots: [{ cid: 'root', enabled: true }],
        mediaLibraryScanDepth: 2,
      },
    } as any);
    vi.mocked(getDrive115V2Service).mockReturnValue({
      getValidAccessToken: vi.fn(async () => ({ success: true, accessToken: 'token' })),
      listFiles: vi.fn(),
    } as any);
    vi.mocked(indexDrive115Roots).mockResolvedValue({
      success: true,
      keptPrevious: false,
      state: emptyState,
      message: '索引完成：0 条',
    });
  });



  it('aborts the in-memory index request when cancelling a running task', async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(indexDrive115Roots).mockImplementation(async (deps: any) => {
      capturedSignal = deps.signal;
      return await new Promise((resolve) => {
        deps.signal.addEventListener('abort', () => {
          resolve({
            success: false,
            keptPrevious: false,
            cancelled: true,
            state: { ...emptyState, lastError: '索引已取消' },
            message: '索引已取消',
          });
        });
      });
    });

    const indexResponsePromise = callIndex();
    await waitForIndexCall();

    const cancelResponse = await callCancel();

    expect(cancelResponse).toMatchObject({ success: true, running: true });
    expect(capturedSignal?.aborted).toBe(true);
    await expect(indexResponsePromise).resolves.toMatchObject({
      success: false,
      cancelled: true,
      message: '索引已取消',
    });
  });

  it('clears a persisted running snapshot when no in-memory index task exists', async () => {
    storageMock.state.progress = {
      phase: 'folder',
      message: 'stale running task',
      running: true,
      updatedAt: 123,
      rootsTotal: 1,
      rootsDone: 0,
      foldersSeen: 18,
      indexed: 0,
      skipped: 18,
      apiCalls: 19,
    };

    const response = await callCancel();

    expect(response).toMatchObject({ success: true, running: false });
    expect(storageMock.setValue).toHaveBeenCalledWith(
      STORAGE_KEYS.DRIVE115_LIBRARY_INDEX_PROGRESS,
      expect.objectContaining({
        phase: 'error',
        running: false,
        rootsTotal: 1,
        foldersSeen: 18,
        indexed: 0,
        skipped: 18,
        apiCalls: 19,
      }),
    );
  });
});

describe('handleDrive115MediaLibraryIndex incremental persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.state.progress = null;
    storageMock.state.checkpoint = null;
    storageMock.state.history = null;
    vi.mocked(loadDrive115LibraryState).mockResolvedValue(emptyState);
    vi.mocked(saveDrive115LibraryState).mockResolvedValue(undefined);
    vi.mocked(getSettings).mockResolvedValue({
      drive115: {
        enabled: true,
        mediaLibraryRoots: [{ cid: 'root', enabled: true }],
        mediaLibraryScanDepth: 2,
      },
    } as any);
    vi.mocked(getDrive115V2Service).mockReturnValue({
      getValidAccessToken: vi.fn(async () => ({ success: true, accessToken: 'token' })),
      listFiles: vi.fn(),
    } as any);
  });

  it('persists incremental partial snapshots before the final state', async () => {
    const partial = {
      ...emptyState,
      updatedAt: 111,
      entries: [{ key: 'k1', code: 'SSIS-001' } as any],
    };
    const finalState = {
      ...emptyState,
      updatedAt: 222,
      entries: [{ key: 'k1', code: 'SSIS-001' } as any, { key: 'k2', code: 'SSIS-002' } as any],
    };
    vi.mocked(indexDrive115Roots).mockImplementation(async (deps: any) => {
      // 模拟索引器中途 flush 一次增量快照
      deps.onPartialState?.(partial);
      return {
        success: true,
        keptPrevious: false,
        state: finalState,
        message: '索引完成：2 条',
      };
    });

    await callIndex();

    // 增量态先落盘，最终态最后落盘且顺序在其后
    expect(saveDrive115LibraryState).toHaveBeenCalledWith(partial);
    expect(saveDrive115LibraryState).toHaveBeenCalledWith(finalState);
    const calls = vi.mocked(saveDrive115LibraryState).mock.calls.map((c) => c[0]);
    expect(calls.indexOf(partial)).toBeLessThan(calls.indexOf(finalState));
  });

  it('refreshes an expired access token and retries the current directory listing', async () => {
    const getValidAccessToken = vi.fn()
      .mockResolvedValueOnce({ success: true, accessToken: 'initial-token' })
      .mockResolvedValueOnce({ success: true, accessToken: 'refreshed-token' });
    const listFiles = vi.fn()
      .mockResolvedValueOnce({
        success: false,
        message: '错误 40140125: access_token 无效',
        raw: { code: 40140125 },
      })
      .mockResolvedValueOnce({ success: true, data: [] });
    vi.mocked(getDrive115V2Service).mockReturnValue({
      getValidAccessToken,
      listFiles,
    } as any);
    vi.mocked(indexDrive115Roots).mockImplementation(async (deps: any) => {
      const listed = await deps.listFiles({ cid: 'root' });
      expect(listed).toMatchObject({ success: true, data: [] });
      return {
        success: true,
        keptPrevious: false,
        state: emptyState,
        message: '索引完成：0 条',
      };
    });

    await callIndex();

    expect(listFiles).toHaveBeenNthCalledWith(1, expect.objectContaining({ accessToken: 'initial-token' }));
    expect(listFiles).toHaveBeenNthCalledWith(2, expect.objectContaining({ accessToken: 'refreshed-token' }));
    expect(getValidAccessToken).toHaveBeenCalledWith({ forceAutoRefresh: true, forceRefresh: true });
  });

  it('falls back to forced refresh when the periodic token check hits the minimum interval', async () => {
    let now = 1_000;
    const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const getValidAccessToken = vi.fn()
      .mockResolvedValueOnce({ success: true, accessToken: 'initial-token' })
      .mockResolvedValueOnce({ success: false, message: '距离上次自动刷新不足最小间隔' })
      .mockResolvedValueOnce({ success: true, accessToken: 'forced-token' });
    const listFiles = vi.fn().mockResolvedValue({ success: true, data: [] });
    vi.mocked(getDrive115V2Service).mockReturnValue({ getValidAccessToken, listFiles } as any);
    vi.mocked(indexDrive115Roots).mockImplementation(async (deps: any) => {
      await deps.listFiles({ cid: 'root' });
      now = 31_000;
      const listed = await deps.listFiles({ cid: 'root' });
      expect(listed).toMatchObject({ success: true, data: [] });
      return {
        success: true,
        keptPrevious: false,
        state: emptyState,
        message: '索引完成：0 条',
      };
    });

    try {
      await callIndex();
    } finally {
      dateNowSpy.mockRestore();
    }

    expect(getValidAccessToken).toHaveBeenNthCalledWith(2, { forceAutoRefresh: true });
    expect(getValidAccessToken).toHaveBeenNthCalledWith(3, { forceAutoRefresh: true, forceRefresh: true });
    expect(listFiles).toHaveBeenLastCalledWith(expect.objectContaining({ accessToken: 'forced-token' }));
  });

  it('adds each completed index report to local history for later review', async () => {
    const report = {
      indexed: [],
      skipped: [],
      indexedTotal: 1,
      skippedTotal: 0,
      skipReasonCounts: {},
      truncatedList: false,
      rootsTotal: 1,
      rootsDone: 1,
      apiCalls: 2,
      truncatedFolders: 0,
      startedAt: 100,
      finishedAt: 200,
    };
    vi.mocked(indexDrive115Roots).mockResolvedValue({
      success: true,
      keptPrevious: false,
      state: { ...emptyState, updatedAt: 200 },
      report,
      message: '索引完成：1 条',
    });

    await callIndex();

    expect(storageMock.setValue).toHaveBeenLastCalledWith(
      STORAGE_KEYS.DRIVE115_LIBRARY_INDEX_HISTORY,
      [report],
    );
  });

  it('keeps only the most recent 20 index reports', async () => {
    const report = {
      indexed: [],
      skipped: [],
      indexedTotal: 21,
      skippedTotal: 0,
      skipReasonCounts: {},
      truncatedList: false,
      rootsTotal: 1,
      rootsDone: 1,
      apiCalls: 21,
      truncatedFolders: 0,
      startedAt: 1000,
      finishedAt: 1100,
    };
    const existing = Array.from({ length: 20 }, (_, index) => ({
      ...report,
      startedAt: index,
      finishedAt: index + 1,
    }));
    storageMock.state.history = existing;
    vi.mocked(indexDrive115Roots).mockResolvedValue({
      success: true,
      keptPrevious: false,
      state: { ...emptyState, updatedAt: 1100 },
      report,
      message: '索引完成：21 条',
    });

    await callIndex();

    const historyCall = vi.mocked(storageMock.setValue).mock.calls.find(
      ([key]) => key === STORAGE_KEYS.DRIVE115_LIBRARY_INDEX_HISTORY,
    );
    expect(historyCall?.[1]).toHaveLength(20);
    expect((historyCall?.[1] as Array<typeof report>)[0]).toEqual(report);
    expect((historyCall?.[1] as Array<typeof report>)[19]?.startedAt).toBe(18);
  });

  it('indexes selected root cids and preserves entries from unselected roots', async () => {
    const oldA = { key: 'a:old', code: 'AAA-001', rootCid: 'root-a' } as any;
    const oldB = { key: 'b:old', code: 'BBB-001', rootCid: 'root-b' } as any;
    vi.mocked(loadDrive115LibraryState).mockResolvedValue({
      ...emptyState,
      updatedAt: 100,
      entries: [oldA, oldB],
    });
    vi.mocked(getSettings).mockResolvedValue({
      drive115: {
        enabled: true,
        mediaLibraryRoots: [
          { cid: 'root-a', name: 'A', enabled: true },
          { cid: 'root-b', name: 'B', enabled: true },
        ],
      },
    } as any);
    const nextB = { key: 'b:new', code: 'BBB-002', rootCid: 'root-b' } as any;
    vi.mocked(indexDrive115Roots).mockImplementation(async (deps: any) => {
      expect(deps.roots.map((root: { cid: string }) => root.cid)).toEqual(['root-b']);
      expect(deps.previous.entries).toEqual([oldB]);
      return {
        success: true,
        keptPrevious: false,
        state: {
          ...emptyState,
          updatedAt: 200,
          entries: [nextB],
        },
        message: '索引完成：1 条',
      };
    });

    const response = await callIndex({
      type: 'DRIVE115_MEDIA_LIBRARY_INDEX',
      rootCids: ['root-b'],
    });

    expect(response).toMatchObject({ success: true });
    const finalState = vi.mocked(saveDrive115LibraryState).mock.calls.at(-1)?.[0];
    expect(finalState?.entries).toEqual([oldA, nextB]);
  });
});

describe('ensureDrive115MediaLibraryResumeAlarm', () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;
  const createAlarm = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.state.checkpoint = null;
    (globalThis as { chrome?: unknown }).chrome = {
      alarms: { create: createAlarm },
    };
  });

  afterEach(() => {
    if (originalChrome === undefined) delete (globalThis as { chrome?: unknown }).chrome;
    else (globalThis as { chrome?: unknown }).chrome = originalChrome;
  });

  it('re-registers the persisted resume alarm after Chrome restarts', async () => {
    const resumeAt = Date.now() + 5 * 60_000;
    storageMock.state.checkpoint = {
      rootCids: ['root'],
      scanDepth: 2,
      pendingQueue: [{ cid: 'folder', name: 'folder', depth: 1, rootCid: 'root' }],
      stats: emptyState.stats,
      containerFoldersSeen: 1,
      report: {},
      resumeAt,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await ensureDrive115MediaLibraryResumeAlarm();

    expect(createAlarm).toHaveBeenCalledWith(
      DRIVE115_LIBRARY_INDEX_RESUME_ALARM,
      { when: resumeAt },
    );
  });
});

function callResolveNfo(message: unknown): Promise<any> {
  return new Promise((resolve) => {
    const handled = handleDrive115MediaLibraryResolveNfo(message, resolve);
    expect(handled).toBe(true);
  });
}

describe('handleDrive115MediaLibraryResolveNfo', () => {
  const entry = {
    key: 'f1:v1',
    code: 'SSIS-001',
    title: 'SSIS-001',
    folderCid: 'f1',
    folderName: 'SSIS-001',
    rootCid: 'r',
    videoFileId: 'v1',
    pickCode: 'p1',
    fileName: 'SSIS-001.mp4',
    fileSize: 1,
    nfoPickCode: 'nfo-pick',
    updatedAt: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(saveDrive115LibraryState).mockResolvedValue(undefined);
  });

  it('downloads and parses the NFO, then writes the summary back', async () => {
    vi.mocked(loadDrive115LibraryState).mockResolvedValue({
      ...emptyState,
      entries: [entry as any],
    });
    const getFileDownloadUrl = vi.fn(async () => ({ success: true, url: 'https://dl/nfo' }));
    vi.mocked(getDrive115V2Service).mockReturnValue({
      getValidAccessToken: vi.fn(async () => ({ success: true, accessToken: 'token' })),
      getFileDownloadUrl,
    } as any);
    const xml = '<movie><title>真实标题</title><year>2021</year><plot>简介</plot></movie>';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode(xml).buffer,
      })),
    );

    const resp = await callResolveNfo({ type: 'DRIVE115_MEDIA_LIBRARY_RESOLVE_NFO', key: 'f1:v1' });

    expect(getFileDownloadUrl).toHaveBeenCalledWith({ accessToken: 'token', pickCode: 'nfo-pick' });
    expect(resp).toMatchObject({ success: true });
    expect(resp.summary).toMatchObject({ title: '真实标题', year: '2021', plot: '简介' });
    expect(saveDrive115LibraryState).toHaveBeenCalled();
    const saved = vi.mocked(saveDrive115LibraryState).mock.calls[0][0] as any;
    expect(saved.entries[0].nfoSummary).toMatchObject({ title: '真实标题' });

    vi.unstubAllGlobals();
  });

  it('falls back across NFO candidates and keeps the more complete parsed summary', async () => {
    vi.mocked(loadDrive115LibraryState).mockResolvedValue({
      ...emptyState,
      entries: [{
        ...entry,
        nfoCandidates: [
          { fileId: 'brief', fileName: 'SSIS-001.nfo', pickCode: 'brief-pick' },
          { fileId: 'rich', fileName: 'movie.nfo', pickCode: 'rich-pick' },
        ],
      } as any],
    });
    const getFileDownloadUrl = vi.fn(async ({ pickCode }: { pickCode: string }) => ({
      success: true,
      url: `https://dl/${pickCode}`,
    }));
    vi.mocked(getDrive115V2Service).mockReturnValue({
      getValidAccessToken: vi.fn(async () => ({ success: true, accessToken: 'token' })),
      getFileDownloadUrl,
    } as any);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode(
        url.endsWith('brief-pick')
          ? '<movie><title>简版</title></movie>'
          : '<movie><title>完整版</title><year>2024</year><plot>完整简介</plot><actor><name>演员</name></actor></movie>',
      ).buffer,
    })));

    const resp = await callResolveNfo({ type: 'DRIVE115_MEDIA_LIBRARY_RESOLVE_NFO', key: 'f1:v1' });

    expect(getFileDownloadUrl).toHaveBeenCalledWith({ accessToken: 'token', pickCode: 'brief-pick' });
    expect(getFileDownloadUrl).toHaveBeenCalledWith({ accessToken: 'token', pickCode: 'rich-pick' });
    expect(resp.summary).toMatchObject({ title: '完整版', year: '2024', plot: '完整简介', actors: ['演员'] });
    vi.unstubAllGlobals();
  });

  it('continues with the next NFO when an earlier candidate cannot be downloaded', async () => {
    vi.mocked(loadDrive115LibraryState).mockResolvedValue({
      ...emptyState,
      entries: [{
        ...entry,
        nfoCandidates: [
          { fileId: 'broken', fileName: 'SSIS-001.nfo', pickCode: 'broken-pick' },
          { fileId: 'usable', fileName: 'movie.nfo', pickCode: 'usable-pick' },
        ],
      } as any],
    });
    const getFileDownloadUrl = vi.fn(async ({ pickCode }: { pickCode: string }) => (
      pickCode === 'broken-pick'
        ? { success: false, message: '直链已失效' }
        : { success: true, url: 'https://dl/usable-pick' }
    ));
    vi.mocked(getDrive115V2Service).mockReturnValue({
      getValidAccessToken: vi.fn(async () => ({ success: true, accessToken: 'token' })),
      getFileDownloadUrl,
    } as any);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode('<movie><title>可用 NFO</title></movie>').buffer,
    })));

    const resp = await callResolveNfo({ type: 'DRIVE115_MEDIA_LIBRARY_RESOLVE_NFO', key: 'f1:v1' });

    expect(getFileDownloadUrl).toHaveBeenCalledWith({ accessToken: 'token', pickCode: 'broken-pick' });
    expect(getFileDownloadUrl).toHaveBeenCalledWith({ accessToken: 'token', pickCode: 'usable-pick' });
    expect(resp.summary).toMatchObject({ title: '可用 NFO' });
    vi.unstubAllGlobals();
  });

  it('fails gracefully when the entry has no NFO pick code', async () => {
    vi.mocked(loadDrive115LibraryState).mockResolvedValue({
      ...emptyState,
      entries: [{ ...entry, nfoPickCode: undefined } as any],
    });

    const resp = await callResolveNfo({ type: 'DRIVE115_MEDIA_LIBRARY_RESOLVE_NFO', key: 'f1:v1' });

    expect(resp.success).toBe(false);
    expect(saveDrive115LibraryState).not.toHaveBeenCalled();
  });
});

describe('handleDrive115MediaLibraryResolveCoverUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves a short-lived cover download url by pick code', async () => {
    const getFileDownloadUrl = vi.fn(async () => ({ success: true, url: 'https://cdn/cover.jpg' }));
    vi.mocked(getDrive115V2Service).mockReturnValue({
      getValidAccessToken: vi.fn(async () => ({ success: true, accessToken: 'token' })),
      getFileDownloadUrl,
    } as any);

    const resp = await new Promise<any>((resolve) => {
      const handled = handleDrive115MediaLibraryResolveCoverUrl(
        { type: 'DRIVE115_MEDIA_LIBRARY_RESOLVE_COVER_URL', pickCode: 'cover-pick' },
        resolve,
      );
      expect(handled).toBe(true);
    });

    expect(getFileDownloadUrl).toHaveBeenCalledWith({ accessToken: 'token', pickCode: 'cover-pick' });
    expect(resp).toMatchObject({ success: true, url: 'https://cdn/cover.jpg' });
  });

  it('fails when pick code is missing', async () => {
    const resp = await new Promise<any>((resolve) => {
      handleDrive115MediaLibraryResolveCoverUrl({ type: 'x' }, resolve);
    });
    expect(resp.success).toBe(false);
  });
});
