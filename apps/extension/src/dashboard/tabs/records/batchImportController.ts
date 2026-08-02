import type { BatchImportMode } from './batchImportService';
import type { BatchImportTaskItem } from './batchImportTaskStore';

export interface RecordsBatchImportSubmission {
  input: string;
  mode: BatchImportMode;
  userTags: string[];
}

export interface CreateRecordsBatchImportControllerOptions {
  onSubmit: (submission: RecordsBatchImportSubmission) => Promise<void> | void;
  onClose?: () => void;
  onRetryItem?: (index: number) => void;
  onExportFailures?: (codes: string[]) => void;
}

export interface RecordsBatchImportController {
  open: () => void;
  close: () => void;
  setBusy: (busy: boolean) => void;
  setProgress: (message: string) => void;
  setError: (message: string) => void;
  setResumeAvailable: (message: string, onResume: () => void) => void;
  setResults: (items: BatchImportTaskItem[]) => void;
}

const RESULT_STATUS_LABELS: Record<BatchImportTaskItem['status'], string> = {
  pending: '等待处理',
  searching: '搜索中',
  matched: '已找到资料',
  imported: '已加入收藏',
  existing: '已更新收藏',
  placeholder: '待补全资料',
  duplicate: '重复项',
  invalid: '无效输入',
  'not-found': '未找到',
  failed: '失败',
};

function parseUserTags(value: string): string[] {
  const seen = new Set<string>();
  return String(value || '')
    .split(/[，,;；]/)
    .map(item => item.trim())
    .filter(Boolean)
    .filter((tag) => {
      if (seen.has(tag)) return false;
      seen.add(tag);
      return true;
    });
}

