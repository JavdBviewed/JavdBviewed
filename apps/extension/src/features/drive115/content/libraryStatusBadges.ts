/**
 * @file libraryStatusBadges.ts
 * @description 115 本地媒体库已存在状态角标
 * @module features/drive115
 */

import { loadDrive115LibraryState, lookupByCode } from '../mediaLibrary';

export function isDrive115LibraryStatusEnabled(settings: Record<string, unknown>): boolean {
  const libraryMatchStatus = settings.libraryMatchStatus as { enabled?: boolean; sources?: { drive115?: boolean } } | undefined;
  const listEnhancement = settings.listEnhancement as { libraryMatchStatus?: { enabled?: boolean; sources?: { drive115?: boolean } }; drive115LibraryStatus?: { enabled?: boolean } } | undefined;
  const legacyLibraryMatchStatus = listEnhancement?.libraryMatchStatus;
  const effectiveLibraryMatchStatus = libraryMatchStatus ?? legacyLibraryMatchStatus;

  return (effectiveLibraryMatchStatus?.enabled === true
    && effectiveLibraryMatchStatus.sources?.drive115 !== false)
    || listEnhancement?.drive115LibraryStatus?.enabled === true;
}

export function matchesDrive115LibraryCode(code: string, matchedCodes: readonly string[]): boolean {
  const target = String(code).trim().toUpperCase();
  return Boolean(target) && matchedCodes.some((matchedCode) => String(matchedCode).trim().toUpperCase() === target);
}

export async function renderDrive115LibraryStatusBadge(
  container: HTMLElement,
  videoId: string,
  settings: Record<string, unknown>,
): Promise<void> {
  container.querySelectorAll('.drive115-library-status-tag').forEach((tag) => tag.remove());
  if (!isDrive115LibraryStatusEnabled(settings)) return;

  const state = await loadDrive115LibraryState();
  const matches = lookupByCode(state, videoId);
  if (!matchesDrive115LibraryCode(videoId, matches.map((entry) => entry.code))) return;

  const badge = document.createElement('span');
  badge.className = 'tag is-info is-light drive115-library-status-tag';
  badge.textContent = '115 已有';
  badge.title = `115 媒体库已匹配 ${matches.length} 个文件`;
  container.appendChild(badge);
}
