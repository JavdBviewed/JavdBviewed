import type { ListRecord } from '../../types';
import { sendRuntimeMessage } from '../../platform/browser/runtimeMessages';
import { getCollectionRecordId, type CollectionListType } from '../../shared/utils/listRecordHelpers';

export interface SiteFavoriteTarget {
  type: CollectionListType | 'favorite';
  id: string;
  name: string;
  origin: string;
}

const COLLECTIONS: Record<SiteFavoriteTarget['type'], { path: string; section: string; prefix: string }> = {
  favorite: { path: '/users/favorite_lists', section: '#lists', prefix: 'list-' },
  series: { path: '/users/collection_series', section: '#series', prefix: 'series-' },
  label: { path: '/users/collection_codes', section: '#codes', prefix: 'code-' },
  maker: { path: '/users/collection_makers', section: '#makers', prefix: 'makers-' },
  director: { path: '/users/collection_directors', section: '#directors', prefix: 'directors-' },
};

const PAGE_LIMIT = 50;

export function parseSiteFavoriteTarget(pathname: string, origin: string, name: string): SiteFavoriteTarget | null {
  const match = pathname.match(/^\/(lists|series|video_codes|makers|directors)\/([^/?#]+)\/?$/);
  if (!match) return null;
  const type: SiteFavoriteTarget['type'] = ({
    lists: 'favorite', series: 'series', video_codes: 'label', makers: 'maker', directors: 'director',
  } as const)[match[1] as 'lists' | 'series' | 'video_codes' | 'makers' | 'directors'];
  try {
    const id = decodeURIComponent(match[2]);
    return id ? { type, id, name: name.trim() || id, origin } : null;
  } catch { return null; }
}

function entryIds(section: Element, type: SiteFavoriteTarget['type']): string[] {
  const config = COLLECTIONS[type];
  return Array.from(section.querySelectorAll<HTMLElement>(type === 'favorite' ? 'li.list-item' : '.box')).flatMap(item => {
    const rawId = item.id.startsWith(config.prefix) ? item.id.slice(config.prefix.length) : '';
    const segment = type === 'favorite' ? 'lists' : type === 'label' ? 'video_codes' : type === 'maker' ? 'makers' : type === 'director' ? 'directors' : 'series';
    const href = item.querySelector<HTMLAnchorElement>(`a[href*="/${segment}/"]`)?.getAttribute('href') || '';
    const pathId = href.match(new RegExp(`/${segment}/([^/?#]+)`))?.[1];
    const id = rawId || pathId;
    if (!id) return [];
    try { return [decodeURIComponent(id)]; } catch { return []; }
  });
}

/** Only a complete, recognizable index may change the local mirror. */
async function readSiteFavorite(target: SiteFavoriteTarget): Promise<boolean | null> {
  const config = COLLECTIONS[target.type];
  const normalizedId = target.type === 'label' ? target.id.toUpperCase() : target.id;
  let found = false;
  for (let page = 1; page <= PAGE_LIMIT; page++) {
    const url = `${target.origin}${config.path}?page=${page}`;
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok || !response.url.startsWith(`${target.origin}${config.path}`)) return null;
    const html = await response.text();
    if (/location\.href\s*=\s*['"][^'"]*\/login|just a moment/i.test(html)) return null;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const section = doc.querySelector(config.section);
    if (!section) return null;
    const ids = entryIds(section, target.type);
    if (!ids.length && !section.querySelector('.empty, .empty-state, .notification, .message')) return null;
    if (ids.some(id => (target.type === 'label' ? id.toUpperCase() : id) === normalizedId)) {
      found = true;
      break;
    }
    const nextPage = page + 1;
    const next = Array.from(doc.querySelectorAll<HTMLAnchorElement>('.pagination-link, .pagination a'))
      .some(link => new URL(link.href, url).searchParams.get('page') === String(nextPage));
    if (!next) return false;
  }
  return found ? true : null;
}

export async function reconcileSiteFavorite(target: SiteFavoriteTarget, expected?: boolean): Promise<boolean> {
  const state = await readSiteFavorite(target);
  if (state === null || (expected !== undefined && state !== expected)) return false;
  const id = target.type === 'favorite' ? target.id : getCollectionRecordId(target.type, target.id);
  const result = await sendRuntimeMessage<{ success: boolean; records?: ListRecord[] }>({ type: 'DB:LISTS_GET_ALL' });
  if (!result?.success || !Array.isArray(result.records)) return false;
  const previous = result.records.find(record => record.id === id && record.type === target.type);
  if (!state) {
    if (previous && !previous.deletedAt && (!previous.source || previous.source === 'javdb')) {
      const deleted = await sendRuntimeMessage<{ success: boolean }>({ type: 'DB:LISTS_DELETE', payload: { id } });
      return deleted?.success === true;
    }
    return true;
  }
  if (previous && !previous.deletedAt) return true;
  const now = Date.now();
  const record: ListRecord = {
    ...(previous ?? {}), id, type: target.type, source: 'javdb',
    name: previous?.name || target.name,
    url: `${target.origin}/${target.type === 'favorite' ? 'lists' : target.type === 'label' ? 'video_codes' : target.type === 'maker' ? 'makers' : target.type === 'director' ? 'directors' : 'series'}/${encodeURIComponent(target.id)}`,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    ...(target.type === 'favorite' ? {} : { externalId: target.type === 'label' ? target.id.toUpperCase() : target.id }),
  };
  delete record.deletedAt;
  const saved = await sendRuntimeMessage<{ success: boolean }>({ type: 'DB:LISTS_PUT', payload: { record } });
  return saved?.success === true;
}

/** Observe only native collect controls; index verification prevents a failed site action from changing local data. */
export function installSiteFavoritesSync(documentRef: Document = document, locationRef: Location = window.location): () => void {
  const page = parseSiteFavoriteTarget(
    locationRef.pathname,
    locationRef.origin,
    documentRef.querySelector('.section-title h2, .section-title h1, h1')?.textContent || '',
  );
  if (!page) return () => {};

  const pending = new Set<ReturnType<typeof setTimeout>>();
  const onClick = (event: MouseEvent): void => {
    const element = event.target instanceof Element ? event.target : null;
    const control = element?.closest<HTMLElement>(
      'a[href$="/collect"], a[href$="/uncollect"], form[action$="/collect"], form[action$="/uncollect"], .button-collect, .button-uncollect, [id^="button-collect-"], [id^="button-uncollect-"], [id^="button-favorite-"], [id^="button-unfavorite-"]',
    ) || element?.closest('button, input[type="submit"]')?.closest<HTMLElement>('form[action$="/collect"], form[action$="/uncollect"]');
    if (!control) return;
    const descriptor = `${control.id} ${control.className} ${control.getAttribute('href') || ''} ${control.getAttribute('action') || ''}`;
    const expected = /uncollect|unfavorite|button-uncollect/.test(descriptor) ? false : true;
    const timer = setTimeout(() => {
      pending.delete(timer);
      void reconcileSiteFavorite(page, expected).catch(() => {});
    }, 800);
    pending.add(timer);
  };
  documentRef.addEventListener('click', onClick, true);
  return () => {
    documentRef.removeEventListener('click', onClick, true);
    pending.forEach(clearTimeout);
    pending.clear();
  };
}
