import { describe, expect, it } from 'vitest';
import { markCleanupCopyResult } from './mediaCleanupModel';
import type { EmbyLibraryState } from '../embyLibrary/types';
import { EMPTY_MEDIA_CLEANUP_STATE, EMPTY_MEDIA_DELETION_HISTORY } from './mediaCleanupModel';
import {
  buildDrive115CleanupSnapshots,
  buildEmbyCleanupSnapshots,
  processEmbySyncCleanupState,
} from './mediaCleanupSync';

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
  it('keeps failed copies terminal when an Emby sync re-observes the same watched title', () => {
    // 首次同步建立基线（影片未入队）
    const first = processEmbySyncCleanupState({
      cleanup: EMPTY_MEDIA_CLEANUP_STATE,
      history: EMPTY_MEDIA_DELETION_HISTORY,
      previous: { entries: {}, updatedAt: 0 },
      next: { entries: { 'AAA-001': [entry('item-1', false)] }, updatedAt: 400 },
      successfulServerKeys: new Set(['emby:http://home.local']),
      now: 400,
    });
    // 第二次同步：影片从“未看”变为“已看” → 自动入队
    const second = processEmbySyncCleanupState({
      cleanup: first.cleanup,
      history: first.history,
      previous: { entries: { 'AAA-001': [entry('item-1', false)] }, updatedAt: 400 },
      next: { entries: { 'AAA-001': [entry('item-1', true)] }, updatedAt: 600 },
      successfulServerKeys: new Set(['emby:http://home.local']),
      now: 600,
    });
    expect(Object.keys(second.cleanup.items['AAA-001'].copies)).toEqual(['emby:http://home.local:item-1']);
    // 115 来源副本删除失败
    const marked = markCleanupCopyResult({
      cleanup: {
        ...second.cleanup,
        items: {
          ...second.cleanup.items,
          'AAA-001': {
            ...second.cleanup.items['AAA-001'],
            copies: {
              '115:file-1': {
                copyId: '115:file-1',
                source: '115',
                status: 'pending',
                lastFoundAt: 500,
              },
              ...second.cleanup.items['AAA-001'].copies,
            },
          },
        },
      },
      history: EMPTY_MEDIA_DELETION_HISTORY,
      titleId: 'AAA-001',
      copyId: '115:file-1',
      success: false,
      error: '115 凭证不可用',
      now: 700,
    });
    // 第三次同步：影片仍已看（附带新的 115 副本快照）
    const result = processEmbySyncCleanupState({
      cleanup: marked.cleanup,
      history: marked.history,
      previous: { entries: { 'AAA-001': [entry('item-1', true)] }, updatedAt: 600 },
      next: { entries: { 'AAA-001': [entry('item-1', true)] }, updatedAt: 1000 },
      successfulServerKeys: new Set(['emby:http://home.local']),
      additionalTitles: [{
        titleId: 'AAA-001',
        code: 'AAA-001',
        title: 'AAA-001',
        copies: [{
          copyId: '115:file-1',
          source: '115',
          watchedAt: 500,
          lastFoundAt: 900,
        }],
      }],
      now: 1000,
    });
    const copies = result.cleanup.items['AAA-001'].copies;
    expect(copies['115:file-1']).toMatchObject({ status: 'failed', error: '115 凭证不可用' });
    expect(copies['emby:http://home.local:item-1'].status).toBe('pending');
    // 影片此前已入队，本次只是刷新已有副本，不应再次计数
    expect(result.enqueuedCount).toBe(0);
  });

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

  it('does not record external_missing when the copy disappeared via a removed server', () => {
    const previous: EmbyLibraryState = {
      entries: { 'AAA-001': [entry('item-1', true)] },
      updatedAt: 400,
    };
    const result = processEmbySyncCleanupState({
      cleanup: EMPTY_MEDIA_CLEANUP_STATE,
      history: EMPTY_MEDIA_DELETION_HISTORY,
      previous,
      next: { entries: {}, updatedAt: 1000 },
      successfulServerKeys: new Set(),
      removedServerKeys: new Set(['emby:http://home.local']),
      now: 1000,
    });
    expect(Object.values(result.history.records)).toHaveLength(0);
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

  it('keeps source-specific cover references in cleanup snapshots', () => {
    const embySnapshots = buildEmbyCleanupSnapshots({
      entries: {
        'AAA-001': [{
          ...entry('item-1', true),
          coverImageUrl: 'http://home.local/Items/item-1/Images/Thumb',
        }],
      },
      updatedAt: 1000,
    }, new Set(['emby:http://home.local']));
    const drive115Snapshots = buildDrive115CleanupSnapshots({
      updatedAt: 1000,
      entries: [{
        code: 'AAA-001',
        title: 'AAA-001',
        videoFileId: 'video-1',
        pickCode: 'video-pick',
        coverFileName: 'poster.jpg',
        coverPickCode: 'cover-pick',
      }],
    });

    expect(embySnapshots[0].copies[0]).toMatchObject({
      coverImageUrl: 'http://home.local/Items/item-1/Images/Thumb',
    });
    expect(drive115Snapshots[0].copies[0]).toMatchObject({
      coverFileName: 'poster.jpg',
      coverPickCode: 'cover-pick',
    });
  });
});
