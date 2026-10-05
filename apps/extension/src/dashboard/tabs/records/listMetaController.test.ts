import { describe, expect, it, vi } from 'vitest';
import { createRecordsListMetaController } from './listMetaController';
import type { ListRecord } from '../../../types';

function list(partial: Partial<ListRecord>): ListRecord {
  return {
    id: partial.id || 'list-1',
    name: partial.name || '清单',
    type: partial.type || 'mine',
    source: partial.source,
    externalId: partial.externalId,
    itemCount: partial.itemCount,
    updatedAt: partial.updatedAt,
    createdAt: partial.createdAt,
  };
}

describe('records list meta controller', () => {
  it('loads video lists, series, and labels into lookup maps', async () => {
    const onAfterLoaded = vi.fn();
    const controller = createRecordsListMetaController({
      loadLists: vi.fn(async () => [
        list({ id: 'local-1', name: '本地清单', type: 'local', source: 'local' }),
        list({ id: 'series:abc', name: '测试系列', type: 'series', externalId: 'abc' }),
        list({ id: 'label:fc2', name: 'FC2', type: 'label', externalId: 'fc2' }),
        list({ id: 'maker:AEO', name: 'AEO 片商', type: 'maker', externalId: 'AEO' }),
        list({ id: 'director:dekM', name: 'dekM 導演', type: 'director', externalId: 'dekM' }),
      ]),
      shouldRenderAfterLoad: () => true,
      onAfterLoaded,
    });

    await controller.ensureLoaded();

    expect(controller.maps.listIdToName.get('local-1')).toBe('本地清单');
    expect(controller.maps.listIdToSource.get('local-1')).toBe('local');
    expect(controller.maps.seriesIdToName.get('abc')).toBe('测试系列');
    expect(controller.maps.labelIdToName.get('FC2')).toBe('FC2');
    expect(controller.maps.seriesIdToRecord.get('abc')?.type).toBe('series');
    expect(controller.maps.labelIdToRecord.get('FC2')?.type).toBe('label');
    expect(controller.maps.makerIdToName.get('AEO')).toBe('AEO 片商');
    expect(controller.maps.directorIdToName.get('dekM')).toBe('dekM 導演');
    expect(controller.maps.makerIdToRecord.get('AEO')?.type).toBe('maker');
    expect(controller.maps.directorIdToRecord.get('dekM')?.type).toBe('director');
    expect(controller.isLoaded()).toBe(true);
    expect(onAfterLoaded).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent load requests', async () => {
    let resolveLists: (value: ListRecord[]) => void = () => {};
    const loadLists = vi.fn(() => new Promise<ListRecord[]>((resolve) => {
      resolveLists = resolve;
    }));
    const controller = createRecordsListMetaController({
      loadLists,
      shouldRenderAfterLoad: () => false,
      onAfterLoaded: vi.fn(),
    });

    const first = controller.ensureLoaded();
    const second = controller.ensureLoaded();
    resolveLists([list({ id: 'list-1', type: 'mine' })]);
    await Promise.all([first, second]);

    expect(loadLists).toHaveBeenCalledTimes(1);
    expect(controller.maps.listIdToName.get('list-1')).toBe('清单');
  });

  it('marks loading as complete after failures and still runs the after-load hook when requested', async () => {
    const onAfterLoaded = vi.fn();
    const controller = createRecordsListMetaController({
      loadLists: vi.fn(async () => {
        throw new Error('failed');
      }),
      shouldRenderAfterLoad: () => true,
      onAfterLoaded,
    });

    await controller.ensureLoaded();

    expect(controller.isLoaded()).toBe(true);
    expect(controller.isLoading()).toBe(false);
    expect(onAfterLoaded).toHaveBeenCalledTimes(1);
  });
});
