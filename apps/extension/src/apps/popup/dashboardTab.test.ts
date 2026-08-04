import { openOrFocusDashboardTab } from './dashboardTab';

describe('openOrFocusDashboardTab', () => {
  it('focuses the existing Dashboard tab instead of creating another page', async () => {
    const tabs = {
      query: vi.fn().mockResolvedValue([
        { id: 42, windowId: 7, url: 'chrome-extension://test/dashboard/dashboard.html#tab-media' },
      ]),
      update: vi.fn().mockResolvedValue({ id: 42 }),
      create: vi.fn(),
    };
    const windows = {
      update: vi.fn().mockResolvedValue({ id: 7 }),
    };

    await openOrFocusDashboardTab({
      dashboardUrl: 'chrome-extension://test/dashboard/dashboard.html',
      tabs,
      windows,
    });

    expect(tabs.query).toHaveBeenCalledWith({
      url: 'chrome-extension://test/dashboard/dashboard.html*',
    });
    expect(tabs.update).toHaveBeenCalledWith(42, { active: true });
    expect(windows.update).toHaveBeenCalledWith(7, { focused: true });
    expect(tabs.create).not.toHaveBeenCalled();
  });

  it('creates a Dashboard tab when none is open', async () => {
    const tabs = {
      query: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: 43 }),
    };

    await openOrFocusDashboardTab({
      dashboardUrl: 'chrome-extension://test/dashboard/dashboard.html',
      tabs,
    });

    expect(tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test/dashboard/dashboard.html',
      active: true,
    });
  });
});
