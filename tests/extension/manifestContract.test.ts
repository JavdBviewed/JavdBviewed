/**
 * @file manifestContract.test.ts
 * @description extension manifest contract 测试
 * @module tests/extension
 */
import { describe, expect, it } from 'vitest';
import manifest from '../../apps/extension/src/manifest.json';

describe('extension manifest contract', () => {
  it('declares the expected Manifest V3 extension entry points', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background).toMatchObject({
      service_worker: 'background/background.ts',
      type: 'module',
    });
    expect(manifest.action.default_popup).toBe('popup/popup.html');
    expect(manifest.options_ui).toMatchObject({
      page: 'dashboard/dashboard.html',
      open_in_tab: true,
    });
  });

  it('keeps core extension permissions available', () => {
    expect(manifest.permissions).toEqual(
      expect.arrayContaining([
        'storage',
        'tabs',
        'alarms',
        'scripting',
        'notifications',
        'unlimitedStorage',
        'cookies',
      ]),
    );
  });

  it('loads the expected content scripts on JavDB, JavBus, 115, and all-frame helpers', () => {
    expect(manifest.content_scripts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          js: expect.arrayContaining(['content/index.ts']),
          matches: expect.arrayContaining(['*://*.javdb.com/*', '*://*.javbus.com/*']),
          run_at: 'document_end',
        }),
        expect.objectContaining({
          js: expect.arrayContaining(['content/drive115-content.ts']),
          matches: expect.arrayContaining(['*://115.com/*', '*://*.115.com/*']),
          run_at: 'document_end',
        }),
        expect.objectContaining({
          js: expect.arrayContaining(['content/drive115-verify.ts']),
          matches: expect.arrayContaining(['*://captchaapi.115.com/*']),
          run_at: 'document_end',
        }),
        expect.objectContaining({
          js: expect.arrayContaining(['content/passwordHelper-standalone.ts']),
          matches: expect.arrayContaining(['<all_urls>']),
          run_at: 'document_idle',
        }),
      ]),
    );
  });
  it('javdb 会话采集声明 cookies 权限；host_permissions 零新增（10-19 线 2：A.2）', () => {
    expect(manifest.permissions).toContain('cookies');
    expect(manifest.host_permissions).toEqual([
      '*://*.javbus.com/*',
      '*://*.javdb.com/*',
      '*://javdb.com/*',
      '*://javdb570.com/*',
      '*://javdb575.com/*',
      'https://dav.jianguoyun.com/*',
      'https://*.teracloud.jp/*',
      'https://*.webdav.yandex.com/*',
      'https://*.nextcloud.com/*',
      '*://*.sukebei.nyaa.si/*',
      '*://*.btdig.com/*',
      '*://*.btsow.com/*',
      '*://*.torrentz2.eu/*',
      'https://*.owncloud.com/*',
      'https://115.com/*',
      'https://*.115.com/*',
      'https://webapi.115.com/*',
      'https://captchaapi.115.com/*',
      'https://uplb.115.com/*',
      'https://v.anxia.com/*',
      'https://123av.com/*',
      'https://fc2ppvdb.com/*',
      'https://adult.contents.fc2.com/*',
      'https://*/*',
      'http://*/*',
    ]);
  });
});
