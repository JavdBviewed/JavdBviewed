/**
 * @file privacyContentPagesSubToggles.test.ts
 * @description 线 10-06-site-privacy-blur：隐私页「模糊影片标题/模糊影片图片」子开关源码锁。
 *   两行位于「普通内容页截图模糊」主开关行之后；model 表单态/默认值/映射、
 *   actions 双函数（spread current + sites 归一保留）均锁死。
 *   既有 privacySettingsModel.test.ts 5 例零改动（纯新增），本锁只加结构断言。
 * @module tests/dom
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PRIVACY_DIR = 'apps/extension/src/apps/dashboard/pages/settings/privacy';
const pageSrc = readFileSync(resolve(process.cwd(), PRIVACY_DIR, 'PrivacySettingsPage.tsx'), 'utf8');
const modelSrc = readFileSync(resolve(process.cwd(), PRIVACY_DIR, 'privacySettingsModel.ts'), 'utf8');
const actionsSrc = readFileSync(resolve(process.cwd(), PRIVACY_DIR, 'privacySettingsActions.ts'), 'utf8');

function extractRowBlock(src: string, id: string): string {
  const markerIdx = src.indexOf(`id="${id}"`);
  expect(markerIdx, `行 id=${id} 必须在位`).toBeGreaterThan(-1);
  const blockStart = src.lastIndexOf('<SettingToggleRow', markerIdx);
  expect(blockStart, `行 id=${id} 必须位于 SettingToggleRow 内`).toBeGreaterThan(-1);
  const blockEnd = src.indexOf('/>', markerIdx);
  expect(blockEnd, `行 id=${id} 必须闭合`).toBeGreaterThan(markerIdx);
  return src.slice(blockStart, blockEnd + 2);
}

describe('privacy page content-page blur sub-toggles (10-06-site-privacy-blur)', () => {
  it('renders both sub-toggle rows with fixed label/description after the main content-page row', () => {
    const titles = extractRowBlock(pageSrc, 'contentPagesBlurTitles');
    expect(titles).toContain('label="模糊影片标题"');
    expect(titles).toContain('仅内容页截图模糊启用时生效。');
    expect(titles).toContain('checked={form.contentPagesBlurTitles}');

    const images = extractRowBlock(pageSrc, 'contentPagesBlurImages');
    expect(images).toContain('label="模糊影片图片"');
    expect(images).toContain('仅内容页截图模糊启用时生效。');
    expect(images).toContain('checked={form.contentPagesBlurImages}');

    const order = [
      pageSrc.indexOf('id="contentPagesScreenshotEnabled"'),
      pageSrc.indexOf('id="contentPagesBlurTitles"'),
      pageSrc.indexOf('id="contentPagesBlurImages"'),
    ];
    expect(order[0], '主开关行在位').toBeGreaterThanOrEqual(0);
    expect(order[1], '标题行在主开关行之后').toBeGreaterThan(order[0]);
    expect(order[2], '图片行在标题行之后').toBeGreaterThan(order[1]);
  });

  it('wires both rows to their own optimistic-toggle handlers', () => {
    expect(pageSrc).toContain('setContentPagesBlurTitles');
    expect(pageSrc).toContain('setContentPagesBlurImages');
    expect(pageSrc).toContain('onContentPagesBlurTitlesToggle');
    expect(pageSrc).toContain('onContentPagesBlurImagesToggle');
    expect(extractRowBlock(pageSrc, 'contentPagesBlurTitles')).toContain('onContentPagesBlurTitlesToggle');
    expect(extractRowBlock(pageSrc, 'contentPagesBlurImages')).toContain('onContentPagesBlurImagesToggle');
  });

  it('locks model form state, defaults and mapping (default on, explicit false respected)', () => {
    expect(modelSrc).toContain('contentPagesBlurTitles: boolean;');
    expect(modelSrc).toContain('contentPagesBlurImages: boolean;');
    expect(modelSrc).toContain('contentPagesBlurTitles: true,');
    expect(modelSrc).toContain('contentPagesBlurImages: true,');
    expect(modelSrc).toContain('contentPagesBlurTitles: screenshot.contentPages?.blurTitles !== false');
    expect(modelSrc).toContain('contentPagesBlurImages: screenshot.contentPages?.blurImages !== false');
  });

  it('locks both action functions (spread current, sites normalization kept)', () => {
    const titlesIdx = actionsSrc.indexOf('export async function setContentPagesBlurTitles(');
    const imagesIdx = actionsSrc.indexOf('export async function setContentPagesBlurImages(');
    expect(titlesIdx, 'setContentPagesBlurTitles 在位').toBeGreaterThan(-1);
    expect(imagesIdx, 'setContentPagesBlurImages 在位且在后').toBeGreaterThan(titlesIdx);

    const titlesBody = actionsSrc.slice(titlesIdx, imagesIdx);
    expect(titlesBody, 'Titles 函数体').toContain('...current,');
    expect(titlesBody, 'Titles 函数体').toContain('blurTitles: enabled,');
    expect(titlesBody, 'Titles 函数体').toContain('current?.sites?.javdb !== false');

    const nextExportIdx = actionsSrc.indexOf('export ', imagesIdx + 1);
    const imagesBody = actionsSrc.slice(imagesIdx, nextExportIdx > -1 ? nextExportIdx : actionsSrc.length);
    expect(imagesBody, 'Images 函数体').toContain('...current,');
    expect(imagesBody, 'Images 函数体').toContain('blurImages: enabled,');
    expect(imagesBody, 'Images 函数体').toContain('current?.sites?.javbus !== false');
  });
});

/**
 * 线 10-23-privacy-popup-toggle-ux 新增锁（既有 4 it 零改动）：
 * - 块2 文案：功能行 label 改 JavDB 口径 + 旧串「JavDB / JavBus」零残留
 * - 块3 主次重塑：五件套收进视觉嵌套子块（border-l + surface-2 底子卡）；
 *   master 关或功能行关时整体降权（opacity-55，控件仍可点击=逻辑零动）
 */
