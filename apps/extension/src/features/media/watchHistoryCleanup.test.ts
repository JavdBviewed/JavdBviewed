import { describe, expect, it } from 'vitest';
import { collectWatchedKeys, evidenceFromDeletionHistory, mergeWatchEvidenceStates } from './watchHistory';
import { buildEmbyCleanupSnapshots, processEmbySyncCleanupState } from '../mediaCleanup/mediaCleanupSync';
import type { EmbyLibraryState } from '../embyLibrary/types';
import { EMPTY_MEDIA_CLEANUP_STATE, EMPTY_MEDIA_DELETION_HISTORY } from '../mediaCleanup/mediaCleanupModel';

const index: EmbyLibraryState = { updatedAt: 200, entries: Object.fromEntries(Array.from({ length: 99 }, (_, i) => [`SYN-${i}`, [{ serverType: 'emby', serverUrl: 'https://media.example', serverName: 'test', itemId: `${i}`, itemName: `SYN-${i}`, updatedAt: 200, userData: { played: false, percent: 95, lastPlayedAt: 100, positionTicks: 95, runtimeTicks: 100 } }]])) };
describe('actual cleanup history format', () => {
 it('retains all 58 vanished 95%-played copies from the real flat deletion journal', () => {
  const next = { updatedAt: 300, entries: Object.fromEntries(Object.entries(index.entries).slice(58)) };
  const result = processEmbySyncCleanupState({ previous: index, next, successfulServerKeys: new Set(['emby:https://media.example']), now: 300, cleanup: EMPTY_MEDIA_CLEANUP_STATE, history: EMPTY_MEDIA_DELETION_HISTORY });
  expect(Object.keys(result.history.records)).toHaveLength(58);
  expect(collectWatchedKeys(evidenceFromDeletionHistory(result.history))).toHaveLength(58);
  expect(buildEmbyCleanupSnapshots(index, new Set(['emby:https://media.example']))[0].copies[0].watchedAt).toBe(100);
 });
 it('an explicit source fence survives old flat history restore', () => {
  const raw = { records: { old: { code: 'SYN-1', source: 'emby', itemId: '1', copyId: 'emby:https://media.example:1', watchedAt: 100 } } };
  const facts = evidenceFromDeletionHistory(raw);
  const revoked = structuredClone(facts);
  Object.assign(revoked.titles['SYN-1'].copies['emby:https://media.example:1'], { watched: false, percent: 0, revokedAt: 200 });
  expect(collectWatchedKeys(mergeWatchEvidenceStates(revoked, facts)).size).toBe(0);
 });
 it('does not promote a known legacy cleanup reason into a playback fact', () => {
  const old = { records: { a: { id: 'legacy115:a', code: 'AAA-001', source: '115', copyId: '115:a', watchedAt: 100, reason: 'extension_cleanup', deletedAt: 200 } } };
  expect(collectWatchedKeys(evidenceFromDeletionHistory(old)).size).toBe(0);
 });

});
