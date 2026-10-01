import { openOrFocusDashboardTab } from './dashboardTab';
import { describe, expect, it, vi } from 'vitest';

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

  it('coalesces concurrent open requests so only one Dashboard tab is created', async () => {
    let releaseQuery: ((tabs: Array<{ id: number }>) => void) | null = null;
    const tabs = {
      query: vi.fn(() => new Promise<Array<{ id: number }>>((resolve) => {
        releaseQuery = resolve;
      })),
      update: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: 43 }),
    };

    const first = openOrFocusDashboardTab({
      dashboardUrl: 'chrome-extension://test/dashboard/dashboard.html',
      tabs,
    });
    const second = openOrFocusDashboardTab({
      dashboardUrl: 'chrome-extension://test/dashboard/dashboard.html',
      tabs,
    });

    expect(first).toBe(second);
    expect(tabs.query).toHaveBeenCalledTimes(1);
    releaseQuery?.([]);

    await Promise.all([first, second]);
    expect(tabs.create).toHaveBeenCalledTimes(1);
  });

  it('applies the hash on an existing tab via message (more-filters deep link)', async () => {
    const tabs = {
      query: vi.fn().mockResolvedValue([
        { id: 42, windowId: 7, url: 'chrome-extension://test/dashboard/dashboard.html' },
      ]),
      update: vi.fn().mockResolvedValue({ id: 42 }),
      create: vi.fn(),
    };
    const windows = {
      update: vi.fn().mockResolvedValue({}),
    };
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });

    const result = await openOrFocusDashboardTab({
      dashboardUrl: 'chrome-extension://test/dashboard/dashboard.html',
      hash: '#tab-settings/enhancement-settings/list',
      tabs,
      windows,
      sendMessage,
    });

    expect(tabs.update).toHaveBeenCalledWith(42, { active: true });
    expect(tabs.update).not.toHaveBeenCalledWith(42, expect.objectContaining({ url: expect.any(String) }));
    expect(tabs.create).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(42, {
      type: 'dashboard-deep-link',
      hash: '#tab-settings/enhancement-settings/list',
    });
    expect(result).toEqual({ action: 'focused', tabId: 42, hashApplied: true });
  });

  it('reloads the existing tab with the hash when the dashboard listener is unreachable', async () => {
    const tabs = {
      query: vi.fn().mockResolvedValue([
        { id: 42, windowId: 7, url: 'chrome-extension://test/dashboard/dashboard.html' },
      ]),
      update: vi.fn().mockResolvedValue({ id: 42 }),
      create: vi.fn(),
    };
    const sendMessage = vi.fn().mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.'));

    const result = await openOrFocusDashboardTab({
      dashboardUrl: 'chrome-extension://test/dashboard/dashboard.html',
      hash: '#tab-settings/enhancement-settings/list',
      tabs,
      sendMessage,
    });

    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(tabs.update).toHaveBeenCalledWith(42, { url: 'chrome-extension://test/dashboard/dashboard.html#tab-settings/enhancement-settings/list' });
    expect(result).toEqual({ action: 'focused', tabId: 42, hashApplied: true });
  });

  it('degrades to focus-only when the hash message and reload both fail', async () => {
    const tabs = {
      query: vi.fn().mockResolvedValue([
        { id: 42, windowId: 7, url: 'chrome-extension://test/dashboard/dashboard.html' },
      ]),
      update: vi.fn((id: number, props: { url?: string }) =>
        props.url ? Promise.reject(new Error('reload failed')) : Promise.resolve({ id }),
      ),
      create: vi.fn(),
    };
    const sendMessage = vi.fn().mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.'));

    const result = await openOrFocusDashboardTab({
      dashboardUrl: 'chrome-extension://test/dashboard/dashboard.html',
      hash: '#tab-settings/enhancement-settings/list',
      tabs,
      sendMessage,
    });

    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ action: 'focused', tabId: 42, hashApplied: false });
  });

  it('appends the hash to the created tab url', async () => {
    const tabs = {
      query: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: 43 }),
    };

    await openOrFocusDashboardTab({
      dashboardUrl: 'chrome-extension://test/dashboard/dashboard.html',
      hash: '#tab-settings/enhancement-settings/list',
      tabs,
    });

    expect(tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test/dashboard/dashboard.html#tab-settings/enhancement-settings/list',
      active: true,
    });
  });
});
