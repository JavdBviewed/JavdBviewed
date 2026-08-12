import type { VideoRecord } from '../types';

type ViewedStatusRecord = Pick<VideoRecord, 'id' | 'status'> & { deletedAt?: number };

export interface ViewedStatusReader {
  get: (id: string) => Promise<ViewedStatusRecord | undefined>;
}

export async function readViewedStatusesWithReader(
  videoIds: readonly string[],
  reader: ViewedStatusReader,
): Promise<Array<Pick<VideoRecord, 'id' | 'status'>>> {
  const ids = [...new Set(videoIds.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  const result: Array<Pick<VideoRecord, 'id' | 'status'>> = [];
  for (const id of ids) {
    const record = await reader.get(id);
    if (record && !record.deletedAt) result.push({ id: record.id, status: record.status });
  }
  return result;
}

function openViewedDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this page'));
      return;
    }
    const request = indexedDB.open('javdb_v1');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open viewed database'));
    request.onupgradeneeded = () => {
      request.transaction?.abort();
      reject(new Error('Viewed database is not initialized'));
    };
  });
}

export async function readLocalViewedStatuses(
  videoIds: readonly string[],
): Promise<Array<Pick<VideoRecord, 'id' | 'status'>>> {
  const db = await openViewedDatabase();
  try {
    if (!db.objectStoreNames.contains('viewedRecords')) {
      throw new Error('Viewed records store is unavailable');
    }
    const reader: ViewedStatusReader = {
      get: (id) => new Promise<ViewedStatusRecord | undefined>((resolve, reject) => {
        const request = db.transaction('viewedRecords', 'readonly').objectStore('viewedRecords').get(id);
        request.onsuccess = () => resolve(request.result as ViewedStatusRecord | undefined);
        request.onerror = () => reject(request.error ?? new Error('Unable to read viewed record'));
      }),
    };
    return await readViewedStatusesWithReader(videoIds, reader);
  } finally {
    db.close();
  }
}
