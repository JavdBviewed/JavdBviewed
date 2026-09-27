import {
  buildActorMetadataRefreshToast,
  type ActorMetadataRefreshResult,
} from './metadataRefreshModel';

export type ActorCardToastType = 'success' | 'error' | 'info' | 'warning';

export interface ActorCardRuntimeHandlers {
  copyActorName(actorId: string, actorName: string, event: Event): void | Promise<void>;
  openActorWorks(actorId: string): void | Promise<void>;
  editActorSourceData(actorId: string): void | Promise<void>;
  refreshActorMetadata(actorId: string): Promise<ActorMetadataRefreshResult>;
  deleteActor(actorId: string): void | Promise<void>;
  toggleBlacklisted(actorId: string, isBlacklisted: boolean): Promise<void>;
  toggleFavorited(actorId: string, isFavorited: boolean): Promise<void>;
  toggleAliasesExpansion(actorId: string): void;
  checkAliasesOverflow(actorId: string): void;
  addSubscription(actorId: string): Promise<void>;
  removeSubscription(actorId: string): Promise<void>;
  isSubscribedOnly(): boolean;
  reloadActors(): Promise<void>;
  showMessage(message: string, type: ActorCardToastType): void;
  logError(context: string, error: unknown): void;
}

export function setupActorCardRuntime(
  actorId: string,
  handlers: ActorCardRuntimeHandlers,
  root: ParentNode = document,
): void {
  bindCopyElement(root.querySelector(`[data-actor-id="${actorId}"].actor-card-name`), handlers);
  root.querySelectorAll(`[data-actor-id="${actorId}"].actor-alias`).forEach(aliasElement => {
    bindCopyElement(aliasElement, handlers);
  });

  bindActorButton(root, actorId, '.actor-works-btn', handlers.openActorWorks);
  bindActorButton(root, actorId, '.actor-edit-btn', handlers.editActorSourceData);
  bindActorButton(root, actorId, '.actor-delete-btn', handlers.deleteActor);
  bindRefreshButton(root, actorId, handlers);
  bindBlacklistButton(root, actorId, handlers);
  bindFavoriteButton(root, actorId, handlers);
  bindAliasToggleButton(root, actorId, handlers);
  bindSubscriptionButton(root, actorId, handlers);

  handlers.checkAliasesOverflow(actorId);
}

function bindCopyElement(element: Element | null, handlers: ActorCardRuntimeHandlers): void {
  element?.addEventListener('click', (event) => {
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    handlers.copyActorName(target.dataset.actorId!, target.dataset.actorName!, event);
  });
}

function bindActorButton(
  root: ParentNode,
  actorId: string,
  selector: string,
  handler: (actorId: string) => void | Promise<void>,
): void {
  const button = root.querySelector(`[data-actor-id="${actorId}"]${selector}`);
  button?.addEventListener('click', (event) => {
    event.preventDefault();
    const targetActorId = (event.currentTarget as HTMLElement).dataset.actorId!;
    handler(targetActorId);
  });
}

function bindRefreshButton(root: ParentNode, actorId: string, handlers: ActorCardRuntimeHandlers): void {
  const refreshBtn = root.querySelector(`[data-actor-id="${actorId}"].actor-refresh-btn`) as HTMLButtonElement | null;
  refreshBtn?.addEventListener('click', async (event) => {
    event.preventDefault();
    const btn = event.currentTarget as HTMLButtonElement;
    const targetActorId = btn.dataset.actorId!;

    if (btn.classList.contains('refreshing')) return;

    try {
      btn.classList.add('refreshing');
      btn.disabled = true;

      const result = await handlers.refreshActorMetadata(targetActorId);
      const toast = buildActorMetadataRefreshToast(result);
      handlers.showMessage(toast.message, toast.type);
    } catch (error) {
      handlers.logError('[Actor] 刷新元数据失败:', error);
      handlers.showMessage('刷新元数据失败', 'error');
    } finally {
      btn.classList.remove('refreshing');
      btn.disabled = false;
    }
  });
}

