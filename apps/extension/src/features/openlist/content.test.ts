// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getSettings, addOfflineDownload, showToast } = vi.hoisted(() => ({
  getSettings: vi.fn(), addOfflineDownload: vi.fn(), showToast: vi.fn(),
}));
vi.mock('../../utils/storage', () => ({ getSettings }));
vi.mock('./openlistClient', () => ({ addOfflineDownload }));
vi.mock('../../platform/browser/toast', () => ({ showToast }));

import { initOpenListPush } from './content';

describe('OpenList magnet push button', () => {
  afterEach(() => { document.body.innerHTML = ''; vi.clearAllMocks(); });

  it('keeps the button absent until an OpenList server and token are configured', async () => {
    document.body.innerHTML = '<div id="magnets-content"><div class="item"><a href="magnet:?xt=abc">file</a></div></div>';
    getSettings.mockResolvedValue({ openlist: { baseUrl: 'http://nas.local', token: '' } });
    await initOpenListPush();
    expect(document.querySelector('.openlist-push-btn')).toBeNull();
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
});
