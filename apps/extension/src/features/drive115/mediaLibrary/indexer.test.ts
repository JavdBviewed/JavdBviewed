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
