/**
 * @file listClickEnhancement.test.ts
 * @description list click enhancement 测试
 * @module tests/dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachListClickEnhancement,
  createListClickEnhancementDelegator,
  extractMovieIdFromJavdbVideoUrl,
  isFc2ListVideoCode,
} from '../../apps/extension/src/features/listEnhancement/ui/clickEnhancement';

function createItem(url = 'https://javdb.com/v/abc123'): HTMLElement {
  const item = document.createElement('div');
  item.className = 'item';
  item.innerHTML = `<a href="${url}"><span>cover</span></a>`;
  document.body.appendChild(item);
  return item;
}

function createDelegatedOptions(overrides: Partial<Parameters<typeof attachListClickEnhancement>[1]> = {}) {
  return {
    videoInfo: { code: 'ABC-001', title: 'Title', url: 'https://javdb.com/v/abc123' },
    enableRightClickBackground: false,
    navigateTo: vi.fn(),
    openFc2Dialog: vi.fn(),
    sendRuntimeMessage: vi.fn(),
    showToast: vi.fn(),
    openWindow: vi.fn(),
    logger: vi.fn(),
    now: () => 1000,
    setTimeout: window.setTimeout.bind(window),
    ...overrides,
  };
}

describe('list click enhancement', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('detects FC2 video codes and extracts movie id from JavDB video url', () => {
    expect(isFc2ListVideoCode('FC2-123456')).toBe(true);
    expect(isFc2ListVideoCode('abc FC2PPV 123')).toBe(true);
    expect(isFc2ListVideoCode('ABC-123')).toBe(false);
    expect(extractMovieIdFromJavdbVideoUrl('https://javdb.com/v/abc123?foo=1')).toBe('abc123');
    expect(extractMovieIdFromJavdbVideoUrl('https://javdb.com/search?q=abc')).toBeNull();
  });

  it('navigates normal videos on left click', async () => {
    const item = createItem();
    const navigateTo = vi.fn();
    attachListClickEnhancement(item, {
      videoInfo: { code: 'ABC-001', title: 'Title', url: 'https://javdb.com/v/abc123' },
      enableRightClickBackground: false,
      navigateTo,
      openFc2Dialog: vi.fn(),
      sendRuntimeMessage: vi.fn(),
      showToast: vi.fn(),
      openWindow: vi.fn(),
      logger: vi.fn(),
      now: () => 1000,
      setTimeout: window.setTimeout.bind(window),
    });

    item.querySelector('a')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(navigateTo).toHaveBeenCalledWith('https://javdb.com/v/abc123');
  });

  it('opens FC2 dialog instead of navigating', async () => {
    const item = createItem();
    const navigateTo = vi.fn();
    const openFc2Dialog = vi.fn().mockResolvedValue(undefined);
    attachListClickEnhancement(item, {
      videoInfo: { code: 'FC2-123456', title: 'Title', url: 'https://javdb.com/v/fc2abc' },
      enableRightClickBackground: false,
      navigateTo,
      openFc2Dialog,
      sendRuntimeMessage: vi.fn(),
      showToast: vi.fn(),
      openWindow: vi.fn(),
      logger: vi.fn(),
      now: () => 1000,
      setTimeout: window.setTimeout.bind(window),
    });

    item.querySelector('a')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(openFc2Dialog).toHaveBeenCalledWith('fc2abc', 'FC2-123456', 'https://javdb.com/v/fc2abc');
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it('shows an error toast when FC2 movie id cannot be parsed', async () => {
    const item = createItem();
    const showToast = vi.fn();
    attachListClickEnhancement(item, {
      videoInfo: { code: 'FC2-123456', title: 'Title', url: 'https://javdb.com/search?q=fc2' },
      enableRightClickBackground: false,
      navigateTo: vi.fn(),
      openFc2Dialog: vi.fn(),
      sendRuntimeMessage: vi.fn(),
      showToast,
      openWindow: vi.fn(),
      logger: vi.fn(),
      now: () => 1000,
      setTimeout: window.setTimeout.bind(window),
    });

    item.querySelector('a')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(showToast).toHaveBeenCalledWith('无法解析FC2视频ID', 'error');
  });

  it('opens right click target in background tab with debounce', () => {
    vi.useFakeTimers();
    const item = createItem();
    const sendRuntimeMessage = vi.fn().mockResolvedValue(undefined);
    const showToast = vi.fn();
    attachListClickEnhancement(item, {
      videoInfo: { code: 'ABC-001', title: 'Title', url: 'https://javdb.com/v/abc123' },
      enableRightClickBackground: true,
      navigateTo: vi.fn(),
      openFc2Dialog: vi.fn(),
      sendRuntimeMessage,
      showToast,
      openWindow: vi.fn(),
      logger: vi.fn(),
      now: () => 1000,
      setTimeout: window.setTimeout.bind(window),
    });

    const link = item.querySelector('a') as HTMLAnchorElement;
    link.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 2 }));
    link.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(sendRuntimeMessage).toHaveBeenCalledTimes(1);
    expect(sendRuntimeMessage).toHaveBeenCalledWith({
      type: 'OPEN_TAB_BACKGROUND',
      url: 'https://javdb.com/v/abc123',
    });
  });

  it('uses one delegated listener set for all links in a list', () => {
    const list = document.createElement('div');
    list.className = 'movie-list';
    document.body.appendChild(list);
    const items = Array.from({ length: 20 }, (_, index) => {
      const item = document.createElement('div');
      item.className = 'item';
      item.innerHTML = `<a href="/v/${index}"><span>cover</span></a>`;
      list.appendChild(item);
      return item;
    });
    const addEventListener = vi.spyOn(list, 'addEventListener');
    const controller = createListClickEnhancementDelegator();

    items.forEach(item => controller.attach(item, createDelegatedOptions()));

    expect(addEventListener.mock.calls.filter(([type]) => type === 'click')).toHaveLength(1);
    expect(addEventListener.mock.calls.filter(([type]) => type === 'mousedown')).toHaveLength(1);
    expect(addEventListener.mock.calls.filter(([type]) => type === 'contextmenu')).toHaveLength(1);
  });

  it('keeps normal delegated navigation and FC2 handling', async () => {
    const list = document.createElement('div');
    list.className = 'movie-list';
    document.body.appendChild(list);
    const normalItem = document.createElement('div');
    normalItem.className = 'item';
    normalItem.innerHTML = '<a href="/v/normal"><span>normal</span></a>';
    const fc2Item = document.createElement('div');
    fc2Item.className = 'item';
    fc2Item.innerHTML = '<a href="/v/fc2"><span>fc2</span></a>';
    list.append(normalItem, fc2Item);
    const normalOptions = createDelegatedOptions();
    const fc2Options = createDelegatedOptions({
      videoInfo: { code: 'FC2-123456', title: 'FC2', url: 'https://javdb.com/v/fc2' },
    });
    const controller = createListClickEnhancementDelegator();
    controller.attach(normalItem, normalOptions);
    controller.attach(fc2Item, fc2Options);

    normalItem.querySelector('a')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    fc2Item.querySelector('a')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(normalOptions.navigateTo).toHaveBeenCalledWith('https://javdb.com/v/abc123');
    expect(fc2Options.openFc2Dialog).toHaveBeenCalledWith('fc2', 'FC2-123456', 'https://javdb.com/v/fc2');
  });
});
