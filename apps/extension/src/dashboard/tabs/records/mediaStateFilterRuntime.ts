import { evidenceFromDeletionHistory, mergeWatchEvidenceStates } from '../../../features/media/watchHistory';
/**
 * @file mediaStateFilterRuntime.ts
 * @description records 媒体库状态筛选运行时（10-24）：dashboard 侧只读消费
 * emby_library_state / drive115_library_state / local_media_library_state + STATE.settings.emby.mediaServers，
 * 维护版本键缓存的命中映射；索引变更（chrome.storage.onChanged）或服务器配置
 * 变更（ensureLoaded 时指纹比对）→ 失效重算 → 任一 chip 激活时触发重滤。
 *
 * 本地文件索引只读；站点侧 EMBY_LIBRARY_STATE_UPDATED（tabs.sendMessage）dashboard 收不到，
 * 故变更感知完全走 storage.onChanged。
 */
import { parseLocalMediaLibraryIndex, type LocalMediaLibraryIndex } from '../../../features/localMediaLibrary';
import { STORAGE_KEYS } from '../../../utils/config';
import { STATE } from '../../state';
import { loadDrive115LibraryState, type Drive115LibraryIndexState } from '../../../features/drive115/mediaLibrary';
import type { EmbyLibraryIndex } from '../../../features/embyLibrary/types';
import type { VideoRecord } from '../../../types';
import { buildMediaStateHitMap, getMediaStateRecordKey, normalizeMediaStateOverrides, type MediaStateHit } from './mediaStateFilterModel';

export interface CreateMediaStateFilterRuntimeOptions {
  getRecords: () => VideoRecord[];
  getInLibraryActive: () => boolean;
  getRealWatchedActive: () => boolean;
  /** 索引版本变更且重算完成（chip 激活时）→ 重滤。 */
  onIndicesChanged: () => void;
  onLibrarySnapshotChanged?: () => void;
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
  let localState: LocalMediaLibraryIndex | null = null;
  let watchEvidence: unknown;
  let loaded = false;
  let loading: Promise<void> | null = null;
  let cacheKey: string | null = null;
  let hits: Map<string, MediaStateHit> | null = null;
  let disposed = false;
  let indexRevision = 0;

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

  /**
   * 人工钉住指纹（10-27 pin）：索引/服务器版本之外的第三失效维度——
   * 仅编辑保存改 override 不动索引时，靠本指纹让缓存键变化触发重算。
   * 无钉住 = 空串（与旧行为零差异）；records 读取异常按无钉住处理。
   */
  const overridesFingerprint = (): string => {
    const parts: string[] = [];
    try {
      for (const record of options.getRecords()) {
        if (!record || typeof record !== 'object') continue;
        const pinned = normalizeMediaStateOverrides(record.mediaStateOverrides);
        if (!pinned) continue;
        const key = getMediaStateRecordKey(record);
        if (!key) continue;
        const dim = (value?: boolean): string => (value === true ? '1' : value === false ? '0' : '-');
        parts.push(`${key}:${dim(pinned.inLibrary)}:${dim(pinned.realWatched)}`);
      }
    } catch (error) {
      logWarning('[Records] 人工钉住指纹计算失败（按无钉住处理）', error);
      return '';
    }
    parts.sort();
    return parts.join('|');
  };

  const keyFor = (): string => (
    `${options.getRecords().map(r => r.id).join(",")}:${indexRevision}:${embyIndex?.updatedAt ?? 0}:${drive115State?.updatedAt ?? 0}:${localState?.updatedAt ?? 0}:${serversFingerprint()}:${overridesFingerprint()}`
  );

  const recompute = (key: string): void => {
    hits = buildMediaStateHitMap({
      records: options.getRecords(),
      embyIndex,
      drive115State,
      localState,
      watchEvidence,
      servers: readServers(),
    });
    cacheKey = key;
  };

  const anyActive = (): boolean => (
    options.getInLibraryActive() || options.getRealWatchedActive()
  );

  const loadOnce = async (): Promise<void> => {
    const readRevision = indexRevision;
    const firstLoad = !loaded;
    const hadLocalHits = firstLoad && localState !== null && Boolean(hits?.size);
    try {
      const [nextEmby, nextDrive, storedLocal, storedWatch] = await Promise.all([
        readEmbyIndex(), loadDrive115LibraryState(),
        chrome.storage.local.get(STORAGE_KEYS.LOCAL_MEDIA_LIBRARY_STATE),
        chrome.storage.local.get([STORAGE_KEYS.MEDIA_WATCH_EVIDENCE, STORAGE_KEYS.MEDIA_DELETION_HISTORY]),
      ]);
      if (disposed || readRevision !== indexRevision) return;
      embyIndex = nextEmby;
      drive115State = nextDrive;
      localState = parseLocalMediaLibraryIndex(storedLocal[STORAGE_KEYS.LOCAL_MEDIA_LIBRARY_STATE]);
      watchEvidence = mergeWatchEvidenceStates(storedWatch[STORAGE_KEYS.MEDIA_WATCH_EVIDENCE], evidenceFromDeletionHistory(storedWatch[STORAGE_KEYS.MEDIA_DELETION_HISTORY]));
    } catch (error) {
      logWarning('[Records] 媒体库索引读取失败，媒体库状态筛选按零命中处理', error);
      return;
    }
    if (disposed || readRevision !== indexRevision) return;

    const key = keyFor();
    const versionChanged = cacheKey !== null && cacheKey !== key;
    recompute(key);
    loaded = true;

    // 本地来源退役后即使筛选未激活也要移除已有入库标记；人工pin重算沿用原回调语义。
    // 双次渲染语义（M1 报备 3）：首次加载或版本变更且（chip 激活 或 存在派生命中）→ 触发回调对齐列表
    // （10-24 state-dict：未激活且有命中时由接线侧补一次渲染，供派生 chip 上卡）。
    if ((firstLoad || versionChanged) && (indexRevision > 0 || anyActive() || hadLocalHits || (hits !== null && hits.size > 0))) {
      options.onIndicesChanged();
    }
  };

  const ensureLoaded = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (loaded && cacheKey !== null && keyFor() === cacheKey) return Promise.resolve();
    if (!loading) {
      loading = (async () => {
        // 读取期间收到新快照/退役通知时，再读一次，避免旧结果覆盖最新通知。
        let readRevision: number;
        do {
          readRevision = indexRevision;
          await loadOnce();
        } while (!disposed && readRevision !== indexRevision);
      })().finally(() => {
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
      Object.prototype.hasOwnProperty.call(changes, STORAGE_KEYS.DRIVE115_LIBRARY_STATE) ||
      Object.prototype.hasOwnProperty.call(changes, STORAGE_KEYS.LOCAL_MEDIA_LIBRARY_STATE) ||
      Object.prototype.hasOwnProperty.call(changes, STORAGE_KEYS.MEDIA_WATCH_EVIDENCE) ||
      Object.prototype.hasOwnProperty.call(changes, STORAGE_KEYS.MEDIA_DELETION_HISTORY);
    if (!touched) return;
    if (Object.prototype.hasOwnProperty.call(changes, STORAGE_KEYS.EMBY_LIBRARY_STATE)) options.onLibrarySnapshotChanged?.();
    indexRevision += 1;
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
