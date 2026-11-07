import type { EmbyLibraryIndex, EmbyLibraryIndexEntry } from '../types';

function publicImageURL(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return url.toString();
  } catch { return undefined; }
}

/** 上报本机扫描结果，图片鉴权留在使用端，不能随索引写入持久上传队列。 */
export function localEmbyReportEntries(index: EmbyLibraryIndex): Array<{ code: string; data: EmbyLibraryIndexEntry }> {
  return Object.entries(index.entries).flatMap(([code, entries]) => entries.map((entry) => ({
    code,
    data: {
      ...entry,
      coverImageUrl: publicImageURL(entry.coverImageUrl),
      imageUrls: entry.imageUrls ? Object.fromEntries(Object.entries(entry.imageUrls).map(([kind, url]) => [kind, publicImageURL(url)])) : undefined,
    },
  })));
}
