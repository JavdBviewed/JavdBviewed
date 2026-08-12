/**
 * @file remoteCdpPerformanceProbe.ts
 * @description 通过 SSH 隔离采集远端 Chrome 的页面和进程性能指标。
 */
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildWslDiagnosticSnapshot,
  buildWslDashboardUrl,
  buildWslExternalSyncIsolationExpression,
  buildWslPageMetricsExpression,
  buildWslPerformanceProbeScript,
  calculateWslIntervalCpuPercent,
  parseWslDashboardHash,
  summarizeWslChromeProcesses,
  summarizeWslChromeProcessesByCategory,
  summarizeWslChromeProcessesByRole,
  summarizeWslCdpProcessInfo,
  summarizeWslTargetInfos,
  type WslChromeProcess,
  type WslChromeProcessCategorySummary,
  type WslChromeProcessRoleSummary,
  type WslCdpProcessInfoSummary,
  type WslDiagnosticProcessSample,
  type WslServiceWorkerHeapUsage,
} from './wslCdpPerformanceProbe';
import { buildPerformanceMediaFixture } from './performanceMediaFixture';
import { redactDiagnosticPayload } from './performanceDiagnostics';

const execFileAsync = promisify(execFile);
const DEFAULT_CDP_URL = 'http://127.0.0.1:19222';
const DEFAULT_SSH_HOST = '192.168.0.134';
const DEFAULT_EXTENSION_ID = 'gnegjfjccmeafanpmbjboegcbchcghka';
const DEFAULT_USER_DATA_DIR = '/opt/javdb-perf/profiles/smoke';
const DEFAULT_SAMPLE_MS = 10_000;
const DEFAULT_INTERVAL_MS = 1_000;
const DEFAULT_TAB_SWITCH_INTERVAL_MS = 500;

export type RemoteProcessState = Map<number, { cpuJiffies: number; atMs: number }>;

export type RemoteProcessSample = WslChromeProcess & { cpuJiffies: number };

export type RemotePssScope = 'all' | 'extension';

type RemoteExternalSyncIsolationResult = {
  ok?: boolean;
  checks?: Record<string, boolean>;
  error?: string;
};

export function isRemoteExternalSyncIsolationSuccessful(
  result: RemoteExternalSyncIsolationResult | null | undefined,
): boolean {
  return result?.ok === true;
}

export type RemoteProbeOptions = {
  cdpUrl: string;
  sshHost: string;
  userDataDir: string;
  extensionId: string;
  dashboardHash: string;
  tabSequence: string[];
  tabSwitchRounds: number;
  tabSwitchIntervalMs: number;
  homeCharts: string;
  newWorksDiagnostic: string;
  disableExternalSync: boolean;
  clearCloudPending: boolean;
  sampleMs: number;
  cooldownMs: number;
  intervalMs: number;
  pssScope: RemotePssScope;
  mediaItems: number;
  seedRecords: number;
  reportDir: string;
};

type RemoteScenarioSample = {
  at: number;
  page: Record<string, unknown>;
  processes: RemoteProcessSample[];
  processSummary: ReturnType<typeof summarizeWslChromeProcesses>;
  processSummaryByCategory: Partial<WslChromeProcessCategorySummary>;
  processSummaryByRole: Partial<WslChromeProcessRoleSummary>;
  cdpProcessInfo: WslCdpProcessInfoSummary[];
  targetSummary: Array<{ type: string; url: string }>;
  pageCount: number;
  serviceWorkerHeapUsage?: WslServiceWorkerHeapUsage | null;
  diagnosticPhase: 'steady' | 'cooldown';
};

export type RemoteTargetInfo = { type?: string; url?: string; targetId?: string };

type RemoteCdpProcessInfo = {
  id?: unknown;
  type?: unknown;
  cpuTime?: unknown;
  privateMemory?: unknown;
  physicalMemory?: unknown;
  peakWorkingSetSize?: unknown;
};

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : fallback;
}

