import { describe, expect, it } from 'vitest';
import {
  getCollectionExternalId,
  getCollectionRecordId,
  getDirectorExternalIdFromUrl,
  getMakerExternalIdFromUrl,
  getSeriesExternalIdFromUrl,
  isCollectionListRecord,
  isCollectionListType,
  matchesDirectorRecord,
  matchesLabelRecord,
  matchesMakerRecord,
  matchesSeriesRecord,
  normalizeCollectionRecord,
} from './listRecordHelpers';
import type { ListRecord } from '../../types';

function collection(partial: Partial<ListRecord>): ListRecord {
  return {
    id: partial.id || 'list-1',
    name: partial.name || '清单',
    type: partial.type || 'series',
    source: partial.source,
    externalId: partial.externalId,
    itemCount: partial.itemCount,
    updatedAt: partial.updatedAt,
    createdAt: partial.createdAt,
  };
}

describe('收藏清单类型体系（series/label/maker/director）', () => {
  it('isCollectionListType 识别四类收藏清单并拒绝视频清单', () => {
    expect(isCollectionListType('series')).toBe(true);
    expect(isCollectionListType('label')).toBe(true);
    expect(isCollectionListType('maker')).toBe(true);
    expect(isCollectionListType('director')).toBe(true);
    expect(isCollectionListType('mine')).toBe(false);
    expect(isCollectionListType('favorite')).toBe(false);
    expect(isCollectionListType('local')).toBe(false);
    expect(isCollectionListType(undefined)).toBe(false);
  });

  it('isCollectionListRecord 跟随类型判断', () => {
    expect(isCollectionListRecord({ type: 'maker' })).toBe(true);
    expect(isCollectionListRecord({ type: 'director' })).toBe(true);
    expect(isCollectionListRecord({ type: 'mine' })).toBe(false);
    expect(isCollectionListRecord(null)).toBe(false);
  });

  it('getCollectionRecordId：maker/director 保留原始大小写（label 仍大写）', () => {
    expect(getCollectionRecordId('maker', 'AEO')).toBe('maker:AEO');
    expect(getCollectionRecordId('maker', 'aeo')).toBe('maker:aeo');
    expect(getCollectionRecordId('director', 'dekM')).toBe('director:dekM');
    expect(getCollectionRecordId('label', 'fc2')).toBe('label:FC2');
    expect(getCollectionRecordId('series', 'gr8a')).toBe('series:gr8a');
  });

  it('getCollectionExternalId 优先 externalId，maker/director 不转大写', () => {
    expect(getCollectionExternalId({ id: 'maker:aeo', type: 'maker', externalId: 'AEO' })).toBe('AEO');
    expect(getCollectionExternalId({ id: 'director:DEKM', type: 'director', externalId: 'dekM' })).toBe('dekM');
    expect(getCollectionExternalId({ id: 'label:fc2', type: 'label' })).toBe('FC2');
    expect(getCollectionExternalId({ id: 'mine-1', type: 'mine' })).toBe('mine-1');
  });

  it('normalizeCollectionRecord 归一 maker/director 记录 id 与 externalId', () => {
    const maker = normalizeCollectionRecord(collection({ id: 'maker:aeo', name: 'AEO', type: 'maker' }) as ListRecord);
    expect(maker.id).toBe('maker:aeo');
    expect(maker.externalId).toBe('aeo');
    const director = normalizeCollectionRecord(collection({ id: 'director:DEKM', name: 'dekM', type: 'director', externalId: 'dekM' }) as ListRecord);
    expect(director.id).toBe('director:dekM');
    expect(director.externalId).toBe('dekM');
  });
});

describe('maker/director URL 外部 ID 提取', () => {
  it('getMakerExternalIdFromUrl 提取 /makers/{id} 并容忍 query/hash/编码', () => {
    expect(getMakerExternalIdFromUrl('https://javdb.com/makers/AEO')).toBe('AEO');
    expect(getMakerExternalIdFromUrl('/makers/AEO?sort=latest')).toBe('AEO');
    expect(getMakerExternalIdFromUrl('https://javdb.com/makers/aeo#videos')).toBe('aeo');
    expect(getMakerExternalIdFromUrl('https://javdb.com/makers/%E7%89%87%E5%95%86')).toBe('片商');
    expect(getMakerExternalIdFromUrl('https://javdb.com/directors/AEO')).toBe('');
    expect(getMakerExternalIdFromUrl(undefined)).toBe('');
  });

  it('getDirectorExternalIdFromUrl 提取 /directors/{id} 并容忍 query/hash', () => {
    expect(getDirectorExternalIdFromUrl('https://javdb.com/directors/dekM')).toBe('dekM');
    expect(getDirectorExternalIdFromUrl('/directors/dekM?page=2')).toBe('dekM');
    expect(getDirectorExternalIdFromUrl('https://javdb.com/makers/dekM')).toBe('');
    expect(getDirectorExternalIdFromUrl('')).toBe('');
  });

  it('series 提取口径零漂移（对照锚）', () => {
    expect(getSeriesExternalIdFromUrl('https://javdb.com/series/gr8A')).toBe('gr8A');
  });
});

describe('matchesMakerRecord / matchesDirectorRecord（名称 + urlId 双匹配）', () => {
  const makerAeo = collection({ id: 'maker:AEO', name: 'AEO', type: 'maker', externalId: 'AEO' }) as ListRecord;
  const directorDekM = collection({ id: 'director:dekM', name: 'dekM', type: 'director', externalId: 'dekM' }) as ListRecord;

  it('maker：名称相等（NFKC/空白/大小写不敏感）', () => {
    expect(matchesMakerRecord({ maker: 'AEO' }, makerAeo)).toBe(true);
    expect(matchesMakerRecord({ maker: 'a e o' }, makerAeo)).toBe(true);
    expect(matchesMakerRecord({ maker: 'Other' }, makerAeo)).toBe(false);
    expect(matchesMakerRecord({}, makerAeo)).toBe(false);
  });

  it('maker：urlId 精确匹配（makerUrl endsWith /makers/{id}）', () => {
    expect(matchesMakerRecord({ maker: '别的厂牌', makerUrl: 'https://javdb.com/makers/AEO' }, makerAeo)).toBe(true);
    expect(matchesMakerRecord({ makerUrl: 'https://javdb.com/makers/OTHER' }, makerAeo)).toBe(false);
  });

  it('director：名称相等 + urlId 精确匹配', () => {
    expect(matchesDirectorRecord({ director: 'dekM' }, directorDekM)).toBe(true);
    expect(matchesDirectorRecord({ director: 'DEKM' }, directorDekM)).toBe(true);
    expect(matchesDirectorRecord({ director: 'other', directorUrl: 'https://javdb.com/directors/dekM' }, directorDekM)).toBe(true);
    expect(matchesDirectorRecord({ director: 'other', directorUrl: 'https://javdb.com/directors/xx' }, directorDekM)).toBe(false);
    expect(matchesDirectorRecord({}, directorDekM)).toBe(false);
  });

  it('series/label 匹配口径零漂移（对照锚）', () => {
    expect(matchesSeriesRecord({ seriesUrl: 'https://javdb.com/series/gr8A' }, collection({ id: 'series:gr8A', name: 'S', type: 'series', externalId: 'gr8A' }) as ListRecord)).toBe(true);
    expect(matchesLabelRecord({ id: 'FC2-123' }, collection({ id: 'label:fc2', name: 'FC2', type: 'label', externalId: 'fc2' }) as ListRecord)).toBe(true);
  });
});
