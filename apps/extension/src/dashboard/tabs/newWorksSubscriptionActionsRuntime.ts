import type { ActorRecord, ActorSubscription } from '../../types';
import type { NewWorksManualConfirmSource } from './newWorksManualConfirmViewModel';
import {
  runAddSubscriptionWorkflow,
} from './newWorksAddSubscriptionWorkflow';
import {
  runManageSubscriptionsWorkflow,
} from './newWorksManageSubscriptionsWorkflow';
import {
  runSingleSubscriptionCheckWorkflow,
  type SingleSubscriptionCheckResponse,
} from './newWorksSingleSubscriptionCheckWorkflow';
import {
  openSubscriptionManagementModal as openSubscriptionManagementModalRuntime,
  type SubscriptionManagementModalDeps,
} from './newWorksSubscriptionModalRuntime';

type MessageType = 'success' | 'error' | 'info' | 'warn' | 'warning';

export interface NewWorksSubscriptionActionsRuntimeDeps {
  initialize(): Promise<void>;
  getSubscriptions(): Promise<ActorSubscription[]>;
  showActorSelector(subscribedIds: string[], onSelected: (selectedActors: ActorRecord[]) => Promise<void>): void;
  addSubscription(actorId: string): Promise<void>;
  getGlobalSubscriptionsForModal(): Promise<ActorSubscription[]>;
  openSubscriptionManagementModal?(subscriptions: ActorSubscription[], deps: SubscriptionManagementModalDeps): void;
  toggleSubscription(actorId: string, enabled: boolean): Promise<void>;
  removeSubscription(actorId: string): Promise<void>;
  confirmRemove(actorName: string): Promise<boolean>;
  sendSingleActorCheck(subscription: ActorSubscription): Promise<SingleSubscriptionCheckResponse>;
  render(): Promise<void>;
  showMessage(message: string, type: MessageType): void;
  logInfo(message: string, data?: unknown): void;
  logError(message: string, error: unknown): void;
  /** 透传给单演员检查流程：注入=走「收集-确认-入库」新链 */
  confirmAndCommit?(source: NewWorksManualConfirmSource): Promise<void>;
}

export interface NewWorksSubscriptionActionsRuntime {
  showAddSubscriptionModal(): Promise<void>;
  showManageSubscriptionsModal(): Promise<void>;
  showSubscriptionManagementModal(subscriptions: ActorSubscription[]): void;
  handleSingleSubscriptionCheck(subscription: ActorSubscription, button: HTMLButtonElement): Promise<void>;
}

export function createNewWorksSubscriptionActionsRuntime(
  deps: NewWorksSubscriptionActionsRuntimeDeps,
): NewWorksSubscriptionActionsRuntime {
  const runtime: NewWorksSubscriptionActionsRuntime = {
    showAddSubscriptionModal: async () => {
      await runAddSubscriptionWorkflow({
        deps: {
          initialize: deps.initialize,
          getSubscriptions: deps.getSubscriptions,
          showActorSelector: deps.showActorSelector,
          addSubscription: deps.addSubscription,
          render: deps.render,
          showMessage: deps.showMessage,
          logInfo: deps.logInfo,
          logError: deps.logError,
        },
      });
    },

    showManageSubscriptionsModal: async () => {
      await runManageSubscriptionsWorkflow({
        deps: {
          getSubscriptions: deps.getGlobalSubscriptionsForModal,
          openSubscriptionManagementModal: subscriptions => runtime.showSubscriptionManagementModal(subscriptions),
          showMessage: deps.showMessage,
          logError: deps.logError,
        },
      });
    },

    showSubscriptionManagementModal: subscriptions => {
      const openModal = deps.openSubscriptionManagementModal || openSubscriptionManagementModalRuntime;
      openModal(subscriptions, {
        showAddSubscriptionModal: () => {
          void runtime.showAddSubscriptionModal();
        },
        toggleSubscription: deps.toggleSubscription,
        removeSubscription: deps.removeSubscription,
        confirmRemove: deps.confirmRemove,
        render: deps.render,
        showMessage: deps.showMessage,
        handleSingleSubscriptionCheck: runtime.handleSingleSubscriptionCheck,
        logInfo: message => deps.logInfo(message),
        logError: deps.logError,
      });
    },

    handleSingleSubscriptionCheck: async (subscription, button) => {
      await runSingleSubscriptionCheckWorkflow({
        subscription,
        button,
        deps: {
          sendSingleActorCheck: deps.sendSingleActorCheck,
          render: deps.render,
          showMessage: deps.showMessage,
          logError: deps.logError,
          confirmAndCommit: deps.confirmAndCommit,
        },
      });
    },
  };

  return runtime;
}
