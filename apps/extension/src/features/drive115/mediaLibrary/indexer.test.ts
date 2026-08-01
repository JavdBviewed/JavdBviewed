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

  it('persists cover and nfo pick codes from alternate 115 list fields', async () => {
    const listFiles = vi.fn(async ({ cid }: { cid: string }) => {
      if (cid === 'root') {
        return { success: true, data: [{ fc: '0', cid: 'f1', fn: '736DW-278' }] };
      }
      return {
        success: true,
        data: [
          { file_category: '1', fileId: 'v1', fileName: '736DW-278.mp4', file_size: '1000', pickCode: 'video-pick' },
          { file_category: '1', id: 'c1', fileName: 'poster.jpg', size: '10', pickcode: 'cover-pick' },
          { file_category: '1', file_id: 'n1', file_name: '736DW-278.nfo', file_size: '2', pcd: 'nfo-pick' },
        ],
      };
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
    expect(result.state.entries[0]).toMatchObject({
      code: '736DW-278',
      pickCode: 'video-pick',
      coverFileId: 'c1',
      coverPickCode: 'cover-pick',
      nfoFileId: 'n1',
      nfoPickCode: 'nfo-pick',
    });
  });

  it('persists every NFO candidate while keeping the code-named one as the compatibility primary NFO', async () => {
    const listFiles = vi.fn(async ({ cid }: { cid: string }) => {
      if (cid === 'root') {
        return { success: true, data: [{ fc: '0', cid: 'f1', fn: 'MISM-304 安堂はるの' }] };
      }
      return {
        success: true,
        data: [
          { fc: '1', fid: 'v1', fn: 'movie.mp4', fs: 1000, pc: 'video-pick' },
          { fc: '1', fid: 'movie-nfo', fn: 'movie.nfo', fs: 2, pc: 'movie-nfo-pick' },
          { fc: '1', fid: 'code-nfo', fn: 'MISM-304.nfo', fs: 2, pc: 'code-nfo-pick' },
        ],
      };
    });

    const result = await indexDrive115Roots({
      roots: [{ cid: 'root', enabled: true }],
      listFiles,
      sleep: async () => {},
      rootIntervalMs: 0,
      folderIntervalMs: 0,
      now: () => 1_700_000_000_000,
    });

    expect(result.state.entries[0]).toMatchObject({
      code: 'MISM-304',
      nfoFileName: 'MISM-304.nfo',
      nfoPickCode: 'code-nfo-pick',
    });
    expect(result.state.entries[0]?.nfoCandidates).toEqual([
      { fileId: 'code-nfo', fileName: 'MISM-304.nfo', pickCode: 'code-nfo-pick' },
      { fileId: 'movie-nfo', fileName: 'movie.nfo', pickCode: 'movie-nfo-pick' },
    ]);
  });

  it('records cover and nfo names in the index report for diagnostics', async () => {
    const listFiles = vi.fn(async ({ cid }: { cid: string }) => {
      if (cid === 'root') {
        return { success: true, data: [{ fc: '0', cid: 'movie', fn: 'MAAN-879' }] };
      }
      return {
        success: true,
        data: [
          { fc: '1', fid: 'video', fn: 'MAAN-879.mp4', fs: 1000, pc: 'video-pick' },
          { fc: '1', fid: 'poster', fn: 'poster.jpg', fs: 10, pc: 'cover-pick' },
          { fc: '1', fid: 'nfo', fn: 'MAAN-879.nfo', fs: 2, pc: 'nfo-pick' },
        ],
      };
    });

    const result = await indexDrive115Roots({
      roots: [{ cid: 'root', enabled: true }],
      listFiles,
      sleep: async () => {},
      rootIntervalMs: 0,
      folderIntervalMs: 0,
      now: () => 1_700_000_000_000,
    });

    expect(result.report?.indexed[0]).toMatchObject({
      code: 'MAAN-879',
      coverFileName: 'poster.jpg',
      nfoFileName: 'MAAN-879.nfo',
      hasCoverPickCode: true,
      hasNfoPickCode: true,
    });
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

  it('indexes every discovered movie folder instead of stopping at the former 300-folder ceiling', async () => {
    const directFolders = Array.from({ length: 301 }, (_, index) => ({
      fc: '0',
      cid: `movie-${index + 1}`,
      fn: `SSIS-${String(index + 1).padStart(3, '0')}`,
    }));
    const result = await indexDrive115Roots({
      roots: [{ cid: 'root', enabled: true }],
      listFiles: async ({ cid }) => {
        if (cid === 'root') return { success: true, data: directFolders };
        return {
          success: true,
          data: [{ fc: '1', fid: `${cid}-video`, fn: `${cid}.mp4`, fs: 10, pc: `${cid}-pick` }],
        };
      },
      sleep: async () => {},
      rootIntervalMs: 0,
      folderIntervalMs: 0,
    });

    expect(result.success).toBe(true);
    expect(result.state.entries).toHaveLength(301);
    expect(result.state.stats.truncatedFolders).toBe(0);
  });

  it('continues root discovery from the next 1150-item page before indexing the full queue', async () => {
    const firstPage = Array.from({ length: 1150 }, (_, index) => ({
      fc: '0',
      cid: `movie-${index + 1}`,
      fn: `SSIS-${String(index + 1).padStart(4, '0')}`,
    }));
    const rootOffsets: number[] = [];
    const result = await indexDrive115Roots({
      roots: [{ cid: 'root', enabled: true }],
      listFiles: async ({ cid, offset = 0 }) => {
        if (cid === 'root') {
          rootOffsets.push(offset);
          return {
            success: true,
            data: offset === 0
              ? firstPage
              : offset === 1150
                ? [{ fc: '0', cid: 'movie-1151', fn: 'SSIS-1151' }]
                : [],
          };
        }
        return {
          success: true,
          data: [{ fc: '1', fid: `${cid}-video`, fn: `${cid}.mp4`, fs: 10, pc: `${cid}-pick` }],
        };
      },
      sleep: async () => {},
      rootIntervalMs: 0,
      folderIntervalMs: 0,
    });

    expect(result.success).toBe(true);
    expect(rootOffsets).toEqual([0, 1150]);
    expect(result.state.entries).toHaveLength(1151);
  });

  it('saves the unfinished root page offset when pagination is rate limited and resumes from it', async () => {
    const firstPage = Array.from({ length: 1150 }, () => ({
      fc: '0',
      cid: 'first-folder',
      fn: 'SSIS-ROOT-001',
    }));
    const firstPassOffsets: number[] = [];
    const firstPass = await indexDrive115Roots({
      roots: [{ cid: 'root', enabled: true }],
      listFiles: async ({ cid, offset = 0 }) => {
        if (cid !== 'root') return { success: true, data: [] };
        firstPassOffsets.push(offset);
        if (offset === 0) return { success: true, data: firstPage };
        return { success: false, code: 429, message: '请求过于频繁，请稍后再试' };
      },
      sleep: async () => {},
      rootIntervalMs: 0,
      folderIntervalMs: 0,
      circuitBreakerThreshold: 1,
    });

    expect(firstPass.success).toBe(false);
    expect(firstPassOffsets).toEqual([0, 1150]);
    expect(firstPass.checkpoint).toMatchObject({
      rootListingComplete: false,
      nextRootOffset: 1150,
      pendingQueue: [{ cid: 'first-folder', name: 'SSIS-ROOT-001' }],
    });

    const resumedRootOffsets: number[] = [];
    const resumedCalls: string[] = [];
    const resumed = await indexDrive115Roots({
      roots: [{ cid: 'root', enabled: true }],
      previous: firstPass.state,
      checkpoint: firstPass.checkpoint,
      listFiles: async ({ cid, offset = 0 }) => {
        resumedCalls.push(cid);
        if (cid === 'root') {
          resumedRootOffsets.push(offset);
          return { success: true, data: [{ fc: '0', cid: 'second-folder', fn: 'SSIS-ROOT-002' }] };
        }
        if (cid === 'first-folder') {
          return { success: true, data: [{ fc: '1', fid: 'v1', fn: 'SSIS-ROOT-001.mp4', fs: 10, pc: 'p1' }] };
        }
        return { success: true, data: [{ fc: '1', fid: 'v2', fn: 'SSIS-ROOT-002.mp4', fs: 10, pc: 'p2' }] };
      },
      sleep: async () => {},
      rootIntervalMs: 0,
      folderIntervalMs: 0,
    });

    expect(resumed.success).toBe(true);
    expect(resumedRootOffsets).toEqual([1150]);
    expect(resumedCalls[0]).toBe('root');
    expect(resumed.state.entries.map((entry) => entry.code).sort()).toEqual(['ROOT-001', 'ROOT-002']);
  });

  it('does not apply a container-folder count ceiling while scan depth still permits traversal', async () => {
    const result = await indexDrive115Roots({
      roots: [{ cid: 'root', enabled: true }],
      listFiles: async ({ cid }) => {
        if (cid === 'root') {
          return {
            success: true,
            data: [
              { fc: '0', cid: 'actor-a', fn: 'Actor A' },
              { fc: '0', cid: 'actor-b', fn: 'Actor B' },
            ],
          };
        }
        if (cid === 'actor-a' || cid === 'actor-b') {
          return { success: true, data: [{ fc: '0', cid: `${cid}-movie`, fn: cid === 'actor-a' ? 'SSIS-201' : 'SSIS-202' }] };
        }
        return {
          success: true,
          data: [{ fc: '1', fid: `${cid}-video`, fn: `${cid}.mp4`, fs: 10, pc: `${cid}-pick` }],
        };
      },
      maxContainerFolders: 1,
      sleep: async () => {},
      rootIntervalMs: 0,
      folderIntervalMs: 0,
    });

    expect(result.success).toBe(true);
    expect(result.state.entries.map((entry) => entry.code).sort()).toEqual(['SSIS-201', 'SSIS-202']);
    expect(result.state.stats.truncatedFolders).toBe(0);
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


  it('retries rate-limited folder listing before skipping the movie folder', async () => {
    const sleeps: number[] = [];
    const progressMessages: string[] = [];
    let folderAttempts = 0;
    const listFiles = vi.fn(async ({ cid }: { cid: string }) => {
      if (cid === 'root') return { success: true, data: [{ fc: '0', cid: 'movie', fn: 'SSIS-777' }] };
      folderAttempts += 1;
      if (folderAttempts < 3) {
        return { success: false, code: 429, message: '请求过于频繁，请稍后再试' };
      }
      return { success: true, data: [{ fc: '1', fid: 'v1', fn: 'SSIS-777.mp4', fs: 10, pc: 'pick-video' }] };
    });

    const result = await indexDrive115Roots({
      roots: [{ cid: 'root', enabled: true }],
      listFiles,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      onProgress: (p) => {
        if (p.message) progressMessages.push(p.message);
      },
      maxListRetries: 2,
      retryBaseMs: 100,
      rootIntervalMs: 0,
      folderIntervalMs: 0,
      now: () => 1_700_000_000_000,
    });

    expect(result.success).toBe(true);
    expect(result.state.entries).toHaveLength(1);
    expect(result.state.entries[0].code).toBe('SSIS-777');
    expect(result.state.stats.skipped).toBe(0);
    expect(folderAttempts).toBe(3);
    expect(sleeps).toEqual([100, 200]);
    expect(progressMessages.some((m) => m.includes('115 接口繁忙') && m.includes('重试'))).toBe(true);
  });

  it('retries a temporary 5xx directory listing before skipping the folder', async () => {
    const sleeps: number[] = [];
    let folderAttempts = 0;
    const listFiles = vi.fn(async ({ cid }: { cid: string }) => {
      if (cid === 'root') {
        return { success: true, data: [{ fc: '0', cid: 'movie', fn: 'SSIS-888' }] };
      }
      folderAttempts += 1;
      if (folderAttempts < 3) {
        return { success: false, code: 503, message: '文件列表网络错误: 503 Service Unavailable' };
      }
      return {
        success: true,
        data: [{ fc: '1', fid: 'v1', fn: 'SSIS-888.mp4', fs: 10, pc: 'pick-video' }],
      };
    });

    const result = await indexDrive115Roots({
      roots: [{ cid: 'root', enabled: true }],
      listFiles,
      sleep: async (ms) => { sleeps.push(ms); },
      maxListRetries: 2,
      retryBaseMs: 100,
      rootIntervalMs: 0,
      folderIntervalMs: 0,
    });

    expect(result.success).toBe(true);
    expect(result.state.entries.map((entry) => entry.code)).toContain('SSIS-888');
    expect(folderAttempts).toBe(3);
    expect(sleeps).toEqual([100, 200]);
  });

  it('keeps the concrete failure reason in the skipped folder report', async () => {
    const listFiles = vi.fn(async ({ cid }: { cid: string }) => {
      if (cid === 'root') {
        return { success: true, data: [{ fc: '0', cid: 'movie', fn: 'SSIS-999' }] };
      }
      return { success: false, code: 403, message: '文件列表网络错误: 403 Forbidden' };
    });

    const result = await indexDrive115Roots({
      roots: [{ cid: 'root', enabled: true }],
      listFiles,
      rootIntervalMs: 0,
      folderIntervalMs: 0,
    });

    expect(result.report?.skipped).toContainEqual(expect.objectContaining({
      folderCid: 'movie',
      reason: 'list_failed',
      failureMessage: '文件列表网络错误: 403 Forbidden',
    }));
  });

  it('keeps the unscanned queue in a checkpoint when rate limiting pauses a scan', async () => {
    const listFiles = vi.fn(async ({ cid }: { cid: string }) => {
      if (cid === 'root') {
        return {
          success: true,
          data: [
            { fc: '0', cid: 'first', fn: 'SSIS-001' },
            { fc: '0', cid: 'second', fn: 'SSIS-002' },
          ],
        };
      }
      return { success: false, code: 429, message: '请求过于频繁，请稍后再试' };
    });

    const result = await indexDrive115Roots({
      roots: [{ cid: 'root', enabled: true }],
      listFiles,
      sleep: async () => {},
      rootIntervalMs: 0,
      folderIntervalMs: 0,
      circuitBreakerThreshold: 1,
    });

    expect(result.success).toBe(false);
    expect((result as { checkpoint?: { pendingQueue?: Array<{ cid: string }> } }).checkpoint)
      .toMatchObject({ pendingQueue: [{ cid: 'first' }, { cid: 'second' }] });
  });

  it('resumes directly from the saved queue without listing the root again', async () => {
    const firstPass = await indexDrive115Roots({
      roots: [{ cid: 'root', enabled: true }],
      listFiles: async ({ cid }) => {
        if (cid === 'root') {
          return {
            success: true,
            data: [
              { fc: '0', cid: 'first', fn: 'SSIS-101' },
              { fc: '0', cid: 'second', fn: 'SSIS-102' },
            ],
          };
        }
        return { success: false, code: 429, message: '请求过于频繁，请稍后再试' };
      },
      sleep: async () => {},
      rootIntervalMs: 0,
      folderIntervalMs: 0,
      circuitBreakerThreshold: 1,
    });
    const checkpoint = firstPass.checkpoint;
    expect(checkpoint).toBeDefined();
    const calls: string[] = [];

    const resumed = await indexDrive115Roots({
      roots: [{ cid: 'root', enabled: true }],
      previous: firstPass.state,
      checkpoint,
      listFiles: async ({ cid }) => {
        calls.push(cid);
        if (cid === 'root') throw new Error('恢复扫描不应重列根目录');
        return {
          success: true,
          data: [{ fc: '1', fid: `${cid}-v`, fn: `${cid}.mp4`, fs: 10, pc: `${cid}-pc` }],
        };
      },
      sleep: async () => {},
      rootIntervalMs: 0,
      folderIntervalMs: 0,
    });

    expect(resumed.success).toBe(true);
    expect(calls).toEqual(['first', 'second']);
    expect(resumed.state.entries.map((entry) => entry.code).sort()).toEqual(['SSIS-101', 'SSIS-102']);
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

  it('flushes live report snapshots during indexing', async () => {
    // 造 12 个叶子目录（10 无视频 + 2 有视频），触发至少一次 REPORT_FLUSH_EVERY=10 的快照
    const leaves = Array.from({ length: 12 }, (_, i) => ({
      fc: '0',
      cid: `f${i}`,
      fn: i < 2 ? `SSIS-00${i + 1}` : `misc-${i}`,
    }));
    const listFiles = vi.fn(async ({ cid }: { cid: string }) => {
      if (cid === 'root') return { success: true, data: leaves };
      const idx = Number(String(cid).replace('f', ''));
      if (idx < 2) {
        return { success: true, data: [{ fc: '1', fid: `v${idx}`, fn: `SSIS-00${idx + 1}.mp4`, fs: 10, pc: `p${idx}` }] };
      }
      return { success: true, data: [{ fc: '1', fid: `x${idx}`, fn: 'note.txt', fs: 1, pc: 'px' }] };
    });

    const snapshots: number[] = [];
    const result = await indexDrive115Roots({
      roots: [{ cid: 'root', enabled: true }],
      listFiles,
      onReport: (rep) => snapshots.push(rep.skippedTotal + rep.indexedTotal),
      sleep: async () => {},
      rootIntervalMs: 0,
      folderIntervalMs: 0,
      now: () => 1_700_000_000_000,
    });

    expect(result.success).toBe(true);
    // 至少收到一次进行中快照，且快照未标记完成
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    expect(snapshots.at(-1)).toBeGreaterThanOrEqual(10);
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
