/**
 * @vitest-environment jsdom
 * @file missavVariant.test.ts
 * @description 10-31-ext-missav-multi-version（10-31-ext-onlineavail-lazy-click G3 改写）：
 * missav 双版本（有码/无码）探测 → 主链接=有码真页 + alternatives=无码真页（双选项）
 * 口径：
 * - 主探 available 且 site.key==='missav' → 二次探 {code}-uncensored-leak（同 checkSiteUrl 通路/32KB 窗口/force 透传/各自缓存）
 * - 双 available → result.url 保持 base 真页，tags 追加「有码」，alternatives=[{url: leak 真页, label:'无码'}]
 * - 二次探不可用 / 主探不可用 / 非 missav 站点 → 行为与请求数零变化
 * fixture=合成最小 HTML（canonical/og:url/title 含 code 的 detail 页），
 * 经 new DOMParser().parseFromString(html.slice(0, 32768), 'text/html') 模拟 maxBodyBytes 截断。
 * @module features/onlineAvailability
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../platform/network/httpClient', () => ({
  defaultHttpClient: { getDocument: vi.fn() },
}));
vi.mock('../../platform/storage/sessionResultCache', () => ({
  getOrFetchSessionResult: vi.fn(),
}));

import { defaultHttpClient } from '../../platform/network/httpClient';
import { getOrFetchSessionResult } from '../../platform/storage/sessionResultCache';
import {
  DEFAULT_ONLINE_AVAILABILITY_SITES,
  OnlineAvailabilityManager,
  buildMissavVariantUrl,
  type OnlineAvailabilitySite,
} from './index';

const PROBE_PREFIX_BYTES = 32768;

/** 有码 base 详情页：canonical 含 code + 中文字幕 tag（subQuery 命中） */
const CENSORED_PAGE = `<!DOCTYPE html><html><head>
<title>FTHTD-243 有一天早晨醒來，發現自己緊貼著一個完全陌生的人</title>
<link rel="canonical" href="https://missav.ws/fthtd-243">
<meta property="og:url" content="https://missav.ws/fthtd-243">
</head><body>
<div class="space-y-2"><a class="text-nord13" href="https://missav.ws/chinese-subtitle">中文字幕</a></div>
<p>番號：FTHTD-243</p>
</body></html>`;

/** 无码 leak 详情页：canonical 含 code-uncensored-leak（32KB 窗口内天然含 code） */
const LEAK_PAGE = `<!DOCTYPE html><html><head>
<title>FTHTD-243 有一天早晨醒來（無碼流出）</title>
<link rel="canonical" href="https://missav.ws/fthtd-243-uncensored-leak">
<meta property="og:url" content="https://missav.ws/fthtd-243-uncensored-leak">
</head><body><p>番號：FTHTD-243</p></body></html>`;

/** fanza 详情页：data-pid 含 cid（fanza productData 信号链；
 * jsdom/nwsapi 不匹配含 '=' 的属性选择器，canonical 分支在真浏览器生效，测试走 data-pid 通道） */
const FANZA_PAGE = `<!DOCTYPE html><html><head>
<title>AB-12345 Sample Detail</title>
<link rel="canonical" href="https://www.dmm.co.jp/digital/videoa/-/detail/=/cid/ab12345/">
</head><body><div data-pid="ab12345"></div><span>AB-12345</span></body></html>`;

function toDoc(html: string): Document {
  // 模拟 get 型探测的 maxBodyBytes 截断（32KB 前缀）
  return new DOMParser().parseFromString(html.slice(0, PROBE_PREFIX_BYTES), 'text/html');
}

const missavSite: OnlineAvailabilitySite | undefined = DEFAULT_ONLINE_AVAILABILITY_SITES.find(s => s.key === 'missav');
const fanzaSite: OnlineAvailabilitySite | undefined = DEFAULT_ONLINE_AVAILABILITY_SITES.find(s => s.key === 'fanza');
if (!missavSite || !fanzaSite) throw new Error('missing default sites: missav/fanza');

function makeManager(sites: OnlineAvailabilitySite[]): OnlineAvailabilityManager {
  const mgr = new OnlineAvailabilityManager();
  mgr.updateConfig({
    enabled: true,
    autoCheck: false,
    showUnavailable: true,
    timeoutMs: 8000,
    sites,
  });
  return mgr;
}

async function checkSite(mgr: OnlineAvailabilityManager, site: OnlineAvailabilitySite, videoId: string, force = false): Promise<any> {
  return (mgr as any).checkSite(site, videoId, force);
}

