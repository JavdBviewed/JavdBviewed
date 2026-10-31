/**
 * @vitest-environment jsdom
 * @file onlineAvailability.recheck.test.ts
 * @description D 项 P2：面板"重检此番号"按钮——force 绕过缓存重探 + 按钮结构
 * @module features/onlineAvailability
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../platform/browser', () => ({
  extractVideoIdFromPage: vi.fn(() => 'abc-123'),
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
import { getOrFetchSessionResult } from '../../platform/storage/sessionResultCache';
import type { OnlineAvailabilitySite } from './index';

const parserSite: OnlineAvailabilitySite = {
  key: '123av',
  name: '123AV',
  url: 'https://123av.com/zh/search?keyword={{code}}',
  fetchType: 'parser',
  enabled: true,
};

const getSite: OnlineAvailabilitySite = {
  key: 'fanza',
  name: 'FANZA 動画',
  url: 'https://www.dmm.co.jp/digital/videoa/-/detail/=/cid={{code}}/',
  fetchType: 'get',
  enabled: true,
};

describe('onlineAvailability 重检按钮（D 项 P2）', () => {
  let manager: OnlineAvailabilityManager;

  beforeEach(() => {
    document.body.innerHTML = '<div class="top-meta"></div>';
    vi.mocked(getOrFetchSessionResult).mockImplementation(async (_ns, identity) => ({
      data: { siteKey: String(identity), siteName: '', available: true, url: '', tags: [] },
      fromCache: true,
    }));
    manager = new OnlineAvailabilityManager();
    manager.updateConfig({ autoCheck: true, sites: [parserSite, getSite] });
  });

  afterEach(() => {
    manager.destroy();
    document.body.innerHTML = '';
  });

  it('recheckCurrentVideo：force=true 覆盖全部启用站，自动检测保持非 force', async () => {
    await manager.initialize();
    await manager.recheckCurrentVideo();

    const calls = vi.mocked(getOrFetchSessionResult).mock.calls;
    const forceCalls = calls.filter(call => (call[3] as { force?: boolean }).force === true);
    const autoCalls = calls.filter(call => call[3]?.force !== true);
    expect(autoCalls.length).toBe(2);
    expect(forceCalls.length).toBe(2);
  });

  it('无当前番号：recheckCurrentVideo 不发请求', async () => {
    const idle = new OnlineAvailabilityManager();
    await idle.recheckCurrentVideo();
    expect(getOrFetchSessionResult).not.toHaveBeenCalled();
  });

  it('面板含"重检"按钮：复用 Bulma 类，位于面板尾部（结果区之后）', async () => {
    await manager.initialize();

    const panel = document.getElementById('jdb-online-availability-panel');
    expect(panel).not.toBeNull();
    const button = panel!.querySelector<HTMLButtonElement>('.jdb-online-recheck');
    expect(button).not.toBeNull();
    expect(button!.textContent).toBe('重检');
    expect(button!.className).toContain('button is-light is-small');
    expect(button!.title).toContain('重新检测此番号');
    expect(panel!.querySelector('.jdb-online-availability-links')).not.toBeNull();
    expect(panel!.lastElementChild).toBe(button);
  });
});
