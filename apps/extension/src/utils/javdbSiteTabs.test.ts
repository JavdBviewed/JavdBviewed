/**
 * @file javdbSiteTabs.test.ts
 * @description 站点 tab 广播 helper 单测（09-29-settings-broadcast-hosts）：
 *   ① 纯函数模式构造（manifest 注入/缺省 chrome 读取/过滤/保序去重/空源兜底）；
 *   ② sendToJavdbSiteTabs 广播行为（tab.id 去重/单 tab 失败静默/恒 resolve）；
 *   ③ 广播点走 helper 的源码级锁定（legacy EnhancementSettings.ts 不再硬编码
 *      `*://javdb.com/*` tabs.query）。
 * @module utils
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { getJavdbSiteTabUrlPatterns, sendToJavdbSiteTabs } from './javdbSiteTabs';

/** 与 src/manifest.json content_scripts[0].matches 一致的站点主机集（09-29 基线）。 */
const SITE_PATTERNS = [
  '*://*.javbus.com/*',
  '*://*.javdb.com/*',
  '*://javdb.com/*',
  '*://javdb570.com/*',
  '*://javdb575.com/*',
];

/** 完整 manifest fixture：站点集 + 各类应排除条目（localhost/115/captchaapi/all_urls）。 */
const REALISTIC_MANIFEST = {
  content_scripts: [
    { matches: SITE_PATTERNS, js: ['index.ts'] },
    { matches: ['http://localhost/web/*', 'http://127.0.0.1/*'], js: ['index.ts'] },
    { matches: ['*://115.com/*', '*://*.115.com/*'], js: ['drive115-content.ts'] },
    { matches: ['*://captchaapi.115.com/*'], js: ['drive115-verify.ts'] },
    { matches: ['<all_urls>'], js: ['passwordHelper-standalone.ts'] },
  ],
};

function stubChromeWithManifest(patterns: string[] | null, tabs: Array<{ id?: number; url?: string }>) {
  const query = vi.fn((_q: unknown, cb: (list: Array<{ id?: number; url?: string }>) => void) => {
    cb(tabs);
  });
  const sendMessage = vi.fn((_tabId: number, _msg: unknown) => undefined);
  const manifest =
    patterns === null ? undefined : { content_scripts: [{ matches: patterns, js: ['index.ts'] }] };
  vi.stubGlobal('chrome', {
    tabs: { query, sendMessage },
    runtime: { lastError: null, getManifest: () => manifest },
  });
  return { query, sendMessage };
}

describe('getJavdbSiteTabUrlPatterns（纯函数）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('manifest 注入：返回站点主机集且保序（与 src/manifest.json 基线一致）', () => {
    expect(getJavdbSiteTabUrlPatterns(REALISTIC_MANIFEST)).toEqual(SITE_PATTERNS);
  });

  it('含主域模式 *://javdb.com/*（主域 tab 可达性回归锁）', () => {
    const p = getJavdbSiteTabUrlPatterns(REALISTIC_MANIFEST);
    expect(p).toContain('*://javdb.com/*');
    expect(p).toContain('*://*.javdb.com/*');
  });

  it('排除非站点条目：localhost/115/captchaapi/<all_urls>', () => {
    const p = getJavdbSiteTabUrlPatterns(REALISTIC_MANIFEST);
    for (const bad of ['http://localhost/*', 'http://127.0.0.1/*', '*://115.com/*', '*://captchaapi.115.com/*', '<all_urls>']) {
      expect(p).not.toContain(bad);
    }
  });

  it('通配子域（*.javdb.com）与裸域（javdb570.com）均保留', () => {
    const p = getJavdbSiteTabUrlPatterns(REALISTIC_MANIFEST);
    expect(p).toContain('*://*.javdb.com/*');
    expect(p).toContain('*://javdb570.com/*');
    expect(p).toContain('*://javdb575.com/*');
  });

  it('重复条目去重（保序）', () => {
    const m = {
      content_scripts: [
        { matches: ['*://javdb575.com/*', '*://javdb.com/*'] },
        { matches: ['*://javdb575.com/*'] },
      ],
    };
    expect(getJavdbSiteTabUrlPatterns(m)).toEqual(['*://javdb575.com/*', '*://javdb.com/*']);
  });

  it('manifest=null/undefined 且无 chrome → 空数组（不抛错）', () => {
    expect(getJavdbSiteTabUrlPatterns(null)).toEqual([]);
    expect(getJavdbSiteTabUrlPatterns(undefined)).toEqual([]);
  });

  it('manifest 缺 content_scripts / 空 matches → 空数组', () => {
    expect(getJavdbSiteTabUrlPatterns({})).toEqual([]);
    expect(getJavdbSiteTabUrlPatterns({ content_scripts: [{ js: ['x.ts'] }] })).toEqual([]);
    expect(getJavdbSiteTabUrlPatterns({ content_scripts: [{}] })).toEqual([]);
  });

  it('manifest 无站点条目（仅 localhost/115）→ 空数组', () => {
    const m = { content_scripts: [{ matches: ['http://localhost/*', '*://115.com/*'] }] };
    expect(getJavdbSiteTabUrlPatterns(m)).toEqual([]);
  });

  it('缺省路径：读 chrome.runtime.getManifest()（运行时形态）', () => {
    stubChromeWithManifest(SITE_PATTERNS, []);
    expect(getJavdbSiteTabUrlPatterns()).toEqual(SITE_PATTERNS);
  });

  it('缺省路径：manifest 无站点条目 → 空数组', () => {
    stubChromeWithManifest(['*://115.com/*'], []);
    expect(getJavdbSiteTabUrlPatterns()).toEqual([]);
  });
});

