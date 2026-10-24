/**
 * @file recordsEditModalStatusDictionary.test.ts
 * @description 10-24-records-state-dict：编辑弹窗字典驱动 6 态下拉
 * （4 存储态可选 / 2 派生态 disabled+「由资料库同步自动判定」）+ save 白名单
 * （派生值永不写入 record.status）。
 * @module tests/dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openRecordsEditModal } from '../../apps/extension/src/dashboard/tabs/records/editModalController';
import type { VideoRecord } from '../../apps/extension/src/types';

const videoStatus = {
  UNTRACKED: 'untracked' as const,
  VIEWED: 'viewed' as const,
  BROWSED: 'browsed' as const,
  WANT: 'want' as const,
};

function createRecord(status: VideoRecord['status']): VideoRecord {
  return {
    id: 'MKMP-577',
    title: '测试标题',
    status,
    tags: [],
    createdAt: 1,
    updatedAt: 2,
  };
}

function openModal(record: VideoRecord, onSave: ReturnType<typeof vi.fn>) {
  openRecordsEditModal({
    record,
    videoStatus,
    showMessage: vi.fn(),
    onSave,
  });
  return document.querySelector('#edit-status') as HTMLSelectElement;
}

describe('records edit modal status dictionary (10-24 state-dict)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders 6 options: 4 stored selectable + 2 derived disabled with auto-judge wording', () => {
    const select = openModal(createRecord('viewed'), vi.fn());
    const options = Array.from(select.options);
    expect(options).toHaveLength(6);

    const byValue = new Map(options.map((option) => [option.value, option]));
    expect(byValue.get('untracked')?.textContent).toBe('未标记');
    expect(byValue.get('viewed')?.textContent).toBe('已观看');
    expect(byValue.get('browsed')?.textContent).toBe('已浏览');
    expect(byValue.get('want')?.textContent).toBe('想看');
    for (const stored of ['untracked', 'viewed', 'browsed', 'want']) {
      expect(byValue.get(stored)?.disabled).toBe(false);
    }
    const inLibrary = byValue.get('inLibrary');
    const realWatched = byValue.get('realWatched');
    expect(inLibrary?.disabled).toBe(true);
    expect(realWatched?.disabled).toBe(true);
    expect(inLibrary?.textContent).toContain('已入库');
    expect(inLibrary?.textContent).toContain('由资料库同步自动判定');
    expect(realWatched?.textContent).toContain('真实已看');
    expect(realWatched?.textContent).toContain('由资料库同步自动判定');
  });

  it('preselects the stored status of the record', () => {
    const select = openModal(createRecord('browsed'), vi.fn());
    expect(select.value).toBe('browsed');
  });

  it('saves stored status unchanged', async () => {
    const onSave = vi.fn(async () => undefined);
    openModal(createRecord('viewed'), onSave);
    (document.querySelector('#save-record') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as VideoRecord;
    expect(saved.status).toBe('viewed');
  });

  it('never writes derived values into record.status (whitelist guard, JSON path)', async () => {
    const onSave = vi.fn(async () => undefined);
    openModal(createRecord('viewed'), onSave);
    const jsonTextarea = document.querySelector('#edit-json') as HTMLTextAreaElement;
    const payload = JSON.parse(jsonTextarea.value) as VideoRecord;
    payload.status = 'realWatched';
    jsonTextarea.value = JSON.stringify(payload, null, 2);
    (document.querySelector('#save-record') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as VideoRecord;
    expect(saved.status).toBe(videoStatus.UNTRACKED);
    expect(['inLibrary', 'realWatched']).not.toContain(saved.status);
  });
});
