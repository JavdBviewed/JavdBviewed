/**
 * @file listPreviewHoverController.test.ts
 * @description list preview hover controller 测试
 * @module tests/dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPreviewHoverController,
} from '../../apps/extension/src/features/listEnhancement/ui/previewHoverController';

function createCover(): HTMLElement {
  const cover = document.createElement('div');
  cover.className = 'cover';
  document.body.appendChild(cover);
  return cover;
}

function createVideo(): HTMLVideoElement {
  const video = document.createElement('video');
  vi.spyOn(video, 'play').mockResolvedValue(undefined);
  vi.spyOn(video, 'pause').mockImplementation(() => {});
  return video;
}

describe('list preview hover controller', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('skips hover preview while list is scrolling', () => {
    const cover = createCover();
    const loadPreviewVideo = vi.fn();
    const controller = createPreviewHoverController({
      window,
      getPreviewDelay: () => 300,
      getPreferredPreviewSource: () => 'auto',
      isScrolling: () => true,
      loadPreviewVideo,
      activatePreviewVideoPreload: vi.fn(),
      releasePreviewVideoMedia: vi.fn(),
      runtimeSendMessage: vi.fn(),
    });

    controller.attach(cover, { code: 'ABC-001', title: 'Title', url: 'https://javdb.com/v/abc' });
    cover.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

    expect(cover.classList.contains('x-cover')).toBe(true);
    expect(cover.classList.contains('x-preview')).toBe(true);
    expect(cover.classList.contains('x-holding')).toBe(false);
    expect(loadPreviewVideo).not.toHaveBeenCalled();
  });

  it('loads preview after the minimum hover delay', async () => {
    vi.useFakeTimers();
    const cover = createCover();
    const loadPreviewVideo = vi.fn(async (target: HTMLElement, _info: unknown, options: any) => {
      const video = createVideo();
      target.appendChild(video);
      options.onVideoCreated(video);
    });
    const controller = createPreviewHoverController({
      window,
      getPreviewDelay: () => 1,
      getPreferredPreviewSource: () => 'auto',
      isScrolling: () => false,
      loadPreviewVideo,
      activatePreviewVideoPreload: vi.fn(),
      releasePreviewVideoMedia: vi.fn(),
      runtimeSendMessage: vi.fn(),
    });

    controller.attach(cover, { code: 'ABC-001', title: 'Title', url: 'https://javdb.com/v/abc' });
    cover.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

    expect(loadPreviewVideo).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(99);
    expect(loadPreviewVideo).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(loadPreviewVideo).toHaveBeenCalledTimes(1);
    expect(controller.getCurrentPlayingVideo()).toBe(cover.querySelector('video'));
  });

  it('reuses existing video and pauses the previous one', () => {
    const firstCover = createCover();
    const secondCover = createCover();
    const firstVideo = createVideo();
    const secondVideo = createVideo();
    firstCover.appendChild(firstVideo);
    secondCover.appendChild(secondVideo);
    const activatePreviewVideoPreload = vi.fn();
    const releasePreviewVideoMedia = vi.fn();
    const controller = createPreviewHoverController({
      window,
      getPreviewDelay: () => 300,
      getPreferredPreviewSource: () => 'auto',
      isScrolling: () => false,
      loadPreviewVideo: vi.fn(),
      activatePreviewVideoPreload,
      releasePreviewVideoMedia,
      runtimeSendMessage: vi.fn(),
    });

    controller.show(firstCover, { code: 'A', title: 'A', url: 'https://javdb.com/v/a' });
    controller.show(secondCover, { code: 'B', title: 'B', url: 'https://javdb.com/v/b' });

    expect(firstVideo.pause).toHaveBeenCalledTimes(1);
    expect(firstVideo.style.opacity).toBe('0');
    expect(releasePreviewVideoMedia).toHaveBeenCalledWith(firstVideo);
    expect(secondVideo.style.opacity).toBe('1');
    expect(activatePreviewVideoPreload).toHaveBeenCalledWith(secondVideo);
    expect(controller.getCurrentPlayingVideo()).toBe(secondVideo);
  });

  it('hides preview and releases current video media', () => {
    const cover = createCover();
    const video = createVideo();
    cover.appendChild(video);
    const releasePreviewVideoMedia = vi.fn();
    const controller = createPreviewHoverController({
      window,
      getPreviewDelay: () => 300,
      getPreferredPreviewSource: () => 'auto',
      isScrolling: () => false,
      loadPreviewVideo: vi.fn(),
      activatePreviewVideoPreload: vi.fn(),
      releasePreviewVideoMedia,
      runtimeSendMessage: vi.fn(),
    });

    controller.show(cover, { code: 'A', title: 'A', url: 'https://javdb.com/v/a' });
    controller.hide(cover);

    expect(cover.classList.contains('x-holding')).toBe(false);
    expect(video.style.opacity).toBe('0');
    expect(releasePreviewVideoMedia).toHaveBeenCalledWith(video);
    expect(controller.getCurrentPlayingVideo()).toBeNull();
  });

  it('keeps preview visible when mouse leaves to a child element', () => {
    const cover = createCover();
    const child = document.createElement('span');
    cover.appendChild(child);
    const releasePreviewVideoMedia = vi.fn();
    const controller = createPreviewHoverController({
      window,
      getPreviewDelay: () => 300,
      getPreferredPreviewSource: () => 'auto',
      isScrolling: () => false,
      loadPreviewVideo: vi.fn(),
      activatePreviewVideoPreload: vi.fn(),
      releasePreviewVideoMedia,
      runtimeSendMessage: vi.fn(),
    });

    controller.attach(cover, { code: 'A', title: 'A', url: 'https://javdb.com/v/a' });
    cover.classList.add('x-holding');
    cover.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: child }));

    expect(cover.classList.contains('x-holding')).toBe(true);
    expect(releasePreviewVideoMedia).not.toHaveBeenCalled();
  });

  it('uses one delegated hover listener pair for all covers in a list', () => {
    const list = document.createElement('div');
    list.className = 'movie-list';
    document.body.appendChild(list);
    const covers = Array.from({ length: 20 }, () => {
      const cover = document.createElement('div');
      cover.className = 'cover';
      list.appendChild(cover);
      return cover;
    });
    const addEventListener = vi.spyOn(list, 'addEventListener');
    const releasePreviewVideoMedia = vi.fn();
    const controller = createPreviewHoverController({
      window,
      getPreviewDelay: () => 300,
      getPreferredPreviewSource: () => 'auto',
      isScrolling: () => true,
      loadPreviewVideo: vi.fn(),
      activatePreviewVideoPreload: vi.fn(),
      releasePreviewVideoMedia,
      runtimeSendMessage: vi.fn(),
    });

    covers.forEach((cover, index) => controller.attach(cover, {
      code: `A-${index}`,
      title: `A-${index}`,
      url: `https://javdb.com/v/a-${index}`,
    }));

    expect(addEventListener.mock.calls.filter(([type]) => type === 'mouseover')).toHaveLength(1);
    expect(addEventListener.mock.calls.filter(([type]) => type === 'mouseout')).toHaveLength(1);
  });

  it('cancels the previous pending hover when moving to another cover', async () => {
    vi.useFakeTimers();
    const list = document.createElement('div');
    list.className = 'movie-list';
    document.body.appendChild(list);
    const firstCover = document.createElement('div');
    firstCover.className = 'cover';
    const secondCover = document.createElement('div');
    secondCover.className = 'cover';
    list.append(firstCover, secondCover);
    const loadPreviewVideo = vi.fn();
    const controller = createPreviewHoverController({
      window,
      getPreviewDelay: () => 300,
      getPreferredPreviewSource: () => 'auto',
      isScrolling: () => false,
      loadPreviewVideo,
      activatePreviewVideoPreload: vi.fn(),
      releasePreviewVideoMedia: vi.fn(),
      runtimeSendMessage: vi.fn(),
    });
    controller.attach(firstCover, { code: 'A', title: 'A', url: 'https://javdb.com/v/a' });
    controller.attach(secondCover, { code: 'B', title: 'B', url: 'https://javdb.com/v/b' });

    firstCover.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    secondCover.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: firstCover }));
    await vi.advanceTimersByTimeAsync(300);

    expect(loadPreviewVideo).toHaveBeenCalledTimes(1);
    expect(loadPreviewVideo).toHaveBeenCalledWith(secondCover, expect.objectContaining({ code: 'B' }), expect.anything());
    expect(firstCover.classList.contains('x-holding')).toBe(false);
  });
});
