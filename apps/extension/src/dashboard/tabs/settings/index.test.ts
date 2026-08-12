// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mountSettingsIndexPage = vi.fn();
const mountDashboardSettingsSearch = vi.fn();

vi.mock('../../../apps/dashboard/pages/settings/mountSettingsIndexPage', () => ({
  mountSettingsIndexPage,
}));

vi.mock('../../../apps/dashboard/settingsSearchBootstrap', () => ({
  mountDashboardSettingsSearch,
  revealDashboardSettingsSearchTarget: vi.fn(),
}));

describe('settings tab startup', () => {
  beforeEach(() => {
    window.location.hash = '#tab-settings';
    document.body.innerHTML = '<div id="tab-settings"></div>';
    mountSettingsIndexPage.mockReset();
    mountDashboardSettingsSearch.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('finishes the settings index startup before the search index is ready', async () => {
    let resolveSearch: (() => void) | undefined;
    mountDashboardSettingsSearch.mockImplementation(() => new Promise<void>(resolve => {
      resolveSearch = resolve;
    }));

    const { initSettingsTab } = await import('./index');
    const startup = initSettingsTab();
    let startupFinished = false;
    void startup.then(() => {
      startupFinished = true;
    });

    await vi.waitFor(() => expect(startupFinished).toBe(true));

    expect(mountSettingsIndexPage).toHaveBeenCalledWith('#tab-settings');
    await vi.waitFor(() => expect(mountDashboardSettingsSearch).toHaveBeenCalledTimes(1));

    resolveSearch?.();
    await startup;
  });
});
