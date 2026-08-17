import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getResourceTagIndexEntries,
  getResourceTagIndexEntry,
  writeResourceTagIndexFromMagnetResults,
} from './resourceTagIndex';

const storage = new Map<string, unknown>();

describe('resource tag index', () => {
  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get(key: string | string[], callback?: (value: Record<string, unknown>) => void) {
            const storageKey = Array.isArray(key) ? key[0] : key;
            const value = { [storageKey]: storage.get(storageKey) };
            callback?.(value);
            return Promise.resolve(value);
          },
          set(entries: Record<string, unknown>, callback?: () => void) {
            Object.entries(entries).forEach(([key, value]) => storage.set(key, value));
            callback?.();
            return Promise.resolve();
          },
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes only verified boolean evidence from detail magnet results', async () => {
    await writeResourceTagIndexFromMagnetResults('ABF-326', [
      { name: 'ABF-326 中文字幕 破解', hasSubtitle: false },
      { name: 'OTHER-001 破解', hasSubtitle: true },
    ] as any, 1000);

    await expect(getResourceTagIndexEntry('ABF-326', 1000)).resolves.toEqual({
      hasSubtitle: true,
      isCracked: true,
      source: 'validated-magnet-search',
      observedAt: 1000,
    });
    expect(JSON.stringify(storage.get('resourceTagIndex'))).not.toContain('ABF-326 中文字幕 破解');
  });

  it('ignores expired evidence instead of showing a stale cracked tag', async () => {
    storage.set('resourceTagIndex', {
      'ABF-326': { isCracked: true, observedAt: 0 },
    });

    await expect(getResourceTagIndexEntry('ABF-326', 8 * 24 * 60 * 60 * 1000)).resolves.toBeNull();
  });

  it('loads several cards from one resource-tag index read', async () => {
    storage.set('resourceTagIndex', {
      'ABF-326': { hasSubtitle: true, observedAt: 1000 },
      'IPZZ-999': { isCracked: true, observedAt: 1000 },
    });
    const get = vi.spyOn(chrome.storage.local, 'get');

    await expect(getResourceTagIndexEntries(['abf-326', 'ipzz-999', 'missing'], 1000)).resolves.toEqual({
      'ABF-326': { hasSubtitle: true, observedAt: 1000 },
      'IPZZ-999': { isCracked: true, observedAt: 1000 },
    });
    expect(get).toHaveBeenCalledTimes(1);
  });
});
