/**
 * @file streamResponse.ts
 * @description 115 播放/下载接口响应解析与安全诊断工具
 * @module features/drive115
 */

export type Drive115StreamType = 'mp4' | 'm3u8' | 'auto';
export type Drive115PlaybackEndpointKind = 'video_play' | 'downurl' | 'unknown';

/**
 * 从 115 播放/下载接口响应中尽量提取可播 URL。
 */
export function extractStreamUrlFromPlayResponse(json: unknown): string | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const record = json as Record<string, unknown>;
  const data = record.data ?? record.result ?? json;
  if (typeof data === 'string' && /^https?:\/\//i.test(data)) return data;
  if (!data || typeof data !== 'object') return undefined;

  const dataRecord = data as Record<string, unknown>;
  const directKeys = ['url', 'video_url', 'down_url', 'download_url', 'src', 'play_url', 'm3u8'];
  for (const key of directKeys) {
    const value = dataRecord[key];
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
    // 115 /open/ufile/downurl 会返回 data[fileId].url.url 这类嵌套对象。
    if (value && typeof value === 'object') {
      const nestedUrl = findFirstHttpUrl(value, 2);
      if (nestedUrl) return nestedUrl;
    }
  }

  const videoUrl = dataRecord.video_url || dataRecord.video_urls;
  if (videoUrl && typeof videoUrl === 'object') {
    if (Array.isArray(videoUrl)) {
      for (const item of videoUrl) {
        if (typeof item === 'string' && /^https?:\/\//i.test(item)) return item;
        if (item && typeof item === 'object') {
          const nestedUrl = findFirstHttpUrl(item, 2);
          if (nestedUrl) return nestedUrl;
        }
      }
    } else {
      for (const value of Object.values(videoUrl)) {
        if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
        if (value && typeof value === 'object') {
          const nestedUrl = findFirstHttpUrl(value, 2);
          if (nestedUrl) return nestedUrl;
        }
      }
    }
  }

  return findFirstHttpUrl(data, 4);
}

export function inferDrive115StreamType(params: {
  url?: string;
  raw?: unknown;
  endpointKind?: Drive115PlaybackEndpointKind;
  endpoint?: string;
}): Drive115StreamType {
  const url = String(params.url || '').toLowerCase();
  if (url.includes('.m3u8') || url.includes('m3u8')) return 'm3u8';
  if (/\.(mp4|webm|mkv|mov|m4v)(?:$|[?#])/i.test(url)) return 'mp4';

  const raw = params.raw;
  const data = raw && typeof raw === 'object'
    ? ((raw as Record<string, unknown>).data ?? (raw as Record<string, unknown>).result ?? raw)
    : undefined;
  if (data && typeof data === 'object') {
    const keys = collectObjectKeys(data, 4);
    if (keys.has('m3u8') || keys.has('video_url') || keys.has('video_urls')) return 'm3u8';
  }

  const endpointPath = String(params.endpoint || '').toLowerCase();
  const kind = params.endpointKind || (endpointPath.includes('/open/video/play') ? 'video_play' : endpointPath.includes('/open/ufile/downurl') ? 'downurl' : 'unknown');
  if (kind === 'video_play') return 'm3u8';
  if (kind === 'downurl') return 'mp4';
  return 'auto';
}

export function maskDrive115StreamUrlForLog(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '<invalid-url>';
  }
}

function findFirstHttpUrl(value: unknown, depth: number): string | undefined {
  if (typeof value === 'string') return /^https?:\/\//i.test(value) ? value : undefined;
  if (!value || typeof value !== 'object' || depth <= 0) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ['url', 'download_url', 'down_url', 'src', 'play_url', 'm3u8']) {
    const hit = findFirstHttpUrl(record[key], depth - 1);
    if (hit) return hit;
  }
  for (const child of Object.values(record)) {
    const hit = findFirstHttpUrl(child, depth - 1);
    if (hit) return hit;
  }
  return undefined;
}

function collectObjectKeys(value: unknown, depth: number, acc: Set<string> = new Set<string>()): Set<string> {
  if (!value || typeof value !== 'object' || depth <= 0) return acc;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    acc.add(key.toLowerCase());
    collectObjectKeys(child, depth - 1, acc);
  }
  return acc;
}
