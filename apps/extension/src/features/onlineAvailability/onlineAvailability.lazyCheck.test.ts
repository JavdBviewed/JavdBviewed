/**
 * @vitest-environment jsdom
 * @file onlineAvailability.lazyCheck.test.ts
 * @description 10-31-ext-onlineavail-lazy-click G1 点击触发检查（零自动探测）：
 * - autoCheck=false 时 initialize 首帧=「未检测」态+「开始检测」按钮，零探测外发
 * - 点「开始检测」=正常缓存读（force 非 true），完成后按钮回落「重检」
 * - 检测中按钮 disabled+「检测中…」，重复点击忽略（防重入）
 * - 首次检测后按钮点击=force 重探（既有 force 语义保留）
 * - autoCheck=true 既有路径自探仍生效（回归锁）
 * G3 渲染：alternatives 主链接后逐条绿 tag 链接
 * @module features/onlineAvailability
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../platform/browser', () => ({
  extractVideoIdFromPage: vi.fn(() => 'FTHTD-243'),
}));

vi.mock('../../platform/network/httpClient', () => ({
  defaultHttpClient: { getDocument: vi.fn() },
}));

vi.mock('../../platform/storage/sessionResultCache', () => ({
  getOrFetchSessionResult: vi.fn(),
}));

vi.mock('../detailEnhancementPanel', () => ({
  ensureDetailEnhancementPanel: vi.fn(() => null),
}));

import { OnlineAvailabilityManager } from './index';
import { defaultHttpClient } from '../../platform/network/httpClient';
import { getOrFetchSessionResult } from '../../platform/storage/sessionResultCache';
import type { OnlineAvailabilityResult, OnlineAvailabilitySite } from './index';

const fanzaSite: OnlineAvailabilitySite = {
  key: 'fanza',
  name: 'FANZA 動画',
  url: 'https://www.dmm.co.jp/digital/videoa/-/detail/=/cid={{code}}/',
  fetchType: 'get',
  enabled: true,
};

const FANZA_URL = 'https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=FTHTD243/';

function availableResult(): OnlineAvailabilityResult {
  return { siteKey: 'fanza', siteName: 'FANZA 動画', available: true, url: FANZA_URL, tags: [] };
}

describe('onlineAvailability 点击触发（10-31-ext-onlineavail-lazy-click G1）', () => {
  let manager: OnlineAvailabilityManager;

  beforeEach(() => {
    document.body.innerHTML = '<div class="top-meta"></div>';
    vi.mocked(getOrFetchSessionResult).mockImplementation(async () => ({
      data: availableResult(),
      fromCache: true,
    }));
    manager = new OnlineAvailabilityManager();
    manager.updateConfig({
      enabled: true,
      autoCheck: false,
      showUnavailable: true,
      timeoutMs: 8000,
      sites: [fanzaSite],
    });
  });

  afterEach(() => {
    manager.destroy();
    document.body.innerHTML = '';
  });

  function panelButton(): HTMLButtonElement {
    const button = document.querySelector<HTMLButtonElement>('#jdb-online-availability-panel .jdb-online-recheck');
    if (!button) throw new Error('panel button missing');
    return button;
  }

  it('initialize（autoCheck=false）：首帧「未检测」+「开始检测」按钮，零探测外发', async () => {
    await manager.initialize();

    const panel = document.getElementById('jdb-online-availability-panel');
    expect(panel).not.toBeNull();
    expect(panel!.querySelector('.jdb-online-status')!.textContent).toBe('未检测');
    const button = panelButton();
    expect(button.textContent).toBe('开始检测');
    expect(button.disabled).toBe(false);
    expect(getOrFetchSessionResult).not.toHaveBeenCalled();
    expect(defaultHttpClient.getDocument).not.toHaveBeenCalled();
  });

  it('点「开始检测」：正常缓存读（force 非 true），完成后按钮回落「重检」且结果渲染', async () => {
    await manager.initialize();
    panelButton().click();

    await vi.waitFor(() => {
      expect(getOrFetchSessionResult).toHaveBeenCalledTimes(1);
    });
    expect((getOrFetchSessionResult.mock.calls[0][3] as { force?: boolean }).force).not.toBe(true);

    await vi.waitFor(() => expect(panelButton().textContent).toBe('重检'));
    expect(panelButton().disabled).toBe(false);
    const link = document.querySelector<HTMLAnchorElement>('#jdb-online-availability-panel a.tag.is-success');
    expect(link).not.toBeNull();
    expect(link!.href).toBe(FANZA_URL);
  });

  it('检测中：按钮 disabled+「检测中…」，重复点击忽略（防重入）', async () => {
    let release!: (value: { data: OnlineAvailabilityResult; fromCache: boolean }) => void;
    vi.mocked(getOrFetchSessionResult).mockImplementation(
      () => new Promise(resolve => { release = resolve; }),
    );
    await manager.initialize();
    panelButton().click();

    await vi.waitFor(() => expect(panelButton().disabled).toBe(true));
    expect(panelButton().textContent).toBe('检测中…');
    panelButton().click(); // 检测中重复点击

    release({ data: availableResult(), fromCache: true });
    await vi.waitFor(() => expect(panelButton().textContent).toBe('重检'));
    expect(getOrFetchSessionResult).toHaveBeenCalledTimes(1);
  });

  it('首次检测后按钮点击=force 重探（既有 force 语义保留）', async () => {
    await manager.initialize();
    panelButton().click();
    await vi.waitFor(() => expect(panelButton().textContent).toBe('重检'));

    vi.mocked(getOrFetchSessionResult).mockClear();
    panelButton().click();
    await vi.waitFor(() => {
      expect(getOrFetchSessionResult).toHaveBeenCalledTimes(1);
      expect((getOrFetchSessionResult.mock.calls[0][3] as { force?: boolean }).force).toBe(true);
    });
  });

  it('autoCheck=true 既有路径：initialize 自探仍生效（回归锁）', async () => {
    manager.updateConfig({ autoCheck: true });
    await manager.initialize();

    expect(getOrFetchSessionResult).toHaveBeenCalledTimes(1);
    expect(panelButton().textContent).toBe('重检');
  });

  it('renderResults：alternatives 主链接后逐条绿 tag 链接（G3 渲染）', () => {
    const main: OnlineAvailabilityResult = {
      siteKey: 'missav',
      siteName: 'MISSAV',
      available: true,
      url: 'https://missav.ws/fthtd-243/',
      tags: ['字幕', '有码'],
      alternatives: [{ url: 'https://missav.ws/fthtd-243-uncensored-leak/', label: '无码' }],
    };
    const other: OnlineAvailabilityResult = {
      siteKey: 'fanza',
      siteName: 'FANZA 動画',
      available: true,
      url: FANZA_URL,
      tags: [],
    };

    (manager as any).renderResults([main, other], 2);

    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('#jdb-online-availability-panel a.tag.is-success'));
    expect(links).toHaveLength(3);
    expect(links[0].textContent).toBe('MISSAV 字幕 有码');
    expect(links[0].href).toBe('https://missav.ws/fthtd-243/');
    expect(links[1].textContent).toBe('MISSAV 无码');
    expect(links[1].href).toBe('https://missav.ws/fthtd-243-uncensored-leak/');
    expect(links[1].target).toBe('_blank');
    expect(links[1].rel).toContain('noopener');
    expect(links[2].textContent).toBe('FANZA 動画');
  });
});
