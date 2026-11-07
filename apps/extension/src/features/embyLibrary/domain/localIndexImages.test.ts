import { describe, expect, it } from 'vitest';
import { hydrateLocalIndexImages } from './localIndexImages';
const settings = { emby: { mediaServers: [{ id: 's', enabled: true, type: 'emby', url: 'https://media.example/emby', apiKey: 'local-secret' }] } };
const row = { itemId: '1', serverUrl: 'https://media.example/emby', coverImageUrl: 'https://media.example/emby/Items/1/Images/Primary', imageUrls: { Thumb: 'https://evil.example/x' } };
describe('local media image authentication', () => {
  it('adds local authentication only to the matching configured image route', () => {
    const value = { entries: { 'A-1': [row] }, updatedAt: 1 };
    const hydrated = hydrateLocalIndexImages(value, settings);
    expect(hydrated.entries['A-1'][0].coverImageUrl).toContain('api_key=local-secret');
    expect(hydrated.entries['A-1'][0].imageUrls.Thumb).toBe('https://evil.example/x');
    expect(value.entries['A-1'][0].coverImageUrl).not.toContain('secret');
  });
  it.each(['https://media.example/other/Items/1/Images/Primary', 'https://media.example/emby/redirect?next=evil'])('never authenticates an unrelated path: %s', (url) => {
    const value = { entries: { 'A-1': [{ ...row, coverImageUrl: url }] } };
    expect(hydrateLocalIndexImages(value, settings).entries['A-1'][0].coverImageUrl).toBe(url);
  });
  it('preserves a legacy non-object entries shape without rewriting it', () => {
    const value = { entries: [], updatedAt: 8 };
    expect(hydrateLocalIndexImages(value, settings)).toEqual(value);
  });
  it('leaves unknown and disabled servers unchanged', () => {
    const value = { entries: { 'A-1': [row] } };
    expect(hydrateLocalIndexImages(value, {})).toEqual(value);
    expect(hydrateLocalIndexImages(value, { emby: { mediaServers: [{ ...settings.emby.mediaServers[0], enabled: false }] } })).toEqual(value);
  });
  it('authenticates parent thumbnails at the same configured image endpoint', () => {
    const value = { entries: { 'A-1': [{ ...row, imageUrls: { Thumb: 'https://media.example/emby/Items/parent/Images/Thumb' } }] } };
    expect(hydrateLocalIndexImages(value, settings).entries['A-1'][0].imageUrls.Thumb).toContain('api_key=local-secret');
  });

});
