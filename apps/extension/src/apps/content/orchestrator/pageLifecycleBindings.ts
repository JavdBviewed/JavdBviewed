/**
 * @file pageLifecycleBindings.ts
 * @description 页面生命周期绑定 —— 在 pagehide/beforeunload 时发送编排器取消通知和指标保存
 * @module apps/content
 */
import type { getPageContext } from '../../../platform/browser';

type OrchestratorWithMetrics = {
  getMetrics(): object;  // 获取编排器指标
  dispose?: () => void;
};

type ChromeRuntimeLike = {
  sendMessage?: (message: unknown) => void;  // 跨上下文消息发送
};

type PageLifecycleWindowLike = {
  location?: { href?: string };
  addEventListener?: (event: string, listener: () => void) => void;
  __initOrchestrator__?: unknown;  // 挂载编排器实例供外部访问
};

type LoggerLike = {
  log?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
};

export type InstallOrchestratorPageLifecycleBindingsOptions = {
  windowRef?: PageLifecycleWindowLike;            // window 对象引用（可注入用于测试）
  chromeRuntime?: ChromeRuntimeLike;              // chrome.runtime 接口
  getPageContextFn: typeof getPageContext;        // 获取当前页面上下文
  now?: () => number;                             // 时间戳函数（可注入用于测试）
  logger?: LoggerLike;                            // 日志接口
};

/**
 * 安装编排器页面生命周期绑定
 * - pagehide → 发送 task-center:page-lifecycle 取消通知
 * - beforeunload → 保存编排器指标到 background
 */

export function installOrchestratorPageLifecycleBindings(
  orchestrator: OrchestratorWithMetrics,
  options: InstallOrchestratorPageLifecycleBindingsOptions,
): void {
  try {
    const windowRef = options.windowRef;
    if (!windowRef || typeof windowRef.addEventListener !== 'function') return;

    windowRef.__initOrchestrator__ = orchestrator;

    const chromeRuntime = options.chromeRuntime;
    const now = options.now || Date.now;
    const logger = options.logger || console;

    const notifyPageLifecycleCancel = (reason: string) => {
      try {
        const pageContext = options.getPageContextFn();
        logger.log?.('[Orchestrator] Page lifecycle cancel', {
          reason,
          pageUrl: pageContext.pageUrl,
          pageInstanceId: pageContext.pageInstanceId,
        });
        chromeRuntime?.sendMessage?.({
          type: 'task-center:page-lifecycle',
          payload: {
            pageInstanceId: pageContext.pageInstanceId,
            reason,
          },
        });
      } catch {}
    };

    windowRef.addEventListener('pagehide', () => {
      notifyPageLifecycleCancel('page-refresh-replaced');
      orchestrator.dispose?.();
    });

    windowRef.addEventListener('beforeunload', () => {
      try {
        const pageUrl = windowRef.location?.href || '';
        const metrics = {
          ...orchestrator.getMetrics(),
          pageUrl,
          timestamp: now(),
        };

        chromeRuntime?.sendMessage?.({
          type: 'orchestrator:saveMetrics',
          metrics,
        });
      } catch (e) {
        logger.warn?.('[Orchestrator] Failed to save metrics on unload:', e);
      }
    });
  } catch {}
}
