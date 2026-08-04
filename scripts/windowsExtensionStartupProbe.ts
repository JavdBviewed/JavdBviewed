/**
 * @file windowsExtensionStartupProbe.ts
 * @description 读取 Windows Chrome Stable 的未打包扩展加载状态与错误文本
 * @module scripts
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

async function main(): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('该启动探针只能在 Windows 上运行。');
  }

  const extensionDir = path.resolve(process.env.JAVDB_EXTENSION_DIST ?? 'dist');
  const profileDir = path.resolve(
    process.env.JAVDB_STARTUP_PROBE_PROFILE ?? `.test-profiles/windows-extension-startup-${Date.now()}`,
  );
  const executablePath = process.env.JAVDB_CHROME_EXECUTABLE
    ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  await fs.rm(profileDir, { recursive: true, force: true });

  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath,
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  });

  try {
    const page = await context.newPage();
    await page.goto('chrome://extensions', { waitUntil: 'domcontentloaded' });
    const waitMs = Number(process.env.JAVDB_STARTUP_PROBE_WAIT_MS ?? 2_000);
    await page.waitForTimeout(Number.isFinite(waitMs) && waitMs >= 0 ? waitMs : 2_000);
    const managerState = await page.evaluate(() => {
      const manager = document.querySelector('extensions-manager');
      return {
        bodyText: document.body?.innerText ?? '',
        managerText: manager?.shadowRoot?.textContent?.trim() ?? '',
      };
    });
    const screenshotPath = path.resolve(
      process.env.JAVDB_STARTUP_PROBE_SCREENSHOT ?? 'test-results/performance/chrome-extensions-startup.png',
    );
    await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(JSON.stringify({
      extensionDir,
      profileDir,
      browserVersion: context.browser()?.version() ?? 'unknown',
      serviceWorkers: context.serviceWorkers().map((worker) => worker.url()),
      pages: context.pages().map((item) => item.url()),
      screenshotPath,
      managerState,
    }, null, 2));
  } finally {
    await context.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
