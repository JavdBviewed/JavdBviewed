/**
 * @file enhancementSettingsActions.test.ts
 * @description 增强设置广播单测：
 *   - B6 口径锁定（09-26-display-settings-audit）：统一小写 settings-updated +
 *     带 settings payload，不再双发大写 SETTINGS_UPDATED；
 *   - 09-29-settings-broadcast-hosts：广播目标改走共享 helper（manifest 站点
 *     主机集=主域+镜像），query 入参 url=manifest 模式数组（含主域），
 *     tab.id 去重，单 tab 失败静默。
 * @module apps/dashboard/pages/settings/enhancement
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const SITE_PATTERNS = [
  '*://*.javbus.com/*',
  '*://*.javdb.com/*',
  '*://javdb.com/*',
  '*://javdb570.com/*',
  '*://javdb575.com/*',
];

function stubChromeTabs(tabs: Array<{ id?: number; url?: string }>, patterns: string[] | null = SITE_PATTERNS) {
  const sendMessage = vi.fn((_tabId: number, _msg: unknown) => undefined);
  const query = vi.fn((_q: unknown, cb: (list: Array<{ id?: number; url?: string }>) => void) => {
    cb(tabs);
  });
  const manifest = patterns === null ? undefined : { content_scripts: [{ matches: patterns, js: ['index.ts'] }] };
  vi.stubGlobal('chrome', {
    tabs: { query, sendMessage },
    runtime: { lastError: null, getManifest: () => manifest },
  });
  return { query, sendMessage };
}

describe('broadcastEnhancementSettings（B6 + 09-29 broadcasthosts）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('query 目标=manifest 站点主机集（主域+镜像），对每个有 id 的 tab 广播小写 settings-updated 且携带 settings payload', async () => {
    const { query, sendMessage } = stubChromeTabs([
      { id: 11, url: 'https://javdb.com/v/abc' },
      { id: 22, url: 'https://javdb575.com/?vst=0' },
      { url: 'https://javdb.com/no-id' },
    ]);
    const { broadcastEnhancementSettings } = await import('./enhancementSettingsActions');
    const settings = { display: { hideViewed: true } } as any;
    broadcastEnhancementSettings(settings);

    // 09-29：不再单域 *://javdb.com/*，改 manifest 站点主机集（含主域，镜像可达）
    expect(query).toHaveBeenCalledWith({ url: SITE_PATTERNS }, expect.any(Function));
    // 无 id 的 tab 跳过，只发两条
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenNthCalledWith(1, 11, { type: 'settings-updated', settings });
    expect(sendMessage).toHaveBeenNthCalledWith(2, 22, { type: 'settings-updated', settings });
  });

  it('query url 必含主域模式（主域 tab 广播不回归）', async () => {
    const { query } = stubChromeTabs([{ id: 1, url: 'https://javdb.com/' }]);
    const { broadcastEnhancementSettings } = await import('./enhancementSettingsActions');
    broadcastEnhancementSettings({} as any);
    const q = query.mock.calls[0]?.[0] as { url: string[] };
    expect(q.url).toContain('*://javdb.com/*');
    expect(q.url).toContain('*://*.javdb.com/*');
  });

  it('同一 tab 被多模式命中时只发一次（tab.id 去重）', async () => {
    const { sendMessage } = stubChromeTabs([
      { id: 11, url: 'https://javdb.com/' },
      { id: 11, url: 'https://javdb.com/' },
    ]);
    const { broadcastEnhancementSettings } = await import('./enhancementSettingsActions');
    broadcastEnhancementSettings({} as any);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('全仓口径：广播消息 type 只允许小写 settings-updated（大写 SETTINGS_UPDATED 已移除）', async () => {
    const { sendMessage } = stubChromeTabs([{ id: 1, url: 'https://javdb.com/' }]);
    const { broadcastEnhancementSettings } = await import('./enhancementSettingsActions');
    broadcastEnhancementSettings({} as any);
    for (const call of sendMessage.mock.calls) {
      expect((call[1] as { type: string }).type).toBe('settings-updated');
    }
  });

  it('无站点标签页时静默不发', async () => {
    const { sendMessage } = stubChromeTabs([]);
    const { broadcastEnhancementSettings } = await import('./enhancementSettingsActions');
    expect(() => broadcastEnhancementSettings({} as any)).not.toThrow();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('manifest 无站点条目（patterns 空）时静默不发、不抛错', async () => {
    const { query, sendMessage } = stubChromeTabs([{ id: 1, url: 'https://javdb.com/' }], null);
    const { broadcastEnhancementSettings } = await import('./enhancementSettingsActions');
    expect(() => broadcastEnhancementSettings({} as any)).not.toThrow();
    expect(query).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
