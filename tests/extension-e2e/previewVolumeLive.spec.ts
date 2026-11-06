import { expect, test } from '@playwright/test';
import path from 'node:path';
import {
  extensionPageUrl,
  launchExtensionContext,
  readExtensionId,
  resolveExtensionHarnessOptions,
} from '../../scripts/extensionHarness';

test('popup volume reaches the active native preview without unmuting other videos (offline)', async ({}, testInfo) => {
  const options = resolveExtensionHarnessOptions({
    ...process.env,
    JAVDB_EXTENSION_USE_CHROME_DATA: '0',
    JAVDB_EXTENSION_PROFILE: path.resolve(testInfo.outputPath('profile')),
  }, process.cwd());
  const context = await launchExtensionContext(options, { headless: false, channel: 'chromium', extraArgs: ['--no-proxy-server'] });
  try {
    const id = await readExtensionId(context);
    const targetUrl = 'https://javdb.com/v/preview-volume-mock';
    await context.route(targetUrl, route => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body><div class="fancybox-is-open"><video id="preview-video" src="/sample.mp4"></video></div><video id="other"></video></body></html>',
    }));
    const page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('#other').evaluate(video => { (video as HTMLVideoElement).muted = true; });
    const popup = await context.newPage();
    await popup.goto(extensionPageUrl(id, 'popup/popup.html'), { waitUntil: 'domcontentloaded' });
    await expect(popup.locator('#volumeSlider')).toHaveValue(/\d+/);
    await page.bringToFront();
    await expect.poll(async () => popup.evaluate(async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return tabs[0]?.url;
    })).toBe(targetUrl);

    await popup.locator('#volumeSlider').evaluate((slider: HTMLInputElement) => {
      slider.value = '65';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect.poll(async () => page.locator('#preview-video').evaluate(video => ({
      volume: (video as HTMLVideoElement).volume,
      muted: (video as HTMLVideoElement).muted,
    }))).toEqual({ volume: 0.65, muted: false });
    await page.locator('#preview-video').evaluate(video => {
      const preview = video as HTMLVideoElement;
      preview.muted = true;
      preview.volume = 0.2;
      preview.dispatchEvent(new Event('volumechange'));
    });
    await expect.poll(async () => page.locator('#preview-video').evaluate(video => ({
      volume: (video as HTMLVideoElement).volume,
      muted: (video as HTMLVideoElement).muted,
    }))).toEqual({ volume: 0.65, muted: false });
    expect(await page.locator('#other').evaluate(video => ({
      volume: (video as HTMLVideoElement).volume,
      muted: (video as HTMLVideoElement).muted,
    }))).toEqual({ volume: 1, muted: true });
  } finally {
    await context.close();
  }
});
