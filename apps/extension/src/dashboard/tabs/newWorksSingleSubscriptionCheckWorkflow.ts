import type { ActorSubscription } from '../../types';
import type {
  NewWorksManualBreakdown,
  NewWorksManualConfirmSource,
  NewWorksManualPendingWork,
} from './newWorksManualConfirmViewModel';

type MessageType = 'success' | 'error' | 'info' | 'warn' | 'warning';

export interface SingleSubscriptionCheckResult {
  identified?: number;
  effective?: number;
  discovered?: number;
  /** 实际持久化到 IndexedDB 的数量（undefined 表示旧版后台未上报） */
  saved?: number;
  /** 持久化失败的数量 */
  failed?: number;
  /** 已在（或本来就在）新作品库的条数 */
  existingCount?: number;
  /** 新链（后台带 confirmRequired）返回：已收集但尚未入库的完整记录 */
  pendingWorks?: NewWorksManualPendingWork[];
  /** 新链返回：按规则剔除的六桶分项 */
  breakdown?: NewWorksManualBreakdown;
}

export interface SingleSubscriptionCheckResponse {
  success?: boolean;
  error?: string;
  result?: SingleSubscriptionCheckResult;
}

export interface SingleSubscriptionCheckWorkflowDeps {
  sendSingleActorCheck(subscription: ActorSubscription): Promise<SingleSubscriptionCheckResponse>;
  render(): Promise<void>;
  showMessage(message: string, type: MessageType): void;
  logError(message: string, error: unknown): void;
  /** 注入则走「收集-确认-入库」新链；缺省=旧当场直写语义（演员页等其它调用方不受影响） */
  confirmAndCommit?(source: NewWorksManualConfirmSource): Promise<void>;
}

export interface RunSingleSubscriptionCheckWorkflowInput {
  subscription: ActorSubscription;
  button: HTMLButtonElement;
  deps: SingleSubscriptionCheckWorkflowDeps;
}

export async function runSingleSubscriptionCheckWorkflow(input: RunSingleSubscriptionCheckWorkflowInput): Promise<void> {
  const { subscription, button, deps } = input;
  const originalHtml = button.innerHTML;
  button.disabled = true;
  button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

  try {
    deps.showMessage(`已开始检查 ${subscription.actorName}`, 'info');

    const response = await deps.sendSingleActorCheck(subscription);
    if (!response?.success) {
      throw new Error(response?.error || '检查失败');
    }

    const result = response.result || {};
    const discovered = result.discovered || 0;

    // 新链：后台只收集未入库，是否落库由确认弹窗决定（列表渲染与 toast 也由其负责）
    if (Array.isArray(result.pendingWorks) && deps.confirmAndCommit) {
      await deps.confirmAndCommit({
        identifiedTotal: result.identified,
        existingCount: result.existingCount,
        breakdown: result.breakdown,
        pendingWorks: result.pendingWorks,
      });
      return;
    }

    const statsParts: string[] = [];
    if (typeof result.identified === 'number') {
      statsParts.push(`识别 ${result.identified}`);
    }
    if (typeof result.effective === 'number') {
      statsParts.push(`可入库 ${result.effective}`);
    }
    statsParts.push(`新增 ${discovered}`);

    // 持久化真实性校验：后台上报了 saved/failed 时按真实保存数提示
    let messageType: MessageType = discovered > 0 ? 'success' : 'info';
    let persistTail = '';
    if (typeof result.saved === 'number') {
      const failed = result.failed || 0;
      if (failed > 0) {
        messageType = 'error';
        persistTail = `，持久化失败（仅保存 ${result.saved}/${discovered}，详见控制台）`;
      } else if (result.saved < discovered) {
        messageType = discovered > 0 ? 'warning' : 'info';
        persistTail = `，已保存 ${result.saved}/${discovered}`;
      }
    }

    await deps.render();
    deps.showMessage(
      `${subscription.actorName}: ${statsParts.join('，')}${persistTail}`,
      messageType,
    );
  } catch (error) {
    deps.logError(`检查演员 ${subscription.actorName} 失败:`, error);
    deps.showMessage(`检查 ${subscription.actorName} 失败: ${(error as Error).message}`, 'error');
  } finally {
    button.disabled = false;
    button.innerHTML = originalHtml;
  }
}
