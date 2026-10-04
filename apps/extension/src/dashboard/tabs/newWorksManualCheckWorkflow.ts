import type { NewWorksProgressData } from './newWorksProgressRuntime';
import type {
  NewWorksManualBreakdown,
  NewWorksManualConfirmSource,
  NewWorksManualPendingWork,
} from './newWorksManualConfirmViewModel';

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
  /** 新链（后台带 confirmRequired）返回：已收集但尚未入库的完整记录 */
  pendingWorks?: NewWorksManualPendingWork[];
  /** 新链返回：按规则剔除的六桶分项 */
  breakdown?: NewWorksManualBreakdown;
  /** 新链返回：已在（或本来就在）新作品库的条数 */
  existingCount?: number;
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
  /** 注入则走「收集-确认-入库」新链；缺省=旧当场直写语义（其它调用方不受影响） */
  confirmAndCommit?(source: NewWorksManualConfirmSource): Promise<void>;
  /** 流程结束通知后台扫描状态机消费确认（terminal 才清，running 不动；缺省不通知） */
  ackScanState?: () => void;
  /** 10-19：新链确认流程收口后清 SW 持久化的 pending 批次（fire-and-forget；仅新链实跑时发，缺省不发） */
  consumePendingBatch?: () => void;
}

export interface RunNewWorksManualCheckWorkflowInput {
  deps: NewWorksManualCheckWorkflowDeps;
}

export async function runNewWorksManualCheckWorkflow(input: RunNewWorksManualCheckWorkflowInput): Promise<void> {
  const { deps } = input;

  // 10-19：确认流程是否实跑（收口后须清 SW 持久化批次；旧链/失败路径不清）
  let confirmFlowRan = false;

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

    const result = response.result || {};
    const errors = Array.isArray(result.errors) ? result.errors : [];

    // 后台回收了 pendingWorks 且页面接入了确认流程 = 新链；否则逐字保留旧提示语义
    if (Array.isArray(result.pendingWorks) && deps.confirmAndCommit) {
      confirmFlowRan = true;
      await commitAfterConfirm(deps, result, errors);
      deps.updateProgressUI({ done: true });
      return;
    }

    await deps.render();

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
    // 双扫描守卫拒绝不是失败：不弹通用「检查失败」（误导），只给等待提示
    if (error instanceof Error && error.message === 'manual-check-running') {
      deps.showMessage('新作品检查进行中，请等待完成', 'warn');
    } else {
      deps.logError('立即检查失败:', error);
      deps.showMessage('检查失败，请重试', 'error');
    }
  } finally {
    deps.setCheckingButtonLoading(false);
    deps.detachProgressListener();
    deps.hideProgressUIAfter(1500);
    // 后台终态消费确认（后台只清 terminal，running/未注入均安全 no-op）
    if (deps.ackScanState) {
      try { deps.ackScanState(); } catch {}
    }
    // 10-19：确认流程收口后清 SW 持久化批次（含异常收口；与现状 live 语义一致——失败也不重弹）
    if (confirmFlowRan && deps.consumePendingBatch) {
      try { deps.consumePendingBatch(); } catch {}
    }
  }
}

/**
 * 新链收尾：检查错误先单独 toast（避免混进弹窗的分项口径），再交给确认弹窗决定是否入库。
 * 列表渲染由确认流程负责，这里不重复 render。
 */
async function commitAfterConfirm(
  deps: NewWorksManualCheckWorkflowDeps,
  result: NewWorksManualCheckResult,
  errors: string[],
): Promise<void> {
  if (errors.length > 0) {
    deps.logWarn('新作品检查错误详情:', errors);
    deps.showMessage(buildManualCheckErrorsMessage(errors), 'warn');
  }
  await deps.confirmAndCommit?.({
    cancelled: result.cancelled === true,
    identifiedTotal: result.identifiedTotal,
    existingCount: result.existingCount,
    breakdown: result.breakdown,
    pendingWorks: result.pendingWorks,
  });
}

function buildManualCheckErrorsMessage(errors: string[]): string {
  const firstError = errors[0];
  if (errors.length === 1) {
    return `部分演员检查失败：${firstError}，详情见控制台`;
  }
  return `部分演员检查失败：${firstError}（共 ${errors.length} 个错误，详情见控制台）`;
}

function buildManualCheckStatsTail(result: NewWorksManualCheckResult, discovered: number): string {
  const parts: string[] = [];
  if (typeof result.identifiedTotal === 'number') {
    parts.push(`已识别 ${result.identifiedTotal}`);
  }
  if (typeof result.effectiveTotal === 'number') {
    parts.push(`可入库 ${result.effectiveTotal}`);
  }
  parts.push(`新增 ${discovered}`);
  if (typeof result.savedTotal === 'number' && result.savedTotal < discovered) {
    parts.push(`持久化 ${result.savedTotal}/${discovered}`);
  }
  return parts.join('，');
}
