// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../drive115/mediaLibrary', () => ({ loadDrive115LibraryState: async () => ({ entries: [], updatedAt: 1 }), lookupByCode: () => [] }));
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });
it('hides historical-only watched cards, retains manual off, and refreshes after storage changes', async () => {
  vi.resetModules();
  const listeners: Function[] = [];
  const stored: Record<string, unknown> = { media_watch_evidence: { 'AAA-001': { source: 'emby', watched: true, percent: 100, lastPlayedAt: 10 }, 'BBB-002': { source: 'emby', watched: true, percent: 100, lastPlayedAt: 10 } } };
  vi.stubGlobal('chrome', { storage: { local: { get: async () => stored }, onChanged: { addListener: (fn: Function) => listeners.push(fn) } } });
  const { STATE } = await import('../contentState');
  const { markMediaLibraryHiding, refreshRegisteredMediaLibraryHiding } = await import('./mediaLibraryHiding');
  STATE.settings = { display: { hideRealWatched: true, hideInMediaLibrary: false }, emby: { mediaServers: [] } } as any;
  STATE.embyLibraryState = { entries: {}, updatedAt: 0 };
  STATE.records = { 'BBB-002': { id: 'BBB-002', title: 'test', status: 'untracked', createdAt: 1, updatedAt: 1, mediaStateOverrides: { realWatched: false } } };
  const a = document.createElement('div'); const b = document.createElement('div'); document.body.append(a, b);
  markMediaLibraryHiding(a, 'AAA-001', STATE.settings); markMediaLibraryHiding(b, 'BBB-002', STATE.settings);
  await refreshRegisteredMediaLibraryHiding();
  expect(a.getAttribute('data-hide-src-realWatched')).toBe('true');
  expect(a.style.display).toBe('none');
  expect(a.hasAttribute('data-hide-src-mediaLibrary')).toBe(false);
  expect(b.hasAttribute('data-hide-src-realWatched')).toBe(false);
  stored.media_watch_evidence = {};
  listeners.forEach(fn => fn({ media_watch_evidence: { newValue: {} } }, 'local'));
  await refreshRegisteredMediaLibraryHiding();
  expect(a.hasAttribute('data-hide-src-realWatched')).toBe(false);
});
