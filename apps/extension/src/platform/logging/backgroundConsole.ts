/**
 * @file backgroundConsole.ts
 * @description Background 控制台代理安装器 —— 从用户设置加载日志配置并应用到控制台代理
 * @module platform/logging
 *
 * 在 Service Worker 启动时调用，先用默认配置安装代理，再异步读取用户设置覆盖。
 */

import { installConsoleProxy } from './consoleProxy';
import { getSettings } from '../../utils/storage';
import { STORAGE_KEYS } from '../../utils/config';

export function installConsoleProxyWithSettings(): void {
  // 安装统一控制台代理（仅控制显示层，不改变入库逻辑）
  installConsoleProxy({
    level: 'INFO',
    format: { showTimestamp: true, timestampStyle: 'hms', timeZone: 'Asia/Shanghai', showSource: true, color: true },
    categories: {
      general: { enabled: true, match: () => true, label: 'BG', color: '#2c3e50' },
    },
  });

  async function applyConsoleSettingsFromStorage() {
    try {
      const settings = await getSettings();
      const logging = settings.logging || ({} as any);
      const ctrl: any = (globalThis as any).__JDB_CONSOLE__;
      if (!ctrl) return;
      if (logging.consoleLevel) ctrl.setLevel(logging.consoleLevel);
      if (logging.consoleFormat) {
        ctrl.setFormat({
          showTimestamp: logging.consoleFormat.showTimestamp ?? true,
          showSource: logging.consoleFormat.showSource ?? true,
          color: logging.consoleFormat.color ?? true,
          timeZone: logging.consoleFormat.timeZone || 'Asia/Shanghai',
        });
      }
      
      // 应用日志模块配置（优先使用 logModules，向后兼容 consoleCategories）
      const modules = logging.logModules || logging.consoleCategories || {};
      const cfg = ctrl.getConfig();
      const allKeys = Object.keys(cfg?.categories || {});
      for (const key of allKeys) {
        const flag = modules[key];
        if (flag === false) ctrl.disable(key);
        else if (flag === true) ctrl.enable(key);
      }
    } catch (e) {
      console.warn('[ConsoleProxy] Failed to apply settings in BG:', e);
    }
  }

  // 立即应用一次
  try { applyConsoleSettingsFromStorage(); } catch {}

  // 设置变更时动态应用
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[STORAGE_KEYS.SETTINGS]) {
          try { applyConsoleSettingsFromStorage(); } catch {}
        }
      });
    }
  } catch {}
}