describe('sendToJavdbSiteTabs（广播行为）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('按 tab.id 去重（多模式命中同一 tab 只发一次），消息原样透传', async () => {
    const tabs = [
      { id: 11, url: 'https://javdb.com/' },
      { id: 11, url: 'https://javdb.com/' }, // 同一 tab 被两个模式命中
      { id: 22, url: 'https://javdb575.com/?vst=0' },
      { url: 'https://javdb.com/no-id' }, // 无 id 跳过
    ];
    const { query, sendMessage } = stubChromeWithManifest(SITE_PATTERNS, tabs);
    const settings = { display: { hideViewed: true } };
    const n = await sendToJavdbSiteTabs({ type: 'settings-updated', settings });

    expect(query).toHaveBeenCalledWith({ url: SITE_PATTERNS }, expect.any(Function));
    expect(n).toBe(2);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenNthCalledWith(1, 11, { type: 'settings-updated', settings });
    expect(sendMessage).toHaveBeenNthCalledWith(2, 22, { type: 'settings-updated', settings });
  });

  it('单 tab 发送失败（Promise reject=无接收方）静默跳过，其余 tab 正常，恒 resolve', async () => {
    const tabs = [
      { id: 11, url: 'https://javdb.com/' },
      { id: 22, url: 'https://javdb575.com/' },
    ];
    const { sendMessage } = stubChromeWithManifest(SITE_PATTERNS, tabs);
    sendMessage.mockImplementationOnce(() => Promise.reject(new Error('Could not establish connection')));
    const n = await sendToJavdbSiteTabs({ type: 'settings-updated' });
    expect(n).toBe(2);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('单 tab 发送抛异常（回调形态兼容）静默跳过，恒 resolve', async () => {
    const tabs = [{ id: 11, url: 'https://javdb.com/' }, { id: 22, url: 'https://javdb575.com/' }];
    const { sendMessage } = stubChromeWithManifest(SITE_PATTERNS, tabs);
    sendMessage.mockImplementationOnce(() => {
      throw new Error('sync throw');
    });
    const n = await sendToJavdbSiteTabs({ type: 'settings-updated' });
    expect(n).toBe(2);
  });

  it('无站点模式（无 chrome）→ resolve(0)，不调 tabs.query', async () => {
    // 不 stub chrome：node 环境无全局 chrome
    const n = await sendToJavdbSiteTabs({ type: 'settings-updated' });
    expect(n).toBe(0);
  });

  it('tabs.query 抛异常 → resolve(0) 不 reject', async () => {
    vi.stubGlobal('chrome', {
      tabs: {
        query: () => {
          throw new Error('query boom');
        },
        sendMessage: vi.fn(),
      },
      runtime: { lastError: null, getManifest: () => ({ content_scripts: [{ matches: SITE_PATTERNS }] }) },
    });
    const n = await sendToJavdbSiteTabs({ type: 'settings-updated' });
    expect(n).toBe(0);
  });
});