export function parseRemoteBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function classifyProcessRole(process: RemoteProcessSample): string {
  const args = process.args ?? '';
  if (args.includes('--type=renderer')) {
    if (args.includes('--extension-process')) return 'extension-renderer';
    if (args.includes('--top-chrome-webui')) return 'chrome-ui-renderer';
    return 'renderer';
  }
  if (args.includes('--type=gpu-process')) return 'gpu';
  if (args.includes('--type=utility')) return 'utility';
  return 'browser';
}

export function parseRemoteChromeProcessLine(line: string): RemoteProcessSample | null {
  const fields = line.trim().split('\t');
  if (fields.length < 5) return null;
  const [pidText, jiffiesText, rssText, pssText, argsBase64] = fields;
  const pid = Number(pidText);
  const cpuJiffies = Number(jiffiesText);
  const rssKb = Number(rssText);
  const pssKb = Number(pssText);
  if (!Number.isInteger(pid) || pid <= 0 || !Number.isFinite(cpuJiffies) || cpuJiffies < 0) return null;
  if (!Number.isFinite(rssKb) || rssKb < 0 || !Number.isFinite(pssKb) || pssKb < 0) return null;
  let args = '';
  try {
    args = Buffer.from(argsBase64 ?? '', 'base64').toString('utf8').trim();
  } catch {
    return null;
  }
  if (!/chrome/i.test(args)) return null;
  return {
    pid,
    cpuJiffies,
    cpuPercent: 0,
    rssKb,
    pssKb,
    command: args.split(/\s+/, 1)[0] ?? 'chrome',
    args,
  };
}

export function calculateRemoteProcessCpuPercent(
  previousJiffies: number,
  currentJiffies: number,
  elapsedMs: number,
): number {
  return calculateWslIntervalCpuPercent(previousJiffies, currentJiffies, elapsedMs);
}

export function buildRemoteDashboardUrl(
  extensionId: string,
  dashboardHash: string,
  homeCharts: string,
  newWorksDiagnostic = '',
): string {
  return buildWslDashboardUrl(extensionId, dashboardHash, homeCharts, newWorksDiagnostic);
}

export function parseRemotePssScope(value: string | undefined): RemotePssScope {
  return value?.trim().toLowerCase() === 'extension' ? 'extension' : 'all';
}

