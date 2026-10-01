/**
 * @file settingsSearch.test.ts
 * @description settings search feature 测试
 * @module tests/dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildSettingsSearchIndex,
  findSettingsResults,
  mountSettingsSearch,
  resolveSettingsTarget,
} from '../../apps/extension/src/features/settingsSearch';
import { DEFAULT_ONLINE_AVAILABILITY_SITES } from '../../apps/extension/src/features/onlineAvailability';
import { normalizeSettingsSubSectionId } from '../../apps/extension/src/apps/dashboard/pages/settings/shared/settingsRouteAliases';
import { SETTINGS_NAV_ITEMS } from '../../apps/extension/src/apps/dashboard/pages/settings/settingsNavModel';
import { DEFAULT_SETTINGS } from '../../apps/extension/src/utils/config';
import fs from 'node:fs';
import path from 'node:path';

describe('settings search feature', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
  });

  it('indexes setting controls from settings page html', () => {
    const index = buildSettingsSearchIndex([
      {
        pageId: 'enhancement-settings',
        pageTitle: '功能增强',
        hash: '#tab-settings/enhancement-settings',
        html: `
          <div class="settings-page" id="enhancement-settings">
            <div class="settings-page-header">
              <h2>功能增强</h2>
              <p class="settings-description">增强功能和体验</p>
            </div>
            <div class="settings-card settings-section">
              <h4>影片页资源入口</h4>
              <div class="form-group-checkbox">
                <input type="checkbox" id="videoSubtitleSearchEnabled">
                <label for="videoSubtitleSearchEnabled">显示字幕搜索</label>
                <p class="input-description">在影片页显示迅雷字幕和 SubTitleCat 入口。</p>
              </div>
            </div>
          </div>
        `,
      },
    ]);

    expect(index).toEqual(expect.arrayContaining([
      expect.objectContaining({
        pageId: 'enhancement-settings',
        pageTitle: '功能增强',
        title: '显示字幕搜索',
        targetSelector: '#videoSubtitleSearchEnabled',
        searchableText: expect.stringContaining('迅雷字幕'),
      }),
    ]));
  });

  it('indexes pages and sections so broad settings queries can navigate to the right page', () => {
    const index = buildSettingsSearchIndex([
      {
        pageId: 'advanced-settings',
        pageTitle: '高级配置',
        hash: '#tab-settings/advanced-settings',
        html: `
          <div class="settings-page" id="advanced-settings">
            <div class="settings-page-header">
              <h2>高级配置</h2>
              <p class="settings-description">高级用户可以查看和编辑原始配置数据。</p>
            </div>
            <div class="settings-section advanced-hero">
              <h4>原始配置工作台</h4>
              <p class="advanced-hero-copy">这里提供原始 JSON 配置查看、编辑和完整备份导出。</p>
            </div>
          </div>
        `,
      },
    ]);

    const pageResult = findSettingsResults(index, '高级配置', 1)[0];
    const sectionResult = findSettingsResults(index, '原始 JSON', 1)[0];

    expect(pageResult).toEqual(expect.objectContaining({
      title: '高级配置',
      targetSelector: '#advanced-settings',
    }));
    expect(sectionResult).toEqual(expect.objectContaining({
      title: '原始配置工作台',
      targetSelector: '#advanced-settings',
    }));
  });

  it('matches aliases and ranks exact control titles first', () => {
    const index = buildSettingsSearchIndex([
      {
        pageId: 'enhancement-settings',
        pageTitle: '功能增强',
        hash: '#tab-settings/enhancement-settings',
        html: `
          <div class="settings-page" id="enhancement-settings">
            <div class="settings-card settings-section">
              <h4>影片页资源入口</h4>
              <div class="form-group-checkbox">
                <input type="checkbox" id="videoSubtitleSearchEnabled">
                <label for="videoSubtitleSearchEnabled">显示字幕搜索</label>
                <p class="input-description">在影片页显示迅雷字幕入口。</p>
              </div>
              <div class="form-group-checkbox">
                <input type="checkbox" id="enableMagnetSearch">
                <label for="enableMagnetSearch">启用磁力搜索</label>
              </div>
            </div>
          </div>
        `,
      },
    ]);

    const results = findSettingsResults(index, '迅雷');

    expect(results[0]).toEqual(expect.objectContaining({
      title: '显示字幕搜索',
      targetSelector: '#videoSubtitleSearchEnabled',
    }));
  });

  it('indexes enhancement toggle buttons backed by data-target', () => {
    const index = buildSettingsSearchIndex([
      {
        pageId: 'enhancement-settings',
        pageTitle: '功能增强',
        hash: '#tab-settings/enhancement-settings',
        html: `
          <div class="settings-page" id="enhancement-settings">
            <div style="display:none">
              <input type="checkbox" id="enableMagnetSearch">
            </div>
            <div class="settings-card settings-section">
              <h4>影片页增强</h4>
              <div class="form-group" data-subtab="video">
                <label class="checkbox-label">
                  <div class="enhancement-feature-title">
                    <h6 class="enhancement-feature-name">🧲 磁力资源搜索</h6>
                    <span class="enhancement-feature-status available">可用</span>
                  </div>
                  <button class="enhancement-toggle" data-target="enableMagnetSearch"></button>
                </label>
                <p class="input-description">在视频详情页自动搜索多个站点的磁力资源。</p>
              </div>
            </div>
          </div>
        `,
      },
    ]);

    expect(index).toEqual(expect.arrayContaining([
      expect.objectContaining({
        pageId: 'enhancement-settings',
        title: '磁力资源搜索',
        targetSelector: '[data-target="enableMagnetSearch"]',
        searchableText: expect.stringContaining('自动搜索多个站点'),
      }),
    ]));
  });

  it('deduplicates search results by page and visible target', () => {
    const index = buildSettingsSearchIndex([
      {
        pageId: 'drive115-settings',
        pageTitle: '115 网盘离线下载',
        hash: '#tab-settings/drive115-settings',
        html: `
          <div class="settings-page" id="drive115-settings">
            <div class="settings-page-header">
              <h2>115 网盘离线下载</h2>
              <p class="settings-description">配置 115 v2 接口域名。</p>
            </div>
            <div class="settings-section settings-card">
              <h4>模式与接口</h4>
              <div class="form-group">
                <label for="drive115V2ApiBaseUrl">接口域名（v2）:</label>
                <input id="drive115V2ApiBaseUrl" type="url">
                <p class="input-description">OpenList 代理接口域名。</p>
              </div>
            </div>
          </div>
        `,
      },
    ]);

    const results = findSettingsResults(index, '接口域名（v2）', 12);
    const targetHits = results.filter(result => result.pageId === 'drive115-settings' && result.targetSelector === '#drive115V2ApiBaseUrl');

    expect(targetHits).toHaveLength(1);
    expect(targetHits[0]).toEqual(expect.objectContaining({
      title: '接口域名（v2）:',
      targetSelector: '#drive115V2ApiBaseUrl',
    }));
  });

  it('indexes real enhancement page toggles that were missed by id-only controls', () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), 'apps/extension/src/dashboard/partials/tabs/settings-enhancement.html'), 'utf8');
    const index = buildSettingsSearchIndex([
      {
        pageId: 'enhancement-settings',
        pageTitle: '功能增强设置',
        hash: '#tab-settings/enhancement-settings',
        html,
        keywords: ['功能增强设置', 'enhancement-settings'],
      },
    ]);

    expect(findSettingsResults(index, '超级排行榜', 5)[0]).toEqual(expect.objectContaining({
      title: '超级排行榜',
      targetSelector: '[data-target="enableSuperRanking"]',
    }));
    expect(findSettingsResults(index, '磁力资源搜索', 5)[0]).toEqual(expect.objectContaining({
      title: '磁力资源搜索',
      targetSelector: '[data-target="enableMagnetSearch"]',
    }));
    expect(findSettingsResults(index, '字幕搜索', 5)[0]).toEqual(expect.objectContaining({
      title: '字幕搜索',
      targetSelector: '[data-target="veEnableSubtitleSearch"]',
    }));
  });

  it('uses the nearest parent enhancement feature as result context', () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), 'apps/extension/src/dashboard/partials/tabs/settings-enhancement.html'), 'utf8');
    const index = buildSettingsSearchIndex([
      {
        pageId: 'enhancement-settings',
        pageTitle: '功能增强设置',
        hash: '#tab-settings/enhancement-settings',
        html,
      },
    ]);

    expect(findSettingsResults(index, '显示失败站点', 5)[0]).toEqual(expect.objectContaining({
      title: '显示失败站点',
      sectionTitle: '在线可看',
      targetSelector: '[data-target="veShowOnlineAvailabilityFailures"]',
    }));
    expect(findSettingsResults(index, '字幕搜索', 5)[0]).toEqual(expect.objectContaining({
      title: '字幕搜索',
      sectionTitle: '影片页外部入口',
      targetSelector: '[data-target="veEnableSubtitleSearch"]',
    }));
  });

  it('keeps select control titles clean when labels wrap the control', () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), 'apps/extension/src/dashboard/partials/tabs/settings-emby.html'), 'utf8');
    const index = buildSettingsSearchIndex([
      {
        pageId: 'emby-settings',
        pageTitle: 'Emby/Jellyfin 增强设置',
        hash: '#tab-settings/emby-settings',
        html,
      },
    ]);

    const result = findSettingsResults(index, '点击番号后的行为', 5)[0];

    expect(result).toEqual(expect.objectContaining({
      title: '点击番号后的行为',
      targetSelector: '#emby-link-behavior',
    }));
    expect(result.title).not.toContain('跳转到JavDB搜索页面');
    expect(result.title).not.toContain('直接跳转到JavDB详情页');
  });

  it('matches common user aliases for insights and magnet source settings', () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), 'apps/extension/src/dashboard/partials/tabs/settings-insights.html'), 'utf8');
    const index = buildSettingsSearchIndex([
      {
        pageId: 'insights-settings',
        pageTitle: '报告设置',
        hash: '#tab-settings/insights-settings',
        html,
        keywords: ['报告设置', 'insights-settings'],
      },
      {
        pageId: 'enhancement-settings',
        pageTitle: '功能增强设置',
        hash: '#tab-settings/enhancement-settings',
        html: fs.readFileSync(path.resolve(process.cwd(), 'apps/extension/src/dashboard/partials/tabs/settings-enhancement.html'), 'utf8'),
      },
    ]);

    expect(findSettingsResults(index, '数据洞察', 5)[0]).toEqual(expect.objectContaining({
      pageId: 'insights-settings',
      title: '报告设置',
    }));
    expect(findSettingsResults(index, 'torrentz2', 10)[0]).toEqual(expect.objectContaining({
      pageId: 'enhancement-settings',
      targetSelector: '#magnetSourceTorrentz2',
    }));
  });

  it('adds index metadata for settings rendered dynamically at runtime', () => {
    const index = buildSettingsSearchIndex([
      {
        pageId: 'search-engine-settings',
        pageTitle: '搜索引擎设置',
        hash: '#tab-settings/search-engine-settings',
        html: fs.readFileSync(path.resolve(process.cwd(), 'apps/extension/src/dashboard/partials/tabs/settings-search-engine.html'), 'utf8'),
      },
      {
        pageId: 'enhancement-settings',
        pageTitle: '功能增强设置',
        hash: '#tab-settings/enhancement-settings',
        html: fs.readFileSync(path.resolve(process.cwd(), 'apps/extension/src/dashboard/partials/tabs/settings-enhancement.html'), 'utf8'),
      },
    ]);

    expect(findSettingsResults(index, 'Jable', 5)[0]).toEqual(expect.objectContaining({
      title: 'Jable',
      targetSelector: '[data-settings-search-target="online-availability-site:jable"]',
    }));
    expect(findSettingsResults(index, 'Google', 5)[0]).toEqual(expect.objectContaining({
      pageId: 'search-engine-settings',
      title: 'Google',
      targetSelector: '[data-settings-search-target="search-engine:google"]',
    }));
    expect(findSettingsResults(index, '页面内并发', 5)[0]).toEqual(expect.objectContaining({
      title: '页面内并发',
      targetSelector: '[data-settings-search-target="magnet-concurrency:magnetPageMaxConcurrentRequests"]',
    }));
  });

  it('derives dynamic search metadata from default setting sources', () => {
    const defaultSearchEngines = (DEFAULT_SETTINGS.searchEngines || [])
      .filter(engine => engine.name && engine.id)
      .map(engine => ({
        id: String(engine.id).trim().toLowerCase(),
        name: String(engine.name),
      }));
    const defaultOnlineSites = DEFAULT_ONLINE_AVAILABILITY_SITES.map(site => ({
      key: site.key,
      name: site.name,
    }));

    const index = buildSettingsSearchIndex([
      {
        pageId: 'search-engine-settings',
        pageTitle: '搜索引擎设置',
        hash: '#tab-settings/search-engine-settings',
        html: fs.readFileSync(path.resolve(process.cwd(), 'apps/extension/src/dashboard/partials/tabs/settings-search-engine.html'), 'utf8'),
      },
      {
        pageId: 'enhancement-settings',
        pageTitle: '功能增强设置',
        hash: '#tab-settings/enhancement-settings',
        html: fs.readFileSync(path.resolve(process.cwd(), 'apps/extension/src/dashboard/partials/tabs/settings-enhancement.html'), 'utf8'),
      },
    ]);

    for (const engine of defaultSearchEngines) {
      expect(findSettingsResults(index, engine.name, 10)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          title: engine.name,
          targetSelector: `[data-settings-search-target="search-engine:${engine.id}"]`,
        }),
      ]));
    }

    for (const site of defaultOnlineSites) {
      expect(findSettingsResults(index, site.name, 10)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          title: site.name,
          targetSelector: `[data-settings-search-target="online-availability-site:${site.key}"]`,
        }),
      ]));
    }
  });

  it('indexes search-engine static settings labels', () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), 'apps/extension/src/dashboard/partials/tabs/settings-search-engine.html'), 'utf8');
    const index = buildSettingsSearchIndex([
      {
        pageId: 'search-engine-settings',
        pageTitle: '搜索引擎设置',
        hash: '#tab-settings/search-engine-settings',
        html,
      },
    ]);

    expect(findSettingsResults(index, '是否启用', 5)[0]).toEqual(expect.objectContaining({
      title: '是否启用',
      targetSelector: '#search-engine-enabled-column',
    }));
    expect(findSettingsResults(index, '搜索引擎分类', 5)[0]).toEqual(expect.objectContaining({
      title: '分类',
      targetSelector: '#search-engine-category-filter',
    }));
  });

  it('resolves navigation target from a result', () => {
    const index = buildSettingsSearchIndex([
      {
        pageId: 'search-engine-settings',
        pageTitle: '搜索引擎',
        hash: '#tab-settings/search-engine-settings',
        html: `
          <div class="settings-page" id="search-engine-settings">
            <button id="add-search-engine">添加新的搜索引擎</button>
          </div>
        `,
      },
    ]);
    const item = index.find(entry => entry.targetSelector === '#add-search-engine')!;

    expect(resolveSettingsTarget(item)).toEqual({
      hash: '#tab-settings/search-engine-settings',
      targetSelector: '#add-search-engine',
      title: '添加新的搜索引擎',
    });
  });

  it('stores target before navigation and highlights it after page mount', async () => {
    const { storeSettingsSearchTarget, revealStoredSettingsSearchTarget } = await import('../../apps/extension/src/features/settingsSearch');
    const scrollIntoView = vi.fn();

    document.body.innerHTML = `
      <div class="form-group" id="target-wrapper">
        <input id="aiApiKey">
        <label for="aiApiKey">API密钥</label>
      </div>
    `;
    Object.defineProperty(document.getElementById('target-wrapper'), 'scrollIntoView', {
      value: scrollIntoView,
      configurable: true,
    });

    storeSettingsSearchTarget({
      hash: '#tab-settings/ai-settings',
      targetSelector: '#aiApiKey',
      title: 'API密钥',
    });

    const revealed = await revealStoredSettingsSearchTarget({
      waitMs: 10,
      highlightMs: 20,
    });

    const wrapper = document.getElementById('target-wrapper')!;
    expect(revealed).toBe(true);
    expect(scrollIntoView).toHaveBeenCalled();
    expect(wrapper.classList.contains('jdb-settings-search-highlight')).toBe(true);
  });

  it('highlights dynamic setting row containers when the matched element is nested', async () => {
    const { storeSettingsSearchTarget, revealStoredSettingsSearchTarget } = await import('../../apps/extension/src/features/settingsSearch');
    const scrollIntoView = vi.fn();

    document.body.innerHTML = `
      <div id="search-engine-list">
        <div class="search-engine-item" data-settings-search-target="search-engine:google">
          <input id="google-engine-name" value="Google">
        </div>
      </div>
    `;
    Object.defineProperty(document.querySelector('.search-engine-item'), 'scrollIntoView', {
      value: scrollIntoView,
      configurable: true,
    });

    storeSettingsSearchTarget({
      hash: '#tab-settings/search-engine-settings',
      targetSelector: '#google-engine-name',
      title: 'Google',
    });

    const revealed = await revealStoredSettingsSearchTarget({
      waitMs: 10,
      highlightMs: 20,
    });

    const row = document.querySelector('.search-engine-item')!;
    expect(revealed).toBe(true);
    expect(scrollIntoView).toHaveBeenCalled();
    expect(row.classList.contains('jdb-settings-search-highlight')).toBe(true);
  });

  it('prefers the form container over a data-targeted control for ordinary settings', async () => {
    const { storeSettingsSearchTarget, revealStoredSettingsSearchTarget } = await import('../../apps/extension/src/features/settingsSearch');
    const scrollIntoView = vi.fn();

    document.body.innerHTML = `
      <div class="form-group" id="ordinary-setting">
        <input id="ordinary-input" data-settings-search-target="ordinary-setting:input">
      </div>
    `;
    Object.defineProperty(document.getElementById('ordinary-setting'), 'scrollIntoView', {
      value: scrollIntoView,
      configurable: true,
    });

    storeSettingsSearchTarget({
      hash: '#tab-settings/advanced-settings',
      targetSelector: '#ordinary-input',
      title: '普通设置',
    });

    const revealed = await revealStoredSettingsSearchTarget({
      waitMs: 10,
      highlightMs: 20,
    });

    const wrapper = document.getElementById('ordinary-setting')!;
    expect(revealed).toBe(true);
    expect(scrollIntoView).toHaveBeenCalled();
    expect(wrapper.classList.contains('jdb-settings-search-highlight')).toBe(true);
  });

  it('reveals enhancement cards inside hidden subtabs and collapsed sub-settings', async () => {
    const { storeSettingsSearchTarget, revealStoredSettingsSearchTarget } = await import('../../apps/extension/src/features/settingsSearch');
    const scrollIntoView = vi.fn();

    document.body.innerHTML = `
      <div id="enhancement-settings">
        <button type="button" class="subtab-link active" data-subtab="list">列表页增强</button>
        <button type="button" class="subtab-link" data-subtab="video">影片页增强</button>
        <div class="settings-page-body">
          <div class="form-group" data-subtab="list" id="list-card"></div>
          <div class="form-group" data-subtab="video" id="video-card" style="display: none;">
            <div class="sub-settings" id="externalEntryConfig" style="display: block; max-height: 0px; border-top-width: 0px; border-bottom-width: 0px; padding-top: 0px; padding-bottom: 0px;">
              <div class="form-group" id="subtitle-card">
                <button class="enhancement-toggle" data-target="veEnableSubtitleSearch"></button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    Object.defineProperty(document.getElementById('subtitle-card'), 'scrollIntoView', {
      value: scrollIntoView,
      configurable: true,
    });

    storeSettingsSearchTarget({
      hash: '#tab-settings/enhancement-settings',
      targetSelector: '[data-target="veEnableSubtitleSearch"]',
      title: '字幕搜索',
    });

    const revealed = await revealStoredSettingsSearchTarget({
      waitMs: 10,
      highlightMs: 20,
    });

    expect(revealed).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('[data-subtab="video"]')?.classList.contains('active')).toBe(true);
    expect(document.getElementById('video-card')?.style.display).toBe('');
    expect(document.getElementById('list-card')?.style.display).toBe('none');
    expect(document.getElementById('externalEntryConfig')?.classList.contains('is-open')).toBe(true);
    expect(document.getElementById('externalEntryConfig')?.style.maxHeight).toBe('none');
    expect(document.getElementById('subtitle-card')?.classList.contains('jdb-settings-search-highlight')).toBe(true);
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('keeps the result panel hidden before the user types', () => {
    document.body.innerHTML = '<div class="settings-index"><div class="settings-index-header"></div></div>';

    mountSettingsSearch({
      container: document.querySelector('.settings-index')!,
      index: [],
    });

    const results = document.querySelector<HTMLElement>('.jdb-settings-search-results')!;
    expect(results.hidden).toBe(true);
    expect(results.style.display).toBe('none');
  });

  it('shows the clear button only while the search input has content', () => {
    document.body.innerHTML = '<div class="settings-index"><div class="settings-index-header"></div></div>';

    mountSettingsSearch({
      container: document.querySelector('.settings-index')!,
      index: [],
    });

    const input = document.querySelector<HTMLInputElement>('.jdb-settings-search-input')!;
    const clearButton = document.querySelector<HTMLButtonElement>('.jdb-settings-search-clear')!;

    expect(clearButton.hidden).toBe(true);

    input.value = '字幕';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(clearButton.hidden).toBe(false);

    clearButton.click();

    expect(input.value).toBe('');
    expect(clearButton.hidden).toBe(true);
  });

  it('supports keyboard selection before jumping to a result', () => {
    document.body.innerHTML = '<div class="settings-index"><div class="settings-index-header"></div></div>';

    mountSettingsSearch({
      container: document.querySelector('.settings-index')!,
      index: [
        {
          id: 'display-settings:#hideWant',
          pageId: 'display-settings',
          pageTitle: '列表显示设置',
          hash: '#tab-settings/display-settings',
          title: '隐藏想看的影片',
          description: '',
          sectionTitle: '列表显示设置',
          targetSelector: '#hideWant',
          searchableText: '隐藏想看的影片 想看 列表显示设置 hideWant',
        },
        {
          id: 'enhancement-settings:[data-target="veEnableWantSync"]',
          pageId: 'enhancement-settings',
          pageTitle: '功能增强设置',
          hash: '#tab-settings/enhancement-settings',
          title: '点击“想看”时同步到番号库',
          description: '',
          sectionTitle: '状态标记增强',
          targetSelector: '[data-target="veEnableWantSync"]',
          searchableText: '点击想看时同步到番号库 想看 状态标记增强',
        },
      ],
    });

    const input = document.querySelector<HTMLInputElement>('.jdb-settings-search-input')!;
    input.value = '想看';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(document.querySelectorAll('.jdb-settings-search-result')[0].getAttribute('aria-selected')).toBe('true');
    expect(window.location.hash).toBe('#tab-settings/enhancement-settings');
    expect(sessionStorage.getItem('jdb:settingsSearch:target')).toContain('veEnableWantSync');
  });

  it('keeps hidden result panels visually hidden in dashboard css', () => {
    const cssPath = path.resolve(process.cwd(), 'apps/extension/src/dashboard/styles/05-pages/settings/settings.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(css).toContain('.jdb-settings-search-results[hidden]');
    expect(css).toContain('display: none !important');
    expect(css).toContain('.jdb-settings-search-result.is-selected');
    expect(css).toContain('.jdb-settings-search-result[aria-selected="true"]');
    expect(css).toContain('#enhancement-settings .form-group.jdb-settings-search-highlight');
  });

  it('uses a two-cycle theme-aware pulse for jumped search targets', () => {
    const cssPath = path.resolve(process.cwd(), 'apps/extension/src/dashboard/styles/05-pages/settings/settings.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(css).toContain('--settings-search-pulse-ring: #f59e0b');
    expect(css).toContain('--settings-search-pulse-ring: #2dd4bf');
    expect(css).toContain('--settings-search-pulse-radius: 8px');
    expect(css).toContain('border-radius: var(--settings-search-pulse-radius)');
    expect(css).toContain('outline: none');
    expect(css).toContain('animation: jdbSettingsSearchPulseHalo 0.82s ease-out 2');
    expect(css).not.toContain('.settings-panel:not(#enhancement-settings) .form-group.jdb-settings-search-highlight');
    expect(css).not.toContain('animation: jdbSettingsSearchPulseRing');
    expect(css).toContain('@keyframes jdbSettingsSearchPulseHalo');
  });

  it('styles dynamic row search highlights across settings layouts', () => {
    const searchEngineCss = fs.readFileSync(
      path.resolve(process.cwd(), 'apps/extension/src/dashboard/styles/05-pages/settings/searchEngine.css'),
      'utf8',
    );
    const enhancementCss = fs.readFileSync(
      path.resolve(process.cwd(), 'apps/extension/src/dashboard/styles/05-pages/settings/enhancement.css'),
      'utf8',
    );

    expect(searchEngineCss).toContain('#search-engine-settings .search-engine-item.jdb-settings-search-highlight');
    expect(searchEngineCss).toContain('var(--settings-search-pulse-fill)');
    expect(searchEngineCss).toContain('var(--settings-search-pulse-ring)');
    expect(enhancementCss).toContain('#enhancement-settings .online-availability-site-item.jdb-settings-search-highlight');
    expect(enhancementCss).toContain('#enhancement-settings .magnet-concurrency-config .form-group-inline.jdb-settings-search-highlight');
    expect(enhancementCss).toContain('var(--settings-search-pulse-fill)');
    expect(enhancementCss).toContain('var(--settings-search-pulse-ring)');
  });

  it('keeps legacy settings-search hashes landing on surviving pages after the IA consolidation', () => {
    // 搜索索引由遗留 partial 注册表构建（pageId 仍是旧 hash 口径：emby-settings / global-actions），
    // 2026-10-03 IA 裁决后退役路由必须经归一化落到仍在导航目录里的页面。
    for (const retired of ['global-actions', 'emby-settings']) {
      const target = normalizeSettingsSubSectionId(retired);
      expect(SETTINGS_NAV_ITEMS.some((item) => item.id === target), retired).toBe(true);
    }
    // 现役目录卡 id 不得被别名表吞掉
    for (const item of SETTINGS_NAV_ITEMS) {
      expect(normalizeSettingsSubSectionId(item.id), item.id).toBe(item.id);
    }
    // 「全局」关键词仍能在索引页命中高级配置卡
    const advanced = SETTINGS_NAV_ITEMS.find((item) => item.id === 'advanced-settings');
    expect(advanced?.description).toContain('全局');
  });
});
