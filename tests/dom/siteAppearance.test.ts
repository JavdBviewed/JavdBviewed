import { beforeEach, describe, expect, it } from 'vitest';
import {
  isJavdbAppearanceSupportedHost,
  SiteAppearanceManager,
} from '../../apps/extension/src/features/siteAppearance';

describe('JavDB site appearance', () => {
  let manager: SiteAppearanceManager;

  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '<main class="movie-list"><div class="item"><div class="box">影片</div></div></main>';
    document.documentElement.removeAttribute('data-x-javdb-appearance');
    manager = new SiteAppearanceManager(document);
  });

  it('limits appearance injection to JavDB hosts', () => {
    expect(isJavdbAppearanceSupportedHost('javdb.com')).toBe(true);
    expect(isJavdbAppearanceSupportedHost('www.javdb.com')).toBe(true);
    expect(isJavdbAppearanceSupportedHost('javbus.com')).toBe(false);
  });

  it('adds only namespaced surface styles for enabled sections', () => {
    manager.apply({
      enabled: true,
      listCards: true,
      detailAndRelated: false,
      magnetList: false,
      previewImages: false,
      autoExpandReplaceTip: false,
    });

    const style = document.getElementById('x-javdb-site-appearance');
    expect(document.documentElement.dataset.xJavdbAppearance).toBe('1');
    expect(style?.textContent).toContain('[data-x-javdb-appearance="1"] .movie-list');
    expect(style?.textContent).not.toMatch(
      /(?:^|\n)\s*(?:display|grid(?:-template)?|flex(?:-direction)?|width|height|margin|padding|position|z-index|transform|visibility|overflow|filter|opacity)\s*:/,
    );
  });

  it('removes all appearance state when disabled', () => {
    manager.apply({ enabled: true });
    manager.apply({ enabled: false });

    expect(document.getElementById('x-javdb-site-appearance')).toBeNull();
    expect(document.documentElement.hasAttribute('data-x-javdb-appearance')).toBe(false);
  });

  it('expands new replace tips only while its independent switch is enabled', async () => {
    manager.apply({ enabled: false, autoExpandReplaceTip: true });
    const enabledTip = document.createElement('div');
    enabledTip.className = 'replace_tip';
    enabledTip.innerHTML = '<span class="icon-expand"></span>提示';
    enabledTip.addEventListener('click', () => enabledTip.setAttribute('data-expanded', '1'));
    document.body.append(enabledTip);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(enabledTip.dataset.expanded).toBe('1');

    manager.apply({ enabled: false, autoExpandReplaceTip: false });
    const disabledTip = document.createElement('div');
    disabledTip.className = 'replace_tip';
    disabledTip.innerHTML = '<span class="icon-expand"></span>提示';
    disabledTip.addEventListener('click', () => disabledTip.setAttribute('data-expanded', '1'));
    document.body.append(disabledTip);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(disabledTip.dataset.expanded).toBeUndefined();
  });

  it('does not toggle an already expanded replace tip during an unrelated settings refresh', () => {
    const tip = document.createElement('div');
    tip.className = 'replace_tip';
    tip.innerHTML = '<span class="icon-expand"></span>提示';
    let clicks = 0;
    tip.addEventListener('click', () => {
      clicks += 1;
    });
    document.body.append(tip);

    manager.apply({ enabled: false, autoExpandReplaceTip: true });
    manager.apply({ enabled: true, autoExpandReplaceTip: true, listCards: false });

    expect(clicks).toBe(1);
  });
});
