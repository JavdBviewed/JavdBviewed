import { describe, expect, it } from 'vitest';
import { mergeWatchEvidenceStates, collectWatchedKeys, evidenceFromLibrary, evidenceFromDeletionHistory } from './watchHistory';
import type { MediaWatchEvidence } from './mediaWatchEvidence';
const fact = (overrides: Partial<MediaWatchEvidence> = {}): MediaWatchEvidence => ({ source: 'emby', sourceItemId: 'a', watched: true, percent: 100, lastPlayedAt: 100, ...overrides });
const state = (value: MediaWatchEvidence, code = 'ABC-123', copy = 'emby:https://media.invalid:a') => ({ version: 2 as const, titles: { [code]: { copies: { [copy]: value } } } });
describe('durable media watch history', () => {
  it('keeps 99 watched facts when 58 physical copies disappear', () => {
    const before = { version: 2, titles: Object.fromEntries(Array.from({ length: 99 }, (_, i) => [`ABC-${i + 100}`, { copies: { a: fact() } }])) };
    const after = { version: 2, titles: Object.fromEntries(Object.entries(before.titles).slice(0, 41)) };
    expect(collectWatchedKeys(mergeWatchEvidenceStates(before, after)).size).toBe(99);
  });
  it('accepts legacy facts and the existing 90 percent threshold without accepting corrupt progress', () => {
    expect([...collectWatchedKeys({ 'ABC-123': fact({ watched: false, percent: 95 }) })]).toEqual(['ABC-123']);
    for (const percent of [-1, 101, Infinity, NaN]) expect(collectWatchedKeys(state(fact({ watched: false, percent }))).size).toBe(0);
  });
  it('keeps a source cancellation against old upload, scan and repeated restore but accepts a later play', () => {
    const revoked = state(fact({ watched: false, percent: 0, revokedAt: 200 }));
    for (const [a, b] of [[revoked, state(fact())], [state(fact()), revoked]]) {
      const merged = mergeWatchEvidenceStates(a, b); expect(collectWatchedKeys(merged).size).toBe(0);
      expect(collectWatchedKeys(mergeWatchEvidenceStates(merged, state(fact()))).size).toBe(0);
      expect(collectWatchedKeys(mergeWatchEvidenceStates(merged, state(fact({ lastPlayedAt: 201 })))).size).toBe(1);
    }
  });
  it('revokes only the selected copy and preserves another watched source', () => {
    const merged = mergeWatchEvidenceStates(state(fact({ watched: false, percent: 0, revokedAt: 200 })), state(fact(), 'ABC-123', 'jellyfin:other:b'));
    expect(collectWatchedKeys(merged).has('ABC-123')).toBe(true);
  });
  it('preserves source timestamps and does not turn absent files or unwatched deletion into watching', () => {
    const entry = { serverType: 'emby', serverName: 'Test', serverUrl: 'https://media.invalid', itemId: 'a', itemName: 'ABC-123', updatedAt: 500, userData: { played: false, percent: 95, lastPlayedAt: 100, positionTicks: 95, runtimeTicks: 100 } };
    const history = evidenceFromLibrary({ entries: { 'ABC-123': [entry] }, updatedAt: 500 } as any);
    expect(collectWatchedKeys(history).has('ABC-123')).toBe(true);
    expect(Object.values(history.titles['ABC-123'].copies)[0].lastPlayedAt).toBe(100);
    expect(collectWatchedKeys(evidenceFromDeletionHistory({ version: 1, records: { x: { code: 'DEF-456', copies: [{ source: 'emby', copyId: 'a', deletedAt: 300 }] } } })).size).toBe(0);
    const restored = evidenceFromDeletionHistory({ version: 1, records: { x: { code: 'DEF-456', copies: [{ source: 'emby', copyId: 'a', watchedAt: 100, deletedAt: 300 }] } } });
    expect(collectWatchedKeys(restored).has('DEF-456')).toBe(true);
  });
  it('carries a proven copy cancellation across an old v1 source/item slot', () => {
    const revoked = state(fact({ sourceItemId: 'item', watched: false, percent: 0, revokedAt: 200 }));
    const oldV1 = { 'ABC-123': fact({ sourceItemId: 'item' }) };
    expect(collectWatchedKeys(mergeWatchEvidenceStates(revoked, oldV1)).size).toBe(0);
  });

  it('does not assign an unscoped legacy fact to one of two servers with the same item id', () => {
    const local = { version: 2, titles: { 'ABC-123': { legacy: fact({ sourceItemId: 'same' }), copies: {
      a: fact({ sourceItemId: 'same', watched: false, percent: 0, revokedAt: 200 }),
      b: fact({ sourceItemId: 'same', watched: false, percent: 20 }),
    } } } };
    expect(collectWatchedKeys(mergeWatchEvidenceStates(local, {})).has('ABC-123')).toBe(true);
    local.titles['ABC-123'].legacy.copyId = 'a';
    expect(collectWatchedKeys(mergeWatchEvidenceStates(local, {})).size).toBe(0);
  });

});
