/**
 * @file handlers.manualSyncCancel.test.ts
 * @description 手动资料库同步支持取消（10-31-ext-emby-syncbtn-unstick）：
 * abort 页边界与部分结果、取消时 wipeEntries 守卫、cancel 幂等、manual 重入防护、
 * composeAbortSignals 信号合成（含 AbortSignal.any 不可用回退）
 * @module features/embyLibrary
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  composeAbortSignals,
  handleEmbyLibraryCancelSync,
  handleEmbyLibrarySync,
} from './handlers';
import type { EmbyLibraryState, EmbyMediaServer } from '../types';

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const serverA: EmbyMediaServer = {
  id: 'srv-a',
  type: 'emby',
  name: 'A',
  url: 'http://a.local:8096/',
  apiKey: 'KEY-A',
  enabled: true,
};
const serverB: EmbyMediaServer = {
  id: 'srv-b',
  type: 'emby',
  name: 'B',
  url: 'http://b.local:8096/',
  apiKey: 'KEY-B',
  enabled: true,
};

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('waitFor timeout');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function createDeps(fetchImpl: typeof fetch, settings: any, storedState: EmbyLibraryState = { entries: {}, updatedAt: 0 }) {
  return {
    getSettings: vi.fn(async () => settings),
    getState: vi.fn(async () => storedState),
    saveState: vi.fn(async () => {}),
    saveSettings: vi.fn(async () => {}),
    fetchImpl,
    now: vi.fn(() => 1000),
  };
}

/** 构造一个挂起至 signal abort 的页响应（abort 时按 AbortError 拒绝） */
function pendingPage(signal: AbortSignal | undefined): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    if (!signal) return;
    const rejectAbort = () => {
      const error = new Error('The operation was aborted.');
      error.name = 'AbortError';
      reject(error);
    };
    if (signal.aborted) {
      rejectAbort();
      return;
    }
    signal.addEventListener('abort', rejectAbort, { once: true });
  });
}

