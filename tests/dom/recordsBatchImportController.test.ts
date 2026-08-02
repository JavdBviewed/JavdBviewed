import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecordsBatchImportController } from '../../apps/extension/src/dashboard/tabs/records/batchImportController';

describe('records batch import controller', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('submits the selected mode, pasted numbers, and local tags', async () => {
    const onSubmit = vi.fn(async () => undefined);
    const controller = createRecordsBatchImportController({ onSubmit });
    controller.open();

    const input = document.querySelector('#batchImportInput') as HTMLTextAreaElement;
    const mode = document.querySelector('#batchImportMode') as HTMLSelectElement;
    const tags = document.querySelector('#batchImportUserTags') as HTMLInputElement;
    const submit = document.querySelector('#batchImportSubmit') as HTMLButtonElement;
    input.value = 'ABC-001\nABC-002';
    mode.value = 'direct-import';
    tags.value = '精选, 待整理';

    submit.click();
    await Promise.resolve();

    expect(onSubmit).toHaveBeenCalledWith({
      input: 'ABC-001\nABC-002',
      mode: 'direct-import',
      userTags: ['精选', '待整理'],
    });
  });

  it('can close the modal without submitting', () => {
    const onSubmit = vi.fn(async () => undefined);
    const controller = createRecordsBatchImportController({ onSubmit });
    controller.open();
    (document.querySelector('#batchImportCancel') as HTMLButtonElement).click();

    expect(document.querySelector('[data-batch-import-modal]')).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps resume and result actions hidden until they are applicable', () => {
    const controller = createRecordsBatchImportController({ onSubmit: vi.fn(async () => undefined) });
    controller.open();

    expect((document.querySelector('#batchImportResume') as HTMLButtonElement).hidden).toBe(true);
    expect((document.querySelector('.batch-import-results-toolbar') as HTMLDivElement).hidden).toBe(true);
    expect((document.querySelector('#batchImportExportFailures') as HTMLButtonElement).hidden).toBe(true);

    controller.setResults([
      { code: 'ABC-001', sourceText: 'ABC-001', status: 'imported' },
    ]);
    expect((document.querySelector('.batch-import-results-toolbar') as HTMLDivElement).hidden).toBe(false);
    expect((document.querySelector('#batchImportExportFailures') as HTMLButtonElement).hidden).toBe(true);

    controller.setResults([
      { code: 'ABC-001', sourceText: 'ABC-001', status: 'failed', error: '网络错误' },
    ]);
    expect((document.querySelector('#batchImportExportFailures') as HTMLButtonElement).hidden).toBe(false);
  });

  it('exposes a resume action when an unfinished task exists', () => {
    const onSubmit = vi.fn(async () => undefined);
    const onResume = vi.fn();
    const controller = createRecordsBatchImportController({ onSubmit });
    controller.open();
    controller.setResumeAvailable('上次任务已处理 2/5 项', onResume);

    const resume = document.querySelector('#batchImportResume') as HTMLButtonElement;
    expect(resume.hidden).toBe(false);
    expect(resume.textContent).toContain('上次任务已处理 2/5 项');
    resume.click();
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('shows result details, filters failed items, retries, and exports failed numbers', () => {
    const onSubmit = vi.fn(async () => undefined);
    const onRetryItem = vi.fn();
    const onExportFailures = vi.fn();
    const controller = createRecordsBatchImportController({ onSubmit, onRetryItem, onExportFailures });
    controller.open();
    controller.setResults([
      { code: 'ABC-001', sourceText: 'ABC-001', status: 'failed', error: '网络错误' },
      { code: 'ABC-002', sourceText: 'ABC-002', status: 'placeholder', title: 'ABC-002' },
    ]);

    expect(document.querySelectorAll('[data-batch-import-result-item]')).toHaveLength(2);
    (document.querySelector('#batchImportResultFilter') as HTMLSelectElement).value = 'failed';
    (document.querySelector('#batchImportResultFilter') as HTMLSelectElement).dispatchEvent(new Event('change'));

    expect(document.querySelectorAll('[data-batch-import-result-item]')).toHaveLength(1);
    expect(document.querySelector('[data-batch-import-result-item]')?.textContent).toContain('网络错误');
    (document.querySelector('[data-batch-import-retry="0"]') as HTMLButtonElement).click();
    (document.querySelector('#batchImportExportFailures') as HTMLButtonElement).click();

    expect(onRetryItem).toHaveBeenCalledWith(0);
    expect(onExportFailures).toHaveBeenCalledWith(['ABC-001']);
  });
});