export function parseRemoteTabSequence(value: string | undefined): string[] {
  const sequence = (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => /^#?tab-[a-z0-9-]+$/.test(part))
    .map((part) => parseWslDashboardHash(part));
  return sequence.filter((hash, index, all) => all.indexOf(hash) === index);
}

export function parseRemoteTabSwitchIntervalMs(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_TAB_SWITCH_INTERVAL_MS;
  return Math.min(5_000, Math.trunc(parsed));
}

export function isRemoteExtensionPageUrl(url: string, extensionId: string): boolean {
  return url.startsWith(`chrome-extension://${extensionId}/`);
}

export function hasUnmappedRemoteExtensionTarget(
  targets: readonly RemoteTargetInfo[],
  pageUrls: readonly string[],
  extensionId: string,
): boolean {
  const hasRawExtensionTarget = targets.some((target) => (
    target.type === 'page' && isRemoteExtensionPageUrl(target.url ?? '', extensionId)
  ));
  const hasMappedExtensionPage = pageUrls.some((url) => isRemoteExtensionPageUrl(url, extensionId));
  return hasRawExtensionTarget && !hasMappedExtensionPage;
}

export function buildRemoteProcessSnapshotCommand(
  userDataDir: string,
  pssScope: RemotePssScope = 'all',
): string {
  const quotedDir = shellQuote(userDataDir);
  const pssCommand = pssScope === 'extension'
    ? '  case "$args" in *"--extension-process"*) pss=$(awk \'/^Pss:/{print $2; exit}\' "$proc/smaps_rollup" 2>/dev/null || printf "0");; *) pss=0;; esac;'
    : '  pss=$(awk \'/^Pss:/{print $2; exit}\' "$proc/smaps_rollup" 2>/dev/null || printf "0");';
  return [
    `userDataDir=${quotedDir}; marker="--user-data-dir=$userDataDir";`,
    'for proc in /proc/[0-9]*; do',
    '  pid="${proc##*/}";',
    '  args=$(tr "\\0" " " < "$proc/cmdline" 2>/dev/null || true);',
    '  case "$args" in *"$marker"*) ;; *) continue ;; esac;',
    '  case "$args" in *chrome*) ;; *) continue ;; esac;',
    '  jiffies=$(awk \'{print $14+$15}\' "$proc/stat" 2>/dev/null || printf "0");',
    '  rss=$(awk \'/^VmRSS:/{print $2; exit}\' "$proc/status" 2>/dev/null || printf "0");',
    pssCommand,
    '  encoded=$(printf "%s" "$args" | base64 -w0 2>/dev/null || true);',
    '  printf "%s\\t%s\\t%s\\t%s\\t%s\\n" "$pid" "${jiffies:-0}" "${rss:-0}" "${pss:-0}" "$encoded";',
    'done',
  ].join(' ');
}

export function buildRemoteProcessSnapshotInvocation(
  sshHost: string,
  userDataDir: string,
  pssScope: RemotePssScope = 'all',
): { file: string; args: string[] } {
  const command = buildRemoteProcessSnapshotCommand(userDataDir, pssScope);
  const normalizedHost = sshHost.trim().toLowerCase();
  if (normalizedHost === 'local' || normalizedHost === 'localhost' || normalizedHost === '127.0.0.1') {
    return {
      file: '/bin/bash',
      args: ['-lc', command],
    };
  }
  return {
    file: 'ssh',
    args: [
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=5',
      sshHost,
      command,
    ],
  };
}

export async function readRemoteProcesses(
  options: Pick<RemoteProbeOptions, 'sshHost' | 'userDataDir' | 'pssScope'>,
  state: RemoteProcessState,
): Promise<RemoteProcessSample[]> {
  const invocation = buildRemoteProcessSnapshotInvocation(
    options.sshHost,
    options.userDataDir,
    options.pssScope,
  );
  const { stdout } = await execFileAsync(invocation.file, invocation.args, {
    maxBuffer: 2_000_000,
    timeout: 10_000,
    windowsHide: true,
  });
  const now = Date.now();
  return stdout
    .split(/\r?\n/)
    .map(parseRemoteChromeProcessLine)
    .filter((process): process is RemoteProcessSample => process !== null)
    .map((process) => {
      const previous = state.get(process.pid);
      const cpuPercent = previous
        ? calculateRemoteProcessCpuPercent(
          previous.cpuJiffies,
          process.cpuJiffies,
          now - previous.atMs,
        )
        : 0;
      state.set(process.pid, { cpuJiffies: process.cpuJiffies, atMs: now });
      return { ...process, cpuPercent };
    });
}

async function getBrowserTargets(client: CDPSession): Promise<RemoteTargetInfo[]> {
  try {
    const response = await client.send('Target.getTargets') as { targetInfos?: RemoteTargetInfo[] };
    return response.targetInfos ?? [];
  } catch {
    return [];
  }
}

async function findMappedRemoteExtensionPage(
  context: BrowserContext,
  client: CDPSession,
  extensionId: string,
  timeoutMs = 2_000,
): Promise<Page | null> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  let latestTargets: RemoteTargetInfo[] = [];
  do {
    const pages = context.pages();
    const mappedPage = pages.find((candidate) => isRemoteExtensionPageUrl(candidate.url(), extensionId));
    if (mappedPage) return mappedPage;
    latestTargets = await getBrowserTargets(client);
    if (!latestTargets.some((target) => (
      target.type === 'page' && isRemoteExtensionPageUrl(target.url ?? '', extensionId)
    ))) return null;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);

  if (hasUnmappedRemoteExtensionTarget(latestTargets, context.pages().map((page) => page.url()), extensionId)) {
    const target = latestTargets.find((candidate) => (
      candidate.type === 'page' && isRemoteExtensionPageUrl(candidate.url ?? '', extensionId)
    ));
    throw new Error(
      `远端 CDP 存在扩展页面 target，但 Playwright 未映射到该页面：${target?.targetId ?? '[unknown]'}。`
      + ' 已停止探针，未对 chrome-error:// 页面重复导航。',
    );
  }
  return null;
}

