/** Shared projection: current presence and durable playback are independent. */
import type { EmbyLibraryIndex } from '../embyLibrary/types';
import { getConfiguredServerKeys } from '../embyLibrary/domain/configuredMatches';
import { normalizeServerUrl } from '../embyLibrary/domain/libraryIndex';
import { collectWatchedKeys, evidenceFromLibrary, mergeWatchEvidenceStates } from './watchHistory';

export function projectWatchedKeys(index: EmbyLibraryIndex | null | undefined, servers: unknown, evidence: unknown): Set<string> {
  const configured = getConfiguredServerKeys(servers);
  const enabled = (entry: NonNullable<EmbyLibraryIndex['catalog']>[string]) => configured.has(`${entry.serverType}:${normalizeServerUrl(entry.serverUrl)}`);
  const current: EmbyLibraryIndex = {
    updatedAt: index?.updatedAt ?? 0,
    entries: Object.fromEntries(Object.entries(index?.entries || {}).map(([key, entries]) => [key, entries.filter(enabled)])),
    catalog: Object.fromEntries(Object.entries(index?.catalog || {}).filter(([, entry]) => enabled(entry))),
  };
  return collectWatchedKeys(mergeWatchEvidenceStates(evidenceFromLibrary(current), evidence));
}

export function hasCatalogPresence(index: EmbyLibraryIndex | null | undefined, id: string, servers: unknown): boolean {
  const entry = index?.catalog?.[id];
  return !!entry && getConfiguredServerKeys(servers).has(`${entry.serverType}:${normalizeServerUrl(entry.serverUrl)}`);
}
