// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getSettings, saveOpenListSettings, testConnection } = vi.hoisted(() => ({
  getSettings: vi.fn().mockResolvedValue({ openlist: { baseUrl: 'http://nas.local', token: 'secret', path: '/movies', tool: 'aria2' } }),
  saveOpenListSettings: vi.fn().mockResolvedValue(undefined),
  testConnection: vi.fn().mockResolvedValue({ ok: true, version: '1.9.9', username: 'admin' }),
}));
vi.mock('../../../../../utils/storage', () => ({ getSettings }));
vi.mock('../../../../../features/openlist/openlistSettingsModel', () => ({
  DEFAULT_OPENLIST_SETTINGS: { baseUrl: '', token: '', path: '', tool: 'aria2' },
  normalizeOpenListSettings: (raw: unknown) => raw,
  saveOpenListSettings,
}));
vi.mock('../../../../../features/openlist/openlistClient', () => ({ testConnection }));

import { OpenListSettingsSection } from './OpenListSettingsSection';

describe('OpenList settings section', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    getSettings.mockResolvedValue({ openlist: { baseUrl: 'http://nas.local', token: 'secret', path: '/movies', tool: 'aria2' } });
    saveOpenListSettings.mockResolvedValue(undefined);
    testConnection.mockResolvedValue({ ok: true, version: '1.9.9', username: 'admin' });
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    host?.remove();
    vi.clearAllMocks();
  });

  it('loads, saves and tests the configured server without exposing its token', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<OpenListSettingsSection />));

    const token = host.querySelector<HTMLInputElement>('#openlistToken');
    expect(token?.type).toBe('password');
    expect(token?.value).toBe('secret');
    expect(host.textContent).not.toContain('secret');
    await act(async () => host.querySelector<HTMLButtonElement>('#openlistSave')?.click());
    expect(saveOpenListSettings).toHaveBeenCalledWith({
      baseUrl: 'http://nas.local', token: 'secret', path: '/movies', tool: 'aria2',
    });
    await act(async () => host.querySelector<HTMLButtonElement>('#openlistTest')?.click());
    expect(testConnection).toHaveBeenCalledWith({ baseUrl: 'http://nas.local', token: 'secret' });
    expect(host.textContent).toContain('1.9.9');
    expect(host.textContent).toContain('admin');
  });

  it('shows the server error on an unsuccessful test', async () => {
    testConnection.mockResolvedValueOnce({ ok: false, message: 'permission denied' });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<OpenListSettingsSection />));
    await act(async () => host.querySelector<HTMLButtonElement>('#openlistTest')?.click());
    expect(host.textContent).toContain('permission denied');
  });
});