async function assertRemotePageMapping(
  page: Page,
  context: BrowserContext,
  client: CDPSession,
  extensionId: string,
): Promise<void> {
  if (isRemoteExtensionPageUrl(page.url(), extensionId)) return;
  const targets = await getBrowserTargets(client);
  if (hasUnmappedRemoteExtensionTarget(targets, context.pages().map((candidate) => candidate.url()), extensionId)) {
    throw new Error(
      `远端 Dashboard 页面未映射成功，当前 Playwright URL 为 ${page.url()}。`
      + ' 已停止探针，未把错误页当作 Dashboard 继续采样。',
    );
  }
  throw new Error(`远端 Dashboard 页面导航后 URL 无效：${page.url()}`);
}

async function getCdpProcessInfo(client: CDPSession): Promise<WslCdpProcessInfoSummary[]> {
  try {
    const response = await client.send('SystemInfo.getProcessInfo') as { processInfo?: RemoteCdpProcessInfo[] };
    return summarizeWslCdpProcessInfo(response.processInfo ?? []);
  } catch {
    return [];
  }
}

async function readPageSnapshot(page: Page): Promise<Record<string, unknown>> {
  const value = await page.evaluate(buildWslPageMetricsExpression({ includeProbeState: true }))
    .catch(() => ({ pageEvaluationFailed: true }));
  return {
    url: page.url(),
    ...(typeof value === 'object' && value !== null ? value : {}),
  };
}

function buildRecordFixture(count: number): Array<Record<string, unknown>> {
  const now = Date.now();
  return Array.from({ length: Math.max(0, Math.trunc(count)) }, (_, index) => {
    const number = index + 1;
    return {
      id: `REMOTE-PERF-${String(number).padStart(5, '0')}`,
      title: `REMOTE-PERF-${String(number).padStart(5, '0')} 性能测试记录`,
      status: index % 3 === 0 ? 'viewed' : 'browsed',
      tags: [`标签-${index % 120}`, `系列-${index % 80}`, `演员-${index % 240}`],
      createdAt: now - index * 86_400_000,
      updatedAt: now - index * 60_000,
      releaseDate: '2026-01-01',
      videoCode: `REMOTE-PERF-${String(number).padStart(5, '0')}`,
      rating: (index % 50) / 10,
      userRating: (index % 50) / 10,
      isFavorite: index % 9 === 0,
      listIds: [`list-${index % 40}`],
    };
  });
}

