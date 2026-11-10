import { expect, it } from 'vitest';
import { buildMediaCatalog, mergeMediaCatalog, catalogRecords } from './mediaCatalog';
const server = { id: 's', type: 'emby' as const, name: 'Test', url: 'https://media.invalid', apiKey: 'synthetic', enabled: true };
it('records recognized and unrecognized films with stable source identities, downloaded status without fabricated playback evidence', async () => {
  const input = [{ Id: 'a', Name: 'ABC-123', UserData: { Played: true } }, { Id: 'b', Name: '家庭录像' }, { Id: 'c', Name: 'DEF-456 GHI-789' }];
  const first = await buildMediaCatalog(server, input, 100); const repeat = await buildMediaCatalog(server, input, 200);
  expect(Object.keys(first)).toEqual(Object.keys(repeat)); expect(Object.keys(first)).toHaveLength(3);
  const records = catalogRecords(first, 100); expect(records.map(r => r.videoCode)).toEqual(['ABC-123', undefined, undefined]);
  for (const record of records) { expect(record.id).toMatch(/^media:[a-f0-9]{64}$/); expect(record.status).toBe('viewed'); expect(record.javdbUrl).toBeUndefined(); expect(record.completed).toBeUndefined(); expect(record.mediaStateOverrides).toBeUndefined(); }
  expect(Object.keys(await buildMediaCatalog({ ...server, url: 'https://other.invalid' }, input, 100))).not.toEqual(Object.keys(first));
});
it('keeps unseen items after partial scans and removes presence only after a complete scan', async () => {
  const scoped = { ...server, url: 'https://MEDIA.invalid/Library' };
  const full = await buildMediaCatalog(scoped, [{ Id: 'a', Name: 'ABC-123' }, { Id: 'b', Name: '家庭录像' }], 100);
  const partial = await buildMediaCatalog(scoped, [{ Id: 'a', Name: 'ABC-123' }], 200);
  const key = 'emby:https://media.invalid/library';
  expect(Object.keys(mergeMediaCatalog(full, partial, new Set(), new Set([key])))).toHaveLength(2);
  expect(Object.keys(mergeMediaCatalog(full, partial, new Set([key]), new Set([key])))).toHaveLength(1);
});
