/** @file mediaScanPersistence.ts @description 发布可重建索引前保留资料及观看事实 @module features/media */
import { mediaMetadataTasks } from './mediaMetadataRuntime';
import type { EmbyLibraryState } from '../embyLibrary/types';
import { catalogFromLibrary, catalogRecords } from '../embyLibrary/domain/mediaCatalog';
import { viewedAddMissingMediaRecords } from '../../platform/storage/indexedDb';
import { evidenceFromDeletionHistory, evidenceFromLibrary, mergeWatchEvidenceStates } from './watchHistory';
import { mergePersistedWatchEvidence } from './mediaWatchEvidence';
export async function preserveMediaScan(previous: EmbyLibraryState, next: EmbyLibraryState): Promise<void> {
  const raw = await chrome.storage.local.get('media_deletion_history');
  const facts = mergeWatchEvidenceStates(evidenceFromDeletionHistory(raw.media_deletion_history), mergeWatchEvidenceStates(evidenceFromLibrary(previous), evidenceFromLibrary(next)));
  await mergePersistedWatchEvidence(facts);
  const catalog = { ...await catalogFromLibrary(previous), ...await catalogFromLibrary(next) };
  await viewedAddMissingMediaRecords(catalogRecords(catalog, Date.now()));
  await mediaMetadataTasks.discover();
}

/** Upgrade existing evidence/records on worker startup; rerunning is additive and idempotent. */
export async function backfillMediaScan(): Promise<void> {
  const stored = await chrome.storage.local.get('emby_library_state');
  const index = stored.emby_library_state as EmbyLibraryState | undefined;
  const current = index && typeof index === 'object' && index.entries ? index : { entries: {}, updatedAt: 0 };
  await preserveMediaScan(current, current);
}
