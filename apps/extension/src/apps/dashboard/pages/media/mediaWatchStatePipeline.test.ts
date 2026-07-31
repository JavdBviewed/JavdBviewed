import { describe, expect, it } from 'vitest';
import type { EmbyLibraryState } from '../../../../features/embyLibrary/types';
import {
  EMPTY_MEDIA_CLEANUP_STATE,
  importHistoricalWatched,
} from '../../../../features/mediaCleanup/mediaCleanupModel';
import {
  buildEmbyCleanupSnapshots,
  collectEmbyServerKeys,
} from '../../../../features/mediaCleanup/mediaCleanupSync';
import { filterMediaItems } from './mediaBrowseModel';
import {
  mapLibraryStateToBrowseItems,
  mergeBrowseCatalogs,
} from './mediaLibraryIndexAdapter';

describe('media watch state pipeline', () => {
  it('keeps MIDA-440 watched across copy aggregation, filtering, and cleanup import', () => {
    const state: EmbyLibraryState = {
      updatedAt: 1785490000000,
      entries: {
        'MIDA-440': [
          {
            serverType: 'emby',
            serverName: '备用媒体库',
            serverUrl: 'http://backup.local:8096',
            itemId: 'backup-3257',
            itemName: 'MIDA-440',
            userData: {
              played: false,
              positionTicks: 0,
              runtimeTicks: 1000,
              percent: 0,
              lastPlayedAt: 0,
            },
            updatedAt: 1785490000000,
          },
          {
            serverType: 'emby',
            serverName: 'Emby-134',
            serverUrl: 'http://emby134.local:38096',
            itemId: '3257',
            itemName: 'MIDA-440',
            userData: {
              played: true,
              positionTicks: 0,
              runtimeTicks: 1000,
              percent: 100,
              lastPlayedAt: 1783955257000,
            },
            updatedAt: 1785490000000,
          },
        ],
      },
    };

    const catalog = mergeBrowseCatalogs(mapLibraryStateToBrowseItems(state), []);

    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
      code: 'MIDA-440',
      watchState: 'watched',
      userData: { played: true, percent: 100 },
    });
    expect(filterMediaItems(catalog, 'all', 'MIDA-440', 'watched')).toHaveLength(1);

    const snapshots = buildEmbyCleanupSnapshots(state, collectEmbyServerKeys(state));
    const imported = importHistoricalWatched(EMPTY_MEDIA_CLEANUP_STATE, snapshots, 1785490001000);

    expect(imported.enqueuedCount).toBe(1);
    expect(imported.state.items['MIDA-440'].copies).toMatchObject({
      'emby:http://emby134.local:38096:3257': {
        status: 'pending',
        watchedAt: 1783955257000,
      },
    });
  });
});
