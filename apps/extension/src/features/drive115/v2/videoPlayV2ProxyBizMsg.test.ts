/**
 * @file videoPlayV2ProxyBizMsg.test.ts
 * @description 115 v2 后台代理（SW 侧）drive115.video_play_v2 分支错误上报（G1b）：
 * 与直连循环同形——首个真实业务错误（bizMsg）优先、POST /open/video/play 端点已删、
 * 每端点结果日志（[115Proxy] 通道）。复用 backgroundProxy.test.ts 既有 stub chrome/fetch 模式。
 * @module features/drive115
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDrive115V2Proxy } from './backgroundProxy';

const BASE = 'https://proapi.115.com';
const CODE = 'pc-123';
const DOWNURL = `${BASE}/open/ufile/downurl`;
const EP2 = `${BASE}/open/video/play?pick_code=${encodeURIComponent(CODE)}`;
const EP3 = `${BASE}/open/video/play?pickcode=${encodeURIComponent(CODE)}`;

const SUCCESS_BODY = {
  state: true,
  data: { 2323423573680609857: { url: { url: 'https://download.example/video.mp4?token=secret' } } },
};

let listener: ((message: any, sender: any, sendResponse: (r: any) => void) => boolean | void) | undefined;

function jsonResp(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function callHandler(): Promise<any> {
  expect(listener).toBeDefined();
  return new Promise<any>((resolve) => {
    const keep = listener?.(
      { type: 'drive115.video_play_v2', payload: { accessToken: 'tok', pickCode: CODE, baseUrl: BASE } },
      {},
      resolve,
    );
    expect(keep).toBe(true);
  });
}

beforeEach(() => {
  listener = undefined;
  vi.stubGlobal('chrome', {
    runtime: { onMessage: { addListener: (fn: any) => { listener = fn; } } },
  });
  installDrive115V2Proxy();
});

afterEach(() => {
  delete (globalThis as any).__drive115_v2_proxy_flag;
  vi.unstubAllGlobals();
});

describe('SW 侧 video_play_v2 取流错误上报（G1b）', () => {
  it('端点1 bizMsg + 端点2/3 网络错 → {success:false, message: 首个 bizMsg}，请求恰 3 次，POST /open/video/play 零请求', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === DOWNURL && init?.method === 'POST') return jsonResp(200, { state: false, message: 'pick_code 已失效' });
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    const resp = await callHandler();

    expect(resp).toMatchObject({ success: false, message: 'pick_code 已失效' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([DOWNURL, EP2, EP3]);
    expect(fetchMock.mock.calls.every((c) => String(c[0]) !== `${BASE}/open/video/play`)).toBe(true);
  });

  it('全端点网络错 → 终态文案「后台取流请求失败」不变（无 bizMsg 回退语义不变），请求恰 3 次', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    const resp = await callHandler();

    expect(resp).toEqual({ success: false, message: '后台取流请求失败' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('端点1 成功 → sendResponse 形状与基线逐字段一致（成功路径零变化），请求恰 1 次', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === DOWNURL) return jsonResp(200, SUCCESS_BODY);
      throw new Error(`unexpected: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const resp = await callHandler();

    expect(resp).toEqual({
      success: true,
      streamUrl: 'https://download.example/video.mp4?token=secret',
      streamType: 'mp4',
      raw: SUCCESS_BODY,
      endpoint: DOWNURL,
      debugSafeUrl: 'https://download.example/video.mp4',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('首个 bizMsg 优先：端点1 bizMsg A + 端点2 bizMsg B + 端点3 网络错 → message=A', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === DOWNURL && init?.method === 'POST') return jsonResp(200, { state: false, message: 'A' });
      if (url === EP2) return jsonResp(200, { state: false, message: 'B' });
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    const resp = await callHandler();

    expect(resp).toMatchObject({ success: false, message: 'A' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('每端点结果日志条数=请求数（SW 侧走既有 [115Proxy] 通道）', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === DOWNURL && init?.method === 'POST') return jsonResp(200, { state: false, message: 'biz-A' });
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    await callHandler();

    const resultLines = infoSpy.mock.calls.filter((c) => String(c[0]).includes('取流结果'));
    expect(resultLines).toHaveLength(3);
  });
});
