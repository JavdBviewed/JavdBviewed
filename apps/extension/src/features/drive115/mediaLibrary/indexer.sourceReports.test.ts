import { describe, expect, it, vi } from 'vitest';
import { indexDrive115Roots, type IndexDrive115RootsDeps } from './indexer';
import type { Drive115LibraryIndexState } from './types';

const roots = [{ cid: 'root', enabled: true }];
const options = { roots, sleep: async () => {}, rootIntervalMs: 0, folderIntervalMs: 0, maxListRetries: 0, now: () => 1000 };
const listFiles: IndexDrive115RootsDeps['listFiles'] = async ({ cid }) => ({ success: true, data: cid === 'root' ? [{ fc: '0', cid: 'folder', fn: 'ABC-123' }] : [{ fc: '1', fid: 'file', fn: 'ABC-123.mp4', pc: 'pick' }] });

describe('115 local source observations', () => {
  it('records only freshly observed entries and completes a fully visited root', async () => {
    const result = await indexDrive115Roots({ ...options, listFiles });
    expect(result.sourceReports).toEqual([{ rootCid: 'root', entries: result.state.entries, complete: true }]);
  });
  it('reports a fresh empty root without uploading retained previous entries', async () => {
    const previous = (await indexDrive115Roots({ ...options, listFiles })).state;
    const result = await indexDrive115Roots({ ...options, previous, listFiles: async () => ({ success: true, data: [] }) });
    expect(result.state.entries).toHaveLength(1);
    expect(result.sourceReports).toEqual([{ rootCid: 'root', entries: [], complete: true }]);
  });
  it('does not claim a cached directory manifest is an exhaustive scan', async () => {
    const fresh = await indexDrive115Roots({ ...options, listFiles });
    const cached = await indexDrive115Roots({ ...options, listFiles, previous: fresh.state, manifest: fresh.manifest });
    expect(cached.sourceReports).toEqual([{ rootCid: 'root', entries: [], complete: false }]);
  });
  it('never uses inherited entries as observations after a failure', async () => {
    const previous: Drive115LibraryIndexState = (await indexDrive115Roots({ ...options, listFiles })).state;
    const result = await indexDrive115Roots({ ...options, previous, listFiles: async () => ({ success: false, message: 'unavailable', code: 503 }) });
    expect(result.sourceReports).toEqual([{ rootCid: 'root', entries: [], complete: false }]);
  });
  it('marks a depth-truncated tree partial', async () => {
    const result = await indexDrive115Roots({ ...options, scanDepth: 1, listFiles: vi.fn(async ({ cid }) => ({ success: true, data: [{ fc: '0', cid: cid === 'root' ? 'folder' : 'child', fn: 'container' }] })) });
    expect(result.sourceReports?.[0]?.complete).toBe(false);
  });
  it('marks a full child-directory page partial until its remaining pages are read', async () => {
    const result = await indexDrive115Roots({ ...options, listFiles: async ({ cid }) => ({ success: true, data: cid === 'root' ? [{ fc: '0', cid: 'folder', fn: 'container' }] : cid === 'folder' ? Array.from({ length: 1150 }, (_, i) => ({ fc: '0', cid: `child${i}`, fn: 'child' })) : [] }) });
    expect(result.sourceReports?.[0]?.complete).toBe(false);
  });
  it('does not lose a no-pickcode failure while descending into child directories', async () => {
    const result = await indexDrive115Roots({ ...options, listFiles: async ({ cid }) => ({ success: true, data: cid === 'root' ? [{ fc: '0', cid: 'folder', fn: 'ABC-123' }] : cid === 'folder' ? [{ fc: '1', fid: 'file', fn: 'ABC-123.mp4' }, { fc: '0', cid: 'child', fn: 'extras' }] : [] }) });
    expect(result.sourceReports?.[0]?.complete).toBe(false);
  });
  it('keeps exhausted roots complete when a different root fails later', async () => {
    const result = await indexDrive115Roots({ ...options, roots: [{ cid: 'a', enabled: true }, { cid: 'b', enabled: true }], listFiles: async ({ cid }) => cid === 'a' ? { success: true, data: [] } : { success: false, code: 403, message: 'forbidden' } });
    expect(result.sourceReports).toEqual([{ rootCid: 'a', entries: [], complete: true }, { rootCid: 'b', entries: [], complete: false }]);
  });

});
