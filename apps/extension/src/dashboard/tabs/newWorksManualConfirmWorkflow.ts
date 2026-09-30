/**
 * @file newWorksManualConfirmWorkflow.ts
 * @description 新作品手动检查「收集-确认-入库」流程编排（纯依赖注入，可单测）
 * @module dashboard/tabs
 */
import {
  buildCommitFailedToastMessage,
  buildDiscardedToastMessage,
  buildNewWorksCommitToastMessage,
  buildNewWorksConfirmModalHtml,
  buildNewWorksConfirmSummary,
  buildNoPendingWorksToastMessage,
  type NewWorksManualCommitStats,
  type NewWorksManualConfirmSource,
  type NewWorksManualPendingWork,
} from './newWorksManualConfirmViewModel';

type MessageType = 'success' | 'error' | 'info' | 'warn' | 'warning';

export interface NewWorksManualCommitResponse {
  success?: boolean;
  error?: string;
  result?: NewWorksManualCommitStats;
}

export interface NewWorksManualConfirmModalOptions {
  title: string;
  html: string;
  confirmLabel: string;
  cancelLabel: string;
}

export interface NewWorksManualConfirmWorkflowDeps {
  showConfirmModal(options: NewWorksManualConfirmModalOptions): Promise<boolean>;
  sendManualCommit(works: NewWorksManualPendingWork[]): Promise<NewWorksManualCommitResponse>;
  render(): Promise<void>;
  showMessage(message: string, type: MessageType): void;
  logError(message: string, error: unknown): void;
}

export interface RunNewWorksManualConfirmWorkflowInput {
  deps: NewWorksManualConfirmWorkflowDeps;
  source?: NewWorksManualConfirmSource;
}

/**
 * 弹窗确认后才批量写入。三条不变式：
 * 1) 可入库为 0 时不打扰用户，直接 toast 说明分项去向；
 * 2) 点「不入库」时零写入——不发 commit 消息，也不动库；
 * 3) 无论哪个分支，最后都渲染一次列表（渲染异常不覆盖业务提示）。
 */
export async function runNewWorksManualConfirmWorkflow(
  input: RunNewWorksManualConfirmWorkflowInput,
): Promise<void> {
  const { deps } = input;
  const source: NewWorksManualConfirmSource = {
    ...input.source,
    pendingWorks: Array.isArray(input.source?.pendingWorks) ? input.source?.pendingWorks : [],
  };
  const summary = buildNewWorksConfirmSummary(source);

  if (summary.pending === 0) {
    deps.showMessage(buildNoPendingWorksToastMessage(source), 'info');
    await renderQuietly(deps);
    return;
  }

  let confirmed = false;
  try {
    confirmed = await deps.showConfirmModal({
      title: summary.title,
      html: buildNewWorksConfirmModalHtml(source),
      confirmLabel: summary.confirmLabel,
      cancelLabel: summary.cancelLabel,
    });
  } catch (error) {
    deps.logError('新作品确认弹窗异常:', error);
    deps.showMessage('入库确认弹窗异常，本次结果未写入新作品库', 'error');
    await renderQuietly(deps);
    return;
  }

  if (!confirmed) {
    deps.showMessage(buildDiscardedToastMessage(summary.pending), 'info');
    await renderQuietly(deps);
    return;
  }

  try {
    const response = await deps.sendManualCommit(source.pendingWorks || []);
    if (!response?.success) {
      deps.logError('新作品手动确认入库失败:', response?.error || 'unknown error');
      deps.showMessage(buildCommitFailedToastMessage(response?.error), 'error');
    } else {
      const toast = buildNewWorksCommitToastMessage(response.result || {});
      deps.showMessage(toast.message, toast.type);
    }
  } catch (error) {
    deps.logError('新作品手动确认入库异常:', error);
    deps.showMessage(buildCommitFailedToastMessage((error as Error)?.message), 'error');
  }

  await renderQuietly(deps);
}

async function renderQuietly(deps: NewWorksManualConfirmWorkflowDeps): Promise<void> {
  try {
    await deps.render();
  } catch {
    // 渲染失败不覆盖入库结果提示
  }
}