describe('onlineAvailability missav 双版本探测（10-31-ext-missav-multi-version）', () => {
  beforeEach(() => {
    // 透传 fetcher：每次 checkSiteUrl 都真实走 getDocument + parse 链；options 记录在 call[3]
    vi.mocked(getOrFetchSessionResult).mockImplementation(
      async (_ns: string, _id: string, fetcher: () => Promise<unknown>) => ({ data: await fetcher(), fromCache: false }),
    );
    vi.mocked(defaultHttpClient.getDocument).mockReset();
  });

  it('双版本（主 available + leak available）→ url=base 真页、tags 追加「有码」、alternatives=无码真页（G3 双选项）', async () => {
    vi.mocked(defaultHttpClient.getDocument)
      .mockResolvedValueOnce(toDoc(CENSORED_PAGE))
      .mockResolvedValueOnce(toDoc(LEAK_PAGE));
    const mgr = makeManager([missavSite]);

    const result = await checkSite(mgr, missavSite, 'FTHTD-243');

    expect(defaultHttpClient.getDocument).toHaveBeenCalledTimes(2);
    expect(vi.mocked(defaultHttpClient.getDocument).mock.calls[0][0]).toBe('https://missav.ws/fthtd-243/');
    expect(vi.mocked(defaultHttpClient.getDocument).mock.calls[1][0]).toBe('https://missav.ws/fthtd-243-uncensored-leak/');
    expect(result.available).toBe(true);
    expect(result.url).toBe('https://missav.ws/fthtd-243/');
    expect(result.siteKey).toBe('missav');
    expect(result.tags).toEqual(['字幕', '有码']);
    expect(result.alternatives).toEqual([
      { url: 'https://missav.ws/fthtd-243-uncensored-leak/', label: '无码' },
    ]);
  });

  it('单版本（主 available + leak 404 reject）→ url=主 detail 页、available 保留', async () => {
    vi.mocked(defaultHttpClient.getDocument)
      .mockResolvedValueOnce(toDoc(CENSORED_PAGE))
      .mockRejectedValueOnce(new Error('HTTP 404'));
    const mgr = makeManager([missavSite]);

    const result = await checkSite(mgr, missavSite, 'FTHTD-243');

    expect(defaultHttpClient.getDocument).toHaveBeenCalledTimes(2);
    expect(result.available).toBe(true);
    expect(result.url).toBe('https://missav.ws/fthtd-243/');
    expect(result.tags).toEqual(['字幕']);
  });

  it('主探不可用 → getDocument 恰好 1 次（不触发二次探，成本守卫）', async () => {
    vi.mocked(defaultHttpClient.getDocument).mockRejectedValueOnce(new Error('HTTP 404'));
    const mgr = makeManager([missavSite]);

    const result = await checkSite(mgr, missavSite, 'FTHTD-243');

    expect(defaultHttpClient.getDocument).toHaveBeenCalledTimes(1);
    expect(result.available).toBe(false);
    expect(result.url).toBe('https://missav.ws/fthtd-243/');
  });

  it('force 透传：两次 getOrFetchSessionResult 的 options.force 均等于入参', async () => {
    const dual = () =>
      vi.mocked(defaultHttpClient.getDocument)
        .mockResolvedValueOnce(toDoc(CENSORED_PAGE))
        .mockResolvedValueOnce(toDoc(LEAK_PAGE));

    const forceMgr = makeManager([missavSite]);
    dual();
    await checkSite(forceMgr, missavSite, 'FTHTD-243', true);
    const forceCalls = vi.mocked(getOrFetchSessionResult).mock.calls;
    expect(forceCalls).toHaveLength(2);
    for (const call of forceCalls) {
      expect((call[3] as { force?: boolean }).force).toBe(true);
    }

    vi.mocked(getOrFetchSessionResult).mockClear();
    const autoMgr = makeManager([missavSite]);
    dual();
    await checkSite(autoMgr, missavSite, 'FTHTD-243', false);
    const autoCalls = vi.mocked(getOrFetchSessionResult).mock.calls;
    expect(autoCalls).toHaveLength(2);
    for (const call of autoCalls) {
      expect((call[3] as { force?: boolean }).force).toBe(false);
    }
  });

  it('非 missav 站点（fanza）available → getDocument 恰好 1 次（零行为变化）', async () => {
    vi.mocked(defaultHttpClient.getDocument).mockResolvedValueOnce(toDoc(FANZA_PAGE));
    const mgr = makeManager([fanzaSite]);

    const result = await checkSite(mgr, fanzaSite, 'AB-12345');

    expect(defaultHttpClient.getDocument).toHaveBeenCalledTimes(1);
    expect(result.available).toBe(true);
    expect(result.url).toBe('https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=AB12345/');
  });

  it('buildMissavVariantUrl 纯函数 URL 形状锁（路径 code 小写 + trim）+ 源码锁（仅 missav 调用点）', () => {
    expect(buildMissavVariantUrl(missavSite, 'FTHTD-243')).toBe('https://missav.ws/fthtd-243-uncensored-leak/');
    expect(buildMissavVariantUrl(missavSite, ' fthtd-243 ')).toBe('https://missav.ws/fthtd-243-uncensored-leak/');
    expect(buildMissavVariantUrl(missavSite, 'FthTd-243')).toBe('https://missav.ws/fthtd-243-uncensored-leak/');

    // 源码锁：variant 仅 1 个定义 + 1 个调用点（调用点位于 key==='missav' 守卫内）
    const source = readFileSync(resolve(process.cwd(), 'apps/extension/src/features/onlineAvailability/index.ts'), 'utf8');
    expect(source.match(/buildMissavVariantUrl\s*\(/g)).toHaveLength(2);
    expect(source).not.toContain('buildMissavSearchUrl');
    expect(source).toContain("site.key === 'missav'");
  });
});
