/**
 * @file videoPlayInfoBizMsg.test.ts
 * @description getVideoPlayInfo 直连取流错误上报：首个真实业务错误（bizMsg）优先、
 * 不存在的 POST /open/video/play 端点已删、每端点结果 debug 日志（替换「尝试取流」尝试日志）。
 * node 环境无 chrome 全局 → SW 前置分支自然跳过，走直连端点循环。
 * @module features/drive115
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDrive115V2Service } from './index';

const BASE = 'https://proapi.115.com';
const CODE = 'pc-123';
const DOWNURL = `${BASE}/open/ufile/downurl`;
const EP2 = `${BASE}/open/video/play?pick_code=${encodeURIComponent(CODE)}`;
const EP3 = `${BASE}/open/video/play?pickcode=${encodeURIComponent(CODE)}`;

const SUCCESS_BODY = {
  state: true,
  data: { 2323423573680609857: { url: { url: 'https://download.example/video.mp4?token=secret' } } },
};

function jsonResp(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getVideoPlayInfo 直连取流错误上报（G1）', () => {
  it('端点1 业务错误优先：最终 message=首个 bizMsg，请求恰 3 次，POST /open/video/play 零请求', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === DOWNURL && init?.method === 'POST') return jsonResp(200, { state: false, message: 'pick_code 已失效' });
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getDrive115V2Service().getVideoPlayInfo({ accessToken: 'tok', pickCode: CODE });

    expect(result.success).toBe(false);
    expect(result.message).toBe('pick_code 已失效');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([DOWNURL, EP2, EP3]);
    expect(fetchMock.mock.calls.every((c) => String(c[0]) !== `${BASE}/open/video/play`)).toBe(true);
  });

  it('全端点网络错（无 bizMsg）：回退末轮 lastMsg 文案，请求恰 3 次', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getDrive115V2Service().getVideoPlayInfo({ accessToken: 'tok', pickCode: CODE });

    expect(result).toEqual({ success: false, message: 'Failed to fetch' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('端点1 成功：返回形状与基线逐字段一致（成功路径零变化），请求恰 1 次', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === DOWNURL) return jsonResp(200, SUCCESS_BODY);
      throw new Error(`unexpected: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getDrive115V2Service().getVideoPlayInfo({ accessToken: 'tok', pickCode: CODE });

    expect(result).toEqual({
      success: true,
      streamUrl: 'https://download.example/video.mp4?token=secret',
      streamType: 'mp4',
      raw: SUCCESS_BODY,
      endpoint: DOWNURL,
      debugSafeUrl: 'https://download.example/video.mp4',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('首个成功即停：端点1 成功且端点2 有 bizMsg → message 不含端点2 错误，请求恰 1 次', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === DOWNURL) return jsonResp(200, SUCCESS_BODY);
      if (url === EP2) return jsonResp(200, { state: false, message: 'ep2-biz' });
      throw new Error(`unexpected: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getDrive115V2Service().getVideoPlayInfo({ accessToken: 'tok', pickCode: CODE });

    expect(result.success).toBe(true);
    expect(result.message).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('每端点结果 debug 日志条数=请求数，旧「尝试取流」尝试日志已替换', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === DOWNURL && init?.method === 'POST') return jsonResp(200, { state: false, message: 'biz-A' });
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    await getDrive115V2Service().getVideoPlayInfo({ accessToken: 'tok', pickCode: CODE });

    const resultLines = infoSpy.mock.calls.filter((c) => String(c[0]).includes('取流结果'));
    expect(resultLines).toHaveLength(3);
    expect(infoSpy.mock.calls.filter((c) => String(c[0]).includes('尝试取流'))).toHaveLength(0);
  });

  it('bizMsg 判定：state===false 取 json.message || json.error 非空值', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === DOWNURL && init?.method === 'POST') return jsonResp(200, { state: false, error: 'file not found' });
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getDrive115V2Service().getVideoPlayInfo({ accessToken: 'tok', pickCode: CODE });

    expect(result).toEqual({ success: false, message: 'file not found' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
