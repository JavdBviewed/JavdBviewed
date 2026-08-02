/**
 * @file recordsBatchAddTagRuntime.test.ts
 * @description records batch add tag runtime 测试
 * @module tests/dom
 */
import { describe, expect, it, vi } from 'vitest';
import { createRecordsBatchAddTagRuntime } from '../../apps/extension/src/dashboard/tabs/records/batchAddTagRuntime';
import type { VideoRecord } from '../../apps/extension/src/types';

function record(id: string): VideoRecord {
  return {
    id,
    title: id,
    status: 'browsed',
    tags: ['old'],
    manuallyEditedFields: [],
    updatedAt: 1,
  } as VideoRecord;
}

describe('records batch add tag runtime', () => {
  it('updates visible records and shows a success message', async () => {
    const visible = [record('A')];
    const putRecord = vi.fn(async () => undefined);
    const showMessage = vi.fn();
    const render = vi.fn();

    const runtime = createRecordsBatchAddTagRuntime({
      getVisibleRecords: () => visible,
      getRecordById: vi.fn(),
      putRecord,
      showMessage,
      render,
    });

    await runtime.executeBatchAddTag(['A'], ['tag-a', 'tag-b']);

    expect(putRecord).toHaveBeenCalledTimes(1);
    expect(visible[0].tags).toEqual(['old']);
    expect(visible[0].userTags).toEqual(['tag-a', 'tag-b']);
    expect(showMessage).toHaveBeenCalledWith('已为 1 条视频追加标签', 'success');
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('loads missing records from storage and reports partial failures', async () => {
    const visible: VideoRecord[] = [];
    const loaded = record('B');
    const getRecordById = vi.fn(async (id: string) => (id === 'B' ? loaded : undefined));
    const putRecord = vi.fn(async () => undefined);
    const showMessage = vi.fn();
    const render = vi.fn();

    const runtime = createRecordsBatchAddTagRuntime({
      getVisibleRecords: () => visible,
      getRecordById,
      putRecord,
      showMessage,
      render,
    });

    await runtime.executeBatchAddTag(['B', 'C'], ['tag-a']);

    expect(getRecordById).toHaveBeenCalledWith('B');
    expect(getRecordById).toHaveBeenCalledWith('C');
    expect(showMessage).toHaveBeenCalledWith('标签添加完成：成功 1 条，失败 1 条', 'warning');
    expect(render).toHaveBeenCalledTimes(1);
  });
});
