// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getSettings, addOfflineDownload, showToast } = vi.hoisted(() => ({
  getSettings: vi.fn(), addOfflineDownload: vi.fn(), showToast: vi.fn(),
}));
vi.mock('../../utils/storage', () => ({ getSettings }));
vi.mock('./openlistClient', () => ({ addOfflineDownload }));
vi.mock('../../platform/browser/toast', () => ({ showToast }));

import { initOpenListPush } from './content';
import { createUnifiedMagnetItem } from '../magnets/ui/unifiedMagnetItem';

describe('OpenList magnet push button', () => {
  afterEach(() => { document.body.innerHTML = ''; vi.clearAllMocks(); });

  it('keeps the button absent until an OpenList server and token are configured', async () => {
    document.body.innerHTML = '<div id="magnets-content"><div class="item"><a href="magnet:?xt=abc">file</a></div></div>';
    getSettings.mockResolvedValue({ openlist: { baseUrl: 'http://nas.local', token: '' } });
    await initOpenListPush();
    expect(document.querySelector('.openlist-push-btn')).toBeNull();
    const laterRow = document.createElement('div');
    laterRow.className = 'item';
    laterRow.innerHTML = '<a href="magnet:?xt=later">later</a>';
    document.querySelector('#magnets-content')?.append(laterRow);
    await Promise.resolve();
    expect(laterRow.querySelector('.openlist-push-btn')).toBeNull();
    expect(addOfflineDownload).not.toHaveBeenCalled();
  });

  it('pushes the selected magnet and reports the task ID or the server error', async () => {
    document.body.innerHTML = '<div id="magnets-content"><div class="item"><a href="magnet:?xt=abc">file</a><div class="buttons"></div></div></div>';
    getSettings.mockResolvedValue({ openlist: { baseUrl: 'http://nas.local', token: 'key', path: '/movies', tool: 'aria2' } });
    addOfflineDownload.mockResolvedValueOnce({ success: true, tasks: [{ id: 't-1' }] });
    await initOpenListPush();
    const button = document.querySelector<HTMLButtonElement>('.openlist-push-btn');
    expect(button).not.toBeNull();
    button?.click();
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringContaining('t-1'), 'success'));
    expect(addOfflineDownload).toHaveBeenCalledWith({
      baseUrl: 'http://nas.local', token: 'key', path: '/movies', tool: 'aria2', urls: ['magnet:?xt=abc'],
    });

    addOfflineDownload.mockResolvedValueOnce({ success: false, message: 'permission denied' });
    button?.click();
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith('permission denied', 'error'));
  });

  it('adds OpenList beside 115 on dynamic search results after the detail page was initialized', async () => {
    getSettings.mockResolvedValue({ openlist: { baseUrl: 'http://nas.local', token: 'key' } });
    addOfflineDownload.mockResolvedValue({ success: true, tasks: [] });
    document.body.innerHTML = '<div id="magnets-content"></div>';
    await initOpenListPush();
    const row = createUnifiedMagnetItem({
      name: 'ABC-123', magnet: 'magnet:?xt=urn:btih:abc', size: '1 GB', sizeBytes: 1,
      date: '2026-11-06', source: 'JavDB', hasSubtitle: false,
    }, 0, { copyMagnet: vi.fn(), push115: vi.fn() });
    document.querySelector('#magnets-content')?.append(row);
    await vi.waitFor(() => expect(row.querySelectorAll('.openlist-push-btn')).toHaveLength(1));
    await initOpenListPush();
    expect(row.querySelectorAll('.drive115-push-btn')).toHaveLength(1);
    expect(row.querySelectorAll('.openlist-push-btn')).toHaveLength(1);
    row.querySelector<HTMLButtonElement>('.openlist-push-btn')?.click();
    await vi.waitFor(() => expect(addOfflineDownload).toHaveBeenCalledWith(expect.objectContaining({
      urls: ['magnet:?xt=urn:btih:abc'],
    })));
  });
});
