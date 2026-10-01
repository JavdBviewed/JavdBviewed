type MaybePromise<T> = T | Promise<T>;
type MessageType = 'success' | 'error' | 'info' | 'warn' | 'warning';

export interface NewWorksButtonEventHandlers {
  checkNow(): MaybePromise<void>;
  syncStatus(): MaybePromise<void>;
  setupSyncHelp(): void;
  setupCheckNowHelp(): void;
  addSubscription(): MaybePromise<void>;
  manageSubscriptions(): MaybePromise<void>;
  confirmCleanupRead(): Promise<boolean>;
  cleanupReadWorks(): Promise<number>;
  render(): MaybePromise<void>;
  showMessage(message: string, type: MessageType): void;
  logError(message: string, error: unknown): void;
  batchOpenUnread(): MaybePromise<void>;
  updateBatchOpenUnreadButton(): void;
  selectAllCurrentPage(): void;
  clearSelection(): void;
  batchOpenSelected(): MaybePromise<void>;
  batchDeleteSelected(): MaybePromise<void>;
}

export interface NewWorksButtonEventsDeps {
  doc?: Document;
}

export function attachNewWorksButtonEvents(
  handlers: NewWorksButtonEventHandlers,
  deps: NewWorksButtonEventsDeps = {},
): void {
  const doc = deps.doc || document;

  bindClick(doc, 'checkNowBtn', handlers.checkNow, () => handlers.setupCheckNowHelp());
  bindClick(doc, 'syncStatusBtn', handlers.syncStatus, () => handlers.setupSyncHelp());
  bindClick(doc, 'addSubscriptionBtn', handlers.addSubscription);
  bindClick(doc, 'manageSubscriptionsBtn', handlers.manageSubscriptions);
  bindCleanupRead(doc, handlers);
  bindClick(doc, 'batchOpenUnreadBtn', handlers.batchOpenUnread, () => handlers.updateBatchOpenUnreadButton());
  bindClick(doc, 'selectAllCurrentPageBtn', handlers.selectAllCurrentPage);
  bindClick(doc, 'clearSelectionBtn', handlers.clearSelection, undefined, event => event.stopPropagation());
  bindClick(doc, 'batchOpenSelectedBtn', handlers.batchOpenSelected);
  bindClick(doc, 'batchDeleteSelectedBtn', handlers.batchDeleteSelected);
}

function bindClick(
  doc: Document,
  id: string,
  handler: () => MaybePromise<void>,
  onFound?: () => void,
  beforeHandler?: (event: Event) => void,
): void {
  const button = doc.getElementById(id);
  if (!button) return;

  button.addEventListener('click', async event => {
    event.preventDefault();
    beforeHandler?.(event);
    await handler();
  });
  onFound?.();
}

function bindCleanupRead(doc: Document, handlers: NewWorksButtonEventHandlers): void {
  const button = doc.getElementById('cleanupReadWorksBtn');
  if (!button) return;

  button.addEventListener('click', async event => {
    event.preventDefault();
    const confirmed = await handlers.confirmCleanupRead();
    if (!confirmed) return;

    try {
      const deleted = await handlers.cleanupReadWorks();
      await handlers.render();
      handlers.showMessage(`已清理 ${deleted} 条已读作品`, 'success');
    } catch (error) {
      handlers.logError('清理已读失败:', error);
      handlers.showMessage('清理已读失败，请重试', 'error');
    }
  });
}
