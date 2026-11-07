/** 本地媒体聚合入站与旧版本游标补拉，仅操作本机索引、标记和storage_item游标。 */
import { parseLocalMediaLibraryIndex } from '../localMediaLibrary';
import { STORAGE_KEYS } from '../../utils/config';
import { CLOUD_CURSORS_STORAGE_KEY } from './chromeCursorStore';
import { markCloudStorageWrite } from './storageChangeGate';

export const LOCAL_MEDIA_INDEX_MIGRATION_KEY = STORAGE_KEYS.CLOUD_LOCAL_MEDIA_INDEX_MIGRATION;

// 这里的写成功决定是否停止补拉；必须检查lastError，不能使用吞掉写失败的旧封装。
function readStorage(keys: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (values) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message || '本地媒体索引读取失败'));
      else resolve(values);
    });
  });
}

function writeStorage(values: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message || '本地媒体索引保存失败'));
      else resolve();
    });
  });
}

export async function applyLocalMediaIndex(value: unknown): Promise<void> {
  const index = parseLocalMediaLibraryIndex(value);
  if (!index) throw new Error('Cloud 本地媒体索引格式无效，未应用本次索引');
  markCloudStorageWrite(STORAGE_KEYS.LOCAL_MEDIA_LIBRARY_STATE, index);
  // 合法空entries也是成功；同一写入保存索引与完成标记，避免半完成状态。
  await writeStorage({
    [STORAGE_KEYS.LOCAL_MEDIA_LIBRARY_STATE]: index,
    [LOCAL_MEDIA_INDEX_MIGRATION_KEY]: true,
  });
}

/** 墓碑不代表收到合法索引；保留既有迁移标记，删除失败时阻止游标越过旧数据。 */
export async function removeLocalMediaIndex(): Promise<void> {
  markCloudStorageWrite(STORAGE_KEYS.LOCAL_MEDIA_LIBRARY_STATE);
  await new Promise<void>((resolve, reject) => {
    chrome.storage.local.remove(STORAGE_KEYS.LOCAL_MEDIA_LIBRARY_STATE, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message || '本地媒体索引删除失败'));
      else resolve();
    });
  });
}

/** 每轮同步调用一次；未成功应用索引时下一轮可重试，不在同轮自动循环。 */
export async function prepareLocalMediaIndexReplay(): Promise<void> {
  const values = await readStorage([
    STORAGE_KEYS.LOCAL_MEDIA_LIBRARY_STATE, LOCAL_MEDIA_INDEX_MIGRATION_KEY, CLOUD_CURSORS_STORAGE_KEY,
  ]);
  if (values[LOCAL_MEDIA_INDEX_MIGRATION_KEY] === true
    || parseLocalMediaLibraryIndex(values[STORAGE_KEYS.LOCAL_MEDIA_LIBRARY_STATE])) return;
  const raw = values[CLOUD_CURSORS_STORAGE_KEY];
  const cursors = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  await writeStorage({ [CLOUD_CURSORS_STORAGE_KEY]: { ...cursors, storage_item: 0 } });
}
