import { describe, expect, it } from 'vitest';
import {
  EMPTY_MEDIA_CLEANUP_STATE,
  EMPTY_MEDIA_DELETION_HISTORY,
  baseCopyId,
  convergeStaleDuplicateCopies,
  enqueueWatchedTitle,
  importHistoricalWatched,
  markCleanupCopyResult,
  mergeMediaCleanupStates,
  mergeMediaDeletionHistories,
  migrateLegacy115CleanupState,
  migrateLegacy115DeletionHistory,
  recordMissingWatchedCopies,
  resetFailedCleanupCopyToPending,
  scanWatchedTitles,
  type MediaCleanupCopyEntry,
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
    // importedAt 现为入队纪元号（单调递增），不再等于扫描时间戳
    expect(imported.state.baseline?.importedAt).toBe(1);
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

  it('re-enqueues a falsely marked deleted copy as a fresh pending copy when the file is still present in the local index', () => {
    // 历史数据：Emby 删除曾"假成功"，副本被标记 deleted，但文件其实还在本地索引里
    const imported = importHistoricalWatched(
      EMPTY_MEDIA_CLEANUP_STATE,
      [{
        titleId: 'AAA-001',
        code: 'AAA-001',
        title: 'AAA-001 title',
        copies: [{ copyId: 'emby:home:item-1', source: 'emby', itemId: 'item-1', watchedAt: 100, lastFoundAt: 90 }],
      }],
      1000,
    );
    const marked = markCleanupCopyResult({
      cleanup: imported.state,
      history: EMPTY_MEDIA_DELETION_HISTORY,
      titleId: 'AAA-001',
      copyId: 'emby:home:item-1',
      success: true,
      now: 2000,
    });
    expect(marked.cleanup.items['AAA-001'].copies['emby:home:item-1'].status).toBe('deleted');
    // 用户重新「查找已看影片」，本地索引里该文件仍然存在。
    // 走 importHistoricalWatched（面板的查找入口），而非自动同步的 scanWatchedTitles。
    const rescanned = importHistoricalWatched(marked.cleanup, [{
      titleId: 'AAA-001',
      code: 'AAA-001',
      title: 'AAA-001 title',
      copies: [{ copyId: 'emby:home:item-1', source: 'emby', itemId: 'item-1', watchedAt: 100, lastFoundAt: 4000 }],
    }], 5000);
    expect(rescanned.enqueuedCount).toBe(1);
    const copies = rescanned.state.items['AAA-001'].copies;
    // 旧的假成功副本保持 deleted（操作记录不动），同一文件以新副本 ID 重新进入待处理
    expect(copies['emby:home:item-1']).toMatchObject({ status: 'deleted' });
    const fresh = Object.values(copies).find((copy) => copy.status === 'pending');
    expect(fresh).toMatchObject({ source: 'emby', itemId: 'item-1' });
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

    // 直接对 failed 副本标记结果会被忽略（必须先经「重试」重置回 pending）
    const ignored = markCleanupCopyResult({
      cleanup: failed.cleanup,
      history: failed.history,
      titleId: 'AAA-001',
      copyId: '115:file-1',
      success: true,
      now: 2500,
    });
    expect(ignored.cleanup.items['AAA-001'].copies['115:file-1'].status).toBe('failed');
    expect(Object.keys(ignored.history.records)).toHaveLength(0);

    // 重试流程：failed → pending → 再次执行成功 → deleted + 写入操作记录
    const reset = resetFailedCleanupCopyToPending({
      cleanup: failed.cleanup,
      titleId: 'AAA-001',
      copyId: '115:file-1',
      now: 2600,
    });
    const deleted = markCleanupCopyResult({
      cleanup: reset.cleanup,
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

  it('resets a failed copy back to pending for retry and ignores non-failed copies', () => {
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
    const reset = resetFailedCleanupCopyToPending({
      cleanup: failed.cleanup,
      titleId: 'AAA-001',
      copyId: '115:file-1',
      now: 3000,
    });
    expect(reset.changed).toBe(true);
    expect(reset.cleanup.items['AAA-001'].copies['115:file-1']).toMatchObject({
      status: 'pending',
      error: undefined,
      updatedAt: 3000,
    });
    // pending 副本 reset 是幂等 no-op（不更新时间戳）
    const again = resetFailedCleanupCopyToPending({
      cleanup: reset.cleanup,
      titleId: 'AAA-001',
      copyId: '115:file-1',
      now: 4000,
    });
    expect(again.changed).toBe(false);
    expect(again.cleanup.items['AAA-001'].copies['115:file-1'].updatedAt).toBe(3000);
    // deleted 副本不允许被重置
    const deleted = markCleanupCopyResult({
      cleanup: reset.cleanup,
      history: EMPTY_MEDIA_DELETION_HISTORY,
      titleId: 'AAA-001',
      copyId: '115:file-1',
      success: true,
      now: 5000,
    });
    const noOp = resetFailedCleanupCopyToPending({
      cleanup: deleted.cleanup,
      titleId: 'AAA-001',
      copyId: '115:file-1',
      now: 6000,
    });
    expect(noOp.changed).toBe(false);
    expect(noOp.cleanup.items['AAA-001'].copies['115:file-1'].status).toBe('deleted');
  });

  it('ignores duplicate cleanup results for copies that are no longer actionable', () => {
    const queued = enqueueWatchedTitle(
      EMPTY_MEDIA_CLEANUP_STATE,
      watchedTitle('AAA-001', '115:file-1'),
      1000,
    ).state;
    const deleted = markCleanupCopyResult({
      cleanup: queued,
      history: EMPTY_MEDIA_DELETION_HISTORY,
      titleId: 'AAA-001',
      copyId: '115:file-1',
      success: true,
      now: 2000,
    });
    // 迟到的失败结果不应把已删除的副本改回 failed
    const late = markCleanupCopyResult({
      cleanup: deleted.cleanup,
      history: deleted.history,
      titleId: 'AAA-001',
      copyId: '115:file-1',
      success: false,
      error: '迟到的失败',
      now: 3000,
    });
    expect(late.cleanup.items['AAA-001'].copies['115:file-1'].status).toBe('deleted');
    expect(late.cleanup.items['AAA-001'].copies['115:file-1'].error).toBeUndefined();
  });

  it('captures the success return message and keeps failure detail for operation-log display', () => {
    const queued = enqueueWatchedTitle(
      EMPTY_MEDIA_CLEANUP_STATE,
      watchedTitle('AAA-001', '115:file-1'),
      1000,
    ).state;
    const deleted = markCleanupCopyResult({
      cleanup: queued,
      history: EMPTY_MEDIA_DELETION_HISTORY,
      titleId: 'AAA-001',
      copyId: '115:file-1',
      success: true,
      message: '已删除 115 文件（移入回收站）',
      now: 3000,
    });
    expect(deleted.cleanup.items['AAA-001'].copies['115:file-1']).toMatchObject({
      status: 'deleted',
      message: '已删除 115 文件（移入回收站）',
      error: undefined,
    });

    const queued2 = enqueueWatchedTitle(
      EMPTY_MEDIA_CLEANUP_STATE,
      watchedTitle('BBB-002', 'emby:home:item-2'),
      1000,
    ).state;
    const failed = markCleanupCopyResult({
      cleanup: queued2,
      history: EMPTY_MEDIA_DELETION_HISTORY,
      titleId: 'BBB-002',
      copyId: 'emby:home:item-2',
      success: false,
      error: "Failed to execute 'fetch' on 'WorkerGlobalScope': Illegal invocation",
      now: 4000,
    });
    expect(failed.cleanup.items['BBB-002'].copies['emby:home:item-2']).toMatchObject({
      status: 'failed',
      error: "Failed to execute 'fetch' on 'WorkerGlobalScope': Illegal invocation",
    });
    // 失败不写入历史（历史仅记录成功删除）
    expect(failed.history.records).toEqual({});
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


function copyEntry(
  copyId: string,
  status: MediaCleanupCopyEntry['status'],
  updatedAt: number,
): MediaCleanupCopyEntry {
  return {
    copyId,
    source: copyId.startsWith('115:') ? '115' : 'emby',
    lastFoundAt: 100,
    status,
    updatedAt,
  };
}

describe('baseCopyId / convergeStaleDuplicateCopies', () => {
  it('strips the ::rev suffix to derive the base copy id', () => {
    expect(baseCopyId('115:file-1')).toBe('115:file-1');
    expect(baseCopyId('115:file-1::rev1758986783609')).toBe('115:file-1');
    expect(baseCopyId('emby:http://home:item-1::rev2')).toBe('emby:http://home:item-1');
  });

  it('keeps the newest pending copy and marks stale duplicates as skipped when the file still exists', () => {
    const state = {
      ...EMPTY_MEDIA_CLEANUP_STATE,
      items: {
        'AAA-001': {
          id: 'AAA-001',
          titleId: 'AAA-001',
          code: 'AAA-001',
          title: 'AAA',
          reason: 'watched',
          addedAt: 50,
          updatedAt: 5000,
          copies: {
            '115:file-1': { ...copyEntry('115:file-1', 'failed', 1000), error: 'err' },
            '115:file-1::rev2': { ...copyEntry('115:file-1::rev2', 'deleted', 2000), message: 'ok' },
            '115:file-1::rev3': copyEntry('115:file-1::rev3', 'pending', 3000),
            '115:file-1::rev4': { ...copyEntry('115:file-1::rev4', 'failed', 4000), error: 'err2' },
          },
        },
      },
    };
    const result = convergeStaleDuplicateCopies(state, new Set(['115:file-1']), 9000);
    const copies = result.state.items['AAA-001'].copies;
    expect(result.convergedCount).toBe(2);
    expect(copies['115:file-1::rev3'].status).toBe('pending');
    expect(copies['115:file-1'].status).toBe('skipped');
    // deleted 终态保持原样（删除历史可追溯）
    expect(copies['115:file-1::rev2']).toMatchObject({ status: 'deleted', message: 'ok' });
    expect(copies['115:file-1::rev4'].status).toBe('skipped');
    expect(copies['115:file-1'].message).toBe('历史重复记录，已随重新扫描合并');
  });

  it('re-enqueues the newest copy when the file still exists but no actionable copy remains', () => {
    const state = {
      ...EMPTY_MEDIA_CLEANUP_STATE,
      items: {
        'AAA-001': {
          id: 'AAA-001',
          titleId: 'AAA-001',
          code: 'AAA-001',
          title: 'AAA',
          reason: 'watched',
          addedAt: 50,
          updatedAt: 5000,
          copies: {
            'emby:http://home:item-1': { ...copyEntry('emby:http://home:item-1', 'deleted', 1000), message: 'ok' },
            'emby:http://home:item-1::rev2': { ...copyEntry('emby:http://home:item-1::rev2', 'failed', 2000), error: 'x' },
            'emby:http://home:item-1::rev3': { ...copyEntry('emby:http://home:item-1::rev3', 'failed', 3000), error: 'y' },
          },
        },
      },
    };
    const result = convergeStaleDuplicateCopies(
      state,
      new Set(['emby:http://home:item-1']),
      9000,
    );
    const copies = result.state.items['AAA-001'].copies;
    expect(result.convergedCount).toBe(1);
    expect(copies['emby:http://home:item-1::rev3'].status).toBe('pending');
    expect(copies['emby:http://home:item-1::rev3'].message).toBe('重新扫描发现文件仍在媒体库中，已重新入队');
    expect(copies['emby:http://home:item-1::rev3'].error).toBeUndefined();
    // deleted 终态保持原样
    expect(copies['emby:http://home:item-1']).toMatchObject({ status: 'deleted' });
    expect(copies['emby:http://home:item-1::rev2'].status).toBe('skipped');
  });

  it('folds dirty duplicate groups whose file is no longer in the library to skipped', () => {
    // 文件已被外部删除（不在当前索引中）时，重复记录没有可执行目标，
    // 全部折叠为 skipped，避免过期 pending 永久滞留「待处理」。
    const state = {
      ...EMPTY_MEDIA_CLEANUP_STATE,
      items: {
        'AAA-001': {
          id: 'AAA-001',
          titleId: 'AAA-001',
          code: 'AAA-001',
          title: 'AAA',
          reason: 'watched',
          addedAt: 50,
          updatedAt: 5000,
          copies: {
            '115:file-1': copyEntry('115:file-1', 'pending', 1000),
            '115:file-1::rev2': copyEntry('115:file-1::rev2', 'failed', 2000),
            '115:file-1::rev3': copyEntry('115:file-1::rev3', 'deleted', 3000),
          },
        },
      },
    };
    const result = convergeStaleDuplicateCopies(state, new Set<string>(), 9000);
    const copies = result.state.items['AAA-001'].copies;
    expect(result.convergedCount).toBe(2);
    expect(copies['115:file-1']).toMatchObject({
      status: 'skipped',
      message: '重新扫描时该文件已不在媒体库中，记录已合并',
    });
    expect(copies['115:file-1::rev2'].status).toBe('skipped');
    // deleted 终态保持原样
    expect(copies['115:file-1::rev3'].status).toBe('deleted');
  });

  it('leaves a single pending copy untouched even when the file is no longer in the library', () => {
    // 单份记录不是脏数据：保留给用户手动删除，由删除幂等逻辑（文件已不存在→按成功处理）兜底。
    const state = {
      ...EMPTY_MEDIA_CLEANUP_STATE,
      items: {
        'AAA-001': {
          id: 'AAA-001',
          titleId: 'AAA-001',
          code: 'AAA-001',
          title: 'AAA',
          reason: 'watched',
          addedAt: 50,
          updatedAt: 5000,
          copies: { '115:file-1': copyEntry('115:file-1', 'pending', 1000) },
        },
      },
    };
    const result = convergeStaleDuplicateCopies(state, new Set<string>(), 9000);
    expect(result.convergedCount).toBe(0);
    expect(result.state).toBe(state);
  });

  it('does not rewrite groups where the file is gone and every copy is already in a deleted terminal state', () => {
    const state = {
      ...EMPTY_MEDIA_CLEANUP_STATE,
      items: {
        'AAA-001': {
          id: 'AAA-001',
          titleId: 'AAA-001',
          code: 'AAA-001',
          title: 'AAA',
          reason: 'watched',
          addedAt: 50,
          updatedAt: 5000,
          copies: {
            '115:file-1': copyEntry('115:file-1', 'deleted', 1000),
            '115:file-1::rev2': copyEntry('115:file-1::rev2', 'deleted', 2000),
          },
        },
      },
    };
    const result = convergeStaleDuplicateCopies(state, new Set<string>(), 9000);
    expect(result.convergedCount).toBe(0);
    expect(result.state).toBe(state);
  });

  it('does not touch groups that have an in-flight deleting copy', () => {
    const state = {
      ...EMPTY_MEDIA_CLEANUP_STATE,
      items: {
        'AAA-001': {
          id: 'AAA-001',
          titleId: 'AAA-001',
          code: 'AAA-001',
          title: 'AAA',
          reason: 'watched',
          addedAt: 50,
          updatedAt: 5000,
          copies: {
            '115:file-1': copyEntry('115:file-1', 'pending', 1000),
            '115:file-1::rev2': copyEntry('115:file-1::rev2', 'deleting', 2000),
          },
        },
      },
    };
    const result = convergeStaleDuplicateCopies(state, new Set(['115:file-1']), 9000);
    expect(result.convergedCount).toBe(0);
    expect(result.state).toBe(state);
  });

  it('leaves single-copy groups untouched', () => {
    const state = {
      ...EMPTY_MEDIA_CLEANUP_STATE,
      items: {
        'AAA-001': {
          id: 'AAA-001',
          titleId: 'AAA-001',
          code: 'AAA-001',
          title: 'AAA',
          reason: 'watched',
          addedAt: 50,
          updatedAt: 5000,
          copies: { '115:file-1': copyEntry('115:file-1', 'pending', 1000) },
        },
      },
    };
    const result = convergeStaleDuplicateCopies(state, new Set(['115:file-1']), 9000);
    expect(result.convergedCount).toBe(0);
    expect(result.state).toBe(state);
  });

  it('importHistoricalWatched collapses stale duplicates and reports convergedCount', () => {
    const dirty = {
      ...EMPTY_MEDIA_CLEANUP_STATE,
      baseline: { capturedAt: 100, candidateCount: 1 },
      items: {
        'AAA-001': {
          id: 'AAA-001',
          titleId: 'AAA-001',
          code: 'AAA-001',
          title: 'AAA',
          reason: 'watched',
          addedAt: 50,
          updatedAt: 5000,
          copies: {
            'emby:http://home:item-1': { ...copyEntry('emby:http://home:item-1', 'deleted', 1000), message: 'ok' },
            'emby:http://home:item-1::rev2': { ...copyEntry('emby:http://home:item-1::rev2', 'failed', 2000), error: 'x' },
            'emby:http://home:item-1::rev3': { ...copyEntry('emby:http://home:item-1::rev3', 'failed', 3000), error: 'y' },
          },
        },
      },
    };
    const result = importHistoricalWatched(
      dirty,
      [watchedTitle('AAA-001', 'emby:http://home:item-1')],
      50000,
    );
    const copies = result.state.items['AAA-001'].copies;
    expect(result.convergedCount).toBe(1);
    const pending = Object.values(copies).filter((copy) => copy.status === 'pending');
    expect(pending).toHaveLength(1);
    expect(pending[0].copyId).toBe('emby:http://home:item-1::rev3');
    expect(Object.values(copies).filter((copy) => copy.status === 'skipped')).toHaveLength(1);
    // 旧的假成功 deleted 终态保持原样
    expect(copies['emby:http://home:item-1']).toMatchObject({ status: 'deleted' });
  });
});
