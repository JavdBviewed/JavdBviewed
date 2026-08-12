/**
 * @file settingsSearchBootstrap.ts
 * @description settingsSearchBootstrap
 * @module apps/dashboard
 */
import { buildSettingsSearchIndex, mountSettingsSearch, revealStoredSettingsSearchTarget } from '../../features/settingsSearch';
import type { SettingsSearchPageSource } from '../../features/settingsSearch';
import { loadPartial } from '../../dashboard/loaders/partialsLoader';
import { TAB_PARTIALS } from '../../dashboard/tabs/resources';

let cachedIndexPromise: Promise<ReturnType<typeof buildSettingsSearchIndex>> | null = null;

export async function mountDashboardSettingsSearch(): Promise<void> {
  // React 入口页 flush 后可能略晚出现；短轮询避免漏挂搜索框
  const container = await waitForSettingsIndexContainer();
  if (!container) return;

  const index = await getDashboardSettingsSearchIndex();
  if (!container.isConnected) return;
  mountSettingsSearch({ container, index });
}

/**
 * 等待设置首页容器（遗留 .settings-index 或 React 页根）
 */
async function waitForSettingsIndexContainer(timeoutMs = 2000): Promise<HTMLElement | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const el =
      document.querySelector<HTMLElement>('.settings-index')
      || document.querySelector<HTMLElement>('.si-page')
      || document.querySelector<HTMLElement>('[data-settings-stack="react"]');
    if (el) return el;
    await new Promise((r) => setTimeout(r, 32));
  }
  return null;
}

export async function revealDashboardSettingsSearchTarget(): Promise<void> {
  await revealStoredSettingsSearchTarget();
}

function getDashboardSettingsSearchIndex(): Promise<ReturnType<typeof buildSettingsSearchIndex>> {
  if (!cachedIndexPromise) {
    cachedIndexPromise = buildDashboardSettingsSearchIndex();
  }
  return cachedIndexPromise;
}

async function buildDashboardSettingsSearchIndex(): Promise<ReturnType<typeof buildSettingsSearchIndex>> {
  const sources: SettingsSearchPageSource[] = [];
  const entries = Object.entries(TAB_PARTIALS)
    .filter(([key]) => key.startsWith('tab-settings-') && key !== 'tab-settings');

  for (const [key, cfg] of entries) {
    if (!cfg) continue;

    const html = await loadPartial(cfg.name);
    if (!html) continue;

    const subSection = key.replace(/^tab-settings-/, '') + '-settings';
    const pageId = normalizeSettingsPageId(subSection);
    const pageTitle = extractPageTitle(html) || pageId;

    sources.push({
      pageId,
      pageTitle,
      hash: `#tab-settings/${pageId}`,
      html,
      keywords: [pageTitle, pageId],
    });
  }

  return buildSettingsSearchIndex(sources);
}

function normalizeSettingsPageId(value: string): string {
  return value
    .replace('search-engine-settings', 'search-engine-settings')
    .replace('network-test-settings', 'network-test-settings')
    .replace('global-actions-settings', 'global-actions')
    .replace('log-settings', 'log-settings');
}

function extractPageTitle(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.querySelector('.settings-page-header h2, .settings-page-header h3')?.textContent || '')
    .replace(/\s+/g, ' ')
    .trim();
}
