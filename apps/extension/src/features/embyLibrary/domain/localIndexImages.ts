import { resolveEnabledMediaServers } from './indexReconcile';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function canonical(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.search || url.hash) return '';
    return url.toString().replace(/\/+$/, '');
  } catch { return ''; }
}

/** 云索引不携带图片密钥；仅为已配置服务器的精确图片路由补本地鉴权。 */
export function hydrateLocalIndexImages<T>(value: T, settings: unknown): T {
  const original = record(value);
  // Image hydration is not a schema migration: preserve legacy/unknown index shapes.
  if (!original.entries || typeof original.entries !== 'object' || Array.isArray(original.entries)) return value;
  const groups = record(original.entries);
  const servers = resolveEnabledMediaServers(settings);
  const entries = Object.fromEntries(Object.entries(groups).map(([code, rows]) => [code, Array.isArray(rows) ? rows.map((raw) => {
    const row = record(raw);
    const server = servers.find((item) => canonical(item.url) !== '' && canonical(item.url) === canonical(String(row.serverUrl || '')));
    const token = server?.accessToken || server?.apiKey;
    if (!server || !token || typeof row.itemId !== 'string') return raw;
    const base = canonical(server.url);
    const imagePrefix = `${new URL(base).pathname.replace(/\/+$/, '')}/Items/`;
    const authenticate = (image: unknown): unknown => {
      if (typeof image !== 'string') return image;
      try {
        const url = new URL(image);
        const kind = url.pathname.slice(imagePrefix.length);
        if (url.origin !== new URL(base).origin || url.username || url.password || !url.pathname.startsWith(imagePrefix)
          || !/^[A-Za-z0-9._~-]+\/Images\/(Primary|Thumb|Backdrop|Logo|Banner)(\/\d+)?$/.test(kind)) return image;
        url.search = ''; url.hash = ''; url.searchParams.set('api_key', token);
        return url.toString();
      } catch { return image; }
    };
    return {
      ...row,
      ...(typeof row.coverImageUrl === 'string' ? { coverImageUrl: authenticate(row.coverImageUrl) } : {}),
      ...(row.imageUrls ? { imageUrls: Object.fromEntries(Object.entries(record(row.imageUrls)).map(([kind, image]) => [kind, authenticate(image)])) } : {}),
    };
  }) : rows]));
  return { ...original, entries } as T;
}
