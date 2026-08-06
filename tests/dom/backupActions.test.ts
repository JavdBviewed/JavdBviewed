/**
 * @file backupActions.test.ts
 * @description 备份页操作按钮 DOM 行为测试
 * @module tests/dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({
  logAsync: vi.fn(() => Promise.resolve()),
  showMessage: vi.fn(),
  showWebDAVRestoreModal: vi.fn(),
  getValue: vi.fn(() => Promise.resolve(0)),
  setValue: vi.fn(() => Promise.resolve()),
  showConfirm: vi.fn(() => Promise.resolve(true)),
  dbViewedCleanInjectedSourceTags: vi.fn(),
}));

vi.mock('../../apps/extension/src/dashboard/logger', () => ({
  logAsync: actionMocks.logAsync,
}));

vi.mock('../../apps/extension/src/dashboard/ui/toast', () => ({
  showMessage: actionMocks.showMessage,
}));

vi.mock('../../apps/extension/src/dashboard/webdavRestore', () => ({
  showWebDAVRestoreModal: actionMocks.showWebDAVRestoreModal,
}));

vi.mock('../../apps/extension/src/dashboard/components/confirmModal', () => ({
  showConfirm: actionMocks.showConfirm,
}));

vi.mock('../../apps/extension/src/dashboard/dbClient', () => ({
  dbViewedCleanInjectedSourceTags: actionMocks.dbViewedCleanInjectedSourceTags,
}));

vi.mock('../../apps/extension/src/features/webdavSync/application/backupArchive', () => ({
  createBackupArchive: vi.fn(async () => new Blob(['zip'], { type: 'application/zip' })),
  readBackupFileContent: vi.fn(),
}));

vi.mock('../../apps/extension/src/utils/storage', () => ({
  getValue: actionMocks.getValue,
  setValue: actionMocks.setValue,
}));

vi.mock('../../apps/extension/src/dashboard/state', () => ({
  STATE: {
    settings: {
      webdav: {
        warningDays: 7,
      },
    },
  },
}));

describe('backup page actions', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    mountBackupActionDom();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports through the backup data runtime message and restores the icon button markup', async () => {
    const sendMessage = installChromeRuntimeResponse({
      success: true,
      data: {
        version: 'test',
        data: {},
      },
    });
    const createObjectUrl = vi.fn(() => 'blob:backup');
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { initBackupActions } = await import('../../apps/extension/src/dashboard/backup/actions');
    const exportButton = document.getElementById('exportBtn') as HTMLButtonElement;
    const originalHtml = exportButton.innerHTML;

    initBackupActions(document);
    exportButton.click();

    expect(exportButton.disabled).toBe(true);
    expect(exportButton.innerHTML).toContain('fa-spinner');

    await flushAsyncAction();

    expect(sendMessage).toHaveBeenCalledWith({ type: 'collect-backup-data' }, expect.any(Function));
    expect(exportButton.disabled).toBe(false);
    expect(exportButton.innerHTML).toBe(originalHtml);
    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:backup');
    expect(actionMocks.showMessage).toHaveBeenCalledWith('数据导出成功', 'success');
  });

  it('uploads through the WebDAV runtime message and restores the icon button markup', async () => {
    const sendMessage = installChromeRuntimeResponse({ success: true });
    const { initBackupActions } = await import('../../apps/extension/src/dashboard/backup/actions');
    const uploadButton = document.getElementById('syncNow') as HTMLButtonElement;
    const originalHtml = uploadButton.innerHTML;

    initBackupActions(document);
    uploadButton.click();

    expect(uploadButton.disabled).toBe(true);
    expect(uploadButton.innerHTML).toContain('fa-spinner');

    await flushAsyncAction();

    expect(sendMessage).toHaveBeenCalledWith({ type: 'webdav-upload' }, expect.any(Function));
    expect(uploadButton.disabled).toBe(false);
    expect(uploadButton.innerHTML).toBe(originalHtml);
    expect(actionMocks.showMessage).toHaveBeenCalledWith('数据已成功上传至云端', 'success');
  });

  it('shows the runtime port error and still restores the upload button markup', async () => {
    installChromeRuntimeResponse(undefined, 'The message port closed before a response was received.');
    const { initBackupActions } = await import('../../apps/extension/src/dashboard/backup/actions');
    const uploadButton = document.getElementById('syncNow') as HTMLButtonElement;
    const originalHtml = uploadButton.innerHTML;

    initBackupActions(document);
    uploadButton.click();
    await flushAsyncAction();

    expect(uploadButton.disabled).toBe(false);
    expect(uploadButton.innerHTML).toBe(originalHtml);
    expect(actionMocks.showMessage).toHaveBeenCalledWith(
      '上传失败: The message port closed before a response was received.',
      'error',
    );
  });

  it('opens the existing WebDAV restore modal from the backup page button', async () => {
    const { initBackupActions } = await import('../../apps/extension/src/dashboard/backup/actions');

    initBackupActions(document);
    document.getElementById('syncDown')?.click();

    expect(actionMocks.showWebDAVRestoreModal).toHaveBeenCalledTimes(1);
  });

  it('scans and cleans injected source tags after confirmation', async () => {
    actionMocks.dbViewedCleanInjectedSourceTags
      .mockResolvedValueOnce({
        success: true,
        scannedCount: 10,
        affectedCount: 2,
        tagsRemoved: 3,
        categoriesRemoved: 1,
        removedTagNames: ['Wiki', 'xslist'],
        dryRun: true,
      })
      .mockResolvedValueOnce({
        success: true,
        scannedCount: 10,
        affectedCount: 2,
        tagsRemoved: 3,
        categoriesRemoved: 1,
        removedTagNames: ['Wiki', 'xslist'],
        dryRun: false,
      });
    const { initBackupActions } = await import('../../apps/extension/src/dashboard/backup/actions');
    const cleanupButton = document.getElementById('cleanupInjectedSourceTags') as HTMLButtonElement;
    const originalHtml = cleanupButton.innerHTML;

    initBackupActions(document);
    cleanupButton.click();

    expect(cleanupButton.disabled).toBe(true);
    expect(cleanupButton.innerHTML).toContain('fa-spinner');

    await flushAsyncAction();

    expect(actionMocks.dbViewedCleanInjectedSourceTags).toHaveBeenNthCalledWith(1, { dryRun: true });
    expect(actionMocks.showConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: '清理错误来源标签',
      confirmText: '确认清理',
      type: 'warning',
    }));
    expect(actionMocks.dbViewedCleanInjectedSourceTags).toHaveBeenNthCalledWith(2, { dryRun: false });
    expect(cleanupButton.disabled).toBe(false);
    expect(cleanupButton.innerHTML).toBe(originalHtml);
    expect(actionMocks.showMessage).toHaveBeenCalledWith('已清理 2 条记录，移除 4 个错误标签', 'success');
  });

  it('does not ask for confirmation when no injected source tags are found', async () => {
    actionMocks.dbViewedCleanInjectedSourceTags.mockResolvedValueOnce({
      success: true,
      scannedCount: 10,
      affectedCount: 0,
      tagsRemoved: 0,
      categoriesRemoved: 0,
      removedTagNames: [],
      dryRun: true,
    });
    const { initBackupActions } = await import('../../apps/extension/src/dashboard/backup/actions');

    initBackupActions(document);
    document.getElementById('cleanupInjectedSourceTags')?.click();
    await flushAsyncAction();

    expect(actionMocks.showConfirm).not.toHaveBeenCalled();
    expect(actionMocks.dbViewedCleanInjectedSourceTags).toHaveBeenCalledTimes(1);
    expect(actionMocks.showMessage).toHaveBeenCalledWith('没有发现需要清理的错误来源标签', 'success');
  });
});

function mountBackupActionDom(): void {
  document.body.innerHTML = `
    <section class="card backup-page">
      <label for="importFile" class="backup-action-btn backup-action-btn-secondary">
        <i class="fas fa-file-import"></i>
        <span>导入本地备份</span>
      </label>
      <input type="file" id="importFile" class="backup-file-input" accept=".zip,.json,application/zip,application/json">
      <button id="exportBtn" type="button" class="backup-action-btn backup-action-btn-primary">
        <i class="fas fa-file-export"></i>
        <span>导出 ZIP 备份</span>
      </button>
      <button id="syncNow" type="button" class="backup-action-btn backup-action-btn-primary">
        <i class="fas fa-cloud-upload-alt"></i>
        <span>立即上传至云端</span>
      </button>
      <button id="syncDown" type="button" class="backup-action-btn backup-action-btn-success">
        <i class="fas fa-cloud-download-alt"></i>
        <span>从云端恢复</span>
      </button>
      <button id="cleanupInjectedSourceTags" type="button" class="backup-action-btn backup-action-btn-secondary">
        <i class="fas fa-tags"></i>
        <span>清理错误来源标签</span>
      </button>
      <span id="lastSyncTime">从未</span>
      <div class="sync-indicator" id="syncIndicator">
        <span class="sync-dot"></span>
        <span class="sync-status-text">未同步</span>
      </div>
      <div id="webdavWarningBanner"></div>
      <div id="webdavWarningMessage"></div>
    </section>
  `;
}

function installChromeRuntimeResponse(response: unknown, runtimeError?: string): ReturnType<typeof vi.fn> {
  const runtime = {
    lastError: undefined as { message?: string } | undefined,
    sendMessage: vi.fn((_message: unknown, callback?: (response: unknown) => void) => {
      if (runtimeError) {
        runtime.lastError = { message: runtimeError };
      }
      if (callback) {
        callback(response);
      }
      runtime.lastError = undefined;
    }),
  };

  vi.stubGlobal('chrome', { runtime });
  return runtime.sendMessage;
}

async function flushAsyncAction(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
