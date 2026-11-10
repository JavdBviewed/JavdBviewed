import { describe, expect, it } from 'vitest';
import { buildMediaStateHitMap } from './mediaStateFilterModel';
import { evidenceFromLibrary } from '../../../features/media/watchHistory';
import type { VideoRecord } from '../../../types';
const servers = [{ type: 'emby', url: 'https://media.example' }];
const entry = { serverType: 'emby' as const, serverUrl: 'https://media.example', serverName: 'test', itemId: '1', itemName: 'ABC-001', updatedAt: 100, userData: { played: true, percent: 95, lastPlayedAt: 90, runtimeTicks: 100, positionTicks: 95 } };
const record = { id: 'ABC-001', title: 'test', status: 'want', createdAt: 1, updatedAt: 1 } as VideoRecord;
describe('durable media history in records', () => {
 it('keeps watched after the last file disappears, without keeping presence', () => {
  const watchEvidence = evidenceFromLibrary({ entries: { 'ABC-001': [entry] }, updatedAt: 100 });
  const hits = buildMediaStateHitMap({ records: [record], embyIndex: { entries: {}, updatedAt: 200 }, drive115State: null, servers, watchEvidence });
  expect(hits.get(record.id)).toEqual({ inLibrary: false, realWatched: true });
  expect(record.status).toBe('want');
 });
 it('keeps manual false authoritative', () => {
  const watchEvidence = evidenceFromLibrary({ entries: { 'ABC-001': [entry] }, updatedAt: 100 });
  expect(buildMediaStateHitMap({ records: [{ ...record, mediaStateOverrides: { realWatched: false } }], embyIndex: null, drive115State: null, servers, watchEvidence }).size).toBe(0);
 });
 it('resolves unidentified media by exact source identity', () => {
  const id = `media:${'a'.repeat(64)}`;
  const hits = buildMediaStateHitMap({ records: [{ ...record, id, videoCode: undefined }], embyIndex: { entries: {}, catalog: { [id]: entry }, updatedAt: 100 }, drive115State: null, servers });
  expect(hits.get(id)).toEqual({ inLibrary: true, realWatched: true });
 });
 it('does not let a stale played index override an explicit source cancellation', () => {
  const watchEvidence = evidenceFromLibrary({ entries: { 'ABC-001': [entry] }, updatedAt: 100 });
  Object.assign(Object.values(watchEvidence.titles['ABC-001'].copies)[0], { revokedAt: 110, watched: false, percent: 0 });
  const hits = buildMediaStateHitMap({ records: [record], embyIndex: { entries: { 'ABC-001': [entry] }, updatedAt: 100 }, drive115State: null, servers, watchEvidence });
  expect(hits.get(record.id)).toEqual({ inLibrary: true, realWatched: false });
 });
});