function stripComments(src: string): string {
  let out = '';
  let inBlock = false;
  for (const line of src.split('\n')) {
    let code = '';
    let i = 0;
    while (i < line.length) {
      if (inBlock) {
        const e = line.indexOf('*/', i);
        if (e === -1) {
          i = line.length;
        } else {
          inBlock = false;
          i = e + 2;
        }
        continue;
      }
      const c = line[i];
      const n = line[i + 1];
      if (c === '/' && n === '*') {
        inBlock = true;
        i += 2;
        continue;
      }
      if (c === '/' && n === '/') break;
      code += c;
      i += 1;
    }
    out += code + '\n';
  }
  return out;
}

const HARDCODED_QUERY = "tabs.query({ url: '*://javdb.com/*'";

describe('广播点走 helper（源码级锁定）', () => {
  it('legacy EnhancementSettings.ts：运行时代码不再硬编码单域 tabs.query（块注释内死代码不计），改 import helper', () => {
    const file = readFileSync(
      path.join(__dirname, '../dashboard/tabs/settings/enhancement/EnhancementSettings.ts'),
      'utf8',
    );
    expect(stripComments(file)).not.toContain(HARDCODED_QUERY);
    expect(file).toContain('from \'../../../../utils/javdbSiteTabs\'');
    expect(file).toContain('sendToJavdbSiteTabs({ type: \'settings-updated\', settings: newSettings })');
  });

  it('settingsPersist.ts：notifyJavdbTabsSettingsUpdated 运行时代码不再硬编码单域 tabs.query', () => {
    const file = readFileSync(
      path.join(__dirname, '../apps/dashboard/pages/settings/shared/settingsPersist.ts'),
      'utf8',
    );
    expect(stripComments(file)).not.toContain(HARDCODED_QUERY);
    expect(file).toContain('sendToJavdbSiteTabs({ type: \'settings-updated\' })');
  });

  it('enhancementSettingsActions.ts：broadcastEnhancementSettings 运行时代码不再硬编码单域 tabs.query', () => {
    const file = readFileSync(
      path.join(__dirname, '../apps/dashboard/pages/settings/enhancement/enhancementSettingsActions.ts'),
      'utf8',
    );
    expect(stripComments(file)).not.toContain(HARDCODED_QUERY);
    expect(file).toContain('sendToJavdbSiteTabs({ type: \'settings-updated\', settings })');
  });

  it('全仓 src 非测试源码：硬编码单域 tabs.query 零残留（注释内死代码不计）', () => {
    let out = '';
    try {
      out = execFileSync(
        'grep',
        ['-rln', HARDCODED_QUERY, 'apps/extension/src'],
        { cwd: path.join(__dirname, '../../../..'), encoding: 'utf8' },
      );
    } catch (e: any) {
      if (e?.status === 1) return; // 无任何命中=通过
      throw e;
    }
    const files = out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.endsWith('.test.ts'));
    for (const f of files) {
      const codeOnly = stripComments(readFileSync(path.join(__dirname, '../../../..', f), 'utf8'));
      expect(codeOnly, f).not.toContain(HARDCODED_QUERY);
    }
  });
});

describe('settingsPersist.notifyJavdbTabsSettingsUpdated（运行时锁定）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('query 入参 url=manifest 站点主机集；消息体无 payload（内容侧自读存储）', async () => {
    const tabs = [{ id: 31, url: 'https://javdb570.com/?vst=0' }];
    const { query, sendMessage } = stubChromeWithManifest(SITE_PATTERNS, tabs);
    const mod = await import('../apps/dashboard/pages/settings/shared/settingsPersist');
    mod.notifyJavdbTabsSettingsUpdated();
    expect(query).toHaveBeenCalledWith({ url: SITE_PATTERNS }, expect.any(Function));
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(31, { type: 'settings-updated' });
  });
});
