/**
 * @file recordsEditModalStatusDictionary.test.ts
 * @description 10-24-records-state-dict 编辑弹窗字典驱动 6 态下拉 + save 白名单
 * （派生值永不写入 record.status）；10-27-records-derived-state-pin 派生态解禁
 * （选中=钉住 on）+ 人工维护三态 select（unset/on/off，显式取消钉住/强制关入口）
 * + override 落盘/清除/JSON 手改同步。
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

function createRecord(status: VideoRecord['status'], overrides?: VideoRecord['mediaStateOverrides']): VideoRecord {
  return {
    id: 'MKMP-577',
    title: '测试标题',
    status,
    tags: [],
    createdAt: 1,
    updatedAt: 2,
    mediaStateOverrides: overrides,
  };
}

interface ModalHandles {
  statusSelect: HTMLSelectElement;
  inLibraryPin: HTMLSelectElement;
  realWatchedPin: HTMLSelectElement;
  jsonTextarea: HTMLTextAreaElement;
  save: HTMLButtonElement;
}

function openModal(record: VideoRecord, onSave: ReturnType<typeof vi.fn>): ModalHandles {
  openRecordsEditModal({
    record,
    videoStatus,
    showMessage: vi.fn(),
    onSave,
  });
  return {
    statusSelect: document.querySelector('#edit-status') as HTMLSelectElement,
    inLibraryPin: document.querySelector('#edit-inlibrary-pin') as HTMLSelectElement,
    realWatchedPin: document.querySelector('#edit-realwatched-pin') as HTMLSelectElement,
    jsonTextarea: document.querySelector('#edit-json') as HTMLTextAreaElement,
    save: document.querySelector('#save-record') as HTMLButtonElement,
  };
}

function selectChange(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change'));
}

function savedRecord(onSave: ReturnType<typeof vi.fn>): VideoRecord {
  return onSave.mock.calls[0][0] as VideoRecord;
}

describe('records edit modal status dictionary (10-24 state-dict + 10-27 pin)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders 6 selectable options: 4 stored + 2 derived with pin wording (no longer disabled)', () => {
    const { statusSelect, inLibraryPin, realWatchedPin } = openModal(createRecord('viewed'), vi.fn());
    const options = Array.from(statusSelect.options);
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
    expect(inLibrary?.disabled).toBe(false);
    expect(realWatched?.disabled).toBe(false);
    expect(inLibrary?.textContent).toContain('已入库');
    expect(inLibrary?.textContent).toContain('钉住');
    expect(realWatched?.textContent).toContain('真实已看');
    expect(realWatched?.textContent).toContain('钉住');

    // 人工维护三态入口可发现：两维各一枚 select，选项 unset/on/off
    expect(inLibraryPin.options).toHaveLength(3);
    expect(realWatchedPin.options).toHaveLength(3);
    for (const select of [inLibraryPin, realWatchedPin]) {
      expect(Array.from(select.options).map((option) => option.value)).toEqual(['unset', 'on', 'off']);
    }
  });

  it('preselects the stored status of the record and pin selects from mediaStateOverrides', () => {
    const { statusSelect, inLibraryPin, realWatchedPin } = openModal(
      createRecord('browsed', { inLibrary: true, realWatched: false }),
      vi.fn(),
    );
    expect(statusSelect.value).toBe('browsed');
    expect(inLibraryPin.value).toBe('on');
    expect(realWatchedPin.value).toBe('off');
  });

  it('old record without overrides → pin selects default to unset', () => {
    const { inLibraryPin, realWatchedPin } = openModal(createRecord('viewed'), vi.fn());
    expect(inLibraryPin.value).toBe('unset');
    expect(realWatchedPin.value).toBe('unset');
  });

  it('selecting a derived status pins that dimension on; stored status is preserved on save', async () => {
    const onSave = vi.fn(async () => undefined);
    const { statusSelect, inLibraryPin, realWatchedPin } = openModal(createRecord('viewed'), onSave);
    selectChange(statusSelect, 'inLibrary');
    expect(inLibraryPin.value).toBe('on');
    expect(realWatchedPin.value).toBe('unset');

    onSave.mockClear();
    selectChange(statusSelect, 'realWatched');
    expect(realWatchedPin.value).toBe('on');
    expect(inLibraryPin.value).toBe('on'); // 两维独立：不互相清除

    statusSelect.value = 'realWatched';
    statusSelect.dispatchEvent(new Event('change'));
    onSave.mockClear();
    selectChange(statusSelect, 'inLibrary'); // 仅留 inLibrary 维演示保存
    inLibraryPin.value = 'unset';
    inLibraryPin.dispatchEvent(new Event('change')); // 再取消 inLibrary，仅 realWatched 钉住
    (document.querySelector('#save-record') as HTMLButtonElement).click();
    await Promise.resolve();

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = savedRecord(onSave);
    expect(saved.status).toBe('viewed'); // 存储态不被派生选择毁掉
    expect(saved.mediaStateOverrides).toEqual({ realWatched: true });
  });

  it('explicitly switching to a different stored status clears both pins and saves the new stored status', async () => {
    const onSave = vi.fn(async () => undefined);
    const { statusSelect, inLibraryPin, realWatchedPin } = openModal(
      createRecord('viewed', { inLibrary: true }),
      onSave,
    );
    selectChange(statusSelect, 'browsed');
    expect(inLibraryPin.value).toBe('unset');
    expect(realWatchedPin.value).toBe('unset');

    (document.querySelector('#save-record') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = savedRecord(onSave);
    expect(saved.status).toBe('browsed');
    expect(saved.mediaStateOverrides).toBeUndefined();
  });

  it('pin select off → force-off override is persisted', async () => {
    const onSave = vi.fn(async () => undefined);
    const { realWatchedPin } = openModal(createRecord('viewed'), onSave);
    selectChange(realWatchedPin, 'off');
    (document.querySelector('#save-record') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(savedRecord(onSave).mediaStateOverrides).toEqual({ realWatched: false });
  });

  it('setting pin back to unset removes the field (no backfill for old records)', async () => {
    const onSave = vi.fn(async () => undefined);
    const { inLibraryPin } = openModal(createRecord('viewed', { inLibrary: true }), onSave);
    expect(inLibraryPin.value).toBe('on');
    selectChange(inLibraryPin, 'unset');
    (document.querySelector('#save-record') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = savedRecord(onSave);
    expect(saved.mediaStateOverrides).toBeUndefined();
    expect(saved.status).toBe('viewed');
  });

  it('JSON manual edit of mediaStateOverrides syncs the pin selects and is normalized on save', async () => {
    const onSave = vi.fn(async () => undefined);
    const { jsonTextarea, inLibraryPin, realWatchedPin } = openModal(createRecord('viewed'), onSave);
    const payload = JSON.parse(jsonTextarea.value) as VideoRecord;
    payload.mediaStateOverrides = { inLibrary: true, realWatched: 'dirty' };
    jsonTextarea.value = JSON.stringify(payload, null, 2);
    jsonTextarea.dispatchEvent(new Event('input'));

    expect(inLibraryPin.value).toBe('on');
    expect(realWatchedPin.value).toBe('unset'); // 脏值=未钉住

    (document.querySelector('#save-record') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(savedRecord(onSave).mediaStateOverrides).toEqual({ inLibrary: true });
  });

  it('saves stored status unchanged', async () => {
    const onSave = vi.fn(async () => undefined);
    openModal(createRecord('viewed'), onSave);
    (document.querySelector('#save-record') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = savedRecord(onSave);
    expect(saved.status).toBe('viewed');
    expect(saved.mediaStateOverrides).toBeUndefined();
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
    const saved = savedRecord(onSave);
    expect(saved.status).toBe(videoStatus.UNTRACKED);
    expect(['inLibrary', 'realWatched']).not.toContain(saved.status);
  });
});
