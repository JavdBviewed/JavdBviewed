import type { NewWorkRecord } from '../../types';
import type { NewWorksQueryFilters } from './newWorksFilterTypes';
import {
  MAX_UNREAD_BATCH_OPEN_COUNT,
  NEW_WORKS_BATCH_OPEN_PERFORMANCE_NOTICE,
  pickUnreadBatchOpenTargets,
} from './newWorksBatchOpenPolicy';

type MessageType = 'success' | 'error' | 'info' | 'warn' | 'warning';
type ConfirmType = 'danger' | 'warning' | 'info';

export interface NewWorksConfirmOptions {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  type: ConfirmType;
  isHtml?: boolean;
}

export interface NewWorksBatchOpenResult {
  works: NewWorkRecord[];
  total: number;
  hasMore?: boolean;
}

export interface UnreadBatchOpenWorkflowDeps {
  getCooldownRemaining(): number;
  getCooldownSeconds(): number;
  updateButton(options?: { loading?: boolean }): void;
  getNewWorks(query: NewWorksQueryFilters): Promise<NewWorksBatchOpenResult>;
  confirm(options: NewWorksConfirmOptions): Promise<boolean>;
  openWorkUrl(url: string): Promise<void>;
  markAsRead(workIds: string[]): Promise<void>;
  startCooldown(): void;
  render(): Promise<void>;
  showMessage(message: string, type: MessageType): void;
  logWarn(message: string, error: unknown): void;
  logError(message: string, error: unknown): void;
}

export interface RunUnreadBatchOpenWorkflowInput {
  filters: NewWorksQueryFilters;
  page: number;
  pageSize: number;
  deps: UnreadBatchOpenWorkflowDeps;
}

export async function runUnreadBatchOpenWorkflow(input: RunUnreadBatchOpenWorkflowInput): Promise<void> {
  const { deps } = input;

  if (deps.getCooldownRemaining() > 0) {
    deps.showMessage(`批量打开冷却中，请在 ${deps.getCooldownSeconds()} 秒后重试`, 'info');
    deps.updateButton();
    return;
  }

  try {
    deps.updateButton({ loading: true });
    const result = await deps.getNewWorks({
      ...input.filters,
      page: input.page,
      pageSize: input.pageSize,
    });

    const unread = result.works.filter(work => !work.isRead);
    const targets = pickUnreadBatchOpenTargets(result.works);
    if (targets.length === 0) {
      deps.showMessage('当前页没有未读作品', 'info');
      return;
    }

    const confirmed = await deps.confirm({
      title: '批量打开未读',
      message: unread.length > MAX_UNREAD_BATCH_OPEN_COUNT
        ? buildBatchOpenConfirmMessage(`当前页共有 ${unread.length} 个未读作品，本次将打开前 ${targets.length} 个新标签页，并标记为已读，继续吗？`)
        : buildBatchOpenConfirmMessage(`将打开 ${targets.length} 个未读作品的新标签页，并标记为已读，继续吗？`),
      confirmText: '继续',
      cancelText: '取消',
      type: 'warning',
      isHtml: true,
    });
    if (!confirmed) return;

    for (const work of targets) {
      try {
        await deps.openWorkUrl(work.javdbUrl);
      } catch (error) {
        deps.logWarn('打开标签页失败:', error);
      }
    }

    try {
      await deps.markAsRead(targets.map(work => work.id));
    } catch (error) {
      deps.logWarn('批量标记已读失败:', error);
    }

    deps.startCooldown();
    await deps.render();
    deps.showMessage(`已打开 ${targets.length} 个未读作品并标为已读`, 'success');
  } catch (error) {
    deps.logError('批量打开未读失败:', error);
    deps.showMessage('批量打开失败，请重试', 'error');
  } finally {
    deps.updateButton();
  }
}

function buildBatchOpenConfirmMessage(summary: string): string {
  return `<p>${summary}</p><p style="margin: 12px 0 0; padding: 10px 12px; border-left: 3px solid var(--warning, #d97706); background: color-mix(in srgb, var(--warning, #d97706) 12%, transparent); color: var(--warning, #d97706); line-height: 1.55;"><strong>性能提示：</strong>${NEW_WORKS_BATCH_OPEN_PERFORMANCE_NOTICE}</p>`;
}
