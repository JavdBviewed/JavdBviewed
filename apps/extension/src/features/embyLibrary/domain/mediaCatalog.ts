/** @file mediaCatalog.ts @description 扫描资料的准确来源身份，不伪造站点影片ID @module features/embyLibrary */
import type { EmbyMediaItem, EmbyMediaServer, EmbyLibraryIndexEntry, EmbyLibraryIndex } from '../types';
import type { VideoRecord } from '../../../types';
import { resolveMediaItemCode } from './mediaItemCode';
import { normalizeServerKey, normalizeServerUrl } from './libraryIndex';
import { parseEmbyUserData } from './watchState';
export type MediaCatalog = Record<string, EmbyLibraryIndexEntry & { code?: string }>;
function safeServerUrl(raw: string): string {
  const url = new URL(normalizeServerUrl(raw));
  url.username = ''; url.password = ''; url.search = ''; url.hash = '';
  return normalizeServerUrl(url.toString());
}
export async function mediaRecordId(type: string, url: string, itemId: string): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([type, safeServerUrl(url), itemId]));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `media:${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
/** Upgrade old code-only snapshots without inventing provider URLs or playback timestamps. */
export async function catalogFromLibrary(index: EmbyLibraryIndex): Promise<MediaCatalog> {
  const catalog: MediaCatalog = { ...index.catalog };
  for (const [code, entries] of Object.entries(index.entries || {})) for (const entry of entries) {
    const id = await mediaRecordId(entry.serverType, entry.serverUrl, entry.itemId);
    if (!catalog[id]) catalog[id] = { ...entry, code };
  }
  return catalog;
}
export async function buildMediaCatalog(server: EmbyMediaServer, items: EmbyMediaItem[], now: number): Promise<MediaCatalog> {
  const catalog: MediaCatalog = {};
  const serverUrl = normalizeServerUrl(server.url);
  for (const item of items) {
    const itemId = String(item.Id || '').trim(); if (!itemId) continue;
    const id = await mediaRecordId(server.type, serverUrl, itemId);
    const resolution = resolveMediaItemCode(item);
    catalog[id] = { serverType: server.type, serverName: server.name, serverUrl, itemId, itemName: String(item.Name || '未命名影片'), path: item.Path, updatedAt: now,
      ...(resolution.kind === 'matched' ? { code: resolution.code } : {}), userData: parseEmbyUserData(item.UserData, Number(item.RunTimeTicks) || 0) };
  }
  return catalog;
}
export function mergeMediaCatalog(previous: MediaCatalog = {}, incoming: MediaCatalog, complete: ReadonlySet<string>, enabled: ReadonlySet<string>): MediaCatalog {
  const next: MediaCatalog = {};
  const completeKeys = new Set([...complete].map(key => key.toLowerCase()));
  const enabledKeys = new Set([...enabled].map(key => key.toLowerCase()));
  for (const [id, entry] of Object.entries(previous)) {
    const key = `${entry.serverType}:${normalizeServerKey(entry.serverUrl)}`;
    if (enabledKeys.has(key) && !completeKeys.has(key)) next[id] = entry;
  }
  return { ...next, ...incoming };
}
export function catalogRecords(catalog: MediaCatalog, now: number): VideoRecord[] {
  return Object.entries(catalog).map(([id, entry]) => ({ id, title: entry.itemName, status: 'untracked', ...(entry.code ? { videoCode: entry.code } : {}), createdAt: now, updatedAt: now }));
}
