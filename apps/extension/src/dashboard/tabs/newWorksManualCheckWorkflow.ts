import type { NewWorksProgressData } from './newWorksProgressRuntime';

type MessageType = 'success' | 'error' | 'info' | 'warn' | 'warning';

export interface NewWorksManualCheckSubscription {
  enabled?: boolean;
}

export interface NewWorksManualCheckResult {
  identifiedTotal?: number;
  effectiveTotal?: number;
  discovered?: number;
  cancelled?: boolean;
  errors?: string[];
  /** 实际持久化到 IndexedDB 的数量（undefined 表示旧版后台未上报） */
  savedTotal?: number;
  /** 持久化失败的数量 */
  failedTotal?: number;
}

export interface NewWorksManualCheckResponse {
  success?: boolean;
  error?: string;
  result?: NewWorksManualCheckResult;
}

export interface NewWorksManualCheckWorkflowDeps {
  setCheckingButtonLoading(loading: boolean): void;
  getSubscriptions(): Promise<NewWorksManualCheckSubscription[]>;
  ensureProgressUI(): void;
  updateProgressUI(data: NewWorksProgressData): void;
  attachProgressListener(): void;
  detachProgressListener(): void;
  hideProgressUIAfter(ms: number): void;
  sendManualCheck(): Promise<NewWorksManualCheckResponse>;
  render(): Promise<void>;
  showMessage(message: string, type: MessageType): void;
  logWarn(message: string, error: unknown): void;
  logError(message: string, error: unknown): void;
}

export interface RunNewWorksManualCheckWorkflowInput {
  deps: NewWorksManualCheckWorkflowDeps;
}

export async function runNewWorksManualCheckWorkflow(input: RunNewWorksManualCheckWorkflowInput): Promise<void> {
  const { deps } = input;

  try {
    deps.setCheckingButtonLoading(true);

    const subscriptions = await deps.getSubscriptions();
    const activeSubscriptions = subscriptions.filter(subscription => subscription.enabled);
    if (activeSubscriptions.length === 0) {
      deps.showMessage('没有活跃的订阅演员，请先添加订阅', 'warn');
      return;
    }

    deps.ensureProgressUI();
    deps.updateProgressUI({
      processed: 0,
      total: activeSubscriptions.length,
      identifiedTotal: 0,
      effectiveTotal: 0,
    });
    deps.attachProgressListener();

    const response = await deps.sendManualCheck();
    if (!response.success) {
      throw new Error(response.error || '检查失败');
    }

    await deps.render();

    const result = response.result || {};
    const errors = Array.isArray(result.errors) ? result.errors : [];
    const discovered = typeof result.discovered === 'number' ? result.discovered : 0;
    const failedTotal = typeof result.failedTotal === 'number' ? result.failedTotal : 0;
    const statsTail = buildManualCheckStatsTail(result, discovered);
    let message = result.cancelled
      ? `检查已取消（${statsTail}，已保留已获取数据）`
      : `检查完成！${statsTail}`;

    if (errors.length > 0) {
      const firstError = errors[0];
      if (errors.length === 1) {
        message += `，错误：${firstError}`;
      } else {
        message += `，错误：${firstError}（共${errors.length}个错误，详情请查看控制台）`;
      }
      deps.logWarn('新作品检查错误详情:', errors);
    }

    const persistFailed = failedTotal > 0;
    deps.showMessage(
      message,
      persistFailed ? 'warn' : (discovered > 0 ? 'success' : (errors.length > 0 ? 'warn' : 'info')),
    );
    deps.updateProgressUI({ done: true });
  } catch (error) {
    deps.logError('立即检查失败:', error);
    deps.showMessage('检查失败，请重试', 'error');
  } finally {
    deps.setCheckingButtonLoading(false);
    deps.detachProgressListener();
    deps.hideProgressUIAfter(1500);
  }
}

function buildManualCheckStatsTail(result: NewWorksManualCheckResult, discovered: number): string {
  const parts: string[] = [];
  if (typeof result.identifiedTotal === 'number') {
    parts.push(`已识别 ${result.identifiedTotal}`);
  }
  if (typeof result.effectiveTotal === 'number') {
    parts.push(`有效 ${result.effectiveTotal}`);
  }
  parts.push(`新增 ${discovered}`);
  if (typeof result.savedTotal === 'number' && result.savedTotal < discovered) {
    parts.push(`持久化 ${result.savedTotal}/${discovered}`);
  }
  return parts.join('，');
}
