/**
 * @file extractStreamUrl.test.ts
 * @description 115 播放响应解析单测
 * @module features/drive115
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractStreamUrlFromPlayResponse, getDrive115V2Service, inferDrive115StreamType, maskDrive115StreamUrlForLog } from './index';

describe('extractStreamUrlFromPlayResponse', () => {
  it('reads nested video_url map', () => {
    expect(
      extractStreamUrlFromPlayResponse({
        state: true,
        data: { video_url: { '1': 'https://cdn.example/a.m3u8' } },
      }),
    ).toBe('https://cdn.example/a.m3u8');
  });

  it('reads direct url field', () => {
    expect(
      extractStreamUrlFromPlayResponse({
        data: { url: 'https://cdn.example/v.mp4' },
      }),
    ).toBe('https://cdn.example/v.mp4');
  });

  it('returns undefined when empty', () => {
    expect(extractStreamUrlFromPlayResponse({ state: true, data: {} })).toBeUndefined();
  });
});

describe('inferDrive115StreamType', () => {
  it('marks video_url responses as m3u8 even when the CDN URL has no m3u8 suffix', () => {
    expect(
      inferDrive115StreamType({
        url: 'https://stream.example/opaque-token-path?token=secret',
        raw: { state: true, data: { video_url: { hd: 'https://stream.example/opaque-token-path?token=secret' } } },
        endpointKind: 'video_play',
      }),
    ).toBe('m3u8');
  });

  it('masks signed stream query parameters in logs', () => {
    expect(maskDrive115StreamUrlForLog('https://stream.example/video.m3u8?token=secret&uid=1')).toBe('https://stream.example/video.m3u8');
  });
});

describe('Drive115V2Service playback/download URL requests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts pick_code as form-data and reads nested downurl response', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      json: async () => ({
        state: true,
        data: {
          '2323423573680609857': {
            file_name: 'poster.jpg',
            pick_code: 'cover-pick',
            url: { url: 'https://download.example/poster.jpg' },
          },
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const ret = await getDrive115V2Service().getFileDownloadUrl({
      accessToken: 'token',
      pickCode: 'cover-pick',
    });

    expect(ret).toMatchObject({ success: true, url: 'https://download.example/poster.jpg' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://proapi.115.com/open/ufile/downurl');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer token',
      Accept: 'application/json',
    });
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('pick_code')).toBe('cover-pick');
  });

  it('prefers POST downurl for playable direct video before HLS video/play', async () => {
    vi.stubGlobal('chrome', undefined);
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

    const ret = await getDrive115V2Service().getVideoPlayInfo({
      accessToken: 'token',
      pickCode: 'video-pick',
    });

    expect(ret).toMatchObject({
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

  it('falls back to POST video/play when downurl has no playable URL', async () => {
    vi.stubGlobal('chrome', undefined);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => ({
      ok: true,
      json: async () => {
        if (url === 'https://proapi.115.com/open/video/play' && init?.method === 'POST') {
          return {
            state: true,
            data: { video_url: { hd: 'https://stream.example/video.m3u8' } },
          };
        }
        return { state: false, message: 'no stream' };
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const ret = await getDrive115V2Service().getVideoPlayInfo({
      accessToken: 'token',
      pickCode: 'video-pick',
    });

    expect(ret).toMatchObject({
      success: true,
      streamUrl: 'https://stream.example/video.m3u8',
      streamType: 'm3u8',
      endpoint: 'https://proapi.115.com/open/video/play',
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const [url, init] = fetchMock.mock.calls[3] as [string, RequestInit];
    expect(url).toBe('https://proapi.115.com/open/video/play');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('pick_code')).toBe('video-pick');
  });
});
