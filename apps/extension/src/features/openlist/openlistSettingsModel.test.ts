import { describe, expect, it, vi } from 'vitest';
import { normalizeOpenListSettings, saveOpenListSettings } from './openlistSettingsModel';

describe('OpenList push settings', () => {
  it('keeps deletion opt-in and drops unknown or destructive policies', () => {
    expect(normalizeOpenListSettings({ deletePolicy: 'delete_on_upload_succeed' }).deletePolicy).toBe('delete_on_upload_succeed');
    for (const deletePolicy of [undefined, null, '', 'delete_always', 'delete_on_upload_failed', 'delete_never']) {
      expect(normalizeOpenListSettings({ deletePolicy }).deletePolicy).toBeUndefined();
    }
  });

  it('normalizes an HTTP endpoint, optional destination and downloader', () => {
    expect(normalizeOpenListSettings({ baseUrl: ' https://nas.example/ ', token: ' secret ', path: ' /downloads ', tool: ' ' }))
      .toEqual({ baseUrl: 'https://nas.example', token: 'secret', path: '/downloads', tool: 'aria2' });
    expect(normalizeOpenListSettings({ baseUrl: 'javascript:alert(1)', token: 'x' }).baseUrl).toBe('');
    expect(normalizeOpenListSettings(null)).toEqual({ baseUrl: '', token: '', path: '', tool: 'aria2' });
  });

  it('turning cleanup off overwrites a previously enabled policy in merged settings', async () => {
    const stored = { openlist: { baseUrl: 'https://nas.example', token: 'synthetic', path: '/nas', tool: '115 Open', deletePolicy: 'delete_on_upload_succeed' } };
    await saveOpenListSettings({ ...stored.openlist, deletePolicy: undefined }, {
      readRawSettings: async () => stored,
      saveSettings: async next => { Object.assign(stored, next); },
    });
    expect(stored.openlist.deletePolicy).toBe('delete_never');
    expect(normalizeOpenListSettings(stored.openlist).deletePolicy).toBeUndefined();
  });

  it('saves only the OpenList section without dropping concurrently saved settings', async () => {
    const stored = { drive115: { enabled: true }, display: { theme: 'dark' } };
    const saveSettings = vi.fn(async (next: typeof stored & { openlist?: unknown }) => Object.assign(stored, next));
    await saveOpenListSettings({ baseUrl: 'http://localhost:5244/', token: 'key', path: '/', tool: 'aria2' }, {
      readRawSettings: async () => stored,
      saveSettings,
    });
    expect(saveSettings).toHaveBeenCalledWith({
      drive115: { enabled: true }, display: { theme: 'dark' },
      openlist: { baseUrl: 'http://localhost:5244', token: 'key', path: '/', tool: 'aria2', deletePolicy: 'delete_never' },
    });
  });
});
