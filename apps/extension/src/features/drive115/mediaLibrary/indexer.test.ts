/**
 * @file indexer.test.ts
 * @description 浅层索引器单测
 * @module features/drive115/mediaLibrary
 */
import { describe, expect, it, vi } from 'vitest';
import { indexDrive115Roots } from './indexer';
import type { Drive115LibraryIndexState } from './types';

describe('indexDrive115Roots', () => {
  it('indexes shallow movie folders under roots', async () => {
    const listFiles = vi.fn(async ({ cid }: { cid: string }) => {
      if (cid === 'root1') {
        return {
          success: true,
          data: [
            { fc: '0', cid: 'f1', fn: 'SSIS-001' },
            { fc: '0', cid: 'f2', fn: 'no-video-folder' },
          ],
        };
      }
      if (cid === 'f1') {
        return {
          success: true,
          data: [
            { fc: '1', fid: 'v1', fn: 'SSIS-001.mp4', fs: 5000, pc: 'pick1' },
            { fc: '1', fid: 'c1', fn: 'poster.jpg', fs: 10, pc: 'pickc' },
            { fc: '1', fid: 'n1', fn: 'SSIS-001.nfo', fs: 1, pc: 'pickn' },
          ],
        };
      }
      if (cid === 'f2') {
        return {
          success: true,
          data: [{ fc: '1', fid: 'x1', fn: 'readme.txt', fs: 1, pc: 'px' }],
        };
      }
      return { success: false, message: 'unknown cid' };
    });

    const result = await indexDrive115Roots({
      roots: [{ cid: 'root1', name: '片库', enabled: true }],
      listFiles,
      sleep: async () => {},
      rootIntervalMs: 0,
      folderIntervalMs: 0,
      now: () => 1_700_000_000_000,
    });

    expect(result.success).toBe(true);
    expect(result.state.entries).toHaveLength(1);
    expect(result.state.entries[0].code).toBe('SSIS-001');
    expect(result.state.entries[0].pickCode).toBe('pick1');
    expect(result.state.entries[0].coverFileId).toBe('c1');
    expect(result.state.stats.skipped).toBe(1);
    expect(result.state.stats.indexed).toBe(1);
    expect(listFiles).toHaveBeenCalled();
  });

  it('flushes partial state incrementally as entries are indexed', async () => {
    const listFiles = vi.fn(async ({ cid }: { cid: string }) => {
      if (cid === 'root') {
        return {
          success: true,
          data: [
            { fc: '0', cid: 'f1', fn: 'SSIS-001' },
            { fc: '0', cid: 'f2', fn: 'SSIS-002' },
          ],
        };
      }
      if (cid === 'f1') {
        return { success: true, data: [{ fc: '1', fid: 'v1', fn: 'SSIS-001.mp4', fs: 10, pc: 'p1' }] };
      }
      return { success: true, data: [{ fc: '1', fid: 'v2', fn: 'SSIS-002.mp4', fs: 10, pc: 'p2' }] };
    });

    const snapshots: number[] = [];
    const result = await indexDrive115Roots({
      roots: [{ cid: 'root', enabled: true }],
      listFiles,
      flushEveryN: 1,
      onPartialState: (state) => {
        snapshots.push(state.entries.length);
      },
      sleep: async () => {},
      rootIntervalMs: 0,
      folderIntervalMs: 0,
      now: () => 1_700_000_000_000,
    });

    expect(result.success).toBe(true);
    expect(result.state.entries).toHaveLength(2);
    // 每入库一条即增量 flush 一次，累计条数递增
    expect(snapshots).toEqual([1, 2]);
  });

  it('merges incremental flush snapshots into the previous index', async () => {
    const previous: Drive115LibraryIndexState = {
      version: 1,
      updatedAt: 100,
      entries: [
        {
          key: 'old:1',
          code: 'OLD-001',
          title: 'OLD-001',
          folderCid: 'old',
          folderName: 'OLD-001',
          rootCid: 'r',
          videoFileId: '1',
          pickCode: 'p',
          fileName: 'OLD-001.mp4',
          fileSize: 1,
          updatedAt: 100,
        },
      ],
      stats: {
        roots: 1,
        foldersSeen: 1,
        indexed: 1,
        skipped: 0,
        unrecognized: 0,
        apiCalls: 1,
        truncatedFolders: 0,
      },
    };
    const listFiles = vi.fn(async ({ cid }: { cid: string }) => {
      if (cid === 'root') {
        return { success: true, data: [{ fc: '0', cid: 'f1', fn: 'SSIS-001' }] };
      }
      return { success: true, data: [{ fc: '1', fid: 'v1', fn: 'SSIS-001.mp4', fs: 10, pc: 'p1' }] };
    });

    const flushed: string[][] = [];
    await indexDrive115Roots({
      roots: [{ cid: 'root', enabled: true }],
      previous,
      listFiles,
      flushEveryN: 1,
      onPartialState: (state) => {
        flushed.push(state.entries.map((e) => e.code).sort());
      },
      sleep: async () => {},
      rootIntervalMs: 0,
      folderIntervalMs: 0,
      now: () => 1_700_000_000_000,
    });

    // 增量快照应把本轮条目并入旧索引，而非只含本轮
    expect(flushed.at(-1)).toEqual(['OLD-001', 'SSIS-001']);
  });

  it('indexes actor/category folders at the default depth', async () => {
    const listFiles = vi.fn(async ({ cid }: { cid: string }) => {
      if (cid === 'root') {
        return { success: true, data: [{ fc: '0', cid: 'actor', fn: 'AIKA' }] };
      }
      if (cid === 'actor') {
        return { success: true, data: [{ fc: '0', cid: 'movie', fn: '390JNT-076' }] };
      }
      if (cid === 'movie') {
        return {
          success: true,
          data: [{ fc: '1', fid: 'v1', fn: '390JNT-076.mp4', fs: 10, pc: 'p1' }],
        };
      }
      return { success: false, message: 'unknown cid' };
    });

    const result = await indexDrive115Roots({
      roots: [{ cid: 'root', enabled: true }],
      listFiles,
      sleep: async () => {},
      rootIntervalMs: 0,
      folderIntervalMs: 0,
      now: () => 1_700_000_000_000,
    });

    expect(result.success).toBe(true);
    expect(result.state.entries).toHaveLength(1);
    expect(result.state.entries[0].code).toBe('390JNT-076');
    expect(listFiles).toHaveBeenCalledWith(expect.objectContaining({ cid: 'actor' }));
    expect(listFiles).toHaveBeenCalledWith(expect.objectContaining({ cid: 'movie' }));
  });


  it('prioritizes the current actor branch in wide roots so entries appear before container cap', async () => {
    const rootFolders = Array.from({ length: 5 }, (_, index) => ({
      fc: '0',
      cid: `actor-${index + 1}`,
      fn: `Actor ${index + 1}`,
    }));
    const listFiles = vi.fn(async ({ cid }: { cid: string }) => {
      if (cid === 'root') {
        return { success: true, data: rootFolders };
      }
      if (cid === 'actor-1') {
        return { success: true, data: [{ fc: '0', cid: 'movie-1', fn: '390JNT-076' }] };
      }
      if (cid === 'movie-1') {
        return {
          success: true,
          data: [{ fc: '1', fid: 'v1', fn: '390JNT-076.mp4', fs: 10, pc: 'p1' }],
        };
      }
      return { success: true, data: [] };
    });

    const result = await indexDrive115Roots({
      roots: [{ cid: 'root', enabled: true }],
      listFiles,
      maxContainerFolders: 1,
      sleep: async () => {},
      rootIntervalMs: 0,
      folderIntervalMs: 0,
    });

    expect(result.state.entries.map((entry) => entry.code)).toContain('390JNT-076');
    expect(listFiles).toHaveBeenCalledWith(expect.objectContaining({ cid: 'movie-1' }));
  });


  it('respects scanDepth 1 for direct movie folders only', async () => {
    const listFiles = vi.fn(async ({ cid }: { cid: string }) => {
      if (cid === 'root') {
        return { success: true, data: [{ fc: '0', cid: 'actor', fn: 'AIKA' }] };
      }
      if (cid === 'actor') {
        return { success: true, data: [{ fc: '0', cid: 'movie', fn: '390JNT-076' }] };
      }
      if (cid === 'movie') {
        return {
          success: true,
          data: [{ fc: '1', fid: 'v1', fn: '390JNT-076.mp4', fs: 10, pc: 'p1' }],
        };
      }
      return { success: false, message: 'unknown cid' };
    });

    const result = await indexDrive115Roots({
      roots: [{ cid: 'root', enabled: true }],
      scanDepth: 1,
      listFiles,
      sleep: async () => {},
      rootIntervalMs: 0,
      folderIntervalMs: 0,
    });

    expect(result.success).toBe(true);
    expect(result.state.entries).toHaveLength(0);
    expect(listFiles).not.toHaveBeenCalledWith(expect.objectContaining({ cid: 'movie' }));
  });

  it('returns a cancellable partial result', async () => {
    let calls = 0;
    const listFiles = vi.fn(async ({ cid }: { cid: string }) => {
      calls += 1;
      if (cid === 'root') {
        return {
          success: true,
          data: [
            { fc: '0', cid: 'f1', fn: 'SSIS-001' },
            { fc: '0', cid: 'f2', fn: 'SSIS-002' },
          ],
        };
      }
      if (cid === 'f1') {
        return {
          success: true,
          data: [{ fc: '1', fid: 'v1', fn: 'SSIS-001.mp4', fs: 10, pc: 'p1' }],
        };
      }
      return {
        success: true,
        data: [{ fc: '1', fid: 'v2', fn: 'SSIS-002.mp4', fs: 10, pc: 'p2' }],
      };
    });

    const result = await indexDrive115Roots({
      roots: [{ cid: 'root', enabled: true }],
      listFiles,
      shouldCancel: () => calls >= 3,
      sleep: async () => {},
      rootIntervalMs: 0,
      folderIntervalMs: 0,
      now: () => 1_700_000_000_000,
    });

    expect(result.success).toBe(false);
    expect(result.cancelled).toBe(true);
    expect(result.partialMerged).toBe(true);
    expect(result.partialIndexed).toBe(1);
    expect(result.state.entries).toHaveLength(1);
    expect(result.message).toContain('\u53d6\u6d88');
  });


  it('keeps previous index on circuit break', async () => {
    const previous: Drive115LibraryIndexState = {
      version: 1,
      updatedAt: 100,
      entries: [
        {
          key: 'old:1',
          code: 'OLD-001',
          title: 'OLD-001',
          folderCid: 'old',
          folderName: 'OLD-001',
          rootCid: 'r',
          videoFileId: '1',
          pickCode: 'p',
          fileName: 'OLD-001.mp4',
          fileSize: 1,
          updatedAt: 100,
        },
      ],
      stats: {
        roots: 1,
        foldersSeen: 1,
        indexed: 1,
        skipped: 0,
        unrecognized: 0,
        apiCalls: 1,
        truncatedFolders: 0,
      },
    };

    let calls = 0;
    const listFiles = vi.fn(async () => {
      calls += 1;
      return { success: false, message: '请求过于频繁 429' };
    });

    const result = await indexDrive115Roots({
      roots: [{ cid: 'root', enabled: true }],
      previous,
      listFiles,
      sleep: async () => {},
      rootIntervalMs: 0,
      folderIntervalMs: 0,
      circuitBreakerThreshold: 1,
    });

    expect(result.success).toBe(false);
    expect(result.keptPrevious).toBe(true);
    expect(result.state.entries[0].code).toBe('OLD-001');
    expect(result.state.lastError).toMatch(/限流|熔断|频繁/);
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  it('merges this-run entries into previous on mid-index circuit break', async () => {
    const previous: Drive115LibraryIndexState = {
      version: 1,
      updatedAt: 100,
      entries: [
        {
          key: 'old:1',
          code: 'OLD-001',
          title: 'OLD-001',
          folderCid: 'old',
          folderName: 'OLD-001',
          rootCid: 'r',
          videoFileId: '1',
          pickCode: 'p',
          fileName: 'OLD-001.mp4',
          fileSize: 1,
          updatedAt: 100,
        },
      ],
      stats: {
        roots: 1,
        foldersSeen: 1,
        indexed: 1,
        skipped: 0,
        unrecognized: 0,
        apiCalls: 1,
        truncatedFolders: 0,
      },
    };

    let calls = 0;
    const listFiles = vi.fn(async ({ cid }: { cid: string }) => {
      calls += 1;
      if (cid === 'root') {
        return {
          success: true,
          data: [
            { fc: '0', cid: 'f1', fn: 'SSIS-001' },
            { fc: '0', cid: 'f2', fn: 'SSIS-002' },
          ],
        };
      }
      if (cid === 'f1') {
        return {
          success: true,
          data: [{ fc: '1', fid: 'v1', fn: 'SSIS-001.mp4', fs: 10, pc: 'p1' }],
        };
      }
      // second folder trips rate limit
      return { success: false, message: '请求过于频繁 429' };
    });

    const result = await indexDrive115Roots({
      roots: [{ cid: 'root', enabled: true }],
      previous,
      listFiles,
      sleep: async () => {},
      rootIntervalMs: 0,
      folderIntervalMs: 0,
      circuitBreakerThreshold: 1,
      now: () => 1_700_000_000_111,
    });

    expect(result.success).toBe(false);
    expect(result.partialMerged).toBe(true);
    expect(result.partialIndexed).toBe(1);
    expect(result.keptPrevious).toBe(false);
    expect(result.state.entries.map((e) => e.code).sort()).toEqual(['OLD-001', 'SSIS-001']);
    expect(result.message).toMatch(/已合并保存本轮 1 条/);
    expect(calls).toBeGreaterThanOrEqual(3);
  });


  it('passes abort signal to list calls and treats signal abort as cancellation', async () => {
    const controller = new AbortController();
    const signals: Array<AbortSignal | undefined> = [];
    const listFiles = vi.fn(async ({ cid, signal }: { cid: string; signal?: AbortSignal }) => {
      signals.push(signal);
      if (cid === 'root') {
        return { success: true, data: [{ fc: '0', cid: 'f1', fn: 'SSIS-001' }] };
      }
      controller.abort();
      return {
        success: true,
        data: [{ fc: '1', fid: 'v1', fn: 'SSIS-001.mp4', fs: 10, pc: 'p1' }],
      };
    });

    const result = await indexDrive115Roots({
      roots: [{ cid: 'root', enabled: true }],
      listFiles,
      signal: controller.signal,
      sleep: async () => {},
      rootIntervalMs: 0,
      folderIntervalMs: 0,
    });

    expect(result.success).toBe(false);
    expect(result.cancelled).toBe(true);
    expect(result.message).toContain('\u53d6\u6d88');
    expect(signals).toEqual([controller.signal, controller.signal]);
  });


  it('collects an index report with classified skip reasons', async () => {
    const listFiles = vi.fn(async ({ cid }: { cid: string }) => {
      if (cid === 'root') {
        return {
          success: true,
          data: [
            { fc: '0', cid: 'ok', fn: 'SSIS-001' }, // 有视频有 pickCode → 入库
            { fc: '0', cid: 'nopc', fn: 'SSIS-002' }, // 有视频缺 pickCode → no_pickcode
            { fc: '0', cid: 'novid', fn: '杂项' }, // 只有非视频文件 → no_video
          ],
        };
      }
      if (cid === 'ok') {
        return { success: true, data: [{ fc: '1', fid: 'v1', fn: 'SSIS-001.mp4', fs: 10, pc: 'p1' }] };
      }
      if (cid === 'nopc') {
        return { success: true, data: [{ fc: '1', fid: 'v2', fn: 'SSIS-002.mp4', fs: 10, pc: '' }] };
      }
      return { success: true, data: [{ fc: '1', fid: 'x1', fn: 'readme.txt', fs: 1, pc: 'px' }] };
    });

    const result = await indexDrive115Roots({
      roots: [{ cid: 'root', enabled: true }],
      listFiles,
      sleep: async () => {},
      rootIntervalMs: 0,
      folderIntervalMs: 0,
      now: () => 1_700_000_000_000,
    });

    const report = result.report;
    expect(report).toBeTruthy();
    expect(report?.indexedTotal).toBe(1);
    expect(report?.skippedTotal).toBe(2);
    expect(report?.skipReasonCounts.no_pickcode).toBe(1);
    expect(report?.skipReasonCounts.no_video).toBe(1);
    expect(report?.indexed[0]?.code).toBe('SSIS-001');
    expect(report?.skipped.map((s) => s.reason).sort()).toEqual(['no_pickcode', 'no_video']);
    expect(report?.apiCalls).toBe(result.state.stats.apiCalls);
  });

  it('returns empty success when no roots', async () => {
    const result = await indexDrive115Roots({
      roots: [],
      listFiles: async () => ({ success: true, data: [] }),
      sleep: async () => {},
    });
    expect(result.success).toBe(true);
    expect(result.state.entries).toEqual([]);
    expect(result.message).toMatch(/未配置/);
  });
});