async function seedRemoteData(page: Page, options: RemoteProbeOptions): Promise<void> {
  if (options.mediaItems > 0) {
    const mediaFixture = buildPerformanceMediaFixture(options.mediaItems);
    await page.evaluate(async (fixture) => {
      await new Promise<void>((resolve, reject) => {
        chrome.storage.local.set(fixture, () => {
          const error = chrome.runtime.lastError;
          if (error) reject(new Error(error.message));
          else resolve();
        });
      });
    }, mediaFixture);
  }
  if (options.seedRecords > 0) {
    const records = buildRecordFixture(options.seedRecords);
    const result = await page.evaluate(async (payload) => new Promise<{ success?: boolean; error?: string }>((resolve) => {
      chrome.runtime.sendMessage({ type: 'DB:VIEWED_BULK_PUT', payload: { records: payload } }, (response) => {
        const error = chrome.runtime.lastError;
        resolve(error ? { success: false, error: error.message } : response ?? { success: false });
      });
    }), records);
    if (result.success !== true) throw new Error(`远端性能记录 fixture 写入失败：${result.error ?? 'unknown'}`);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
}

async function samplePage(
  browserClient: CDPSession,
  page: Page,
  options: RemoteProbeOptions,
  phase: 'steady' | 'cooldown',
): Promise<RemoteScenarioSample[]> {
  const processState: RemoteProcessState = new Map();
  const samples: RemoteScenarioSample[] = [];
  const startedAt = Date.now();
  while (Date.now() - startedAt < options.sampleMs) {
    const [pageSnapshot, processes, targets, cdpProcessInfo] = await Promise.all([
      readPageSnapshot(page),
      readRemoteProcesses(options, processState),
      getBrowserTargets(browserClient),
      getCdpProcessInfo(browserClient),
    ]);
    samples.push({
      at: Date.now(),
      page: pageSnapshot,
      processes,
      processSummary: summarizeWslChromeProcesses(processes),
      processSummaryByCategory: summarizeWslChromeProcessesByCategory(processes),
      processSummaryByRole: summarizeWslChromeProcessesByRole(processes),
      cdpProcessInfo,
      targetSummary: summarizeWslTargetInfos(targets),
      pageCount: targets.filter((target) => target.type === 'page').length,
      diagnosticPhase: phase,
    });
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
  return samples;
}

function readOptions(): RemoteProbeOptions {
  return {
    cdpUrl: process.env.JAVDB_REMOTE_CDP_URL?.trim() || DEFAULT_CDP_URL,
    sshHost: process.env.JAVDB_REMOTE_SSH_HOST?.trim() || DEFAULT_SSH_HOST,
    userDataDir: process.env.JAVDB_REMOTE_USER_DATA_DIR?.trim() || DEFAULT_USER_DATA_DIR,
    extensionId: process.env.JAVDB_REMOTE_EXTENSION_ID?.trim() || DEFAULT_EXTENSION_ID,
    dashboardHash: process.env.JAVDB_REMOTE_DASHBOARD_HASH?.trim() || '#tab-records',
    tabSequence: parseRemoteTabSequence(process.env.JAVDB_REMOTE_TAB_SEQUENCE),
    tabSwitchRounds: Math.max(1, numberFromEnv('JAVDB_REMOTE_TAB_SWITCH_ROUNDS', 2)),
    tabSwitchIntervalMs: parseRemoteTabSwitchIntervalMs(process.env.JAVDB_REMOTE_TAB_SWITCH_INTERVAL_MS),
    homeCharts: process.env.JAVDB_REMOTE_HOME_CHARTS?.trim() || '',
    newWorksDiagnostic: process.env.JAVDB_REMOTE_NEW_WORKS_DIAGNOSTIC?.trim() || '',
    disableExternalSync: parseRemoteBoolean(process.env.JAVDB_REMOTE_DISABLE_EXTERNAL_SYNC, true),
    clearCloudPending: parseRemoteBoolean(process.env.JAVDB_REMOTE_CLEAR_CLOUD_PENDING, true),
    sampleMs: numberFromEnv('JAVDB_REMOTE_SAMPLE_MS', DEFAULT_SAMPLE_MS),
    cooldownMs: Math.min(60_000, numberFromEnv('JAVDB_REMOTE_COOLDOWN_MS', 5_000)),
    intervalMs: Math.max(250, numberFromEnv('JAVDB_REMOTE_INTERVAL_MS', DEFAULT_INTERVAL_MS)),
    pssScope: parseRemotePssScope(process.env.JAVDB_REMOTE_PSS_SCOPE),
    mediaItems: numberFromEnv('JAVDB_REMOTE_MEDIA_ITEMS', 0),
    seedRecords: numberFromEnv('JAVDB_REMOTE_SEED_RECORDS', 1_289),
    reportDir: path.resolve(process.env.JAVDB_REMOTE_REPORT_DIR || 'test-results/performance/remote-regression'),
  };
}

async function run(options: RemoteProbeOptions): Promise<string> {
  const browser = await chromium.connectOverCDP(options.cdpUrl);
  let browserClient: CDPSession | null = null;
  try {
    const context: BrowserContext | undefined = browser.contexts()[0];
    if (!context) throw new Error('远端 CDP 没有可用 BrowserContext。');
    browserClient = await browser.newBrowserCDPSession();
    const existingPages = context.pages();
    let page = await findMappedRemoteExtensionPage(context, browserClient, options.extensionId);
    if (!page) page = existingPages.find((candidate) => candidate.url() === 'about:blank') ?? null;
    if (!page) page = await context.newPage();
    // 连续专项运行只保留一个探针页面和一个 cooldown 空白页，避免探针自身制造 target 累积。
    await Promise.all(existingPages
      .filter((candidate) => candidate !== page && (
        candidate.url() === 'about:blank'
        || candidate.url().startsWith(`chrome-extension://${options.extensionId}/`)
      ))
      .map((candidate) => candidate.close().catch(() => undefined)));
    const dashboardUrl = buildRemoteDashboardUrl(
      options.extensionId,
      options.dashboardHash,
      options.homeCharts,
      options.newWorksDiagnostic,
    );
    // Chrome may auto-open the extension page when the isolated profile starts.
    // Re-navigating an already mounted extension page can be rejected by Chrome.
    if (!page.url().startsWith(`chrome-extension://${options.extensionId}/`)) {
      await page.goto(dashboardUrl, {
        waitUntil: 'domcontentloaded',
      });
    } else if (page.url() !== dashboardUrl) {
      await page.evaluate((url) => {
        window.location.href = url;
      }, dashboardUrl);
      await page.waitForLoadState('domcontentloaded').catch(() => undefined);
    }
    await assertRemotePageMapping(page, context, browserClient, options.extensionId);
    await page.waitForSelector('#app-root', { timeout: 15_000 });
    let externalSyncIsolation: RemoteExternalSyncIsolationResult | null = null;
    if (options.disableExternalSync) {
      externalSyncIsolation = await page.evaluate(
        buildWslExternalSyncIsolationExpression({ clearCloudPending: options.clearCloudPending }),
      ) as RemoteExternalSyncIsolationResult;
      if (!isRemoteExternalSyncIsolationSuccessful(externalSyncIsolation)) {
        throw new Error(`远端性能 profile 外部同步隔离失败：${externalSyncIsolation.error ?? 'unknown'}`);
      }
    }
    await seedRemoteData(page, options);
    await page.evaluate(buildWslPerformanceProbeScript());
    await page.waitForTimeout(2_000);
    const steadySamples = await samplePage(browserClient, page, options, 'steady');
    let tabChurnSamples: RemoteScenarioSample[] = [];
    let tabSwitchSnapshots: Array<Record<string, unknown>> = [];
    if (options.tabSequence.length >= 2) {
      tabSwitchSnapshots = await page.evaluate(async ({ sequence, repeat, switchIntervalMs }) => {
        const snapshots: Array<Record<string, unknown>> = [];
        const totalSwitches = sequence.length * repeat;
        let completedSwitches = 0;
        for (let round = 0; round < repeat; round += 1) {
          for (const hash of sequence) {
            const requestedAt = performance.now();
            window.location.hash = hash;
            const expectedTabId = hash.replace(/^#/, '');
            const activationStartedAt = requestedAt;
            let active = document.querySelector('.tab-content.active');
            while (performance.now() - activationStartedAt < 2_000) {
              if (active?.id === expectedTabId) break;
              await new Promise<void>((resolve) => setTimeout(resolve, 50));
              active = document.querySelector('.tab-content.active');
            }
            snapshots.push({
              round: round + 1,
              requestedHash: hash,
              requestedAt,
              expectedTabId,
              activeTabId: active?.id ?? null,
              activated: active?.id === expectedTabId,
              activationWaitMs: Math.round(performance.now() - activationStartedAt),
              appRootMounted: Boolean(document.querySelector('#app-root')?.childElementCount),
              activeContentCount: document.querySelectorAll('.tab-content.active').length,
              activeContentDomNodes: active?.querySelectorAll('*').length ?? 0,
            });
            completedSwitches += 1;
            if (switchIntervalMs > 0 && completedSwitches < totalSwitches) {
              await new Promise<void>((resolve) => setTimeout(resolve, switchIntervalMs));
            }
          }
        }
        return snapshots;
      }, {
        sequence: options.tabSequence,
        repeat: options.tabSwitchRounds,
        switchIntervalMs: options.tabSwitchIntervalMs,
      });
      // 切换计时不能与 CDP/进程采样竞争同一扩展页面；先稳定后再测资源。
      await page.waitForTimeout(1_000);
      tabChurnSamples = await samplePage(browserClient, page, {
        ...options,
        sampleMs: Math.max(8_000, options.sampleMs),
        seedRecords: 0,
        mediaItems: 0,
      }, 'steady');
    }
    await page.goto(`chrome-extension://${options.extensionId}/dashboard/dashboard.html#tab-home`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(1_000);
    const hiddenSnapshot = await readPageSnapshot(page);

    const blank = context.pages().find((candidate) => candidate !== page && candidate.url() === 'about:blank')
      ?? await context.newPage();
    await blank.goto('about:blank');
    await page.close();
    const cooldownSamples = await samplePage(browserClient, blank, {
      ...options,
      sampleMs: options.cooldownMs,
      seedRecords: 0,
      mediaItems: 0,
    }, 'cooldown');
    // Chrome 在最后一个页面关闭后会自动退出；保留空白页让远端测试浏览器继续可用。

    const allSamples = [...steadySamples, ...cooldownSamples];
    const diagnosticInput: WslDiagnosticProcessSample[] = allSamples.map((sample) => ({
      at: sample.at,
      phase: sample.diagnosticPhase,
      page: sample.page,
      processSummary: sample.processSummary,
      processSummaryByCategory: sample.processSummaryByCategory,
      processSummaryByRole: sample.processSummaryByRole,
    }));
    const diagnostic = buildWslDiagnosticSnapshot(
      `remote-chrome-${options.dashboardHash.replace(/^#/, '')}`,
      diagnosticInput,
    );
    const targets = await getBrowserTargets(browserClient);
    const report = redactDiagnosticPayload({
      version: 1,
      capturedAt: Date.now(),
      browser: 'remote-cdp',
      cdpUrl: options.cdpUrl,
      sshHost: options.sshHost,
      extensionId: options.extensionId,
      dashboardHash: options.dashboardHash,
      tabSequence: options.tabSequence,
      tabSwitchRounds: options.tabSwitchRounds,
      tabSwitchIntervalMs: options.tabSwitchIntervalMs,
      tabSwitchSnapshots,
      homeCharts: options.homeCharts,
      newWorksDiagnostic: options.newWorksDiagnostic,
      disableExternalSync: options.disableExternalSync,
      clearCloudPending: options.clearCloudPending,
      externalSyncIsolation,
      seedRecords: options.seedRecords,
      mediaItems: options.mediaItems,
      sampleMs: options.sampleMs,
      cooldownMs: options.cooldownMs,
      intervalMs: options.intervalMs,
      pssScope: options.pssScope,
      extensionRuntime: {
        ok: Boolean(targets.some((target) => target.type === 'service_worker' && target.url?.startsWith(`chrome-extension://${options.extensionId}/`))),
      },
      extensionPageRuntime: {
        url: steadySamples[0]?.page.url ?? null,
        appRootMounted: steadySamples.some((sample) => sample.page.appRootMounted === true),
        domNodes: steadySamples.at(-1)?.page.domNodes ?? null,
      },
      hiddenTabSnapshot: hiddenSnapshot,
      diagnostic,
      scenarios: [
        { name: 'remote-dashboard-steady', phase: 'steady', samples: steadySamples },
        ...(options.tabSequence.length >= 2
          ? [{ name: 'remote-dashboard-post-switch-steady', phase: 'steady' as const, samples: tabChurnSamples }]
          : []),
        { name: 'remote-dashboard-close-recovery', phase: 'cooldown', samples: cooldownSamples },
      ],
    });
    await fs.mkdir(options.reportDir, { recursive: true });
    const reportPath = path.join(options.reportDir, `remote-cdp-${Date.now()}.json`);
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    return reportPath;
  } finally {
    await browserClient?.detach().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  run(readOptions())
    .then((reportPath) => console.log(JSON.stringify({ reportPath }, null, 2)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      process.exitCode = 1;
    });
}
