// storage.ts
// 封装 chrome.storage，兼容 GM_setValue/GM_getValue

import { STORAGE_KEYS, DEFAULT_SETTINGS } from './config';
import type { ExtensionSettings } from '../types';
import { log } from './logController';
import { dedupeSearchEngines, migrateSearchEngineTemplateIcon } from './searchEngines';
import { createChromeStorage } from '../platform/storage/chromeStorage';

const VIEWED_RECORDS_STORAGE_KEY = 'viewed';
const IDB_MIGRATED_STORAGE_KEY = 'idb_migrated';

const chromeStorage = createChromeStorage({
  largeKeys: [VIEWED_RECORDS_STORAGE_KEY],
  migratedLargeObjectLoaders: {
    [VIEWED_RECORDS_STORAGE_KEY]: {
      migratedFlagKey: IDB_MIGRATED_STORAGE_KEY,
      messageType: 'DB:VIEWED_GET_ALL',
      mapResponseToObject(response) {
        const records = Array.isArray(response?.records) ? response.records : [];
        const byId: Record<string, any> = Object.create(null);
        for (const record of records) {
          if (record?.id) {
            byId[record.id] = record;
          }
        }
        return byId;
      },
    },
  },
  logger(message, context) {
    log.storage?.(message, context);
  },
});

export function setValue<T>(key: string, value: T): Promise<void> {
  return chromeStorage.setValue(key, value);
}

export function getValue<T>(key: string, defaultValue: T): Promise<T> {
  return chromeStorage.getValue(key, defaultValue);
}

function migrateLegacyDrive115Settings(raw: any): { drive115: Record<string, any>; changed: boolean } {
  const source = raw && typeof raw === 'object' ? raw : {};
  const next = { ...source } as Record<string, any>;
  let changed = false;

  if (!Object.prototype.hasOwnProperty.call(next, 'enabled') && typeof next.enableV2 === 'boolean') {
    next.enabled = next.enableV2;
    changed = true;
  }

  if (Object.prototype.hasOwnProperty.call(next, 'enableV2')) {
    delete next.enableV2;
    changed = true;
  }

  if (Object.prototype.hasOwnProperty.call(next, 'lastSelectedVersion')) {
    delete next.lastSelectedVersion;
    changed = true;
  }

  return { drive115: next, changed };
}

function normalizeSettingsForSave<T extends Partial<ExtensionSettings>>(settings: T): T {
  if (!settings || typeof settings !== 'object') return settings;
  if (!('drive115' in settings)) return settings;

  const migrated = migrateLegacyDrive115Settings((settings as any).drive115);
  return {
    ...settings,
    drive115: migrated.drive115,
  } as T;
}

function mergeTelemetrySettings(storedTelemetry: any): Record<string, any> {
  const defaults = ((DEFAULT_SETTINGS as any).telemetry || {}) as Record<string, any>;
  const stored = storedTelemetry && typeof storedTelemetry === 'object' ? storedTelemetry : {};
  const merged = {
    ...defaults,
    ...stored,
  };

  if (!String(merged.endpoint || '').trim()) {
    merged.endpoint = defaults.endpoint;
  }

  return merged;
}

export function mergeSearchEngineTemplates(searchEngines: any[] | undefined | null): any[] {
  const defaultEngines = Array.isArray((DEFAULT_SETTINGS as any).searchEngines)
    ? (DEFAULT_SETTINGS as any).searchEngines
    : [];
  const userEngines = Array.isArray(searchEngines) ? searchEngines : [];
  const merged: any[] = [];
  const bundledOverrides = new Map<string, { enabled?: boolean }>();

  userEngines.forEach((engine) => {
    if (!engine || typeof engine !== 'object') return;
    const id = String(engine.id || '').trim().toLowerCase();
    if (!id || typeof engine.enabled !== 'boolean') return;
    if (defaultEngines.some((defaultEngine: any) => String(defaultEngine.id || '').trim().toLowerCase() === id)) {
      bundledOverrides.set(id, { enabled: engine.enabled });
    }
  });

  defaultEngines.forEach((engine: any) => {
    const id = String(engine.id || '').trim().toLowerCase();
    merged.push(migrateSearchEngineTemplateIcon({
      ...engine,
      ...bundledOverrides.get(id),
    }));
  });

  userEngines.forEach((engine) => {
    if (!engine || typeof engine !== 'object') return;
    merged.push(migrateSearchEngineTemplateIcon(engine));
  });

  return dedupeSearchEngines(merged).engines;
}

