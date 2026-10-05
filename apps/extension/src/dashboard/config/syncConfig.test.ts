import { describe, expect, it } from 'vitest';
import {
  SYNC_OPTIONS,
  getSyncOptionByType,
  isSyncTypeSupported,
  isValidSyncType,
} from './syncConfig';

describe('数据同步配置：片商/導演同步项', () => {
  it('SYNC_OPTIONS 含 syncMakersData（全字段锁定）', () => {
    const option = SYNC_OPTIONS.find((o) => o.id === 'syncMakersData');
    expect(option).toBeDefined();
    expect(option).toEqual({
      id: 'syncMakersData',
      type: 'makers',
      title: '同步片商',
      description: '收藏的片商',
      icon: 'fas fa-building',
      color: '#e83e8c',
      enabled: true,
    });
  });

  it('SYNC_OPTIONS 含 syncDirectorsData（全字段锁定）', () => {
    const option = SYNC_OPTIONS.find((o) => o.id === 'syncDirectorsData');
    expect(option).toBeDefined();
    expect(option).toEqual({
      id: 'syncDirectorsData',
      type: 'directors',
      title: '同步導演',
      description: '收藏的導演',
      icon: 'fas fa-user-tie',
      color: '#fd7e14',
      enabled: true,
    });
  });

  it('makers/directors 通过类型判定且可按类型取回选项', () => {
    expect(isSyncTypeSupported('makers')).toBe(true);
    expect(isSyncTypeSupported('directors')).toBe(true);
    expect(isValidSyncType('makers')).toBe(true);
    expect(isValidSyncType('directors')).toBe(true);
    expect(getSyncOptionByType('makers')?.id).toBe('syncMakersData');
    expect(getSyncOptionByType('directors')?.id).toBe('syncDirectorsData');
  });

  it('既有七项同步选项零漂移（顺序与全量锁定）', () => {
    expect(SYNC_OPTIONS.filter((o) => ['syncAllData', 'syncViewedData', 'syncWantData', 'syncActorsData', 'syncListsData', 'syncSeriesData', 'syncLabelsData'].includes(o.id)).map((o) => o.id)).toEqual([
      'syncAllData',
      'syncViewedData',
      'syncWantData',
      'syncActorsData',
      'syncListsData',
      'syncSeriesData',
      'syncLabelsData',
    ]);
    expect(isSyncTypeSupported('labels')).toBe(true);
  });
});
