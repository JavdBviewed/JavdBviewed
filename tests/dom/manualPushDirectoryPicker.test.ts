import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

vi.mock('../../apps/extension/src/features/drive115/v2', () => ({
  getDrive115V2Service: vi.fn(() => ({
    getValidAccessToken: vi.fn().mockResolvedValue({ success: true, accessToken: 'token' }),
    listFiles: vi.fn().mockResolvedValue({
      success: true,
      path: [],
      data: Array.from({ length: 12 }, (_, index) => ({
        fid: String(index + 1),
        fn: `Folder ${index + 1}`,
        fc: '0',
      })),
    }),
  })),
}));

import { openManualPushDirectoryPicker } from '../../apps/extension/src/features/drive115/ui/manualPushDirectoryPicker';

describe('manual 115 push directory picker', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-theme');
  });

  it('resolves null and removes its overlay when the user cancels', async () => {
    const result = openManualPushDirectoryPicker('123');

    document.querySelector<HTMLButtonElement>('[data-jbv-drive115-picker-cancel]')?.click();

    await expect(result).resolves.toBeNull();
    expect(document.querySelector('[data-jbv-drive115-picker]')).toBeNull();
  });

  it('returns the current directory when the user confirms', async () => {
    const result = openManualPushDirectoryPicker('123');

    document.querySelector<HTMLButtonElement>('[data-jbv-drive115-picker-use]')?.click();

    await expect(result).resolves.toMatchObject({ cid: '123' });
    expect(document.querySelector('[data-jbv-drive115-picker]')).toBeNull();
  });

  it('renders ten child folders per page when the current directory has many folders', async () => {
    openManualPushDirectoryPicker('123');

    await vi.waitFor(() => {
      expect(document.querySelectorAll('[data-jbv-drive115-picker-folder]')).toHaveLength(10);
    });

    expect(document.querySelector('[data-jbv-drive115-picker-pagination]')?.textContent).toContain('第 1 / 2 页');
  });

  it('reuses the Dashboard picker structure and visual hooks', async () => {
    openManualPushDirectoryPicker('123');

    const overlay = document.querySelector<HTMLElement>('[data-jbv-drive115-picker]');
    expect(overlay?.classList.contains('c-modal-overlay')).toBe(true);
    expect(overlay?.querySelector('.drive115-folder-picker-modal')).not.toBeNull();
    expect(overlay?.querySelector('.drive115-folder-picker-heading')).not.toBeNull();
    expect(overlay?.querySelector('.drive115-folder-picker-pathbar')).not.toBeNull();
    expect(overlay?.querySelector('.drive115-folder-picker-list')).not.toBeNull();
    expect(overlay?.querySelector('.c-modal__footer')).not.toBeNull();

    await vi.waitFor(() => {
      expect(overlay?.querySelector('.drive115-folder-row')).not.toBeNull();
    });
  });

  it('keeps long picker content in a scrollable body instead of clipping its controls', () => {
    openManualPushDirectoryPicker('123');

    const overlay = document.querySelector<HTMLElement>('[data-jbv-drive115-picker]');
    const modal = overlay?.querySelector<HTMLElement>('.drive115-folder-picker-modal');
    const body = overlay?.querySelector<HTMLElement>('.c-modal__body');

    expect(modal).not.toBeNull();
    expect(body).not.toBeNull();
    if (!modal || !body) return;

    expect(getComputedStyle(modal).display).toBe('flex');
    expect(getComputedStyle(body).overflowY).toBe('auto');
    expect(getComputedStyle(body).minHeight).toBe('0');
  });

  it('keeps the picker scrollable on a saved JavDB detail-page fixture', () => {
    const fixturePath = path.resolve(
      process.cwd(),
      'test-results/performance/local-session-capture/pages-offline/04.html',
    );
    document.open();
    document.write(readFileSync(fixturePath, 'utf8'));
    document.close();

    openManualPushDirectoryPicker('123');

    const body = document.querySelector<HTMLElement>('[data-jbv-drive115-picker] .c-modal__body');
    expect(body).not.toBeNull();
    if (!body) return;

    expect(getComputedStyle(body).overflowY).toBe('auto');
    expect(getComputedStyle(body).overscrollBehavior).toBe('contain');
  });

  it('keeps the shared picker theme tokens scoped to the content overlay', () => {
    openManualPushDirectoryPicker('123');

    const style = document.querySelector<HTMLStyleElement>('[data-jbv-drive115-picker] style');
    expect(style?.textContent).toContain('--d115-primary');
    expect(style?.textContent).toContain('[data-theme="dark"] .drive115-folder-picker-overlay');
    expect(style?.textContent).toContain('drive115-folder-row:hover');
  });

  it('renders the current path separately from its directory identifier', async () => {
    openManualPushDirectoryPicker('123');

    await vi.waitFor(() => {
      expect(document.querySelector('[data-jbv-drive115-picker-current]')?.textContent).toBe('/');
    });
    expect(document.querySelector('[data-jbv-drive115-picker-cid]')?.textContent).toBe('目录 ID 123');
  });

  it('filters child folders by name and returns to the first page', async () => {
    openManualPushDirectoryPicker('123');

    await vi.waitFor(() => {
      expect(document.querySelectorAll('[data-jbv-drive115-picker-folder]')).toHaveLength(10);
    });

    const search = document.querySelector<HTMLInputElement>('[data-jbv-drive115-picker-search]');
    expect(search).not.toBeNull();
    if (!search) return;

    search.value = 'folder 11';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.waitFor(() => {
      const folders = document.querySelectorAll<HTMLButtonElement>('[data-jbv-drive115-picker-folder]');
      expect(folders).toHaveLength(1);
      expect(folders[0]?.querySelector('.drive115-folder-row-main strong')?.textContent).toBe('Folder 11');
    });
    expect(document.querySelector('[data-jbv-drive115-picker-pagination]')?.textContent).toContain('第 1 / 1 页');
  });

  it('follows the source page theme while open', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    openManualPushDirectoryPicker('123');

    const picker = document.querySelector<HTMLElement>('[data-jbv-drive115-picker]');
    expect(picker?.dataset.theme).toBe('dark');

    document.documentElement.setAttribute('data-theme', 'light');
    await vi.waitFor(() => {
      expect(picker?.dataset.theme).toBe('light');
    });
  });

  it('returns the independent default-folder and skip-picker choices', async () => {
    const result = openManualPushDirectoryPicker('123');

    const setAsDefault = document.querySelector<HTMLInputElement>('[data-jbv-drive115-picker-set-default]');
    const skipPicker = document.querySelector<HTMLInputElement>('[data-jbv-drive115-picker-skip]');
    expect(setAsDefault).not.toBeNull();
    expect(skipPicker).not.toBeNull();
    if (!setAsDefault || !skipPicker) return;

    expect(skipPicker.disabled).toBe(true);
    setAsDefault.click();
    expect(skipPicker.disabled).toBe(false);
    skipPicker.click();
    document.querySelector<HTMLButtonElement>('[data-jbv-drive115-picker-use]')?.click();

    await expect(result).resolves.toMatchObject({
      cid: '123',
      setAsDefault: true,
      skipManualDirectoryPicker: true,
    });
  });
});
