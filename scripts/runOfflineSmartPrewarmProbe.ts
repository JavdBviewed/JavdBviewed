/**
 * @file runOfflineSmartPrewarmProbe.ts
 * @description Runs an isolated offline detail-page pressure test for smart scheduling.
 */
import { chromium } from '@playwright/test';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const extensionId = 'gnegjfjccmeafanpmbjboegcbchcghka';
const sourceRoot = 'http://127.0.0.1:18083';

type FocusTask = {
  label: string;
  status: string;
  visibilityPolicy?: string;
  waitReason?: string;
  pageInstanceId?: string;
};

type ProcessSummary = {
  cpuPercent: number;
  rssKb: number;
  pssKb: number;
  extensionCpuPercent: number;
  extensionPssKb: number;
};

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

function sourceUrls(tabCount: number): string[] {
  const codes = ['z4Zm2W', 'ZNzv27', '82JB8K', 'yxYQA0', 'Ww7aGg'];
  return Array.from({ length: tabCount }, (_, index) => (
    `${sourceRoot}/v/${codes[index % codes.length]}?perfContent=1&prewarmRun=${index}`
  ));
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((result, item) => {
    const name = key(item);
    result[name] = (result[name] ?? 0) + 1;
    return result;
  }, {});
}

async function readProcessSummary(profileDir: string): Promise<ProcessSummary> {
  const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,pcpu=,rss=,args=']);
  const rows = stdout.trim().split('\n').flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/);
    if (!match || !match[4].includes(`--user-data-dir=${profileDir}`)) return [];
    return [{ pid: Number(match[1]), cpuPercent: Number(match[2]), rssKb: Number(match[3]), args: match[4] }];
  });
  const processes = await Promise.all(rows.map(async (row) => {
    const smaps = await fs.readFile(`/proc/${row.pid}/smaps_rollup`, 'utf8').catch(() => '');
    return {
      ...row,
      pssKb: Number(smaps.match(/^Pss:\s+(\d+) kB/m)?.[1] ?? 0),
      extension: row.args.includes('--extension-process'),
    };
  }));
  return processes.reduce<ProcessSummary>((result, process) => ({
    cpuPercent: result.cpuPercent + process.cpuPercent,
    rssKb: result.rssKb + process.rssKb,
    pssKb: result.pssKb + process.pssKb,
    extensionCpuPercent: result.extensionCpuPercent + (process.extension ? process.cpuPercent : 0),
    extensionPssKb: result.extensionPssKb + (process.extension ? process.pssKb : 0),
  }), { cpuPercent: 0, rssKb: 0, pssKb: 0, extensionCpuPercent: 0, extensionPssKb: 0 });
}

