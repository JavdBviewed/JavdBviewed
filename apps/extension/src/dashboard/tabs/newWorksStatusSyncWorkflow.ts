type MessageType = 'success' | 'error' | 'info' | 'warn' | 'warning';

export interface NewWorksStatusSyncDetail {
  id: string;
  oldStatus: string;
  newStatus: string;
}

export interface NewWorksStatusSyncResult {
  updated: number;
  details: NewWorksStatusSyncDetail[];
  skipped?: boolean;
}

export interface NewWorksStatusSyncWorkflowDeps {
  setSyncButtonLoading(loading: boolean): void;
  syncWithVideoRecords(): Promise<NewWorksStatusSyncResult>;
  render(): Promise<void>;
  showMessage(message: string, type: MessageType): void;
  logInfo(message: string, data?: unknown): void;
  logError(message: string, error: unknown): void;
}

export interface RunNewWorksStatusSyncWorkflowInput {
  deps: NewWorksStatusSyncWorkflowDeps;
}

export async function runNewWorksStatusSyncWorkflow(input: RunNewWorksStatusSyncWorkflowInput): Promise<void> {
  const { deps } = input;

  try {
    deps.setSyncButtonLoading(true);
    deps.logInfo('开始同步新作品状态...');

    const result = await deps.syncWithVideoRecords();
    deps.logInfo('同步完成:', result);

    await deps.render();

    if (result.updated > 0) {
      deps.showMessage(buildStatusSyncSuccessMessage(result), 'success');
    } else {
      deps.showMessage('没有需要同步的作品状态', 'info');
    }
  } catch (error) {
    deps.logError('同步新作品状态失败:', error);
    deps.showMessage('同步状态失败，请重试', 'error');
  } finally {
    deps.setSyncButtonLoading(false);
  }
}

function buildStatusSyncSuccessMessage(result: NewWorksStatusSyncResult): string {
  let message = `已同步 ${result.updated} 个作品的状态`;
  if (result.details.length === 0) {
    return message;
  }

  const detailsToShow = result.details.slice(0, 3);
  const detailsText = detailsToShow.map(detail => `${detail.id}: ${detail.oldStatus} → ${detail.newStatus}`).join('\n');
  message += `\n\n更新详情:\n${detailsText}`;
  if (result.details.length > 3) {
    message += `\n...还有 ${result.details.length - 3} 个作品`;
  }
  return message;
}
