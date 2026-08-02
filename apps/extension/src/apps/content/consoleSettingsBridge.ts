/**
 * @file consoleSettingsBridge.ts
 * @description consoleSettingsBridge
 * @module apps/content
 */
import { getSettings } from '../../utils/storage';
import { installConsoleProxy } from '../../platform/logging/consoleProxy';
import {
    getActiveManagedTaskIds,
    installTaskHeartbeatReporter,
    installTaskVisibilityReporter,
} from '../../platform/tasks';

async function applyConsoleSettingsFromStorage(): Promise<void> {
    try {
        const settings = await getSettings();
        const logging: any = settings.logging || {};
        const ctrl: any = (window as any).__JDB_CONSOLE__;
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

        const modules = logging.logModules || logging.consoleCategories || {};
        const cfg = ctrl.getConfig();
        const allKeys = Object.keys(cfg?.categories || {});
        for (const key of allKeys) {
            const flag = modules[key];
            if (flag === false) ctrl.disable(key);
            else if (flag === true) ctrl.enable(key);
        }
    } catch (e) {
        console.warn('[ConsoleProxy] Failed to apply settings in CS:', e);
    }
}

export function installContentConsoleSettingsBridge(): void {
    installConsoleProxy({
        level: 'INFO',
        format: { showTimestamp: true, timestampStyle: 'hms', timeZone: 'Asia/Shanghai', showSource: true, color: true },
        categories: {
            general: { enabled: true, match: () => true, label: 'CS', color: '#27ae60' },
        },
    });

    installTaskVisibilityReporter(() => getActiveManagedTaskIds());
    installTaskHeartbeatReporter(() => getActiveManagedTaskIds());

    applyConsoleSettingsFromStorage();

    try {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes['settings']) {
                applyConsoleSettingsFromStorage();
            }
        });
    } catch {}
}
