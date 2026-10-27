/**
 * @file collectionMirrorReconcile.test.ts
 * @description 收藏全量同步对账迁移纯函数测试（PRD 10-27-ext-favorites-id-reconcile §5 项 1-5）
 */
import { describe, expect, it } from 'vitest';
import { reconcileCollectionListRecords } from './collectionMirrorReconcile';
import type { ListRecord } from '../../types';

function rec(partial: Partial<ListRecord> & Pick<ListRecord, 'id' | 'type'>): ListRecord {
  return {
    id: partial.id,
    name: partial.name ?? '清单',
    type: partial.type,
    source: partial.source ?? 'javdb',
    externalId: partial.externalId,
    moviesCount: partial.moviesCount,
    clickedCount: partial.clickedCount,
    url: partial.url,
    createdAt: partial.createdAt ?? 1000,
    updatedAt: partial.updatedAt ?? 2000,
  };
}

describe('reconcileCollectionListRecords（收藏全量同步对账迁移）', () => {
  it('1) 裸 ID + 新前缀同 externalId → 合并后删旧（字段并集口径逐字段断言）', () => {
    const mirror = rec({ id: 'q8e6', type: 'series', name: '旧名', url: 'https://javdb.com/series/q8e6', moviesCount: 3, clickedCount: 7, createdAt: 1, updatedAt: 2 });
    const fresh = rec({ id: 'series:q8e6', type: 'series', externalId: 'q8e6', name: '新名', url: 'https://javdb.com/series/q8e6?ref=1', moviesCount: 5, createdAt: 10, updatedAt: 20 });
    const result = reconcileCollectionListRecords('series', [fresh], [mirror]);
    expect(result.finalRecords).toHaveLength(1);
    const merged = result.finalRecords[0];
    expect(merged.id).toBe('series:q8e6');
    expect(merged.externalId).toBe('q8e6');
    expect(merged.name).toBe('新名');
    expect(merged.url).toBe('https://javdb.com/series/q8e6?ref=1');
    expect(merged.moviesCount).toBe(5);
    expect(merged.clickedCount).toBe(7);
    expect(merged.createdAt).toBe(10);
    expect(merged.updatedAt).toBe(20);
    expect(result.deleteIds).toEqual(['q8e6']);
    expect(result.keptBareMirrors).toEqual([]);
  });

  it('1b) externalId 主键失配 + url 辅键（尾斜杠归一）命中 → 合并后删旧', () => {
    const mirror = rec({ id: 'oldabc', type: 'series', externalId: 'STALE', url: 'https://javdb.com/series/q8e6/' });
    const fresh = rec({ id: 'series:q8e6', type: 'series', externalId: 'q8e6', url: 'https://javdb.com/series/q8e6' });
    const result = reconcileCollectionListRecords('series', [fresh], [mirror]);
    expect(result.deleteIds).toEqual(['oldabc']);
    expect(result.keptBareMirrors).toEqual([]);
    expect(result.finalRecords[0].id).toBe('series:q8e6');
  });

  it('2) 仅旧裸 ID、新结果无对应 → 保留 + 留痕（不删）', () => {
    const mirror = rec({ id: 'q8e6', type: 'series', url: 'https://javdb.com/series/q8e6' });
    const result = reconcileCollectionListRecords('series', [], [mirror]);
    expect(result.finalRecords).toEqual([]);
    expect(result.deleteIds).toEqual([]);
    expect(result.keptBareMirrors).toEqual([{ rawId: 'q8e6', externalId: 'q8e6' }]);
  });

  it('3) 幂等：迁移后再跑一次 → 零删除、写入集为新结果原样', () => {
    const fresh = rec({ id: 'series:q8e6', type: 'series', externalId: 'q8e6', name: 'S', clickedCount: 9 });
    const migratedExisting = rec({ id: 'series:q8e6', type: 'series', externalId: 'q8e6', name: 'S', clickedCount: 9 });
    const result = reconcileCollectionListRecords('series', [fresh], [migratedExisting]);
    expect(result.deleteIds).toEqual([]);
    expect(result.keptBareMirrors).toEqual([]);
    expect(result.finalRecords).toEqual([fresh]);
  });

  it('4) 已前缀存量不在新结果 → 仍按现有整替语义删除（回归锁）', () => {
    const kept = rec({ id: 'series:keep', type: 'series', externalId: 'keep' });
    const gone = rec({ id: 'series:gone', type: 'series', externalId: 'gone' });
    const result = reconcileCollectionListRecords('series', [kept], [kept, gone]);
    expect(result.deleteIds).toEqual(['series:gone']);
    expect(result.keptBareMirrors).toEqual([]);
    expect(result.finalRecords).toEqual([kept]);
  });

  it('4b) Q7 实形：裸 + 前缀同 externalId 并存 → 裸合并删、前缀保留', () => {
    const fresh = rec({ id: 'series:q8e6', type: 'series', externalId: 'q8e6', name: 'S' });
    const bare = rec({ id: 'q8e6', type: 'series', name: '裸镜像', clickedCount: 3 });
    const prefixed = rec({ id: 'series:q8e6', type: 'series', externalId: 'q8e6', name: 'S' });
    const result = reconcileCollectionListRecords('series', [fresh], [prefixed, bare]);
    expect(result.deleteIds).toEqual(['q8e6']);
    expect(result.keptBareMirrors).toEqual([]);
    expect(result.finalRecords).toHaveLength(1);
    expect(result.finalRecords[0].id).toBe('series:q8e6');
    expect(result.finalRecords[0].clickedCount).toBe(3);
  });

  it('5) label 大写归一（mism vs label:MISM 同物）；maker 不转大写', () => {
    const labelResult = reconcileCollectionListRecords(
      'label',
      [rec({ id: 'label:MISM', type: 'label', externalId: 'MISM', name: '新' })],
      [rec({ id: 'mism', type: 'label', name: '旧' })],
    );
    expect(labelResult.deleteIds).toEqual(['mism']);
    expect(labelResult.keptBareMirrors).toEqual([]);
    expect(labelResult.finalRecords[0].name).toBe('新');

    const makerResult = reconcileCollectionListRecords(
      'maker',
      [rec({ id: 'maker:AEO', type: 'maker', externalId: 'AEO' })],
      [rec({ id: 'aeo', type: 'maker' })],
    );
    expect(makerResult.deleteIds).toEqual([]);
    expect(makerResult.keptBareMirrors).toEqual([{ rawId: 'aeo', externalId: 'aeo' }]);
  });
});
