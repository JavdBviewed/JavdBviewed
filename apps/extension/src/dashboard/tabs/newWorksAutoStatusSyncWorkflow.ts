import type { NewWorksStatusSyncResult } from './newWorksStatusSyncWorkflow';

export interface NewWorksAutoStatusSyncWorkflowDeps {
  syncWithVideoRecords(): Promise<NewWorksStatusSyncResult>;
  render(): Promise<void>;
  logInfo(message: string): void;
  logError(message: string, error: unknown): void;
}

export interface RunNewWorksAutoStatusSyncWorkflowInput {
  deps: NewWorksAutoStatusSyncWorkflowDeps;
}

export async function runNewWorksAutoStatusSyncWorkflow(
  input: RunNewWorksAutoStatusSyncWorkflowInput,
): Promise<void> {
  const { deps } = input;

  try {
    deps.logInfo('自动同步新作品状态...');
    const result = await deps.syncWithVideoRecords();

    if (result.skipped) {
      deps.logInfo('自动同步新作品状态已跳过：最近已同步');
      return;
    }

    if (result.updated > 0) {
      deps.logInfo(`自动同步完成，更新了 ${result.updated} 个作品的状态`);
      result.details.forEach(detail => {
        deps.logInfo(`• ${detail.id}: ${detail.oldStatus} → ${detail.newStatus}`);
      });
      await deps.render();
      return;
    }

    deps.logInfo('自动同步完成，没有需要更新的作品状态');
  } catch (error) {
    deps.logError('自动同步状态失败:', error);
  }
}
