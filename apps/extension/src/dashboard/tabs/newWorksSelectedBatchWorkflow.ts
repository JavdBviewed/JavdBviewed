import {
  MAX_NEW_WORKS_BATCH_OPEN_COUNT,
  NEW_WORKS_BATCH_OPEN_PERFORMANCE_NOTICE,
} from './newWorksBatchOpenPolicy';

type MessageType = 'success' | 'error' | 'info' | 'warn' | 'warning';
type ConfirmType = 'danger' | 'warning' | 'info';

export interface NewWorksSelectedConfirmOptions {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  type: ConfirmType;
  isHtml?: boolean;
}

export interface ResolvedSelectedWork {
  id: string;
  url: string;
  isRead: boolean;
}

export interface SelectedBatchRemoteQueryResult {
  works: Array<{
    id: string;
    javdbUrl?: string;
    isRead?: boolean;
  }>;
}

export type SelectedBatchRemoteQuery = (query: { search: string }) => Promise<SelectedBatchRemoteQueryResult>;

export interface SelectedBatchOpenWorkflowDeps {
  confirm(options: NewWorksSelectedConfirmOptions): Promise<boolean>;
  setLoading(loading: boolean): void;
  getCurrentPageWork(workId: string): ResolvedSelectedWork | undefined;
  findWorkById(workId: string): Promise<ResolvedSelectedWork | undefined>;
  openWorkUrl(url: string): Promise<void>;
  markAsRead(workIds: string[]): Promise<void>;
  removeSelection(workIds: string[]): void;
  render(): Promise<void>;
  showMessage(message: string, type: MessageType): void;
  updateBatchOperations(): void;
  logWarn(message: string, error: unknown): void;
  logError(message: string, error: unknown): void;
}

export interface RunSelectedBatchOpenWorkflowInput {
  selectedIds: string[];
  deps: SelectedBatchOpenWorkflowDeps;
}

export async function runSelectedBatchOpenWorkflow(input: RunSelectedBatchOpenWorkflowInput): Promise<void> {
  const { selectedIds, deps } = input;
  if (selectedIds.length === 0) {
    deps.showMessage('未选择任何作品', 'info');
    return;
  }

  const selectedIdsToOpen = selectedIds.slice(0, MAX_NEW_WORKS_BATCH_OPEN_COUNT);
  const confirmed = await deps.confirm({
    title: '批量打开（已选）',
    message: selectedIds.length > MAX_NEW_WORKS_BATCH_OPEN_COUNT
      ? buildSelectedBatchOpenConfirmMessage(`已选 ${selectedIds.length} 个作品，本次将打开前 ${selectedIdsToOpen.length} 个新标签页，并为未读项标记为已读，继续吗？`)
      : buildSelectedBatchOpenConfirmMessage(`将打开 ${selectedIdsToOpen.length} 个已选作品的新标签页，并为未读项标记为已读，继续吗？`),
    confirmText: '继续',
    cancelText: '取消',
    type: 'warning',
    isHtml: true,
  });
  if (!confirmed) return;

  deps.setLoading(true);
  try {
    const worksToOpen = await resolveSelectedWorks(selectedIdsToOpen, deps);
    if (worksToOpen.length === 0) {
      deps.showMessage('未找到可打开的作品链接', 'warn');
      return;
    }

    for (const work of worksToOpen) {
      try {
        await deps.openWorkUrl(work.url);
      } catch (error) {
        deps.logWarn('打开标签页失败:', error);
      }
    }

    const unreadIds = worksToOpen.filter(work => !work.isRead).map(work => work.id);
    if (unreadIds.length > 0) {
      try {
        await deps.markAsRead(unreadIds);
      } catch {}
    }

    deps.removeSelection(worksToOpen.map(work => work.id));
    await deps.render();
    deps.showMessage(
      `已打开 ${worksToOpen.length} 个已选作品${unreadIds.length > 0 ? '（并标记未读为已读）' : ''}`,
      'success',
    );
  } catch (error) {
    deps.logError('批量打开（已选）失败:', error);
    deps.showMessage('批量打开失败，请重试', 'error');
  } finally {
    deps.setLoading(false);
    deps.updateBatchOperations();
  }
}

function buildSelectedBatchOpenConfirmMessage(summary: string): string {
  return `<p>${summary}</p><p style="margin: 12px 0 0; padding: 10px 12px; border-left: 3px solid var(--warning, #d97706); background: color-mix(in srgb, var(--warning, #d97706) 12%, transparent); color: var(--warning, #d97706); line-height: 1.55;"><strong>性能提示：</strong>${NEW_WORKS_BATCH_OPEN_PERFORMANCE_NOTICE}</p>`;
}

async function resolveSelectedWorks(
  selectedIds: string[],
  deps: Pick<SelectedBatchOpenWorkflowDeps, 'getCurrentPageWork' | 'findWorkById'>,
): Promise<ResolvedSelectedWork[]> {
  const worksToOpen: ResolvedSelectedWork[] = [];

  for (const id of selectedIds) {
    const cached = deps.getCurrentPageWork(id);
    if (cached) {
      worksToOpen.push(cached);
      continue;
    }

    try {
      const found = await deps.findWorkById(id);
      if (found) {
        worksToOpen.push(found);
      }
    } catch {}
  }

  return worksToOpen;
}

export async function findSelectedBatchWorkById(
  id: string,
  getNewWorks: SelectedBatchRemoteQuery,
): Promise<ResolvedSelectedWork | undefined> {
  try {
    const result = await getNewWorks({ search: id });
    const work = result.works.find(item => item.id === id);
    if (!work?.javdbUrl) {
      return undefined;
    }

    return {
      id,
      url: work.javdbUrl,
      isRead: !!work.isRead,
    };
  } catch {
    return undefined;
  }
}
