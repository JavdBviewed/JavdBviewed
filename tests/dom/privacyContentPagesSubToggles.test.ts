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
