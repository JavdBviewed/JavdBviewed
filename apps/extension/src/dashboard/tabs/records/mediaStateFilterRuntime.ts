/**
 * @file mediaStateFilterRuntime.ts
 * @description records 媒体库状态筛选运行时（10-24）：dashboard 侧只读消费
 * emby_library_state / drive115_library_state 两枚已存键 + STATE.settings.emby.mediaServers，
 * 维护版本键缓存的命中映射；索引变更（chrome.storage.onChanged 两 key）或服务器配置
 * 变更（ensureLoaded 时指纹比对）→ 失效重算 → 任一 chip 激活时触发重滤。
 *
 * 零新存储键；站点侧 EMBY_LIBRARY_STATE_UPDATED（tabs.sendMessage）dashboard 收不到，
 * 故变更感知完全走 storage.onChanged。
 */
import { STORAGE_KEYS } from '../../../utils/config';
import { STATE } from '../../state';
import { loadDrive115LibraryState, type Drive115LibraryIndexState } from '../../../features/drive115/mediaLibrary';
import type { EmbyLibraryIndex } from '../../../features/embyLibrary/types';
import type { VideoRecord } from '../../../types';
import { buildMediaStateHitMap, type MediaStateHit } from './mediaStateFilterModel';

export interface CreateMediaStateFilterRuntimeOptions {
  getRecords: () => VideoRecord[];
  getInLibraryActive: () => boolean;
  getRealWatchedActive: () => boolean;
  /** 索引版本变更且重算完成（chip 激活时）→ 重滤。 */
  onIndicesChanged: () => void;
  logWarning?: (message: string, error?: unknown) => void;
}

export interface MediaStateFilterRuntime {
  /** 幂等单飞：缓存有效（索引版本+服务器指纹未变）= 零成本返回。 */
  ensureLoaded: () => Promise<void>;
  /** 未载/未命中维度 = null/无键（filterAndSortRecords 侧按不命中处理）。 */
  getHits: () => ReadonlyMap<string, MediaStateHit> | null;
  invalidate: () => void;
  dispose: () => void;
}

async function readEmbyIndex(): Promise<EmbyLibraryIndex | null> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.EMBY_LIBRARY_STATE);
  const raw: unknown = result[STORAGE_KEYS.EMBY_LIBRARY_STATE];
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const candidate = raw as Partial<EmbyLibraryIndex>;
  if (!candidate.entries || typeof candidate.entries !== 'object') {
    return null;
  }
  return candidate as EmbyLibraryIndex;
}

export function createMediaStateFilterRuntime(
  options: CreateMediaStateFilterRuntimeOptions,
): MediaStateFilterRuntime {
  const logWarning = options.logWarning || ((message: string, error?: unknown) => {
    console.warn(message, error ?? '');
  });

  let embyIndex: EmbyLibraryIndex | null = null;
  let drive115State: Drive115LibraryIndexState | null = null;
  let loaded = false;
  let loading: Promise<void> | null = null;
  let cacheKey: string | null = null;
  let hits: Map<string, MediaStateHit> | null = null;
  let disposed = false;

  const readServers = (): unknown => (STATE.settings as Record<string, unknown> | undefined)?.emby
    ? (STATE.settings as any).emby.mediaServers
    : null;

  const serversFingerprint = (): string => {
    try {
      return JSON.stringify(readServers() ?? null);
    } catch {
      return '[]';
    }
  };

  const keyFor = (): string => (
    `${embyIndex?.updatedAt ?? 0}:${drive115State?.updatedAt ?? 0}:${serversFingerprint()}`
  );

  const recompute = (key: string): void => {
    hits = buildMediaStateHitMap({
      records: options.getRecords(),
      embyIndex,
      drive115State,
      servers: readServers(),
    });
    cacheKey = key;
  };

  const anyActive = (): boolean => (
    options.getInLibraryActive() || options.getRealWatchedActive()
  );

  const loadOnce = async (): Promise<void> => {
    const firstLoad = !loaded;
    try {
      embyIndex = await readEmbyIndex();
      drive115State = await loadDrive115LibraryState();
    } catch (error) {
      logWarning('[Records] 媒体库索引读取失败，媒体库状态筛选按零命中处理', error);
      return;
    }
    if (disposed) return;

    const key = keyFor();
    const versionChanged = cacheKey !== null && cacheKey !== key;
    recompute(key);
    loaded = true;

    // 双次渲染语义（M1 报备 3）：首次加载或版本变更且 chip 激活 → 触发重滤对齐列表。
    if ((firstLoad || versionChanged) && anyActive()) {
      options.onIndicesChanged();
    }
  };

  const ensureLoaded = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (loaded && cacheKey !== null && keyFor() === cacheKey) return Promise.resolve();
    if (!loading) {
      loading = loadOnce().finally(() => {
        loading = null;
      });
    }
    return loading;
  };

  const onStorageChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ): void => {
    if (areaName !== 'local') return;
    const touched =
      Object.prototype.hasOwnProperty.call(changes, STORAGE_KEYS.EMBY_LIBRARY_STATE) ||
      Object.prototype.hasOwnProperty.call(changes, STORAGE_KEYS.DRIVE115_LIBRARY_STATE);
    if (!touched) return;
    // 先失效再读新值，保证 onChanged 不被「缓存仍有效」短路。
    loaded = false;
    cacheKey = null;
    void ensureLoaded();
  };

  try {
    chrome.storage.onChanged.addListener(onStorageChanged);
  } catch (error) {
    logWarning('[Records] 媒体库索引变更监听注册失败', error);
  }

  return {
    ensureLoaded,
    getHits: () => (hits ?? null),
    invalidate: () => {
      loaded = false;
      cacheKey = null;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      try {
        chrome.storage.onChanged.removeListener(onStorageChanged);
      } catch {}
    },
  };
}
