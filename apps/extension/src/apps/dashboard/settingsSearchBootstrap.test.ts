// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadPartial = vi.fn();
const buildSettingsSearchIndex = vi.fn(() => []);
const mountSettingsSearch = vi.fn();

vi.mock('../../features/settingsSearch', () => ({
  buildSettingsSearchIndex,
  mountSettingsSearch,
  revealStoredSettingsSearchTarget: vi.fn(),
}));

vi.mock('../../dashboard/loaders/partialsLoader', () => ({
  loadPartial,
}));

describe('settings search bootstrap', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    loadPartial.mockReset();
    buildSettingsSearchIndex.mockClear();
    mountSettingsSearch.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('does not mount search into an index container detached while its index loads', async () => {
    let resolveFirstPartial: ((html: string) => void) | undefined;
    loadPartial.mockImplementation(() => Promise.resolve('<h2>设置</h2>'));
    loadPartial.mockImplementationOnce(() => new Promise<string>(resolve => {
      resolveFirstPartial = resolve;
    }));

    const indexContainer = document.createElement('div');
    indexContainer.className = 'settings-index';
    document.body.append(indexContainer);

    const { mountDashboardSettingsSearch } = await import('./settingsSearchBootstrap');
    const mountPromise = mountDashboardSettingsSearch();
    await Promise.resolve();

    indexContainer.remove();
    resolveFirstPartial?.('<h2>设置</h2>');
    await mountPromise;

    expect(mountSettingsSearch).not.toHaveBeenCalled();
  });
});
