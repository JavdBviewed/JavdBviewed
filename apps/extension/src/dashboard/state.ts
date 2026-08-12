import { getValue, setValue, getSettings } from '../utils/storage';
import { STORAGE_KEYS, DEFAULT_SETTINGS } from '../utils/config';
import type { ExtensionSettings, VideoRecord, LogEntry } from '../types';
import { logAsync } from './logger';
import { showMessage } from './ui/toast';
import { getDisplayVersionInfo } from '../shared/utils/versionInfo';
import { dbViewedCount } from './dbClient';

// --- Global State & Utilities ---

export interface DashboardState {
    settings: ExtensionSettings;
    records: VideoRecord[];
    logs: LogEntry[];
    isInitialized: boolean;
}

export const STATE: DashboardState = {
    settings: DEFAULT_SETTINGS,
    records: [],
    logs: [],
    isInitialized: false,
};

export async function initializeGlobalState(): Promise<void> {
    if (STATE.isInitialized) return;

    try {
        let settings = await getSettings();

        // --- Settings Migration Logic ---
        let settingsChanged = false;

        // --- Version Sync Logic ---
        let manifestVersion = '';
        try {
            manifestVersion = chrome?.runtime?.getManifest?.().version || '';
        } catch {}
        const actualVersion = getDisplayVersionInfo({
            manifestVersion,
            env: import.meta.env,
        }).version;
        if (settings.version !== actualVersion) {
            settings.version = actualVersion;
            settingsChanged = true;
            await logAsync('INFO', `[Dashboard] 版本号已更新到: ${actualVersion}`);
        }
        // --- End Version Sync Logic ---
        if (settings.searchEngines && Array.isArray(settings.searchEngines)) {
            const migratedEngines = settings.searchEngines.map((engine: any) => {
                let currentEngine = { ...engine };
                let hasChanged = false;

                // 1. Migrate from iconUrl to icon
                if (currentEngine.iconUrl && !currentEngine.icon) {
                    currentEngine.icon = currentEngine.iconUrl;
                    delete currentEngine.iconUrl;
                    hasChanged = true;
                }

                // 2. Correct the icon path for default engines if they are using a remote URL
                // 只修复使用远程URL的图标，不要覆盖用户的自定义设置
                if (currentEngine.name === 'JavDB' && currentEngine.icon && currentEngine.icon.startsWith('http')) {
                    currentEngine.icon = 'assets/favicons/light/favicon-32x32.png';
                    hasChanged = true;
                }
                if (currentEngine.name === 'Javbus' && currentEngine.icon && currentEngine.icon.startsWith('http')) {
                    currentEngine.icon = 'assets/javbus.ico';
                    hasChanged = true;
                }

                // 3. 清理包含 example.com 的测试数据
                if (currentEngine.urlTemplate && currentEngine.urlTemplate.includes('example.com')) {
                    currentEngine.urlTemplate = 'https://www.google.com/search?q={{ID}}';
                    currentEngine.icon = chrome.runtime.getURL('assets/alternate-search.png');
                    hasChanged = true;
                }

                // 4. 修复使用 Google favicon 服务的图标
                if (currentEngine.icon && currentEngine.icon.includes('google.com/s2/favicons')) {
                    currentEngine.icon = chrome.runtime.getURL('assets/alternate-search.png');
                    hasChanged = true;
                }

                // 5. Ensure ID exists
                if (!currentEngine.id) {
                    currentEngine.id = `engine-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
                    hasChanged = true;
                }

                if(hasChanged) {
                    settingsChanged = true;
                }
                return currentEngine;
            });


            if (settingsChanged) {
                settings.searchEngines = migratedEngines;
            }

            // 6. 过滤掉任何仍然包含 example.com 的搜索引擎
            const cleanEngines = settings.searchEngines.filter((engine: any) => {
                const hasExampleDomain = engine.urlTemplate && engine.urlTemplate.includes('example.com');
                const hasGoogleFavicon = engine.icon && engine.icon.includes('google.com/s2/favicons');

                if (hasExampleDomain || hasGoogleFavicon) {
                    logAsync('INFO', '[Dashboard] 移除包含测试数据的搜索引擎', { engine });
                    settingsChanged = true;
                    return false;
                }
                return true;
            });

            if (cleanEngines.length !== settings.searchEngines.length) {
                settings.searchEngines = cleanEngines;
                settingsChanged = true;
            }
        }
        // --- End Migration Logic ---

        // Save settings if any changes were made
        if (settingsChanged) {
            await setValue(STORAGE_KEYS.SETTINGS, settings);
            await logAsync('INFO', '[Dashboard] 设置已更新并保存。');
        }

        STATE.settings = settings;

        const hasIndexedDbRecords = await dbViewedCount()
            .then(count => count > 0)
            .catch(() => false);
        if (hasIndexedDbRecords) {
            // Records tab has an IndexedDB-backed paged path. Avoid cloning the legacy full dataset at startup.
            STATE.records = [];
        } else {
            try {
                const recordsData = await getValue<Record<string, VideoRecord>>(STORAGE_KEYS.VIEWED_RECORDS, {});
                // 确保 recordsData 是对象且 Object.values 返回数组
                if (recordsData && typeof recordsData === 'object') {
                    STATE.records = Object.values(recordsData);
                } else {
                    console.warn('记录数据格式不正确:', recordsData);
                    STATE.records = [];
                }

                // 确保 STATE.records 是数组
                if (!Array.isArray(STATE.records)) {
                    console.warn('STATE.records 不是数组，重置为空数组:', STATE.records);
                    STATE.records = [];
                }
            } catch (error) {
                console.error('加载记录数据失败:', error);
                STATE.records = [];
            }
        }

        try {
            const logsData = await getValue<LogEntry[]>(STORAGE_KEYS.LOGS, []);
            // 确保 logsData 是数组
            if (Array.isArray(logsData)) {
                STATE.logs = logsData;
            } else {
                console.warn('日志数据不是数组格式:', logsData);
                STATE.logs = [];
            }
        } catch (error) {
            console.error('加载日志数据失败:', error);
            STATE.logs = [];
        }
    } catch (error: any) {
        console.error("Failed to initialize global state:", error);
        showMessage(`Failed to load settings: ${error.message}`, 'error');
        // 确保在出错时也有安全的默认值
        STATE.records = [];
        STATE.logs = [];
    }
    STATE.isInitialized = true;
    // console.log("Global state initialized.", STATE);
}

/**
 * 清理搜索引擎配置中的测试数据
 */
export async function cleanupSearchEngines(): Promise<void> {
    try {
        const settings = await getValue(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);

        if (!settings.searchEngines || !Array.isArray(settings.searchEngines)) {
            return;
        }

        const originalCount = settings.searchEngines.length;

        // 过滤掉包含测试数据的搜索引擎
        settings.searchEngines = settings.searchEngines.filter((engine: any) => {
            const hasExampleDomain = engine.urlTemplate && engine.urlTemplate.includes('example.com');
            const hasGoogleFavicon = engine.icon && engine.icon.includes('google.com/s2/favicons');

            if (hasExampleDomain || hasGoogleFavicon) {
                logAsync('INFO', '清理包含测试数据的搜索引擎', { engine });
                return false;
            }
            return true;
        });

        const cleanedCount = settings.searchEngines.length;

        if (cleanedCount !== originalCount) {
            await setValue(STORAGE_KEYS.SETTINGS, settings);
            await logAsync('INFO', `搜索引擎清理完成，移除了 ${originalCount - cleanedCount} 个包含测试数据的引擎`);

            // 更新全局状态
            STATE.settings = settings;
        }
    } catch (error: any) {
        await logAsync('ERROR', '清理搜索引擎配置失败', { error: error.message });
    }
}
