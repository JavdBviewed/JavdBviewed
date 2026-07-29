/**
 * @file backgroundProxy.test.ts
 * @description 115 v2 后台代理单测
 * @module features/drive115
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installDrive115V2Proxy } from './backgroundProxy';

describe('installDrive115V2Proxy video playback proxy', () => {
  afterEach(() => {
    delete (globalThis as any).__drive115_v2_proxy_flag;
    vi.unstubAllGlobals();
  });

  it('tries POST downurl before HLS video/play for playback', async () => {
    let listener: ((message: any, sender: any, sendResponse: (response: any) => void) => boolean | void) | undefined;
    const addListener = vi.fn((fn) => {
      listener = fn;
    });
    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: { addListener },
      },
    });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => ({
      ok: true,
      json: async () => {
        if (url === 'https://proapi.115.com/open/ufile/downurl' && init?.method === 'POST') {
          return {
            state: true,
            data: {
              '2323423573680609857': {
                url: { url: 'https://download.example/video.mp4?token=secret' },
              },
            },
          };
        }
        if (url === 'https://proapi.115.com/open/video/play' && init?.method === 'POST') {
          return {
            state: true,
            data: { video_url: { hd: 'https://stream.example/video.m3u8' } },
          };
        }
        return { state: false, message: 'Method GET does not exist' };
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    installDrive115V2Proxy();

    expect(listener).toBeDefined();
    const responsePromise = new Promise<any>((resolve) => {
      const keepAlive = listener?.(
        {
          type: 'drive115.video_play_v2',
          payload: { accessToken: 'token', pickCode: 'video-pick' },
        },
        {},
        resolve,
      );
      expect(keepAlive).toBe(true);
    });

    await expect(responsePromise).resolves.toMatchObject({
      success: true,
      streamUrl: 'https://download.example/video.mp4?token=secret',
      streamType: 'mp4',
      endpoint: 'https://proapi.115.com/open/ufile/downurl',
      debugSafeUrl: 'https://download.example/video.mp4',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://proapi.115.com/open/ufile/downurl');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('pick_code')).toBe('video-pick');
  });
});
