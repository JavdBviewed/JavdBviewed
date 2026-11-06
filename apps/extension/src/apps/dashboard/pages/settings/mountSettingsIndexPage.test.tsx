// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { clearSettingsReactRoot, setSettingsReactRoot } from './settingsReactRoots';
import { unmountSettingsIndexPage } from './mountSettingsIndexPage';

describe('settings index navigation', () => {
  afterEach(async () => {
    const host = document.querySelector('#tab-settings');
    if (host) await act(async () => clearSettingsReactRoot(host));
    document.body.innerHTML = '';
  });

  it('keeps an already mounted settings subpage when switching its hash subtab', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    host.id = 'tab-settings';
    const mount = document.createElement('div');
    host.append(mount);
    document.body.append(host);
    const root: Root = createRoot(mount);
    setSettingsReactRoot(host, 'subpage', root, mount);
    await act(async () => root.render(<input defaultValue="unsaved" />));
    const input = mount.querySelector('input');
    if (input) input.value = 'edited';

    await act(async () => unmountSettingsIndexPage('#tab-settings'));

    expect(mount.querySelector('input')).toBe(input);
    expect(input?.value).toBe('edited');
  });
});
