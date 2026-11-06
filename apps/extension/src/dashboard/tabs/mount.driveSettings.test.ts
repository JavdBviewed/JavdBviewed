// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mountDrive115SettingsPage } = vi.hoisted(() => ({ mountDrive115SettingsPage: vi.fn() }));
vi.mock('../../apps/dashboard/pages/settings/drive115/mountDrive115SettingsPage', () => ({ mountDrive115SettingsPage }));
vi.mock('../../apps/dashboard/pages/settings/mountSettingsIndexPage', () => ({ unmountSettingsIndexPage: vi.fn() }));
vi.mock('../loaders/stylesLoader', () => ({ ensureStylesLoaded: vi.fn(async () => undefined) }));

import { mountTabIfNeeded } from './mount';

describe('drive settings mount routes', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    window.location.hash = '';
    mountDrive115SettingsPage.mockClear();
  });

  it.each([
    ['#tab-settings/drive115-settings', '#tab-settings/drive-settings/115'],
    ['#tab-settings/drive115-settings/115', '#tab-settings/drive-settings/115'],
    ['#tab-settings/drive115-settings/openlist', '#tab-settings/drive-settings/openlist'],
    ['#tab-settings/drive-settings/openlist', '#tab-settings/drive-settings/openlist'],
  ])('mounts %s as %s', async (input, expected) => {
    document.body.innerHTML = '<div id="tab-settings"></div>';
    window.location.hash = input;
    await mountTabIfNeeded('tab-settings');
    expect(window.location.hash).toBe(expected);
    expect(mountDrive115SettingsPage).toHaveBeenCalledWith('#tab-settings');
  });
});
