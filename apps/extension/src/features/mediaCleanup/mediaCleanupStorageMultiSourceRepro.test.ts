import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../../utils/config';
import type { MediaCleanupCopySnapshot } from './mediaCleanupModel';
import { executeQueuedCleanupCopy } from './mediaCleanupStorage';

/**
 * 混合批次（115 + Emby）删除的持久化行为 mock 复现：
 * 验证一个来源失败时 copy.error 被写回清理状态、status 变 failed、
 * 另一个来源成功时进入删除历史 —— UI 的「处理失败」页靠 copy.error 展示原因。
 */
const storageMock = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  return {
    values,
    getValue: vi.fn(async (key: string, fallback: unknown) => values.get(key) ?? fallback),
    setValue: vi.fn(async (key: string, value: unknown) => {
      values.set(key, value);
    }),
  };
});

vi.mock('../../utils/storage', () => ({
  getValue: storageMock.getValue,
  setValue: storageMock.setValue,
}));

const NOW = 1757102235179;

function seedMultiSourceState() {
  storageMock.values.set(STORAGE_KEYS.MEDIA_CLEANUP_STATE, {
    version: 1,
    items: {
      'HBAD-720': {
        id: 'HBAD-720',
        titleId: 'HBAD-720',
        code: 'HBAD-720',
        title: 'HBAD-720 美人女友超爱口暴性欲强到随时都',
        reason: 'watched',
        addedAt: NOW,
        updatedAt: NOW,
        copies: {
          '115:file-1': {
            copyId: '115:file-1',
            source: '115',
            serverName: '115 片库',
            fileId: 'file-1',
            fileName: 'HBAD-720.mp4',
            watchedAt: NOW,
            lastFoundAt: NOW,
            status: 'pending',
            updatedAt: NOW,
          },
          'emby:http://emby.example.local:item-9': {
            copyId: 'emby:http://emby.example.local:item-9',
            source: 'emby',
            serverName: 'Emby-134',
            serverUrl: 'http://emby.example.local',
            itemId: 'item-9',
            fileName: 'HBAD-720.mkv',
            watchedAt: NOW,
            lastFoundAt: NOW,
            status: 'pending',
            updatedAt: NOW,
          },
        },
      },
    },
    observedWatchedCopyIds: ['115:file-1', 'emby:http://emby.example.local:item-9'],
    updatedAt: NOW,
  });
  storageMock.values.set(STORAGE_KEYS.MEDIA_DELETION_HISTORY, { version: 1, records: {}, updatedAt: NOW });
}

function mixedDeleteCopy() {
  return async (copy: MediaCleanupCopySnapshot) => {
    if (copy.source === '115') return { ok: true, message: '已删除 115 文件' };
    return { ok: false, message: '媒体服务器拒绝删除，请检查账号权限' };
  };
}

describe('executeQueuedCleanupCopy: multi-source mixed batch (mock)', () => {
  beforeEach(() => {
    storageMock.values.clear();
    storageMock.getValue.mockClear();
    storageMock.setValue.mockClear();
  });

  it('115 成功 + Emby 失败：失败原因持久化到 copy.error 且 status=failed', async () => {
    seedMultiSourceState();

    const r1 = await executeQueuedCleanupCopy({
      titleId: 'HBAD-720',
      copyId: '115:file-1',
      deleteCopy: mixedDeleteCopy(),
    });
    const r2 = await executeQueuedCleanupCopy({
      titleId: 'HBAD-720',
      copyId: 'emby:http://emby.example.local:item-9',
      deleteCopy: mixedDeleteCopy(),
    });

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
    expect(r2.message).toBe('媒体服务器拒绝删除，请检查账号权限');

    const state = storageMock.values.get(STORAGE_KEYS.MEDIA_CLEANUP_STATE) as {
      items: Record<string, { copies: Record<string, { status: string; error?: string }> }>;
    };
    expect(state.items['HBAD-720'].copies['115:file-1'].status).toBe('deleted');
    expect(state.items['HBAD-720'].copies['115:file-1'].error).toBeUndefined();
    expect(state.items['HBAD-720'].copies['emby:http://emby.example.local:item-9'].status).toBe('failed');
    expect(state.items['HBAD-720'].copies['emby:http://emby.example.local:item-9'].error)
      .toBe('媒体服务器拒绝删除，请检查账号权限');

    // 成功的 115 副本进入删除历史，失败的留在清理队列
    const history = storageMock.values.get(STORAGE_KEYS.MEDIA_DELETION_HISTORY) as {
      records: Record<string, { copyId: string }>;
    };
    expect(Object.values(history.records).map((r) => r.copyId)).toContain('115:file-1');
    expect(Object.values(history.records).some((r) => r.copyId === 'emby:http://emby.example.local:item-9')).toBe(false);
  });

  it('两个来源都失败：两个 copy 都带 error 且 status=failed，历史无记录', async () => {
    seedMultiSourceState();

    const failing = async (copy: MediaCleanupCopySnapshot) => (
      copy.source === '115'
        ? { ok: false, message: '115 凭证不可用' }
        : { ok: false, message: '对应媒体服务器配置已不存在' }
    );

    const r1 = await executeQueuedCleanupCopy({ titleId: 'HBAD-720', copyId: '115:file-1', deleteCopy: failing });
    const r2 = await executeQueuedCleanupCopy({
      titleId: 'HBAD-720',
      copyId: 'emby:http://emby.example.local:item-9',
      deleteCopy: failing,
    });

    expect(r1).toEqual({ ok: false, message: '115 凭证不可用', cleanup: expect.anything() });
    expect(r2).toEqual({ ok: false, message: '对应媒体服务器配置已不存在', cleanup: expect.anything() });

    const state = storageMock.values.get(STORAGE_KEYS.MEDIA_CLEANUP_STATE) as {
      items: Record<string, { copies: Record<string, { status: string; error?: string }> }>;
    };
    expect(state.items['HBAD-720'].copies['115:file-1']).toMatchObject({
      status: 'failed',
      error: '115 凭证不可用',
    });
    expect(state.items['HBAD-720'].copies['emby:http://emby.example.local:item-9']).toMatchObject({
      status: 'failed',
      error: '对应媒体服务器配置已不存在',
    });
    const history = storageMock.values.get(STORAGE_KEYS.MEDIA_DELETION_HISTORY) as {
      records: Record<string, unknown>;
    };
    expect(Object.keys(history.records)).toHaveLength(0);
  });

  it('队列中副本不存在（已被移除/重复处理）→ 返回失败原因而不是抛错', async () => {
    seedMultiSourceState();
    const result = await executeQueuedCleanupCopy({
      titleId: 'HBAD-720',
      copyId: '115:unknown-file',
      deleteCopy: mixedDeleteCopy(),
    });
    expect(result).toEqual({ ok: false, message: '待清理副本不存在或已移除', cleanup: expect.anything() });
  });
});
