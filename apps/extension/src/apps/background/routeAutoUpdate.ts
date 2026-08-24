/**
 * @file routeAutoUpdate.ts
 * @description routeAutoUpdate
 * @module apps/background
 */
import { registerDynamicContentScripts } from './dynamicContentScripts';

export async function autoUpdateRoutes(): Promise<void> {
  try {
    // 用 WorkerGlobalScope/ServiceWorkerGlobalScope 判断真实 SW 上下文，
    // 避免被 swGlobalsGuard 安装的惰性 document 垫片误导。
    const g = globalThis as unknown as {
      WorkerGlobalScope?: new (...args: unknown[]) => unknown;
      ServiceWorkerGlobalScope?: new (...args: unknown[]) => unknown;
    };
    const selfRef = self as unknown;
    const isRealSw =
      (typeof g.WorkerGlobalScope !== 'undefined' && selfRef instanceof g.WorkerGlobalScope) ||
      (typeof g.ServiceWorkerGlobalScope !== 'undefined' && selfRef instanceof g.ServiceWorkerGlobalScope);
    if (!isRealSw && typeof document !== 'undefined') {
      console.info('[Background] 检测到 document，上下文可能不是 Service Worker');
    }
    const { RouteManager } = await import('../../features/routeManagement');
    const routeManager = RouteManager.getInstance();
    const updated = await routeManager.checkAndUpdateRoutes(false);

    if (updated) {
      console.info('[Background] 线路配置已自动更新');
      await registerDynamicContentScripts();
    }
  } catch (e: any) {
    const message = e?.message || String(e);
    console.warn('[Background] 自动更新线路配置失败:', message);
    console.warn('[Background] 自动更新线路配置错误详情:', e);
  }
}

export function initializeRouteAutoUpdate(): void {
  autoUpdateRoutes();
}
