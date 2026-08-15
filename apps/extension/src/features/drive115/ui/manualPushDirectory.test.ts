import { describe, expect, it, vi } from 'vitest';

import {
  createManualPushDirectoryResolver,
  getDefaultManualPushDirectory,
  getManualPushInitialDirectory,
  resolveManualPushDirectory,
  shouldUseDefaultDirectoryForManualPush,
  type Drive115FolderSelection,
} from './manualPushDirectory';

import { openManualPushDirectoryPicker } from './manualPushDirectoryPicker';

vi.mock('./manualPushDirectoryPicker', () => ({
  openManualPushDirectoryPicker: vi.fn(),
}));

describe('createManualPushDirectoryResolver', () => {
  it('passes the configured directory as the picker initial location and returns the confirmed folder', async () => {
    const selection: Drive115FolderSelection = {
      cid: '456',
      name: 'Movies',
      path: '/Downloads/Movies',
    };
    const openPicker = vi.fn().mockResolvedValue(selection);
    const resolveManualPushDirectory = createManualPushDirectoryResolver(openPicker);

    await expect(resolveManualPushDirectory('123')).resolves.toEqual(selection);
    expect(openPicker).toHaveBeenCalledWith('123');
  });

  it('returns null when the picker is cancelled so callers can skip the push', async () => {
    const openPicker = vi.fn().mockResolvedValue(null);
    const resolveManualPushDirectory = createManualPushDirectoryResolver(openPicker);

    await expect(resolveManualPushDirectory('123')).resolves.toBeNull();
  });

  it('passes the configured default directory to the picker for skip-picker validation', async () => {
    const openPicker = vi.fn().mockResolvedValue(null);
    const resolveManualPushDirectory = createManualPushDirectoryResolver(openPicker);

    await expect(resolveManualPushDirectory('123', '456')).resolves.toBeNull();
    expect(openPicker).toHaveBeenCalledWith('123', '456');
  });

  it('delegates the production resolver to the content picker without persisting settings', async () => {
    const selection: Drive115FolderSelection = { cid: '456', name: 'Movies', path: '/Movies' };
    vi.mocked(openManualPushDirectoryPicker).mockResolvedValue(selection);

    await expect(resolveManualPushDirectory('123')).resolves.toEqual(selection);
    expect(openManualPushDirectoryPicker).toHaveBeenCalledWith('123');
  });

  it('prefers the last manually selected directory without replacing the configured default', () => {
    expect(getManualPushInitialDirectory('456', '123')).toBe('456');
    expect(getManualPushInitialDirectory('', '123')).toBe('123');
  });

  it('uses the default directory without opening the picker only when it is valid and explicitly enabled', () => {
    expect(shouldUseDefaultDirectoryForManualPush(true, '123')).toBe(true);
    expect(shouldUseDefaultDirectoryForManualPush(false, '123')).toBe(false);
    expect(shouldUseDefaultDirectoryForManualPush(true, '')).toBe(false);
    expect(shouldUseDefaultDirectoryForManualPush(true, '0')).toBe(false);
  });

  it('builds a selection from the persisted default directory metadata', () => {
    expect(getDefaultManualPushDirectory('123', 'Movies', '/Downloads/Movies')).toEqual({
      cid: '123',
      name: 'Movies',
      path: '/Downloads/Movies',
    });
    expect(getDefaultManualPushDirectory('', '', '')).toBeNull();
  });
});
