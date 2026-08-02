/**
 * @file logController.ts
 * @description 日志控制器兼容入口 —— 将日志控制实现桥接到 platform/logging
 * @module utils（旧路径保留，实际实现在 platform/logging/logController）
 *
 * 职责：初始化日志控制器、加载用户配置、将日志持久化到 background
 */

import { LogController, type LogControllerConfig, type LogEntry } from '../platform/logging/logController';
import { enqueuePersistentLog } from '../platform/logging/persistentLogQueue';
import { getSettings } from './storage';

function persistLog(entry: LogEntry): void {
  // consoleProxy 已经负责持久化；这里仅为未安装代理的旧上下文保留兜底。
  if ((globalThis as { __JDB_CONSOLE__?: unknown }).__JDB_CONSOLE__) return;
  enqueuePersistentLog(entry);
}

async function loadLogControllerConfig(): Promise<Partial<LogControllerConfig>> {
  const settings = await getSettings();
  return {
    verboseMode: settings.logging?.verboseMode || false,
    showPrivacyLogs: settings.logging?.showPrivacyLogs || false,
    showStorageLogs: settings.logging?.showStorageLogs || false,
    suppressConsoleOutput: (settings.logging as any)?.suppressConsoleOutput || false,
  };
}

const logController = new LogController({ persistLog });

setTimeout(() => {
  logController.initialize(loadLogControllerConfig).catch(console.error);
}, 100);

export { logController };
export type { LogControllerConfig };

export const log = {
  verbose: (message: string, ...args: any[]) => logController.verbose(message, ...args),
  privacy: (message: string, ...args: any[]) => logController.privacy(message, ...args),
  storage: (message: string, ...args: any[]) => logController.storage(message, ...args),
  debug: (category: 'privacy' | 'storage' | 'verbose', message: string, ...args: any[]) =>
    logController.debug(category, message, ...args),
  info: (message: string, ...args: any[]) => logController.info(message, ...args),
  warn: (message: string, ...args: any[]) => logController.warn(message, ...args),
  error: (message: string, ...args: any[]) => logController.error(message, ...args),
};

export async function updateLogControllerConfig(): Promise<void> {
  try {
    const settings = await getSettings();
    logController.updateConfig({
      verboseMode: settings.logging?.verboseMode || false,
      showPrivacyLogs: settings.logging?.showPrivacyLogs || false,
      showStorageLogs: settings.logging?.showStorageLogs || false,
      suppressConsoleOutput: (settings.logging as any)?.suppressConsoleOutput || false,
    });

    try {
      const globalObj: any = typeof window !== 'undefined' ? window : globalThis;
      const consoleControl = globalObj.__JDB_CONSOLE__;
      if (consoleControl && settings.logging) {
        if ((settings.logging as any).consoleLevel) {
          consoleControl.setLevel((settings.logging as any).consoleLevel);
        }

        if ((settings.logging as any).consoleFormat) {
          consoleControl.setFormat((settings.logging as any).consoleFormat);
        }

        const modules = (settings.logging as any).logModules || {};
        const categories = (settings.logging as any).consoleCategories || {};
        const allModules = { ...categories, ...modules };

        for (const [key, enabled] of Object.entries(allModules)) {
          if (enabled) {
            consoleControl.enable(key);
          } else {
            consoleControl.disable(key);
          }
        }
      }
    } catch (error) {
      console.warn('[LogController] 更新 consoleProxy 配置失败:', error);
    }
  } catch (error) {
    console.error('Failed to update log controller config:', error);
  }
}

export function onSettingsChanged(): void {
  updateLogControllerConfig();
}
