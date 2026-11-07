// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/storage', () => ({ getSettings: vi.fn(async () => ({ listEnhancement: { previewVolume: 0.2 } })) }));
vi.mock('../contentState', () => ({ log: vi.fn() }));
vi.mock('./previewVideoPreload', () => ({ activatePreviewVideoPreload: vi.fn(), releasePreviewVideoMedia: vi.fn() }));

import { installPreviewVolumeControl } from './previewVolumeControl';
import { activatePreviewVideoPreload } from './previewVideoPreload';
import { attachNativeJavdbPreview } from './nativeJavdbPreview';

describe('popup 音量变更实时更新影片页预览', () => {
  afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

  it('updates a visible id-less video in a Fancybox preview and the replacement video', async () => {
    let listener: ((message: { type: string; volume: number }, sender: unknown, respond: (response: unknown) => void) => void) | undefined;
    vi.stubGlobal('chrome', { runtime: { onMessage: { addListener: vi.fn((fn) => { listener = fn; }) } } });
    document.body.innerHTML = '<div class="fancybox-is-open"><video src="/clip.mp4" muted></video></div><video id="unrelated" muted></video>';
    await installPreviewVolumeControl();
    const wrapper = document.querySelector('.fancybox-is-open');
    const preview = wrapper?.querySelector('video');
    if (preview) preview.muted = true;
    const unrelated = document.querySelector<HTMLVideoElement>('#unrelated');
    if (unrelated) unrelated.muted = true;
    listener?.({ type: 'volume-changed', volume: 0.3 }, {}, vi.fn());
    expect(preview?.muted).toBe(false);
    expect(preview?.volume).toBe(0.3);
    const replacement = document.createElement('video');
    replacement.src = '/clip-next.mp4';
    replacement.muted = true;
    wrapper?.replaceChildren(replacement);
    replacement.dispatchEvent(new Event('playing', { bubbles: true }));
    expect(replacement.muted).toBe(false);
    expect(replacement.volume).toBe(0.3);
    expect(document.querySelector<HTMLVideoElement>('#unrelated')?.muted).toBe(true);
  });

  it('recognizes a playing id-less video loaded after the preview click without touching other players', async () => {
    let listener: ((message: { type: string; volume: number }, sender: unknown, respond: (response: unknown) => void) => void) | undefined;
    vi.stubGlobal('chrome', { runtime: { onMessage: { addListener: vi.fn((fn) => { listener = fn; }) } } });
    document.body.innerHTML = '<a href="/preview-video">预览</a><video id="other" src="/other.mp4"></video><div id="player"></div>';
    const other = document.querySelector<HTMLVideoElement>('#other');
    if (other) { other.muted = true; Object.defineProperty(other, 'paused', { value: false }); }
    await installPreviewVolumeControl();
    document.querySelector('a')?.addEventListener('click', event => event.preventDefault());
    document.querySelector('a')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const preview = document.createElement('video');
    preview.src = '/clip.mp4';
    preview.muted = true;
    Object.defineProperty(preview, 'paused', { value: false });
    document.querySelector('#player')?.appendChild(preview);
    listener?.({ type: 'volume-changed', volume: 0.3 }, {}, vi.fn());
    expect(preview.volume).toBe(0.3);
    expect(preview.muted).toBe(false);
    expect(other?.muted).toBe(true);
  });

  it('keeps an id-less preview controllable after the click window and restores sound after mute', async () => {
    let listener: ((message: { type: string; volume: number }, sender: unknown, respond: (response: unknown) => void) => void) | undefined;
    vi.stubGlobal('chrome', { runtime: { onMessage: { addListener: vi.fn((fn) => { listener = fn; }) } } });
    document.body.innerHTML = '<a href="/preview-video">预览</a><div id="player"></div><video id="other" src="/other.mp4" muted></video>';
    await installPreviewVolumeControl();
    const other = document.querySelector<HTMLVideoElement>('#other');
    if (other) other.muted = true;
    document.querySelector('a')?.addEventListener('click', event => event.preventDefault());
    document.querySelector('a')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const preview = document.createElement('video');
    preview.src = '/clip.mp4';
    let paused = false;
    Object.defineProperty(preview, 'paused', { get: () => paused });
    document.querySelector('#player')?.appendChild(preview);
    listener?.({ type: 'volume-changed', volume: 0.43 }, {}, vi.fn());
    expect(preview.volume).toBe(0.43);

    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11_000);
    paused = true;
    listener?.({ type: 'volume-changed', volume: 0 }, {}, vi.fn());
    expect(preview.volume).toBe(0);
    expect(preview.muted).toBe(true);
    listener?.({ type: 'volume-changed', volume: 0.36 }, {}, vi.fn());
    expect(preview.volume).toBe(0.36);
    expect(preview.muted).toBe(false);
    expect(other?.muted).toBe(true);
    now.mockRestore();
  });

  it('respects a manual player mute until the popup changes volume again', async () => {
    let listener: ((message: { type: string; volume: number }, sender: unknown, respond: (response: unknown) => void) => void) | undefined;
    vi.stubGlobal('chrome', { runtime: { onMessage: { addListener: vi.fn((fn) => { listener = fn; }) } } });
    document.body.innerHTML = '<div class="fancybox-is-open"><video src="/clip.mp4"></video></div>';
    const preview = document.querySelector<HTMLVideoElement>('video');
    await installPreviewVolumeControl();
    listener?.({ type: 'volume-changed', volume: 0.55 }, {}, vi.fn());
    if (preview) {
      preview.muted = true;
      preview.dispatchEvent(new Event('volumechange'));
    }
    expect(preview?.muted).toBe(true);
    listener?.({ type: 'volume-changed', volume: 0.19 }, {}, vi.fn());
    expect(preview?.muted).toBe(false);
    expect(preview?.volume).toBe(0.19);
  });

  it('收到消息时修改正在播放的预览视频音量，并保持普通视频不变', async () => {
    let listener: ((message: { type: string; volume: number }, sender: unknown, respond: (response: unknown) => void) => void) | undefined;
    vi.stubGlobal('chrome', { runtime: { onMessage: { addListener: vi.fn((fn) => { listener = fn; }) } } });
    document.body.innerHTML = '<div class="preview-video-container"><video src="/clip.mp4"></video></div><video id="unrelated"></video>';
    const preview = document.querySelector<HTMLVideoElement>('.preview-video-container video');
    const unrelated = document.querySelector<HTMLVideoElement>('#unrelated');
    expect(preview).not.toBeNull();
    expect(unrelated).not.toBeNull();
    await installPreviewVolumeControl();
    vi.mocked(activatePreviewVideoPreload).mockClear();
    listener?.({ type: 'volume-changed', volume: 0.65 }, {}, vi.fn());
    expect(preview?.volume).toBe(0.65);
    expect(unrelated?.volume).toBe(1);
    listener?.({ type: 'volume-changed', volume: 0 }, {}, vi.fn());
    expect(preview?.volume).toBe(0);
    expect(activatePreviewVideoPreload).not.toHaveBeenCalled();
  });

  it('popup 消息先于原生预览的静音播放回退时，播放后仍使用新音量', async () => {
    let listener: ((message: { type: string; volume: number }, sender: unknown, respond: (response: unknown) => void) => void) | undefined;
    const sendMessage = vi.fn((_tabId: number, message: { type: string; volume: number }) => listener?.(message, {}, vi.fn()));
    vi.stubGlobal('chrome', {
      runtime: { onMessage: { addListener: vi.fn((fn) => { listener = fn; }) } },
      tabs: { sendMessage },
    });
    let rejectPlay: ((error: Error) => void) | undefined;
    vi.spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectPlay = reject; }))
      .mockResolvedValue(undefined);
    document.body.innerHTML = '<video id="preview-video" src="/clip.mp4" muted></video><video id="unrelated"></video><div id="cover"></div>';
    const preview = document.querySelector<HTMLVideoElement>('#preview-video');
    const unrelated = document.querySelector<HTMLVideoElement>('#unrelated');
    const cover = document.querySelector<HTMLElement>('#cover');
    expect(preview).not.toBeNull();
    expect(cover).not.toBeNull();

    await installPreviewVolumeControl();
    attachNativeJavdbPreview(cover as HTMLElement, 0.2);
    chrome.tabs.sendMessage(42, { type: 'volume-changed', volume: 0.65 });
    expect(sendMessage).toHaveBeenCalledWith(42, { type: 'volume-changed', volume: 0.65 });
    expect(preview?.muted).toBe(false);
    expect(preview?.volume).toBe(0.65);

    rejectPlay?.(new Error('Autoplay requires muted playback'));
    await vi.waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2));
    expect(preview?.muted).toBe(true);
    preview?.dispatchEvent(new Event('playing'));
    expect(preview?.muted).toBe(false);
    expect(preview?.volume).toBe(0.65);
    expect(unrelated?.muted).toBe(false);
    expect(unrelated?.volume).toBe(1);
  });

  it('原站播放中覆盖静音与音量时恢复 popup 设置，不触碰普通视频或未打开的预览', async () => {
    let listener: ((message: { type: string; volume: number }, sender: unknown, respond: (response: unknown) => void) => void) | undefined;
    vi.stubGlobal('chrome', { runtime: { onMessage: { addListener: vi.fn((fn) => { listener = fn; }) } } });
    document.body.innerHTML = '<div class="fancybox-is-open"><video id="preview-video" src="/clip.mp4"></video></div><video id="other"></video><video class="fancybox-video" id="closed" src="/closed.mp4" muted></video>';
    const preview = document.querySelector<HTMLVideoElement>('#preview-video');
    const other = document.querySelector<HTMLVideoElement>('#other');
    const closed = document.querySelector<HTMLVideoElement>('#closed');
    if (closed) closed.muted = true;
    await installPreviewVolumeControl();
    listener?.({ type: 'volume-changed', volume: 0.7 }, {}, vi.fn());

    if (preview) {
      preview.muted = true;
      preview.volume = 0.1;
      preview.dispatchEvent(new Event('volumechange'));
    }
    expect(preview?.muted).toBe(false);
    expect(preview?.volume).toBe(0.7);
    expect(closed?.muted).toBe(true);
    expect(closed?.volume).toBe(1);
    other?.dispatchEvent(new Event('volumechange'));
    expect(other?.volume).toBe(1);
  });

  it('原站视频在 Fancybox 容器外播放时仍能实时更新，静止的候选预览不解除静音', async () => {
    let listener: ((message: { type: string; volume: number }, sender: unknown, respond: (response: unknown) => void) => void) | undefined;
    vi.stubGlobal('chrome', { runtime: { onMessage: { addListener: vi.fn((fn) => { listener = fn; }) } } });
    document.body.innerHTML = '<video id="preview-video" src="/native.mp4"></video><video class="fancybox-video" src="/closed.mp4"></video>';
    const native = document.querySelector<HTMLVideoElement>('#preview-video');
    const closed = document.querySelector<HTMLVideoElement>('.fancybox-video');
    if (native) Object.defineProperty(native, 'paused', { value: false });
    if (closed) closed.muted = true;
    await installPreviewVolumeControl();

    listener?.({ type: 'volume-changed', volume: 0.8 }, {}, vi.fn());
    expect(native?.volume).toBe(0.8);
    expect(native?.muted).toBe(false);
    expect(closed?.muted).toBe(true);
    expect(closed?.volume).toBe(1);
  });
});
