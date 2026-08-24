/**
 * @file embyEnhancementContent.test.ts
 * @description Emby/Jellyfin 页面增强内容识别测试
 * @module tests/dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STATE } from '../../apps/extension/src/features/contentState';
import { embyEnhancementManager } from '../../apps/extension/src/features/embyEnhancement/content';
import { DEFAULT_SETTINGS } from '../../apps/extension/src/utils/config';

function setEmbySettings(videoCodePatterns: string[] = []): void {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.emby = {
    ...settings.emby,
    enabled: true,
    recognitionEnabled: true,
    matchUrls: ['*'],
    mediaServers: [],
    videoCodePatterns,
    linkBehavior: 'javdb-search',
    enableAutoDetection: true,
    highlightStyle: {
      backgroundColor: '#fff3cd',
      color: '#856404',
      borderRadius: '3px',
      padding: '2px 4px',
    },
    showQuickSearchCode: false,
    showQuickSearchActor: false,
  };
  settings.searchEngines = [
    {
      id: 'javdb',
      name: 'JavDB',
      urlTemplate: 'https://javdb.com/search?q={{ID}}',
      icon: '',
    },
  ];
  STATE.settings = settings;
  STATE.records = {};
}

function appendTextContainer(text: string): HTMLElement {
  const container = document.createElement('div');
  container.textContent = text;
  document.body.appendChild(container);
  return container;
}

describe('emby enhancement content recognition', () => {
  beforeEach(() => {
    setEmbySettings();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  afterEach(() => {
    embyEnhancementManager.destroy();
    STATE.settings = null;
    STATE.records = {};
    STATE.embyLibraryState = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('uses shared extraction to link standard and FC2 codes without custom patterns', async () => {
    appendTextContainer('Playlist includes ABC-123 and FC2PPV4903984');

    await embyEnhancementManager.initialize();

    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('.emby-video-link'));
    expect(links.map(link => link.textContent)).toEqual(['ABC-123', 'FC2-PPV-4903984']);
    expect(links[0]?.href).toBe('https://javdb.com/search?q=ABC-123');
    expect(links[1]?.href).toBe('https://javdb.com/search?q=FC2-PPV-4903984');
  });

  it('keeps configured videoCodePatterns as a fallback', async () => {
    setEmbySettings(['CUSTOM-\\d+']);
    appendTextContainer('Local title CUSTOM-998');

    await embyEnhancementManager.initialize();

    const link = document.querySelector<HTMLAnchorElement>('.emby-video-link');
    expect(link?.textContent).toBe('CUSTOM-998');
    expect(link?.href).toBe('https://javdb.com/search?q=CUSTOM-998');
  });

  it('does not parse page text as HTML while injecting links', async () => {
    const container = appendTextContainer('Unsafe text <img src=x onerror=alert(1)> ABC-123');

    await embyEnhancementManager.initialize();

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(container.querySelector('.emby-video-link')?.textContent).toBe('ABC-123');
  });

  it('does not duplicate links when refreshed after processing', async () => {
    appendTextContainer('Duplicate guard ABC-123');

    await embyEnhancementManager.initialize();
    await embyEnhancementManager.refresh();

    const links = document.querySelectorAll('.emby-video-link');
    expect(links).toHaveLength(1);
  });
});
