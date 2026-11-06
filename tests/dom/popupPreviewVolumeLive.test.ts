import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../apps/extension/src/utils/storage', () => ({
  getSettings: vi.fn(async () => ({
    display: {},
    listEnhancement: { previewVolume: 0.2 },
  })),
  saveSettings: vi.fn(async () => {}),
}));

describe('popup preview volume message', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('sends each slider input to the active JavDB tab before the debounced save', async () => {
    const ids = [
      'dashboard-button', 'popup-lock-btn', 'theme-switcher-btn', 'helpBtn',
      'toggleWatchedContainer', 'toggleViewedContainer', 'toggleVRContainer',
      'toggleWantContainer', 'toggleHideInMediaLibraryContainer',
      'toggleHideRealWatchedContainer', 'toggleHideBlacklistedActorsContainer',
      'toggleHideNonFavoritedActorsContainer', 'toggleHideSubscribedActorsContainer',
      'volumeSlider', 'volumeValue', 'muteBtn', 'columnCountInput',
      'containerWidthSlider', 'containerWidthValue', 'resetListDisplayBtn',
    ];
    document.body.innerHTML = ids.map(id =>
      id === 'volumeSlider' ? `<input id="${id}" type="range" />` :
      id === 'muteBtn' ? `<button id="${id}"></button>` : `<div id="${id}"></div>`,
    ).join('');
    const sendMessage = vi.fn();
    vi.stubGlobal('chrome', {
      storage: {
        local: { get: vi.fn(async () => ({})) },
        onChanged: { addListener: vi.fn() },
      },
      tabs: {
        query: vi.fn((_query, callback) => callback([{ id: 42, url: 'https://javdb.com/v/ABC' }])),
        sendMessage,
      },
    });

    await import('../../apps/extension/src/apps/popup/bootstrap');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    const slider = document.querySelector<HTMLInputElement>('#volumeSlider');
    await vi.waitFor(() => expect(slider?.value).toBe('20'));
    sendMessage.mockClear();

    if (slider) {
      slider.value = '65';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }
    expect(sendMessage).toHaveBeenCalledWith(42, { type: 'volume-changed', volume: 0.65 });

    document.querySelector<HTMLElement>('#muteBtn')?.click();
    expect(sendMessage).toHaveBeenCalledWith(42, { type: 'volume-changed', volume: 0 });
  });
});