describe('handleEmbyLibrarySync manual cancel (U1/U2/U3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('U1 abort 页边界：挂起页被中断 → canceled=true + 部分结果 + 未开始服务器「已取消」', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async (input, init) => {
      const url = String(input);
      if (url.includes('a.local') && url.includes('StartIndex=0')) {
        return new Response(
          JSON.stringify({
            Items: [{ Id: 'item-a1', Name: 'ABC-101', Path: '/movies/ABC-101.mkv' }],
            TotalRecordCount: 501,
          }),
          { status: 200 },
        );
      }
      if (url.includes('a.local')) {
        return pendingPage(init?.signal as AbortSignal | undefined);
      }
      throw new Error(`unexpected url ${url}`);
    });
    const settings = {
      emby: {
        mediaServers: [serverA, serverB],
        libraryStatus: { enabled: true, showOnList: true, showOnDetail: true },
        libraryEnabled: true,
      },
    };
    const deps = createDeps(fetchImpl, settings);
    const sendResponse = vi.fn();

    const syncPromise = handleEmbyLibrarySync({ manual: true }, sendResponse, deps);
    // A 首页正常 → 第二页挂起在途
    await waitFor(() => fetchImpl.mock.calls.length >= 2);

    const cancelResponse = vi.fn();
    expect(handleEmbyLibraryCancelSync(undefined, cancelResponse)).toBe(true);
    await waitFor(() => cancelResponse.mock.calls.length >= 1);
    expect(cancelResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true, running: true }));

    await syncPromise;
    expect(sendResponse).toHaveBeenCalledTimes(1);
    const response = sendResponse.mock.calls[0][0] as any;
    expect(response.canceled).toBe(true);
    expect(response.synced).toBe(0);
    expect(response.failed).toBe(2);
    expect(response.serverResults).toHaveLength(2);
    const [aResult, bResult] = response.serverResults as any[];
    expect(aResult).toEqual(expect.objectContaining({ serverId: 'srv-a', success: false }));
    expect(String(aResult.error)).toContain('取消');
    expect(bResult).toEqual(expect.objectContaining({ serverId: 'srv-b', success: false, error: '已取消' }));
    // B 从未开始请求
    expect(fetchImpl.mock.calls.every((call) => !String(call[0]).includes('b.local'))).toBe(true);

    // 结束后再次取消 → 幂等 running:false
    const cancelResponse2 = vi.fn();
    handleEmbyLibraryCancelSync(undefined, cancelResponse2);
    await waitFor(() => cancelResponse2.mock.calls.length >= 1);
    expect(cancelResponse2).toHaveBeenCalledWith(expect.objectContaining({ success: true, running: false }));
  });

  it('U2 取消时 wipeEntries 守卫：入库关闭的全量手动同步被取消 → 不清空 entries（saveState 不被调用）', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async (input, init) => {
      const url = String(input);
      if (url.includes('StartIndex=0')) {
        return new Response(
          JSON.stringify({
            Items: [{ Id: 'item-a1', Name: 'ABC-900', Path: '/movies/ABC-900.mkv' }],
            TotalRecordCount: 501,
          }),
          { status: 200 },
        );
      }
      return pendingPage(init?.signal as AbortSignal | undefined);
    });
    const previousState: EmbyLibraryState = {
      entries: {
        'ABC-900': [{
          serverType: 'emby',
          serverName: 'A',
          serverUrl: 'http://a.local:8096',
          itemId: 'old-item',
          itemName: 'ABC-900',
          updatedAt: 500,
        }],
      },
      updatedAt: 500,
    };
    const settings = {
      emby: {
        mediaServers: [serverA],
        libraryStatus: { enabled: false, showOnList: true, showOnDetail: true },
        libraryEnabled: false,
      },
    };
    const deps = createDeps(fetchImpl, settings, previousState);
    const sendResponse = vi.fn();

    const syncPromise = handleEmbyLibrarySync({ manual: true }, sendResponse, deps);
    await waitFor(() => fetchImpl.mock.calls.length >= 2);
    const cancelResponse = vi.fn();
    handleEmbyLibraryCancelSync(undefined, cancelResponse);
    await waitFor(() => cancelResponse.mock.calls.length >= 1);
    await syncPromise;

    const response = sendResponse.mock.calls[0][0] as any;
    expect(response.canceled).toBe(true);
    // 取消 ≠「关闭即清空」：最后快照原样保留
    expect(deps.saveState).not.toHaveBeenCalled();
  });

  it('U3 cancel 幂等：无在途 → running:false；在途 → running:true；结束 → running:false', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async (_input, init) => pendingPage(init?.signal as AbortSignal | undefined));
    const settings = {
      emby: {
        mediaServers: [serverA],
        libraryStatus: { enabled: true },
        libraryEnabled: true,
      },
    };
    const deps = createDeps(fetchImpl, settings);

    // 无在途
    const idleResponse = vi.fn();
    handleEmbyLibraryCancelSync(undefined, idleResponse);
    await waitFor(() => idleResponse.mock.calls.length >= 1);
    expect(idleResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true, running: false }));

    // 在途（首页即挂起）
    const sendResponse = vi.fn();
    const syncPromise = handleEmbyLibrarySync({ manual: true }, sendResponse, deps);
    await waitFor(() => fetchImpl.mock.calls.length >= 1);
    const busyResponse = vi.fn();
    handleEmbyLibraryCancelSync(undefined, busyResponse);
    await waitFor(() => busyResponse.mock.calls.length >= 1);
    expect(busyResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true, running: true }));

    await syncPromise;
    const response = sendResponse.mock.calls[0][0] as any;
    expect(response.canceled).toBe(true);

    const afterResponse = vi.fn();
    handleEmbyLibraryCancelSync(undefined, afterResponse);
    await waitFor(() => afterResponse.mock.calls.length >= 1);
    expect(afterResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true, running: false }));
  });

  it('manual 重入防护：在途 manual 期间再次 manual → 「已有同步在途」，原同步不受影响仍可取消', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async (_input, init) => pendingPage(init?.signal as AbortSignal | undefined));
    const settings = {
      emby: {
        mediaServers: [serverA],
        libraryStatus: { enabled: true },
        libraryEnabled: true,
      },
    };
    const deps = createDeps(fetchImpl, settings);
    const sendResponse = vi.fn();

    const syncPromise = handleEmbyLibrarySync({ manual: true }, sendResponse, deps);
    await waitFor(() => fetchImpl.mock.calls.length >= 1);

    const secondResponse = vi.fn();
    await handleEmbyLibrarySync({ manual: true }, secondResponse, deps);
    expect(secondResponse).toHaveBeenCalledWith({ success: false, error: '已有同步在途' });

    const cancelResponse = vi.fn();
    handleEmbyLibraryCancelSync(undefined, cancelResponse);
    await waitFor(() => cancelResponse.mock.calls.length >= 1);
    await syncPromise;
    expect(sendResponse).toHaveBeenCalledTimes(1);
    expect(sendResponse.mock.calls[0][0]).toEqual(expect.objectContaining({ canceled: true }));
  });
});

describe('composeAbortSignals', () => {
  it('空/全 undefined → undefined；单信号原样返回', () => {
    expect(composeAbortSignals([])).toBeUndefined();
    expect(composeAbortSignals([undefined, undefined])).toBeUndefined();
    const signal = new AbortController().signal;
    expect(composeAbortSignals([signal, undefined])).toBe(signal);
  });

  it('双信号 + AbortSignal.any 可用：任一 abort → 合成 aborted', () => {
    const c1 = new AbortController();
    const c2 = new AbortController();
    const composed = composeAbortSignals([c1.signal, c2.signal]);
    expect(composed).toBeDefined();
    expect(composed?.aborted).toBe(false);
    c2.abort();
    expect(composed?.aborted).toBe(true);
  });

  it('AbortSignal.any 不可用 → 回退合成，任一 abort → aborted（含合成时已 abort）', () => {
    const originalAny = (AbortSignal as any).any;
    vi.stubGlobal('AbortSignal', { ...AbortSignal, any: undefined });
    try {
      const c1 = new AbortController();
      const c2 = new AbortController();
      const composed = composeAbortSignals([c1.signal, c2.signal]);
      expect(composed).toBeDefined();
      expect(composed?.aborted).toBe(false);
      c1.abort();
      expect(composed?.aborted).toBe(true);

      const c3 = new AbortController();
      const c4 = new AbortController();
      c4.abort();
      const composed2 = composeAbortSignals([c3.signal, c4.signal]);
      expect(composed2?.aborted).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      expect((AbortSignal as any).any).toBe(originalAny);
    }
  });
});
