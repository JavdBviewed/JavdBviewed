import { describe, expect, it } from 'vitest';
import type { EmbyLibraryState } from '../embyLibrary/types';
import { EMPTY_MEDIA_CLEANUP_STATE, EMPTY_MEDIA_DELETION_HISTORY } from './mediaCleanupModel';
import { processEmbySyncCleanupState } from './mediaCleanupSync';

function entry(itemId: string, played: boolean) {
  return {
    serverType: 'emby' as const,
    serverName: 'Home',
    serverUrl: 'http://home.local/',
    itemId,
    itemName: itemId,
    userData: played ? {
      played: true,
      positionTicks: 100,
      runtimeTicks: 100,
      percent: 100,
      lastPlayedAt: 500,
    } : undefined,
    updatedAt: 400,
  };
}

describe('mediaCleanupSync', () => {
  it('keeps a watched externally deleted copy in history after sync replaces the server index', () => {
    const previous: EmbyLibraryState = {
      entries: { 'AAA-001': [entry('item-1', true)] },
      updatedAt: 400,
    };
    const next: EmbyLibraryState = { entries: {}, updatedAt: 1000 };

    const result = processEmbySyncCleanupState({
      cleanup: EMPTY_MEDIA_CLEANUP_STATE,
      history: EMPTY_MEDIA_DELETION_HISTORY,
      previous,
      next,
      successfulServerKeys: new Set(['emby:http://home.local']),
      now: 1000,
    });

    expect(Object.values(result.history.records)).toHaveLength(1);
    expect(Object.values(result.history.records)[0]).toMatchObject({
      code: 'AAA-001',
      itemId: 'item-1',
      reason: 'external_missing',
    });
    expect(result.enqueuedCount).toBe(0);
  });

  it('reports a first-sync historical candidate count without enqueueing it', () => {
    const next: EmbyLibraryState = {
      entries: { 'AAA-001': [entry('item-1', true)] },
      updatedAt: 1000,
    };
    const result = processEmbySyncCleanupState({
      cleanup: EMPTY_MEDIA_CLEANUP_STATE,
      history: EMPTY_MEDIA_DELETION_HISTORY,
      previous: { entries: {}, updatedAt: 0 },
      next,
      successfulServerKeys: new Set(['emby:http://home.local']),
      now: 1000,
    });

    expect(result.baselineCount).toBe(1);
    expect(result.enqueuedCount).toBe(0);
    expect(result.cleanup.items).toEqual({});
  });

  it('attaches matching 115 copies when a server title becomes newly watched', () => {
    const baseline = processEmbySyncCleanupState({
      cleanup: EMPTY_MEDIA_CLEANUP_STATE,
      history: EMPTY_MEDIA_DELETION_HISTORY,
      previous: { entries: {}, updatedAt: 0 },
      next: { entries: { 'AAA-001': [entry('item-1', false)] }, updatedAt: 500 },
      successfulServerKeys: new Set(['emby:http://home.local']),
      now: 500,
    });
    const result = processEmbySyncCleanupState({
      cleanup: baseline.cleanup,
      history: baseline.history,
      previous: { entries: { 'AAA-001': [entry('item-1', false)] }, updatedAt: 500 },
      next: { entries: { 'AAA-001': [entry('item-1', true)] }, updatedAt: 1000 },
      successfulServerKeys: new Set(['emby:http://home.local']),
      additionalTitles: [{
        titleId: 'AAA-001',
        code: 'AAA-001',
        title: 'AAA-001',
        copies: [{
          copyId: '115:file-1',
          source: '115',
          fileId: 'file-1',
          pickCode: 'pick-1',
          fileName: 'AAA-001.mp4',
          lastFoundAt: 900,
        }],
      }],
      now: 1000,
    });

    expect(result.enqueuedCount).toBe(1);
    expect(Object.keys(result.cleanup.items['AAA-001'].copies).sort()).toEqual([
      '115:file-1',
      'emby:http://home.local:item-1',
    ]);
  });
});