export async function getSettings(): Promise<ExtensionSettings> {
  const storedSettings = await getValue<Partial<ExtensionSettings>>(STORAGE_KEYS.SETTINGS, {});
  const { drive115: migratedDrive115, changed: drive115Migrated } = migrateLegacyDrive115Settings((storedSettings as any).drive115);

  log.storage('Loading settings from storage', {
    key: STORAGE_KEYS.SETTINGS,
    hasStoredSettings: !!storedSettings,
    hasPrivacy: !!storedSettings.privacy,
    drive115Migrated,
  });

  const mergedSettings: ExtensionSettings = {
    ...DEFAULT_SETTINGS,
    ...storedSettings,
    actorLibrary: {
      ...DEFAULT_SETTINGS.actorLibrary,
      ...(storedSettings.actorLibrary || {}),
      blacklist: {
        ...DEFAULT_SETTINGS.actorLibrary.blacklist,
        ...(storedSettings.actorLibrary?.blacklist || {}),
      },
    },
    display: {
      ...DEFAULT_SETTINGS.display,
      ...(storedSettings.display || {}),
    },
    webdav: {
      ...DEFAULT_SETTINGS.webdav,
      ...(storedSettings.webdav || {}),
    },
    dataSync: {
      ...DEFAULT_SETTINGS.dataSync,
      ...(storedSettings.dataSync || {}),
      urls: {
        ...DEFAULT_SETTINGS.dataSync.urls,
        ...(storedSettings.dataSync?.urls || {}),
      },
    },
    dataEnhancement: {
      ...DEFAULT_SETTINGS.dataEnhancement,
      ...(storedSettings.dataEnhancement || {}),
    },
    siteAppearance: {
      ...(DEFAULT_SETTINGS.siteAppearance || {}),
      ...((storedSettings as any).siteAppearance || {}),
    },
    translation: {
      ...DEFAULT_SETTINGS.translation,
      ...(storedSettings.translation || {}),
      targets: {
        ...((DEFAULT_SETTINGS.translation as any).targets || {}),
        ...((storedSettings.translation as any)?.targets || {}),
      },
      traditional: {
        ...DEFAULT_SETTINGS.translation.traditional,
        ...(storedSettings.translation?.traditional || {}),
      },
      ai: {
        ...DEFAULT_SETTINGS.translation.ai,
        ...(storedSettings.translation?.ai || {}),
      },
    },
    videoEnhancement: {
      ...DEFAULT_SETTINGS.videoEnhancement,
      ...((storedSettings as any).videoEnhancement || {}),
    },
    userExperience: {
      ...DEFAULT_SETTINGS.userExperience,
      ...(storedSettings.userExperience || {}),
    },
    contentFilter: {
      ...DEFAULT_SETTINGS.contentFilter,
      ...(storedSettings.contentFilter || {}),
    },
    listEnhancement: {
      ...DEFAULT_SETTINGS.listEnhancement,
      ...(storedSettings.listEnhancement || {}),
      listDisplayControl: {
        ...((DEFAULT_SETTINGS.listEnhancement as any).listDisplayControl || {}),
        ...((storedSettings.listEnhancement as any)?.listDisplayControl || {}),
        enabled: true,
      },
      sorting: {
        ...((DEFAULT_SETTINGS.listEnhancement as any).sorting || {}),
        ...((storedSettings.listEnhancement as any)?.sorting || {}),
      },
    },
    drive115: {
      ...DEFAULT_SETTINGS.drive115,
      ...migratedDrive115,
    },
    actorSync: {
      ...DEFAULT_SETTINGS.actorSync,
      ...(storedSettings.actorSync || {}),
      urls: {
        ...DEFAULT_SETTINGS.actorSync.urls,
        ...(storedSettings.actorSync?.urls || {}),
      },
    },
    privacy: {
      ...DEFAULT_SETTINGS.privacy,
      ...(storedSettings.privacy || {}),
      screenshotMode: {
        ...DEFAULT_SETTINGS.privacy.screenshotMode,
        ...(storedSettings.privacy?.screenshotMode || {}),
        contentPages: {
          ...DEFAULT_SETTINGS.privacy.screenshotMode.contentPages,
          ...(storedSettings.privacy?.screenshotMode?.contentPages || {}),
          sites: {
            ...DEFAULT_SETTINGS.privacy.screenshotMode.contentPages.sites,
            ...(storedSettings.privacy?.screenshotMode?.contentPages?.sites || {}),
          },
        },
      },
      privateMode: {
        ...DEFAULT_SETTINGS.privacy.privateMode,
        ...(storedSettings.privacy?.privateMode || {}),
      },
      passwordRecovery: {
        ...DEFAULT_SETTINGS.privacy.passwordRecovery,
        ...(storedSettings.privacy?.passwordRecovery || {}),
      },
    },
    ai: {
      ...DEFAULT_SETTINGS.ai,
      ...(storedSettings.ai || {}),
    },
    telemetry: {
      ...mergeTelemetrySettings((storedSettings as any).telemetry),
    },
    insights: {
      ...DEFAULT_SETTINGS.insights,
      ...((storedSettings as any).insights || {}),
    },
    emby: {
      ...DEFAULT_SETTINGS.emby,
      ...(storedSettings.emby || {}),
      highlightStyle: {
        ...DEFAULT_SETTINGS.emby.highlightStyle,
        ...(storedSettings.emby?.highlightStyle || {}),
      },
      libraryStatus: {
        ...((DEFAULT_SETTINGS.emby as any).libraryStatus || {}),
        ...((storedSettings.emby as any)?.libraryStatus || {}),
      },
      realtimeCheck: {
        ...((DEFAULT_SETTINGS.emby as any).realtimeCheck || {}),
        ...((storedSettings.emby as any)?.realtimeCheck || {}),
      },
    },
  };

  // Emby 主开关拆分迁移（幂等）：
  // 旧数据只有 emby.enabled（总闸）+ emby.libraryStatus.enabled（入库）。
  // 新模型拆成 recognitionEnabled / libraryEnabled 两个独立能力开关，
  // enabled 保留为 OR 派生字段以兼容旧读点/遥测/备份。
  {
    const embyAny = mergedSettings.emby as any;
    const storedEmby = (storedSettings as any).emby || {};
    const hasNewFields =
      'recognitionEnabled' in storedEmby || 'libraryEnabled' in storedEmby;
    if (!hasNewFields) {
      // 旧数据（无新字段）：从 enabled 总闸 + libraryStatus.enabled 回填
      const legacyEnabled = storedEmby.enabled === true;
      const legacyLibrary = storedEmby.libraryStatus?.enabled === true;
      embyAny.recognitionEnabled = legacyEnabled;
      embyAny.libraryEnabled = legacyEnabled && legacyLibrary;
    }
    // 无论是否迁移，统一让 enabled 成为 OR 派生，保证旧读点一致。
    embyAny.enabled = !!(embyAny.recognitionEnabled || embyAny.libraryEnabled);
    // 一致性保证：libraryStatus.enabled 是“入库展示”的主闸，与 libraryEnabled 同源。
    // 若存储的 libraryStatus.enabled 为 true 但 libraryEnabled 为 false（旧数据迁移后
    // 页面 re-save 可能把 libraryEnabled 重置），以 libraryStatus.enabled 为准回填，
    // 避免 re-save 把用户已启用的入库功能悄悄关掉。
    if (
      embyAny.enabled === true &&
      storedEmby.libraryStatus?.enabled === true &&
      embyAny.libraryEnabled !== true
    ) {
      embyAny.libraryEnabled = true;
      embyAny.enabled = !!(embyAny.recognitionEnabled || embyAny.libraryEnabled);
    }
  }

  mergedSettings.searchEngines = mergeSearchEngineTemplates((storedSettings as any).searchEngines);

  log.storage('Merged settings privacy config', mergedSettings.privacy);
  return mergedSettings;
}

export function saveSettings(settings: ExtensionSettings): Promise<void> {
  log.storage('Saving settings to storage', {
    key: STORAGE_KEYS.SETTINGS,
    hasPrivacy: !!settings.privacy,
    screenshotModeEnabled: settings.privacy?.screenshotMode?.enabled,
    protectedElementsCount: settings.privacy?.screenshotMode?.protectedElements?.length
  });
  return setValue(STORAGE_KEYS.SETTINGS, settings);
}
