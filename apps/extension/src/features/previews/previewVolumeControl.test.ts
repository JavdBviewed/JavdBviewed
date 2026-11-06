// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/storage', () => ({ getSettings: vi.fn(async () => ({ listEnhancement: { previewVolume: 0.2 } })) }));
vi.mock('../contentState', () => ({ log: vi.fn() }));
vi.mock('./previewVideoPreload', () => ({ activatePreviewVideoPreload: vi.fn(), releasePreviewVideoMedia: vi.fn() }));

import { installPreviewVolumeControl } from './previewVolumeControl';
import { activatePreviewVideoPreload } from './previewVideoPreload';

describe('popup 音量变更实时更新影片页预览', () => {
  afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

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
});
