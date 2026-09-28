/**
 * @vitest-environment jsdom
 * @file magnetCommentQuickSearchSettings.test.tsx
 * @description 「磁力评论区选文快速搜索」开关落位与设置模型往返（09-29-magnet-comment-quicksearch 线）。
 *   钉死：开关位于功能增强设置 → 影片页签 → 磁力资源搜索 section，且与「启用磁力搜索」相互独立
 *   （不嵌在 #magnetSourcesConfig 内，后者随 enableMagnetSearch 折叠）；默认关闭；
 *   settings ↔ form 双向映射不丢字段。
 * @module tests/dom
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ENHANCEMENT_SETTINGS_FORM,
  applyEnhancementFormToSettings,
  mapSettingsToEnhancementForm,
} from '../../apps/extension/src/apps/dashboard/pages/settings/enhancement/enhancementSettingsModel';
import { VideoTab } from '../../apps/extension/src/apps/dashboard/pages/settings/enhancement/VideoTab';
import { DEFAULT_SETTINGS } from '../../apps/extension/src/utils/config';

const MAGNET_SECTION_SELECTOR = '[data-enhancement-feature="磁力资源搜索"]';

function renderVideoTab(formOverride = {}) {
  const form = { ...DEFAULT_ENHANCEMENT_SETTINGS_FORM, ...formOverride };
  const html = renderToStaticMarkup(
    createElement(VideoTab, {
      form,
      aiModel: 'gpt-4o-mini',
      setToggle: () => undefined,
      patchForm: () => undefined,
    }),
  );
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

describe('磁力评论区选文快速搜索 · 设置开关落位', () => {
  it('渲染在影片页签「磁力资源搜索」section 内，文案与锚点 id 固定', () => {
    const host = renderVideoTab();
    const section = host.querySelector(MAGNET_SECTION_SELECTOR);
    expect(section).not.toBeNull();

    const toggle = section!.querySelector('#enableMagnetCommentQuickSearch');
    expect(toggle).not.toBeNull();

    const label = section!.querySelector('label[for="enableMagnetCommentQuickSearch"]');
    expect(label?.textContent).toBe('磁力评论区选文快速搜索');
  });

  it('与「启用磁力搜索」相互独立：不嵌在随主开关折叠的 #magnetSourcesConfig 内', () => {
    // enableMagnetSearch=false 时 #magnetSourcesConfig 不渲染，本开关仍需可见
    const host = renderVideoTab({ enableMagnetSearch: false });
    const section = host.querySelector(MAGNET_SECTION_SELECTOR)!;

    expect(section.querySelector('#magnetSourcesConfig')).toBeNull();
    expect(section.querySelector('#enableMagnetCommentQuickSearch')).not.toBeNull();
    expect(section.querySelector('#enableMagnetCommentQuickSearch')!.closest('#magnetSourcesConfig')).toBeNull();
  });

  it('默认关闭（checkbox 未勾选）', () => {
    const host = renderVideoTab();
    const toggle = host.querySelector<HTMLInputElement>('#enableMagnetCommentQuickSearch')!;
    expect(toggle.type).toBe('checkbox');
    expect(toggle.checked).toBe(false);
    expect(DEFAULT_SETTINGS.userExperience.enableMagnetCommentQuickSearch).toBe(false);
    expect(DEFAULT_ENHANCEMENT_SETTINGS_FORM.enableMagnetCommentQuickSearch).toBe(false);
  });
});

describe('磁力评论区选文快速搜索 · 设置模型往返', () => {
  it('settings → form：仅 === true 视为开启（缺省/脏值一律关闭）', () => {
    expect(
      mapSettingsToEnhancementForm({
        ...DEFAULT_SETTINGS,
        userExperience: { ...DEFAULT_SETTINGS.userExperience, enableMagnetCommentQuickSearch: true },
      }).enableMagnetCommentQuickSearch,
    ).toBe(true);

    expect(mapSettingsToEnhancementForm(DEFAULT_SETTINGS).enableMagnetCommentQuickSearch).toBe(false);
    expect(
      mapSettingsToEnhancementForm({
        ...DEFAULT_SETTINGS,
        userExperience: { ...DEFAULT_SETTINGS.userExperience, enableMagnetCommentQuickSearch: 'yes' as unknown as boolean },
      }).enableMagnetCommentQuickSearch,
    ).toBe(false);
  });

  it('form → settings：写回 userExperience.enableMagnetCommentQuickSearch，且不改动 enableMagnetSearch', () => {
    const form = {
      ...DEFAULT_ENHANCEMENT_SETTINGS_FORM,
      enableMagnetCommentQuickSearch: true,
      enableMagnetSearch: false,
    };
    const next = applyEnhancementFormToSettings(DEFAULT_SETTINGS, form);

    expect(next.userExperience.enableMagnetCommentQuickSearch).toBe(true);
    expect(next.userExperience.enableMagnetSearch).toBe(false);
  });
});

describe('磁力评论区选文快速搜索 · 遗留静态页搜索索引锚点', () => {
  it('settings-enhancement.html 含同 id 的搜索索引项（设置搜索可命中并跳转）', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const partial = readFileSync(
      join(process.cwd(), 'apps/extension/src/dashboard/partials/tabs/settings-enhancement.html'),
      'utf8',
    );

    expect(partial).toContain('data-target="enableMagnetCommentQuickSearch"');
    expect(partial).toContain('<input type="checkbox" id="enableMagnetCommentQuickSearch">');
    expect(partial).toContain('磁力评论区选文快速搜索');
  });
});