describe('privacy page screenshot-mode hierarchy rework (10-23-privacy-popup-toggle-ux)', () => {
  const WRAPPER_TOKENS = [
    'border-l-2',
    'bg-[var(--color-surface-2)]',
    'transition-opacity',
  ] as const;

  function extractNestedWrapper(src: string): string {
    const featureIdx = src.indexOf('id="contentPagesScreenshotEnabled"');
    expect(featureIdx, '功能行在位').toBeGreaterThan(-1);
    const featureEnd = src.indexOf('/>', featureIdx);
    expect(featureEnd, '功能行闭合').toBeGreaterThan(featureIdx);
    const titlesIdx = src.indexOf('id="contentPagesBlurTitles"');
    expect(titlesIdx, '标题行在位').toBeGreaterThan(featureEnd);
    const wrapperStart = src.lastIndexOf('<div', titlesIdx);
    expect(wrapperStart, '嵌套子块 div 在功能行之后、标题行之前').toBeGreaterThan(featureEnd);
    const wrapperEndMarker = src.indexOf('选择要模糊的区域', wrapperStart);
    expect(wrapperEndMarker, 'blur-areas 块在嵌套子块内').toBeGreaterThan(wrapperStart);
    const wrapperEnd = src.indexOf('</div>', src.lastIndexOf('<div', wrapperEndMarker));
    expect(wrapperEnd, '嵌套子块闭合').toBeGreaterThan(wrapperEndMarker);
    return src.slice(wrapperStart, wrapperEnd + 6);
  }

  it('labels the content-page row JavDB-only and leaves no legacy JavDB / JavBus string', () => {
    expect(pageSrc).toContain('label="普通内容页截图模糊（JavDB）"');
    expect(pageSrc, '旧串「JavDB / JavBus」零残留').not.toContain('JavDB / JavBus');
    expect(pageSrc, '功能行 description 零改动').toContain('仅模糊影片、搜索和演员内容，不启用锁屏或密码保护。');
  });

  it('wraps the five sub-items in one nested visual block after the content-page feature row', () => {
    const wrapper = extractNestedWrapper(pageSrc);
    for (const token of WRAPPER_TOKENS) {
      expect(wrapper, `嵌套子块含样式 token ${token}`).toContain(token);
    }
    // 五件套全部在嵌套子块内
    for (const id of ['contentPagesBlurTitles', 'contentPagesBlurImages', 'blurIntensity', 'autoBlurTrigger']) {
      expect(wrapper, `五件套 id=${id} 在嵌套子块内`).toContain(`id="${id}"`);
    }
    expect(wrapper, 'blur-areas 块在嵌套子块内').toContain('选择要模糊的区域');
    // master 行与功能行仍在嵌套子块之外（容器顶部，视觉权重最高）
    const featureIdx = pageSrc.indexOf('id="contentPagesScreenshotEnabled"');
    const wrapperStart = pageSrc.lastIndexOf('<div', pageSrc.indexOf('id="contentPagesBlurTitles"'));
    expect(pageSrc.indexOf('id="screenshotModeEnabled"'), 'master 行在位').toBeGreaterThan(-1);
    expect(featureIdx, 'master/功能行都在嵌套子块之前').toBeLessThan(wrapperStart);
  });

  it('dims the nested block when master or content-page scope is off (controls stay clickable)', () => {
    const wrapper = extractNestedWrapper(pageSrc);
    expect(wrapper, '降权 class 在位').toContain('opacity-55');
    expect(
      wrapper,
      '降权条件=master 关 或 功能行 关（双态 && 驱动）',
    ).toContain('form.screenshotEnabled && form.contentPagesScreenshotEnabled');
  });
});
