/**
 * @file mediaStateFilterRuntime.test.ts
 * @description records 媒体库状态筛选运行时（10-27 pin）：缓存键第三失效维度
 * （人工钉住指纹）——仅编辑保存改 override 不动索引/服务器时也能触发重算。
 * @module apps/extension/src/dashboard/tabs/records
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { stateMock, chromeMock, loadDrive115Mock } = vi.hoisted(() => {
  const chromeMock = {
    storage: {
      local: { get: vi.fn(async () => ({})) },
      // onChanged 挂在 storage 下（与真实 chrome.storage.onChanged 一致）
      onChanged: {
        addListener: (fn: () => void) => { listeners.add(fn); },
        removeListener: (fn: () => void) => { listeners.delete(fn); },
      },
    },
  };
  const listeners = new Set<() => void>();
  return {
    stateMock: { settings: {} as Record<string, unknown> },
    loadDrive115Mock: vi.fn(),
    chromeMock,
  };
});

vi.mock('../../state', () => ({ STATE: stateMock }));
// 只覆盖 loadDrive115LibraryState（chromeStorage 链路在 node 单测环境挂起）；其余导出走真实模块
vi.mock('../../../features/drive115/mediaLibrary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../features/drive115/mediaLibrary')>();
  return { ...actual, loadDrive115LibraryState: (...args: unknown[]) => loadDrive115Mock(...args) };
});

import { createMediaStateFilterRuntime } from './mediaStateFilterRuntime';
import type { VideoRecord } from '../../../types';

function record(id: string, overrides?: VideoRecord['mediaStateOverrides']): VideoRecord {
  return {
    id,
    title: id,
    status: 'browsed',
    tags: [],
    videoCode: id.toLowerCase(),
    createdAt: 1,
    updatedAt: 2,
    mediaStateOverrides: overrides,
  };
}

function createRuntime(records: VideoRecord[]) {
  const onIndicesChanged = vi.fn();
  const rt = createMediaStateFilterRuntime({
    getRecords: () => records,
    getInLibraryActive: () => false,
    getRealWatchedActive: () => false,
    onIndicesChanged,
  });
  return { rt, onIndicesChanged };
}

describe('mediaStateFilterRuntime 缓存失效维度（10-27 pin）', () => {
  beforeEach(() => {
    stateMock.settings = { emby: { mediaServers: [] } };
    loadDrive115Mock.mockReset();
    loadDrive115Mock.mockResolvedValue(null);
    chromeMock.storage.local.get.mockReset();
    chromeMock.storage.local.get.mockResolvedValue({});
    (globalThis as Record<string, unknown>).chrome = chromeMock;
  });

  it('缓存有效（索引/服务器/钉住均未变）→ 零成本短路，不重复触发回调', async () => {
    const rec = record('ABC-001', { realWatched: true });
    const { rt, onIndicesChanged } = createRuntime([rec]);
    await rt.ensureLoaded();
    await rt.ensureLoaded();
    expect(onIndicesChanged).toHaveBeenCalledTimes(1);
    expect(rt.getHits()?.get('ABC-001')).toMatchObject({ realWatched: true, pinned: { realWatched: true } });
  });

  it('仅 override 变化（索引/服务器未变）→ 缓存键变化触发重算（钉住→清除）', async () => {
    const rec = record('ABC-001', { realWatched: true });
    const { rt, onIndicesChanged } = createRuntime([rec]);
    await rt.ensureLoaded();
    expect(rt.getHits()?.get('ABC-001')).toMatchObject({ realWatched: true });
    expect(onIndicesChanged).toHaveBeenCalledTimes(1);

    delete rec.mediaStateOverrides; // 仅改人工钉住，不动索引/服务器
    await rt.ensureLoaded();
    expect(rt.getHits()?.get('ABC-001')).toBeUndefined();
    expect(onIndicesChanged).toHaveBeenCalledTimes(1); // 未激活且无命中 → 不触发重滤
  });

  it('钉住从无到有 → 缓存失效并产生新命中', async () => {
    const rec = record('ABC-001');
    const { rt } = createRuntime([rec]);
    await rt.ensureLoaded();
    expect(rt.getHits()?.size ?? 0).toBe(0);

    rec.mediaStateOverrides = { inLibrary: true };
    await rt.ensureLoaded();
    expect(rt.getHits()?.get('ABC-001')).toMatchObject({ inLibrary: true, pinned: { inLibrary: true } });
  });

  it('强制关（override=false）变化同样失效重算，且命中不落 map', async () => {
    const rec = record('ABC-001');
    const { rt } = createRuntime([rec]);
    await rt.ensureLoaded();
    expect(rt.getHits()?.size ?? 0).toBe(0);

    rec.mediaStateOverrides = { inLibrary: false };
    await rt.ensureLoaded();
    expect(rt.getHits()?.size ?? 0).toBe(0);

    rec.mediaStateOverrides = { inLibrary: true };
    await rt.ensureLoaded();
    expect(rt.getHits()?.get('ABC-001')).toMatchObject({ inLibrary: true, pinned: { inLibrary: true } });
  });

  it('服务器配置变更仍触发失效（既有维度回归）', async () => {
    const rec = record('ABC-001', { realWatched: true });
    const { rt, onIndicesChanged } = createRuntime([rec]);
    await rt.ensureLoaded();
    expect(onIndicesChanged).toHaveBeenCalledTimes(1);

    stateMock.settings = { emby: { mediaServers: [{ type: 'emby', url: 'http://e2.local', enabled: true }] } };
    await rt.ensureLoaded();
    expect(onIndicesChanged).toHaveBeenCalledTimes(2); // 版本变更 + 存在命中 → 再触发
    expect(rt.getHits()?.get('ABC-001')).toMatchObject({ realWatched: true });
  });
});
