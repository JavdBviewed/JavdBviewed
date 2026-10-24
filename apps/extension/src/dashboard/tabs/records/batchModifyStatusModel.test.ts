import { describe, expect, it, vi } from 'vitest';
import {
  BATCH_STATUS_OPTIONS,
  executeBatchModifyStatus,
  isBatchStoredStatus,
} from './batchActionsController';

describe('batch modify status pure model', () => {
  it('locks the 4 stored status value domain and rejects derived values', () => {
    expect(BATCH_STATUS_OPTIONS.map(option => option.value)).toEqual(['untracked', 'viewed', 'browsed', 'want']);
    expect(isBatchStoredStatus('untracked')).toBe(true);
    expect(isBatchStoredStatus('viewed')).toBe(true);
    expect(isBatchStoredStatus('browsed')).toBe(true);
    expect(isBatchStoredStatus('want')).toBe(true);
    // 派生态（已入库/真实已看=资料库同步自动判定的筛选维度，非存储态）必须拒绝
    expect(isBatchStoredStatus('in_library')).toBe(false);
    expect(isBatchStoredStatus('real_watched')).toBe(false);
    expect(isBatchStoredStatus('')).toBe(false);
  });

  it('rejects an invalid status value without writing anything', async () => {
    const updateRecordStatus = vi.fn().mockResolvedValue(undefined);
    await expect(executeBatchModifyStatus({
      recordIds: ['AAA-001'],
      status: 'in_library',
      updateRecordStatus,
    })).rejects.toThrow(/状态值/);
    expect(updateRecordStatus).not.toHaveBeenCalled();
  });

  it('isolates per-item failures and aggregates the result', async () => {
    const updateRecordStatus = vi.fn(async (id: string) => {
      if (id === 'BAD-002') throw new Error('写入失败');
    });
    const onProgress = vi.fn();
    const result = await executeBatchModifyStatus({
      recordIds: ['AAA-001', 'BAD-002', 'CCC-003'],
      status: 'viewed',
      updateRecordStatus,
      onProgress,
      delayMs: 0,
    });

    expect(result.successCount).toBe(2);
    expect(result.failCount).toBe(1);
    expect(result.errors).toEqual([{ recordId: 'BAD-002', message: '写入失败' }]);
    expect(onProgress).toHaveBeenLastCalledWith(3, 3);
    expect(updateRecordStatus).toHaveBeenCalledTimes(3);
  });
});
