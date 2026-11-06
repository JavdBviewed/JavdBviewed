import { describe, expect, it, vi } from 'vitest';
import { normalizeOpenListSettings, saveOpenListSettings } from './openlistSettingsModel';

describe('OpenList push settings', () => {
  it('normalizes an HTTP endpoint, optional destination and downloader', () => {
    expect(normalizeOpenListSettings({ baseUrl: ' https://nas.example/ ', token: ' secret ', path: ' /downloads ', tool: ' ' }))
      .toEqual({ baseUrl: 'https://nas.example', token: 'secret', path: '/downloads', tool: 'aria2' });
    expect(normalizeOpenListSettings({ baseUrl: 'javascript:alert(1)', token: 'x' }).baseUrl).toBe('');
    expect(normalizeOpenListSettings(null)).toEqual({ baseUrl: '', token: '', path: '', tool: 'aria2' });
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
      openlist: { baseUrl: 'http://localhost:5244', token: 'key', path: '/', tool: 'aria2' },
    });
  });
});
