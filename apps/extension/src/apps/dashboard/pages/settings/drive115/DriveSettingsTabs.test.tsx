// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { DriveSettingsTabs } from './DriveSettingsTabs';

describe('drive settings hash tabs', () => {
  let root: Root | undefined;
  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    document.body.innerHTML = '';
    window.location.hash = '';
  });

  it('keeps both unsaved forms mounted across hash navigation, including the old 115 hash', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    window.location.hash = '#tab-settings/drive115-settings';
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    function Form({ label }: { label: string }) { return <input aria-label={label} defaultValue="" />; }
    await act(async () => root?.render(
      <DriveSettingsTabs drive115={<Form label="115" />} openlist={<Form label="OpenList" />} />,
    ));
    const input115 = host.querySelector<HTMLInputElement>('[aria-label="115"]');
    const inputOpenList = host.querySelector<HTMLInputElement>('[aria-label="OpenList"]');
    if (input115) input115.value = '115 draft';
    if (inputOpenList) inputOpenList.value = 'OpenList draft';
    expect(host.querySelector('[data-drive-tab="115"]')?.hasAttribute('hidden')).toBe(false);
    await act(async () => { window.location.hash = '#tab-settings/drive-settings/openlist'; window.dispatchEvent(new Event('hashchange')); });
    expect(host.querySelector('[data-drive-tab="openlist"]')?.hasAttribute('hidden')).toBe(false);
    expect(host.querySelector('[data-drive-tab="115"]')?.hasAttribute('hidden')).toBe(true);
    expect(host.querySelector<HTMLInputElement>('[aria-label="115"]')).toBe(input115);
    expect(host.querySelector<HTMLInputElement>('[aria-label="OpenList"]')).toBe(inputOpenList);
    expect(input115?.value).toBe('115 draft');
    expect(inputOpenList?.value).toBe('OpenList draft');
    await act(async () => { window.location.hash = '#tab-settings/drive115-settings/openlist'; window.dispatchEvent(new Event('hashchange')); });
    expect(host.querySelector('[data-drive-tab="openlist"]')?.hasAttribute('hidden')).toBe(false);
    expect(inputOpenList?.value).toBe('OpenList draft');
    expect(host.querySelector<HTMLAnchorElement>('[data-drive-tab-link="115"]')?.getAttribute('href'))
      .toBe('#tab-settings/drive-settings/115');
    await act(async () => { window.location.hash = '#tab-settings/drive-settings/115'; window.dispatchEvent(new Event('hashchange')); });
    expect(host.querySelector('[data-drive-tab="115"]')?.hasAttribute('hidden')).toBe(false);
    expect(input115?.value).toBe('115 draft');
    expect(inputOpenList?.value).toBe('OpenList draft');
  });

  it('opens OpenList directly from its deep hash', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    window.location.hash = '#tab-settings/drive-settings/openlist';
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<DriveSettingsTabs drive115="115 form" openlist="OpenList form" />));
    expect(host.querySelector('[data-drive-tab="openlist"]')?.hasAttribute('hidden')).toBe(false);
    expect(host.querySelector('[data-drive-tab="115"]')?.hasAttribute('hidden')).toBe(true);
    expect(host.querySelector('[data-drive-tab-link="openlist"]')?.getAttribute('aria-current')).toBe('page');
  });
});
