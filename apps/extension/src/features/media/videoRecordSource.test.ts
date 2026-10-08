/**
 * @file videoRecordSource.test.ts
 * @description 10-08：VideoRecord 媒体源字段（sourceType/sourceId）写入链
 *  - evidenceSourceToWire：wire 值映射（仅 emby/jellyfin/m115drive 可产出）
 *  - resolveVideoRecordSource：多源确定性裁决（T1 watched emby/JF → T2 唯一候选 → T3 弃）
 *  - syncVideoRecordSourceForCode：case-fold 匹配记录 + viewedPut 写入（幂等/回收站/源未知）
 *  - reportWatchProgressWithRecordSourceSync：胶水包装（吞错不阻断证据主路径）
 *  - IDB 归一化/上行整包 round-trip 段：normalizeViewedRecord 全 spread + videoToSyncEntity 整包
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaWatchEvidence } from './mediaWatchEvidence';

const spies = vi.hoisted(() => ({
  reportWatchProgress: vi.fn(),
  loadWatchEvidenceState: vi.fn(),
  viewedGetAll: vi.fn(),
  viewedPut: vi.fn(),
}));

vi.mock('./mediaWatchEvidence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mediaWatchEvidence')>();
  return {
    ...actual,
    reportWatchProgress: spies.reportWatchProgress,
    loadWatchEvidenceState: spies.loadWatchEvidenceState,
  };
});

vi.mock('../../platform/storage/indexedDb', () => ({
  viewedGetAll: spies.viewedGetAll,
  viewedPut: spies.viewedPut,
}));

import {
  evidenceSourceToWire,
  reportWatchProgressWithRecordSourceSync,
  resolveVideoRecordSource,
  syncVideoRecordSourceForCode,
} from './videoRecordSource';
import { normalizeViewedRecord } from '../../platform/storage/indexedDbViewedIndexes';
import { videoToSyncEntity } from '../cloudSync/toSyncEntity';

function ev(partial: Partial<MediaWatchEvidence>): MediaWatchEvidence {
  return {
    source: 'emby',
    percent: 0,
    watched: false,
    lastPlayedAt: 0,
    ...partial,
  };
}

function baseRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ssis-001',
    title: 'T',
    status: 'viewed' as const,
    tags: [] as string[],
    createdAt: 1,
    updatedAt: 100,
    videoCode: 'ssis-001',
    ...overrides,
  };
}

describe('evidenceSourceToWire（wire 值映射）', () => {
  it('emby/jellyfin 与 wire 逐字一致；drive115 映射 m115drive', () => {
    expect(evidenceSourceToWire('emby')).toBe('emby');
    expect(evidenceSourceToWire('jellyfin')).toBe('jellyfin');
    expect(evidenceSourceToWire('drive115')).toBe('m115drive');
  });

  it('manual/webdav/未知源 → null（禁写）', () => {
    expect(evidenceSourceToWire('manual')).toBeNull();
    expect(evidenceSourceToWire('webdav')).toBeNull();
    expect(evidenceSourceToWire('')).toBeNull();
  });
});

describe('resolveVideoRecordSource（多源确定性裁决）', () => {
  it('T2：唯一 emby 候选（未 watched）→ 取该候选', () => {
    const winner = resolveVideoRecordSource({
      copies: { 'emby:u1:42': ev({ source: 'emby', sourceItemId: '42', percent: 55 }) },
    });
    expect(winner).toEqual({ sourceType: 'emby', sourceId: '42' });
  });

  it('T2：唯一 jellyfin 候选 → wire jellyfin', () => {
    const winner = resolveVideoRecordSource({
      copies: { 'jellyfin:u1:7': ev({ source: 'jellyfin', sourceItemId: '7', watched: true }) },
    });
    expect(winner).toEqual({ sourceType: 'jellyfin', sourceId: '7' });
  });

  it('T2：唯一 115 候选 → m115drive + 源级 id', () => {
    const winner = resolveVideoRecordSource({
      copies: { '115:f123': ev({ source: 'drive115', sourceItemId: 'f123', percent: 100, watched: true }) },
    });
    expect(winner).toEqual({ sourceType: 'm115drive', sourceId: 'f123' });
  });

  it('T1：emby watched 优先于 115（即使 115 也 watched）', () => {
    const winner = resolveVideoRecordSource({
      copies: {
        '115:f1': ev({ source: 'drive115', sourceItemId: 'f1', watched: true, lastPlayedAt: 999 }),
        'emby:u1:42': ev({ source: 'emby', sourceItemId: '42', watched: true, lastPlayedAt: 1 }),
      },
    });
    expect(winner).toEqual({ sourceType: 'emby', sourceId: '42' });
  });

  it('T1：双 emby/JF watched → lastPlayedAt 大者', () => {
    const winner = resolveVideoRecordSource({
      copies: {
        'emby:u1:10': ev({ source: 'emby', sourceItemId: '10', watched: true, lastPlayedAt: 100 }),
        'jellyfin:u2:20': ev({ source: 'jellyfin', sourceItemId: '20', watched: true, lastPlayedAt: 200 }),
      },
    });
    expect(winner).toEqual({ sourceType: 'jellyfin', sourceId: '20' });
  });

  it('T1 并列 lastPlayedAt → copyId 字典序大者（确定性）', () => {
    const winner = resolveVideoRecordSource({
      copies: {
        'emby:u1:10': ev({ source: 'emby', sourceItemId: '10', watched: true, lastPlayedAt: 500 }),
        'emby:u2:20': ev({ source: 'emby', sourceItemId: '20', watched: true, lastPlayedAt: 500 }),
      },
    });
    expect(winner).toEqual({ sourceType: 'emby', sourceId: '20' });
  });

  it('legacy 证据以 copyId="" 参与 T1（lastPlayedAt 大者胜）', () => {
    const winner = resolveVideoRecordSource({
      legacy: ev({ source: 'emby', sourceItemId: '9', watched: true, lastPlayedAt: 200 }),
      copies: { 'emby:u1:10': ev({ source: 'emby', sourceItemId: '10', watched: true, lastPlayedAt: 100 }) },
    });
    expect(winner).toEqual({ sourceType: 'emby', sourceId: '9' });
  });

  it('T3：115 watched + emby 未 watched → 弃（非 emby/JF watched 主导且非唯一）', () => {
    const winner = resolveVideoRecordSource({
      copies: {
        '115:f1': ev({ source: 'drive115', sourceItemId: 'f1', watched: true }),
        'emby:u1:42': ev({ source: 'emby', sourceItemId: '42', percent: 30 }),
      },
    });
    expect(winner).toBeNull();
  });

  it('T3：emby 未 watched + 115 未 watched（多源无主导）→ 弃', () => {
    const winner = resolveVideoRecordSource({
      copies: {
        'emby:u1:42': ev({ source: 'emby', sourceItemId: '42', percent: 30 }),
        '115:f1': ev({ source: 'drive115', sourceItemId: 'f1', percent: 20 }),
      },
    });
    expect(winner).toBeNull();
  });

  it('零候选（空桶）→ null', () => {
    expect(resolveVideoRecordSource({})).toBeNull();
    expect(resolveVideoRecordSource({ legacy: undefined, copies: {} })).toBeNull();
  });

  it('候选过滤：sourceItemId 空/空白的证据不参与裁决', () => {
    const winner = resolveVideoRecordSource({
      copies: {
        'emby:u1:': ev({ source: 'emby', sourceItemId: '', percent: 90 }),
        '115:f1': ev({ source: 'drive115', sourceItemId: 'f1', percent: 10 }),
      },
    });
    expect(winner).toEqual({ sourceType: 'm115drive', sourceId: 'f1' });
    expect(
      resolveVideoRecordSource({
        copies: {
          'emby:u1:': ev({ source: 'emby', sourceItemId: '   ', percent: 90, watched: true }),
        },
      }),
    ).toBeNull();
  });

  it('manual 源证据不构成候选（即使 watched + 有 id）', () => {
    const winner = resolveVideoRecordSource({
      copies: { m1: ev({ source: 'manual', sourceItemId: 'x1', watched: true }) },
    });
    expect(winner).toBeNull();
  });
});

describe('syncVideoRecordSourceForCode（记录匹配 + 写入）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emby watched 证据 → case-fold 匹配记录写 sourceType=emby+sourceId，updatedAt 推进', async () => {
    spies.loadWatchEvidenceState.mockResolvedValue({
      version: 2,
      titles: {
        'SSIS-001': {
          copies: { 'emby:u1:42': ev({ source: 'emby', sourceItemId: '42', watched: true, percent: 100, lastPlayedAt: 111 }) },
        },
      },
    });
    const records = [
      baseRecord(),
      baseRecord({ id: 'ssis-002', videoCode: 'SSIS-002' }),
      baseRecord({ id: 'bzqa5g', videoCode: undefined, title: 'western' }),
    ];
    spies.viewedGetAll.mockResolvedValue(records);
    spies.viewedPut.mockResolvedValue({ success: true });

    const result = await syncVideoRecordSourceForCode('ssis-001');

    expect(result).toEqual({ code: 'SSIS-001', winner: { sourceType: 'emby', sourceId: '42' }, matched: 1, written: 1 });
    expect(spies.viewedPut).toHaveBeenCalledTimes(1);
    const written = spies.viewedPut.mock.calls[0][0];
    expect(written.id).toBe('ssis-001');
    expect(written.title).toBe('T');
    expect(written.sourceType).toBe('emby');
    expect(written.sourceId).toBe('42');
    expect(typeof written.updatedAt).toBe('number');
    expect(written.updatedAt).toBeGreaterThan(100);
    expect(spies.viewedPut.mock.calls[0][0]).not.toBe(records[0]); // 不原地改，走 viewedPut 新对象
  });

  it('jellyfin / 115 写入 wire 值逐字', async () => {
    for (const [source, wire, id] of [
      ['jellyfin', 'jellyfin', '77'],
      ['drive115', 'm115drive', 'f9'],
    ] as const) {
      vi.clearAllMocks();
      spies.loadWatchEvidenceState.mockResolvedValue({
        version: 2,
        titles: { 'SSIS-001': { copies: { c1: ev({ source, sourceItemId: id, watched: true }) } } },
      });
      spies.viewedGetAll.mockResolvedValue([baseRecord()]);
      spies.viewedPut.mockResolvedValue({ success: true });
      await syncVideoRecordSourceForCode('SSIS-001');
      expect(spies.viewedPut).toHaveBeenCalledTimes(1);
      expect(spies.viewedPut.mock.calls[0][0].sourceType).toBe(wire);
      expect(spies.viewedPut.mock.calls[0][0].sourceId).toBe(id);
    }
  });

  it('幂等：记录已有同值 sourceType+sourceId → 不重写不 bump', async () => {
    spies.loadWatchEvidenceState.mockResolvedValue({
      version: 2,
      titles: { 'SSIS-001': { copies: { c1: ev({ source: 'emby', sourceItemId: '42', watched: true }) } } },
    });
    spies.viewedGetAll.mockResolvedValue([
      baseRecord({ sourceType: 'emby', sourceId: '42', updatedAt: 777 }),
    ]);
    spies.viewedPut.mockResolvedValue({ success: true });

    const result = await syncVideoRecordSourceForCode('SSIS-001');

    expect(result).toEqual({ code: 'SSIS-001', winner: { sourceType: 'emby', sourceId: '42' }, matched: 1, written: 0 });
    expect(spies.viewedPut).not.toHaveBeenCalled();
  });

  it('回收站记录不匹配不写', async () => {
    spies.loadWatchEvidenceState.mockResolvedValue({
      version: 2,
      titles: { 'SSIS-001': { copies: { c1: ev({ source: 'emby', sourceItemId: '42', watched: true }) } } },
    });
    spies.viewedGetAll.mockResolvedValue([baseRecord({ deletedAt: 5 })]);
    spies.viewedPut.mockResolvedValue({ success: true });

    const result = await syncVideoRecordSourceForCode('SSIS-001');

    expect(result.matched).toBe(0);
    expect(result.written).toBe(0);
    expect(spies.viewedPut).not.toHaveBeenCalled();
  });

  it('源未知（仅 manual 证据）→ 无 winner，不读记录不写', async () => {
    spies.loadWatchEvidenceState.mockResolvedValue({
      version: 2,
      titles: { 'SSIS-001': { copies: { m1: ev({ source: 'manual', sourceItemId: 'x', watched: true }) } } },
    });
    spies.viewedGetAll.mockResolvedValue([baseRecord()]);
    spies.viewedPut.mockResolvedValue({ success: true });

    const result = await syncVideoRecordSourceForCode('SSIS-001');

    expect(result.winner).toBeNull();
    expect(spies.viewedGetAll).not.toHaveBeenCalled();
    expect(spies.viewedPut).not.toHaveBeenCalled();
  });

  it('空 code → 直接 no-op', async () => {
    const result = await syncVideoRecordSourceForCode('   ');
    expect(result).toEqual({ code: '', winner: null, matched: 0, written: 0 });
    expect(spies.loadWatchEvidenceState).not.toHaveBeenCalled();
    expect(spies.viewedGetAll).not.toHaveBeenCalled();
  });
});

describe('reportWatchProgressWithRecordSourceSync（胶水包装）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('证据写入成功后顺带同步记录源字段，原样返回证据', async () => {
    const evidence = ev({ source: 'emby', sourceItemId: '42', watched: true, percent: 100 });
    spies.reportWatchProgress.mockResolvedValue(evidence);
    spies.loadWatchEvidenceState.mockResolvedValue({
      version: 2,
      titles: { 'SSIS-001': { copies: { c1: evidence } } },
    });
    spies.viewedGetAll.mockResolvedValue([baseRecord()]);
    spies.viewedPut.mockResolvedValue({ success: true });

    const ret = await reportWatchProgressWithRecordSourceSync({
      code: 'ssis-001',
      source: 'emby',
      sourceItemId: '42',
      forceWatched: true,
    });

    expect(ret).toBe(evidence);
    expect(spies.viewedPut).toHaveBeenCalledTimes(1);
    expect(spies.viewedPut.mock.calls[0][0].sourceType).toBe('emby');
  });

  it('证据写入失败 → 抛错且不触碰记录', async () => {
    spies.reportWatchProgress.mockRejectedValue(new Error('无效番号'));

    await expect(
      reportWatchProgressWithRecordSourceSync({ code: '', source: 'emby' }),
    ).rejects.toThrow('无效番号');
    expect(spies.loadWatchEvidenceState).not.toHaveBeenCalled();
    expect(spies.viewedGetAll).not.toHaveBeenCalled();
    expect(spies.viewedPut).not.toHaveBeenCalled();
  });

  it('记录源同步失败（吞错）→ 证据仍正常返回，不阻断', async () => {
    const evidence = ev({ source: 'emby', sourceItemId: '42', watched: true });
    spies.reportWatchProgress.mockResolvedValue(evidence);
    spies.loadWatchEvidenceState.mockRejectedValue(new Error('storage down'));

    const ret = await reportWatchProgressWithRecordSourceSync({
      code: 'SSIS-001',
      source: 'emby',
      sourceItemId: '42',
    });

    expect(ret).toBe(evidence);
    expect(spies.viewedPut).not.toHaveBeenCalled();
  });
});

describe('round-trip 段：IDB 归一化 + 上行整包（新字段存活）', () => {
  it('normalizeViewedRecord 全 spread 保留 sourceType/sourceId（IDB 写入前归一化不剥离）', () => {
    const rec = { ...baseRecord({ sourceType: 'm115drive' as const, sourceId: 'f1', isFavorite: true }) };
    const normalized = normalizeViewedRecord(rec);
    expect(normalized.sourceType).toBe('m115drive');
    expect(normalized.sourceId).toBe('f1');
    expect(normalized.favoriteIndexed).toBe(1);
  });

  it('videoToSyncEntity 整包：payload=完整记录引用，wire 原文逐字上行', () => {
    const rec = baseRecord({ sourceType: 'emby' as const, sourceId: '42' }) as import('../../types').VideoRecord;
    const entity = videoToSyncEntity(rec);
    expect(entity).not.toBeNull();
    expect(entity!.type).toBe('video');
    expect(entity!.id).toBe('ssis-001');
    expect(entity!.payload).toBe(rec);
    expect((entity!.payload as { sourceType?: string }).sourceType).toBe('emby');
    expect((entity!.payload as { sourceId?: string }).sourceId).toBe('42');
  });

  it('videoToSyncEntity 整包透传（追加派单）：progress 三字段值相等上行，信封零改', () => {
    const rec: import('../../types').VideoRecord = {
      id: 'ssis-001',
      title: 'T',
      status: 'viewed',
      createdAt: 1,
      updatedAt: 100,
      videoCode: 'ssis-001',
      sourceType: 'emby',
      sourceId: '42',
      positionMs: 123456,
      durationMs: 999000,
      completed: true,
    };
    const entity = videoToSyncEntity(rec);
    expect(entity).not.toBeNull();
    expect(entity!.type).toBe('video');
    expect(entity!.payload).toBe(rec);
    expect((entity!.payload as import('../../types').VideoRecord).positionMs).toBe(123456);
    expect((entity!.payload as import('../../types').VideoRecord).durationMs).toBe(999000);
    expect((entity!.payload as import('../../types').VideoRecord).completed).toBe(true);
  });

  it('videoToSyncEntity 零回补（追加派单）：旧记录无 progress 字段 → payload 无此三键', () => {
    const rec: import('../../types').VideoRecord = {
      id: 'old-legacy',
      title: 'OLD',
      status: 'browsed',
      createdAt: 1,
      updatedAt: 2,
      videoCode: 'OLD-1',
    };
    const entity = videoToSyncEntity(rec);
    expect(entity).not.toBeNull();
    expect('positionMs' in (entity!.payload as object)).toBe(false);
    expect('durationMs' in (entity!.payload as object)).toBe(false);
    expect('completed' in (entity!.payload as object)).toBe(false);
  });
});