function bindBlacklistButton(root: ParentNode, actorId: string, handlers: ActorCardRuntimeHandlers): void {
  const blacklistBtn = root.querySelector(`[data-actor-id="${actorId}"].actor-blacklist-toggle-btn`);
  blacklistBtn?.addEventListener('click', async (event) => {
    event.preventDefault();
    const targetActorId = (event.currentTarget as HTMLElement).dataset.actorId!;
    const actorCard = root.querySelector(`[data-actor-id="${actorId}"].actor-card`) as HTMLElement | null;
    const isBlacklisted = actorCard?.dataset.blacklisted === 'true';

    try {
      await handlers.toggleBlacklisted(targetActorId, isBlacklisted);
    } catch (error) {
      handlers.logError('[Actor] 切换黑名单状态失败:', error);
      handlers.showMessage('切换黑名单状态失败', 'error');
    }
  });
}

function bindFavoriteButton(root: ParentNode, actorId: string, handlers: ActorCardRuntimeHandlers): void {
  const favoriteBtn = root.querySelector(`[data-actor-id="${actorId}"].actor-favorite-toggle-btn`);
  favoriteBtn?.addEventListener('click', async (event) => {
    event.preventDefault();
    const targetActorId = (event.currentTarget as HTMLElement).dataset.actorId!;
    const actorCard = root.querySelector(`[data-actor-id="${actorId}"].actor-card`) as HTMLElement | null;
    // 卡片 data-fav 缺省时按「已收藏」处理（与 favorited 缺省 = 已收藏口径一致）
    const isFavorited = actorCard?.dataset.fav !== '0';

    try {
      await handlers.toggleFavorited(targetActorId, isFavorited);
    } catch (error) {
      handlers.logError('[Actor] 切换收藏状态失败:', error);
      handlers.showMessage('切换收藏状态失败', 'error');
    }
  });
}

function bindAliasToggleButton(root: ParentNode, actorId: string, handlers: ActorCardRuntimeHandlers): void {
  const toggleBtn = root.querySelector(`[data-actor-id="${actorId}"].aliases-toggle-btn`);
  toggleBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const targetActorId = (event.currentTarget as HTMLElement).dataset.actorId!;
    handlers.toggleAliasesExpansion(targetActorId);
  });
}

function bindSubscriptionButton(root: ParentNode, actorId: string, handlers: ActorCardRuntimeHandlers): void {
  const subBtn = root.querySelector(`[data-actor-id="${actorId}"].actor-subscribe-toggle-btn`) as HTMLButtonElement | null;
  subBtn?.addEventListener('click', async (event) => {
    event.preventDefault();
    const btn = event.currentTarget as HTMLButtonElement;
    if (btn.getAttribute('data-busy') === '1') return;

    btn.setAttribute('data-busy', '1');
    const targetActorId = btn.dataset.actorId!;
    const wasSub = btn.dataset.sub === '1';

    try {
      if (!wasSub) {
        await handlers.addSubscription(targetActorId);
        setSubscriptionButtonState(btn, true);
        handlers.showMessage('已订阅该演员的新作品', 'success');
      } else {
        await handlers.removeSubscription(targetActorId);
        setSubscriptionButtonState(btn, false);
        handlers.showMessage('已取消订阅该演员', 'success');
      }

      if (handlers.isSubscribedOnly()) {
        await handlers.reloadActors();
      }
    } catch (error: any) {
      const message = error?.message || String(error);
      if (!wasSub && /已经订阅/.test(message)) {
        setSubscriptionButtonState(btn, true);
        handlers.showMessage('该演员已在订阅列表', 'info');
        if (handlers.isSubscribedOnly()) {
          await handlers.reloadActors();
        }
      } else {
        handlers.logError('[Actor] 切换订阅失败:', error);
        handlers.showMessage('操作失败，请重试', 'error');
      }
    } finally {
      btn.removeAttribute('data-busy');
    }
  });
}

function setSubscriptionButtonState(btn: HTMLButtonElement, isSubscribed: boolean): void {
  const icon = btn.querySelector('i');
  btn.dataset.sub = isSubscribed ? '1' : '0';
  btn.title = isSubscribed ? '取消订阅' : '订阅';

  if (!icon) return;

  if (isSubscribed) {
    icon.classList.remove('fa-bell');
    icon.classList.add('fa-bell-slash');
  } else {
    icon.classList.remove('fa-bell-slash');
    icon.classList.add('fa-bell');
  }
}
