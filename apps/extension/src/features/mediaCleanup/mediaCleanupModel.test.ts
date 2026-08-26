import { describe, expect, it } from 'vitest';
import {
  EMPTY_MEDIA_CLEANUP_STATE,
  EMPTY_MEDIA_DELETION_HISTORY,
  enqueueWatchedTitle,
  importHistoricalWatched,
  markCleanupCopyResult,
  mergeMediaCleanupStates,
  mergeMediaDeletionHistories,
  migrateLegacy115CleanupState,
  migrateLegacy115DeletionHistory,
  recordMissingWatchedCopies,
  scanWatchedTitles,
  type WatchedMediaTitleSnapshot,
} from './mediaCleanupModel';

function watchedTitle(code: string, copyId: string): WatchedMediaTitleSnapshot {
  return {
    titleId: code,
    code,
    title: `${code} title`,
    copies: [{
      copyId,
      source: copyId.startsWith('115:') ? '115' : 'emby',
      itemId: copyId.split(':').at(-1),
      serverName: copyId.startsWith('115:') ? '115 片库' : 'Home Emby',
      watchedAt: 100,
      lastFoundAt: 90,
    }],
  };
}

describe('mediaCleanupModel', () => {
  it('captures the first watched baseline without silently enqueueing historical items', () => {
    const first = scanWatchedTitles(
      EMPTY_MEDIA_CLEANUP_STATE,
      [watchedTitle('AAA-001', 'emby:http://home:item-1')],
      1000,
    );

    expect(first.baselineCount).toBe(1);
    expect(first.enqueuedCount).toBe(0);
    expect(first.state.items).toEqual({});
    expect(first.state.baseline?.importedAt).toBeUndefined();
  });

  it('automatically enqueues only newly observed watched titles after the baseline', () => {
    const first = scanWatchedTitles(
      EMPTY_MEDIA_CLEANUP_STATE,
      [watchedTitle('AAA-001', 'emby:http://home:item-1')],
      1000,
    );
    const second = scanWatchedTitles(
      first.state,
      [
        watchedTitle('AAA-001', 'emby:http://home:item-1'),
        watchedTitle('BBB-002', '115:file-2'),
      ],
      2000,
    );

    expect(second.enqueuedCount).toBe(1);
    expect(Object.keys(second.state.items)).toEqual(['BBB-002']);
    expect(second.state.items['BBB-002'].copies['115:file-2'].status).toBe('pending');
  });

  it('imports historical watched titles only after explicit confirmation', () => {
    const candidates = [watchedTitle('AAA-001', 'emby:http://home:item-1')];
    const baseline = scanWatchedTitles(EMPTY_MEDIA_CLEANUP_STATE, candidates, 1000).state;
    const imported = importHistoricalWatched(baseline, candidates, 3000);

    expect(imported.enqueuedCount).toBe(1);
    expect(imported.state.baseline?.importedAt).toBe(3000);
    expect(imported.state.items['AAA-001']).toBeDefined();
  });

  it('idempotently enqueues a newly completed local playback without deleting it', () => {
    const title = watchedTitle('AAA-001', '115:file-1');
    const first = enqueueWatchedTitle(EMPTY_MEDIA_CLEANUP_STATE, title, 1000);
    const second = enqueueWatchedTitle(first.state, title, 2000);

    expect(first.added).toBe(true);
    expect(second.added).toBe(false);
    expect(Object.keys(second.state.items)).toEqual(['AAA-001']);
    expect(second.state.items['AAA-001'].copies['115:file-1'].status).toBe('pending');
  });

  it('records a watched copy that disappeared from a server sync but ignores unwatched copies', () => {
    const previous = [
      watchedTitle('AAA-001', 'emby:http://home:item-1'),
      {
        ...watchedTitle('BBB-002', 'emby:http://home:item-2'),
        copies: [{
          ...watchedTitle('BBB-002', 'emby:http://home:item-2').copies[0],
          watchedAt: undefined,
        }],
      },
    ];
    const history = recordMissingWatchedCopies(
      EMPTY_MEDIA_DELETION_HISTORY,
      previous,
      new Set<string>(),
      4000,
    );

    expect(Object.values(history.records)).toHaveLength(1);
    expect(Object.values(history.records)[0]).toMatchObject({
      code: 'AAA-001',
      copyId: 'emby:http://home:item-1',
      reason: 'external_missing',
      deletedAt: 4000,
    });
  });


  it('does not reset failed copies to pending when the same watched title is re-scanned with new copies', () => {
    // 模拟历史导入：影片有 115 + Emby 两个已看来源副本
    const imported = importHistoricalWatched(
      EMPTY_MEDIA_CLEANUP_STATE,
      [{
        titleId: 'AAA-001',
        code: 'AAA-001',
        title: 'AAA-001 title',
        copies: [
          { copyId: '115:file-1', source: '115', watchedAt: 100, lastFoundAt: 90 },
          { copyId: 'emby:home:item-1', source: 'emby', itemId: 'item-1', watchedAt: 100, lastFoundAt: 90 },
        ],
      }],
      1000,
    );
    // 115 删除失败后，用户点击“查找已看影片”（扫描再次识别到该影片并带一个新副本）
    const marked = markCleanupCopyResult({
      cleanup: imported.state,
      history: EMPTY_MEDIA_DELETION_HISTORY,
      titleId: 'AAA-001',
      copyId: '115:file-1',
      success: false,
      error: '115 凭证不可用',
      now: 2000,
    });
    const rescanned = scanWatchedTitles(marked.cleanup, [{
      titleId: 'AAA-001',
      code: 'AAA-001',
      title: 'AAA-001 title',
      copies: [
        { copyId: '115:file-1', source: '115', watchedAt: 100, lastFoundAt: 2500 },
        { copyId: 'emby:home:item-1', source: 'emby', itemId: 'item-1', watchedAt: 100, lastFoundAt: 2500 },
        { copyId: '115:file-2', source: '115', fileId: 'file-2', watchedAt: 100, lastFoundAt: 2500 },
      ],
    }], 3000);
    const copies = rescanned.state.items['AAA-001'].copies;
    expect(copies['115:file-1']).toMatchObject({ status: 'failed', error: '115 凭证不可用' });
    expect(copies['emby:home:item-1'].status).toBe('pending');
    expect(copies['115:file-2'].status).toBe('pending');
  });

  it('keeps per-copy failures retryable and writes successful extension deletion to history', () => {
    const queued = enqueueWatchedTitle(
      EMPTY_MEDIA_CLEANUP_STATE,
      watchedTitle('AAA-001', '115:file-1'),
      1000,
    ).state;
    const failed = markCleanupCopyResult({
      cleanup: queued,
      history: EMPTY_MEDIA_DELETION_HISTORY,
      titleId: 'AAA-001',
      copyId: '115:file-1',
      success: false,
      error: '权限不足',
      now: 2000,
    });
    expect(failed.cleanup.items['AAA-001'].copies['115:file-1']).toMatchObject({
      status: 'failed',
      error: '权限不足',
    });

    const deleted = markCleanupCopyResult({
      cleanup: failed.cleanup,
      history: failed.history,
      titleId: 'AAA-001',
      copyId: '115:file-1',
      success: true,
      now: 3000,
    });
    expect(deleted.cleanup.items['AAA-001'].copies['115:file-1'].status).toBe('deleted');
    expect(Object.values(deleted.history.records)[0]).toMatchObject({
      reason: 'extension_cleanup',
      deletedAt: 3000,
    });
  });

  it('migrates legacy 115 pending and failed items into the generic copy queue idempotently', () => {
    const legacy = {
      updatedAt: 5000,
      items: [
        {
          id: 'AAA-001::file-1::pick-1',
          code: 'aaa-001',
          title: 'AAA title',
          fileId: 'file-1',
          pickCode: 'pick-1',
          fileName: 'AAA-001.mp4',
          reason: 'watched' as const,
          addedAt: 1000,
          status: 'pending' as const,
        },
        {
          id: 'BBB-002::::',
          code: 'BBB-002',
          title: 'BBB title',
          reason: 'manual' as const,
          addedAt: 2000,
          status: 'failed' as const,
          error: '缺少绑定',
        },
      ],
    };

    const first = migrateLegacy115CleanupState(EMPTY_MEDIA_CLEANUP_STATE, legacy, 6000);
    const second = migrateLegacy115CleanupState(first, legacy, 7000);

    expect(first.items['AAA-001'].copies['115:file-1']).toMatchObject({
      source: '115',
      status: 'pending',
      fileName: 'AAA-001.mp4',
    });
    expect(first.items['BBB-002'].copies['115:legacy:BBB-002::::']).toMatchObject({
      status: 'failed',
      error: '缺少绑定',
    });
    expect(second).toEqual(first);
  });

  it('migrates legacy 115 deleted items into the persistent deletion ledger', () => {
    const history = migrateLegacy115DeletionHistory(EMPTY_MEDIA_DELETION_HISTORY, {
      updatedAt: 5000,
      items: [{
        id: 'AAA-001::file-1::pick-1',
        code: 'AAA-001',
        title: 'AAA title',
        fileId: 'file-1',
        pickCode: 'pick-1',
        reason: 'watched',
        addedAt: 1000,
        status: 'deleted',
      }],
    }, 6000);

    expect(history.records['legacy115:AAA-001::file-1::pick-1']).toMatchObject({
      code: 'AAA-001',
      copyId: '115:file-1',
      source: '115',
      reason: 'extension_cleanup',
      deletedAt: 5000,
    });
  });

  it('merges cleanup queues by stable title and copy ids without losing newer local status', () => {
    const local = enqueueWatchedTitle(
      EMPTY_MEDIA_CLEANUP_STATE,
      watchedTitle('AAA-001', '115:file-1'),
      3000,
    ).state;
    const remote = enqueueWatchedTitle(
      EMPTY_MEDIA_CLEANUP_STATE,
      watchedTitle('BBB-002', 'emby:https://home:item-2'),
      2000,
    ).state;
    const remoteWithOlderCopy = enqueueWatchedTitle(
      remote,
      watchedTitle('AAA-001', '115:file-1'),
      2000,
    ).state;

    const merged = mergeMediaCleanupStates(local, remoteWithOlderCopy);

    expect(Object.keys(merged.items).sort()).toEqual(['AAA-001', 'BBB-002']);
    expect(merged.items['AAA-001'].copies['115:file-1'].updatedAt).toBe(3000);
    expect(merged.observedWatchedCopyIds).toEqual(expect.arrayContaining([
      '115:file-1',
      'emby:https://home:item-2',
    ]));
  });

  it('merges deletion ledgers by stable history id', () => {
    const local = migrateLegacy115DeletionHistory(EMPTY_MEDIA_DELETION_HISTORY, {
      updatedAt: 3000,
      items: [{
        id: 'AAA-001::file-1::pick-1',
        code: 'AAA-001',
        title: 'AAA title',
        fileId: 'file-1',
        pickCode: 'pick-1',
        reason: 'watched',
        addedAt: 1000,
        status: 'deleted',
      }],
    }, 3000);
    const remote = recordMissingWatchedCopies(
      EMPTY_MEDIA_DELETION_HISTORY,
      [watchedTitle('BBB-002', 'emby:https://home:item-2')],
      new Set(),
      4000,
    );

    const merged = mergeMediaDeletionHistories(local, remote);

    expect(Object.values(merged.records).map((record) => record.code).sort()).toEqual([
      'AAA-001',
      'BBB-002',
    ]);
    expect(merged.updatedAt).toBe(4000);
  });
});
