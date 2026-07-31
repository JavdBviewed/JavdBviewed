/**
 * @file playwright.extension.config.ts
 * @description 拓展真浏览器冒烟测试配置：独立 profile、串行执行、保留 trace 便于人工复核
 * @module tests/extension-e2e
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/extension-e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 90_000,
  outputDir: 'test-results/extension-e2e',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
