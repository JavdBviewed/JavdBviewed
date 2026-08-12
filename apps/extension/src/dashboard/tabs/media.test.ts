/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const root = {
  render: vi.fn(),
  unmount: vi.fn(),
};
const createRoot = vi.fn(() => root);

vi.mock('react-dom/client', () => ({ createRoot }));
vi.mock('../../apps/dashboard/pages/media/MediaLibraryPage', () => ({
  MediaLibraryPage: () => null,
}));

describe('media tab lifecycle', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="tab-media"></div>';
    root.render.mockReset();
    root.unmount.mockReset();
    createRoot.mockClear();
  });

  afterEach(async () => {
    const { dashboardTabLifecycle } = await import('./tabLifecycle');
    dashboardTabLifecycle.disposeAll();
    document.body.innerHTML = '';
  });

  it('keeps the React root mounted while the media tab is hidden', async () => {
    const { dashboardTabLifecycle } = await import('./tabLifecycle');
    const { initMediaTab } = await import('./media');

    await initMediaTab();
    dashboardTabLifecycle.notify('active', 'tab-media');
    dashboardTabLifecycle.notify('hidden', 'tab-media');

    expect(root.unmount).not.toHaveBeenCalled();

    dashboardTabLifecycle.notify('active', 'tab-media');
    await initMediaTab();
    expect(createRoot).toHaveBeenCalledTimes(1);
  });

  it('forwards tab visibility to the retained media page', async () => {
    const { dashboardTabLifecycle } = await import('./tabLifecycle');
    const { initMediaTab } = await import('./media');

    await initMediaTab();
    dashboardTabLifecycle.notify('active', 'tab-media');
    expect(root.render).toHaveBeenLastCalledWith(expect.objectContaining({
      props: expect.objectContaining({ isActive: true }),
    }));

    dashboardTabLifecycle.notify('hidden', 'tab-media');
    expect(root.render).toHaveBeenLastCalledWith(expect.objectContaining({
      props: expect.objectContaining({ isActive: false }),
    }));

    dashboardTabLifecycle.notify('restore', 'tab-media');
    expect(root.render).toHaveBeenLastCalledWith(expect.objectContaining({
      props: expect.objectContaining({ isActive: true }),
    }));
    expect(createRoot).toHaveBeenCalledTimes(1);
    expect(root.unmount).not.toHaveBeenCalled();
  });

  it('dispatches a synchronous hidden signal before the retained root updates', async () => {
    const dispatchEvent = vi.spyOn(window, 'dispatchEvent');
    const { dashboardTabLifecycle } = await import('./tabLifecycle');
    const { initMediaTab } = await import('./media');

    await initMediaTab();
    dashboardTabLifecycle.notify('active', 'tab-media');
    dashboardTabLifecycle.notify('hidden', 'tab-media');

    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'media-tab-visibility',
      detail: { isActive: false },
    }));
  });
});