async function main(): Promise<void> {
  const cdpUrl = process.env.JAVDB_TEST_CDP_URL?.trim();
  const profileDir = process.env.JAVDB_TEST_PROFILE?.trim();
  const reportPath = process.env.JAVDB_TEST_REPORT?.trim();
  if (!cdpUrl || !profileDir || !reportPath) {
    throw new Error('JAVDB_TEST_CDP_URL, JAVDB_TEST_PROFILE, and JAVDB_TEST_REPORT are required.');
  }

  const tabCount = numberFromEnv('JAVDB_TEST_TAB_COUNT', 15);
  const sampleMs = numberFromEnv('JAVDB_TEST_SAMPLE_MS', 30_000);
  const intervalMs = numberFromEnv('JAVDB_TEST_INTERVAL_MS', 1_000);
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0];
  if (!context) throw new Error('CDP browser did not expose a context.');

  const dashboard = await context.newPage();
  const pages = [];
  try {
    await dashboard.goto(`chrome-extension://${extensionId}/dashboard/dashboard.html#tab-home`, {
      waitUntil: 'domcontentloaded',
    });
    await dashboard.waitForFunction(() => Boolean(globalThis.chrome?.storage?.local));
    const isolation = await dashboard.evaluate(async () => {
      await Promise.all([
        'cloud-auto-sync',
        'emby.library.sync',
        'drive115.daily_user_refresh',
        'drive115-library-index-resume',
        'webdav-auto-sync',
      ].map((name) => chrome.alarms.clear(name).catch(() => false)));
      const stored = await chrome.storage.local.get(['settings', 'cloud_auto_sync_settings_v1']);
      const settings = structuredClone(
        stored.settings && typeof stored.settings === 'object' ? stored.settings : {},
      ) as Record<string, any>;
      settings.videoEnhancement = {
        ...(settings.videoEnhancement ?? {}),
        enabled: true,
        schedulingMode: 'smart',
        enableVideoFavoriteRating: true,
        enableActorNameMarks: true,
      };
      settings.emby = { ...(settings.emby ?? {}), enabled: false };
      settings.drive115 = { ...(settings.drive115 ?? {}), enabled: false };
      settings.webdav = { ...(settings.webdav ?? {}), enabled: false, autoSync: false };
      settings.cloud = { ...(settings.cloud ?? {}), enabled: false };
      settings.cloudSync = { ...(settings.cloudSync ?? {}), enabled: false };
      await chrome.storage.local.set({
        settings,
        cloud_auto_sync_settings_v1: { ...(stored.cloud_auto_sync_settings_v1 ?? {}), enabled: false, updatedAt: Date.now() },
        cloud_sync_pending_v1: [],
      });
      return {
        schedulingMode: settings.videoEnhancement.schedulingMode,
        embyDisabled: settings.emby.enabled === false,
        drive115Disabled: settings.drive115.enabled === false,
        webdavDisabled: settings.webdav.enabled === false,
        cloudDisabled: settings.cloud.enabled === false && settings.cloudSync.enabled === false,
      };
    });

    for (const url of sourceUrls(tabCount)) {
      const page = await context.newPage();
      pages.push(page);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    }
    await pages[0]?.bringToFront();

    const startedAt = Date.now();
    const samples: Array<Record<string, unknown>> = [];
    while (Date.now() - startedAt < sampleMs) {
      const [taskCenter, process] = await Promise.all([
        dashboard.evaluate(async () => chrome.runtime.sendMessage({ type: 'task-center:query' })),
        readProcessSummary(profileDir),
      ]);
      const tasks = Array.isArray(taskCenter?.tasks) ? taskCenter.tasks : [];
      const focus = tasks.filter((task: FocusTask) => (
        task.visibilityPolicy === 'background_throttled'
      )) as FocusTask[];
      const activePrewarm = focus.filter((task) => task.status === 'leased' || task.status === 'running');
      samples.push({
        elapsedMs: Date.now() - startedAt,
        process,
        taskCounts: countBy(tasks, (task: { status?: string }) => task.status ?? 'unknown'),
        prewarm: {
          registered: focus.length,
          active: activePrewarm.length,
          activePageInstances: new Set(activePrewarm.map((task) => task.pageInstanceId)).size,
          waits: countBy(focus.filter((task) => task.waitReason), (task) => task.waitReason ?? 'none'),
          tasks: focus.map((task) => ({
            label: task.label,
            status: task.status,
            waitReason: task.waitReason,
            pageInstanceId: task.pageInstanceId,
          })),
        },
      });
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    const activeSamples = samples.map((sample) => (sample.prewarm as { active: number }).active);
    const report = {
      capturedAt: new Date().toISOString(),
      source: 'offline-replay',
      tabCount,
      sampleMs,
      intervalMs,
      isolation,
      urls: sourceUrls(tabCount),
      maxActivePrewarm: Math.max(0, ...activeSamples),
      maxActivePrewarmPageInstances: Math.max(0, ...samples.map((sample) => (
        (sample.prewarm as { activePageInstances: number }).activePageInstances
      ))),
      samples,
    };
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify({
      reportPath,
      tabCount,
      maxActivePrewarm: report.maxActivePrewarm,
      maxActivePrewarmPageInstances: report.maxActivePrewarmPageInstances,
    }, null, 2));
  } finally {
    await Promise.all(pages.map((page) => page.close().catch(() => undefined)));
    await dashboard.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