export function createRecordsBatchImportController(
  options: CreateRecordsBatchImportControllerOptions,
): RecordsBatchImportController {
  let modal: HTMLDivElement | null = null;
  let submitButton: HTMLButtonElement | null = null;
  let progressElement: HTMLDivElement | null = null;
  let errorElement: HTMLDivElement | null = null;
  let resumeButton: HTMLButtonElement | null = null;
  let resultFilter: HTMLSelectElement | null = null;
  let resultsToolbar: HTMLDivElement | null = null;
  let exportFailuresButton: HTMLButtonElement | null = null;
  let resultsElement: HTMLDivElement | null = null;
  let resultItems: BatchImportTaskItem[] = [];

  const removeModal = () => {
    modal?.remove();
    modal = null;
    submitButton = null;
    progressElement = null;
    errorElement = null;
    resumeButton = null;
    resultFilter = null;
    resultsToolbar = null;
    exportFailuresButton = null;
    resultsElement = null;
    resultItems = [];
  };

  const close = () => {
    options.onClose?.();
    removeModal();
  };

  const setBusy = (busy: boolean) => {
    if (!modal || !submitButton) return;
    submitButton.disabled = busy;
    submitButton.textContent = busy ? '处理中…' : '开始处理';
    modal.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')
      .forEach((element) => { element.disabled = busy; });
    if (resumeButton) resumeButton.disabled = busy;
  };

  const setProgress = (message: string) => {
    if (progressElement) progressElement.textContent = message;
  };

  const setError = (message: string) => {
    if (!errorElement) return;
    errorElement.textContent = message;
    errorElement.hidden = !message;
  };

  const setResumeAvailable = (message: string, onResume: () => void) => {
    if (!resumeButton) return;
    resumeButton.textContent = message;
    resumeButton.hidden = false;
    resumeButton.onclick = onResume;
  };

  const renderResults = () => {
    if (!resultsElement) return;
    const resultsContainer = resultsElement;
    const filter = resultFilter?.value || 'all';
    resultsContainer.textContent = '';
    resultItems.forEach((item, index) => {
      if (filter !== 'all' && item.status !== filter) return;

      const row = document.createElement('div');
      row.dataset.batchImportResultItem = 'true';
      row.className = 'batch-import-result-item';

      const summary = document.createElement('div');
      summary.className = 'batch-import-result-summary';
      const code = document.createElement('strong');
      code.textContent = item.code || item.sourceText;
      const status = document.createElement('span');
      status.className = `batch-import-result-status is-${item.status}`;
      status.textContent = RESULT_STATUS_LABELS[item.status];
      summary.append(code, status);
      row.appendChild(summary);

      if (item.title && item.title !== item.code) {
        const title = document.createElement('span');
        title.className = 'batch-import-result-title';
        title.textContent = item.title;
        row.appendChild(title);
      }

      if (item.error) {
        const error = document.createElement('span');
        error.className = 'batch-import-result-error';
        error.textContent = item.error;
        row.appendChild(error);
      }

      if (item.status === 'failed') {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'batch-import-result-retry';
        retry.dataset.batchImportRetry = String(index);
        retry.textContent = '重试';
        retry.addEventListener('click', () => options.onRetryItem?.(index));
        row.appendChild(retry);
      }

      resultsContainer.appendChild(row);
    });
  };

  const setResults = (items: BatchImportTaskItem[]) => {
    resultItems = items.map(item => ({ ...item }));
    if (resultsToolbar) resultsToolbar.hidden = resultItems.length === 0;
    if (exportFailuresButton) {
      exportFailuresButton.hidden = !resultItems.some(item => item.status === 'failed');
    }
    renderResults();
  };

  const open = () => {
    removeModal();
    modal = document.createElement('div');
    modal.dataset.batchImportModal = 'true';
    modal.className = 'batch-import-modal';
    modal.innerHTML = `
      <div class="batch-import-overlay"></div>
      <section class="batch-import-content" role="dialog" aria-modal="true" aria-labelledby="batchImportTitle">
        <header class="batch-import-header">
          <div>
            <span class="batch-import-eyebrow">本地收藏</span>
            <h3 id="batchImportTitle">批量导入番号</h3>
          </div>
          <button type="button" id="batchImportClose" class="batch-import-close" aria-label="关闭">×</button>
        </header>
        <div class="batch-import-body">
          <label class="batch-import-field">
            <span>番号列表</span>
            <textarea id="batchImportInput" rows="8" placeholder="每行一个番号，例如：\nMISM-304\nABC-001"></textarea>
          </label>
          <label class="batch-import-field">
            <span>处理方式</span>
            <select id="batchImportMode">
              <option value="search-import">搜索并加入扩展收藏（推荐）</option>
              <option value="search-only">仅搜索，不写入收藏</option>
              <option value="direct-import">直接加入本地收藏，不联网</option>
            </select>
          </label>
          <label class="batch-import-field">
            <span>本地标签 <small>可选</small></span>
            <input id="batchImportUserTags" type="text" placeholder="多个标签用逗号分隔，例如：精选, 待整理" />
          </label>
          <p class="batch-import-hint">搜索不到的番号会保留为“待补全资料”的本地收藏；不会修改 JavDB 的“我想看”。</p>
          <button type="button" id="batchImportResume" class="batch-import-resume" hidden></button>
          <div id="batchImportProgress" class="batch-import-progress" aria-live="polite"></div>
          <div id="batchImportError" class="batch-import-error" role="alert" hidden></div>
          <div class="batch-import-results-toolbar" hidden>
            <label for="batchImportResultFilter">结果</label>
            <select id="batchImportResultFilter">
              <option value="all">全部</option>
              <option value="failed">失败</option>
              <option value="placeholder">待补全资料</option>
              <option value="imported">已加入收藏</option>
              <option value="matched">已找到资料</option>
              <option value="duplicate">重复项</option>
              <option value="invalid">无效输入</option>
            </select>
            <button type="button" id="batchImportExportFailures" hidden>导出失败番号</button>
          </div>
          <div id="batchImportResults" class="batch-import-results" aria-live="polite"></div>
        </div>
        <footer class="batch-import-footer">
          <button type="button" id="batchImportCancel" class="button-like">关闭</button>
          <button type="button" id="batchImportSubmit" class="button-like primary">开始处理</button>
        </footer>
      </section>
    `;
    document.body.appendChild(modal);

    submitButton = modal.querySelector('#batchImportSubmit') as HTMLButtonElement | null;
    progressElement = modal.querySelector('#batchImportProgress') as HTMLDivElement | null;
    errorElement = modal.querySelector('#batchImportError') as HTMLDivElement | null;
    resumeButton = modal.querySelector('#batchImportResume') as HTMLButtonElement | null;
    resultFilter = modal.querySelector('#batchImportResultFilter') as HTMLSelectElement | null;
    resultsToolbar = modal.querySelector('.batch-import-results-toolbar') as HTMLDivElement | null;
    exportFailuresButton = modal.querySelector('#batchImportExportFailures') as HTMLButtonElement | null;
    resultsElement = modal.querySelector('#batchImportResults') as HTMLDivElement | null;
    const input = modal.querySelector('#batchImportInput') as HTMLTextAreaElement | null;
    const mode = modal.querySelector('#batchImportMode') as HTMLSelectElement | null;
    const userTags = modal.querySelector('#batchImportUserTags') as HTMLInputElement | null;

    const submit = async () => {
      if (!input || !mode || !userTags) return;
      if (!input.value.trim()) {
        setError('请先输入至少一个番号。');
        return;
      }
      setError('');
      setBusy(true);
      try {
        await options.onSubmit({
          input: input.value,
          mode: mode.value as BatchImportMode,
          userTags: parseUserTags(userTags.value),
        });
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error || '处理失败'));
      } finally {
        setBusy(false);
      }
    };

    modal.querySelector('#batchImportClose')?.addEventListener('click', close);
    modal.querySelector('#batchImportCancel')?.addEventListener('click', close);
    modal.querySelector('.batch-import-overlay')?.addEventListener('click', close);
    submitButton?.addEventListener('click', () => { void submit(); });
    resultFilter?.addEventListener('change', renderResults);
    modal.querySelector('#batchImportExportFailures')?.addEventListener('click', () => {
      options.onExportFailures?.(resultItems.filter(item => item.status === 'failed').map(item => item.code));
    });
    input?.focus();
  };

  return { open, close, setBusy, setProgress, setError, setResumeAvailable, setResults };
}
