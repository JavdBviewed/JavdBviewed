import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openRecordsEditModal } from '../../apps/extension/src/dashboard/tabs/records/editModalController';
import type { VideoRecord } from '../../apps/extension/src/types';

describe('records edit modal user tags', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('edits local user tags without changing scraped tags', async () => {
    const record: VideoRecord = {
      id: 'ABC-001',
      title: '标题',
      status: 'browsed',
      tags: ['中文字幕'],
      userTags: ['旧标签'],
      createdAt: 1,
      updatedAt: 1,
    };
    const onSave = vi.fn(async () => undefined);

    openRecordsEditModal({
      record,
      videoStatus: {
        UNTRACKED: 'untracked',
        VIEWED: 'viewed',
        BROWSED: 'browsed',
        WANT: 'want',
      },
      showMessage: vi.fn(),
      onSave,
    });

    const input = document.querySelector('#edit-user-tags') as HTMLTextAreaElement;
    expect(input).toBeTruthy();
    input.value = '精选, 待整理';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    (document.querySelector('#save-record') as HTMLButtonElement).click();
    await Promise.resolve();

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      tags: ['中文字幕'],
      userTags: ['精选', '待整理'],
    }), record);
  });
});
