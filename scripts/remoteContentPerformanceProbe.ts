/**
 * @file remoteContentPerformanceProbe.ts
 * @description 在隔离远端 Chrome 中对动态列表内容脚本做低开销计数诊断。
 */
import { chromium, type CDPSession, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildContentPerformanceReadExpression,
  buildWslPageMetricsExpression,
  buildWslPerformanceProbeScript,
  summarizeWslChromeProcesses,
  summarizeWslChromeProcessesByCategory,
  summarizeWslChromeProcessesByRole,
} from './wslCdpPerformanceProbe';
import {
  readRemoteProcesses,
  type RemoteProcessSample,
  type RemoteProcessState,
} from './remoteCdpPerformanceProbe';
import { buildWslExternalSyncIsolationExpression } from './wslCdpPerformanceProbe';

type ExecutionContextInfo = {
  id: number;
  name?: string;
  origin?: string;
  auxData?: { type?: string };
};

type DiagnosticSnapshot = {
  enabled?: boolean;
  counters?: Record<string, number>;
  durations?: Record<string, { count: number; totalMs: number; maxMs: number }>;
};

type RuntimeEvaluateResponse = {
  exceptionDetails?: {
    text?: string;
    exception?: {
      description?: string;
      value?: unknown;
    };
  };
  result?: { value?: unknown };
};

export function formatRemoteContentRuntimeEvaluationFailure(
  response: RuntimeEvaluateResponse,
): string {
  const exception = response.exceptionDetails;
  if (!exception) return '';
  const description = exception.exception?.description
    ?? (exception.exception?.value === undefined
      ? ''
      : JSON.stringify(exception.exception.value));
  return [exception.text, description].filter(Boolean).join(': ')
    || 'Runtime.evaluate 执行异常';
}

type ProbeSample = {
  elapsedMs: number;
  items: number;
  domNodes: number;
  diagnostics: DiagnosticSnapshot | null;
  page: Record<string, unknown>;
  processes: RemoteProcessSample[];
  processSummary: ReturnType<typeof summarizeWslChromeProcesses>;
  processSummaryByCategory: ReturnType<typeof summarizeWslChromeProcessesByCategory>;
  processSummaryByRole: ReturnType<typeof summarizeWslChromeProcessesByRole>;
  inputLatency: InputLatencySnapshot | null;
};

type InputLatencySnapshot = {
  eventCount: number;
  maxEventDurationMs: number;
  eventLoopSamples: number;
  maxEventLoopDelayMs: number;
};

export type RemoteContentPerformanceProbeOptions = {
  cdpUrl: string;
  sshHost: string;
  userDataDir: string;
  variant: 'full' | 'actor-off' | 'filter-off' | 'actor-on-filter-off' | 'watermark';
  sourceUrl: string;
  sampleAtMs: number[];
  dynamicBatches: number;
  dynamicBatchSize: number;
  dynamicIntervalMs: number;
  reportDir: string;
};

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

export function readRemoteContentPerformanceProbeOptions(): RemoteContentPerformanceProbeOptions {
  return {
    cdpUrl: process.env.JAVDB_REMOTE_CONTENT_CDP_URL?.trim() || 'http://127.0.0.1:19236',
    sshHost: process.env.JAVDB_REMOTE_CONTENT_SSH_HOST?.trim() || '192.168.0.134',
    userDataDir: process.env.JAVDB_REMOTE_CONTENT_USER_DATA_DIR?.trim() || '/opt/javdb-perf/profiles/content-resource',
    variant: parseRemoteContentVariant(process.env.JAVDB_REMOTE_CONTENT_VARIANT),
    sourceUrl: process.env.JAVDB_REMOTE_CONTENT_SOURCE_URL?.trim()
      || 'http://127.0.0.1:18080/content-perf-fixture.html?perfContent=1',
    sampleAtMs: [0, 1_000, 2_500, 5_000, 7_500],
    dynamicBatches: Math.max(0, Math.trunc(numberFromEnv('JAVDB_REMOTE_CONTENT_BATCHES', 20))),
    dynamicBatchSize: Math.max(1, Math.trunc(numberFromEnv('JAVDB_REMOTE_CONTENT_BATCH_SIZE', 12))),
    dynamicIntervalMs: Math.max(0, Math.trunc(numberFromEnv('JAVDB_REMOTE_CONTENT_INTERVAL_MS', 250))),
    reportDir: path.resolve(process.env.JAVDB_REMOTE_CONTENT_REPORT_DIR || 'test-results/performance/remote-regression/content-dynamic'),
  };
}

export function parseRemoteContentVariant(value: string | undefined): RemoteContentPerformanceProbeOptions['variant'] {
  if (value === 'actor-off' || value === 'filter-off' || value === 'actor-on-filter-off' || value === 'watermark') return value;
  return 'full';
}

export function buildRemoteContentPerformanceReadExpression(): string {
  return buildContentPerformanceReadExpression();
}

async function applyRemoteContentVariant(
  client: CDPSession,
  context: ExecutionContextInfo | null,
  variant: RemoteContentPerformanceProbeOptions['variant'],
): Promise<void> {
  if (!context) throw new Error(`远端内容性能变量设置失败：未找到扩展隔离上下文（${variant}）`);
  const response = await client.send('Runtime.evaluate', {
    contextId: context.id,
    returnByValue: true,
    awaitPromise: true,
    expression: `(async (selectedVariant) => {
    const current = await new Promise((resolve) => {
      chrome.storage.local.get(['settings'], value => resolve(value.settings ?? {}));
    });
    const settings = { ...current };
    settings.userExperience = { ...(settings.userExperience ?? {}) };
    settings.contentFilter = { ...(settings.contentFilter ?? {}) };
    settings.listEnhancement = { ...(settings.listEnhancement ?? {}) };
    // 让三组使用明确且可比较的候选开关，不依赖空 profile 的默认设置。
    const filterOff = selectedVariant === 'filter-off' || selectedVariant === 'actor-on-filter-off';
    settings.userExperience.enableContentFilter = !filterOff;
    settings.contentFilter.enabled = !filterOff;
    settings.listEnhancement.enableActorWatermark = selectedVariant === 'watermark';
    settings.listEnhancement.hideBlacklistedActorsInList = false;
    settings.listEnhancement.hideNonFavoritedActorsInList = selectedVariant !== 'actor-off' && selectedVariant !== 'watermark';
    settings.listEnhancement.hideUnrecognizedActorsInList = selectedVariant !== 'actor-off' && selectedVariant !== 'watermark';
    await new Promise((resolve, reject) => {
      chrome.storage.local.set({ settings }, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve();
      });
    });
    return {
      variant: selectedVariant,
      contentFilterEnabled: settings.userExperience.enableContentFilter === true,
      actorQueueEnabled: settings.listEnhancement.enableActorWatermark === true
        || settings.listEnhancement.hideBlacklistedActorsInList === true
        || settings.listEnhancement.hideNonFavoritedActorsInList === true
        || settings.listEnhancement.hideUnrecognizedActorsInList !== false,
    };
  })(${JSON.stringify(variant)})`,
  }) as { result?: { value?: { variant?: string } } };
  const result = response.result?.value;
  if (!result || result.variant !== variant) {
    throw new Error(`远端内容性能变量设置失败：${variant}`);
  }
}

async function disableRemoteContentExternalSync(
  client: CDPSession,
  context: ExecutionContextInfo | null,
): Promise<void> {
  if (!context) throw new Error('远端内容性能诊断外部同步隔离失败：未找到扩展隔离上下文。');
  // 内容页初始化会持续产生本地 storage/log pending；独立 profile 中用开关和 alarm
  // 状态证明外部同步已隔离，不能把内容页的本地写入误判为 Cloud 同步仍在运行。
  const response = await client.send('Runtime.evaluate', {
    contextId: context.id,
    returnByValue: true,
    awaitPromise: true,
    expression: buildWslExternalSyncIsolationExpression({ clearCloudPending: false }),
  }) as RuntimeEvaluateResponse & {
    result?: { value?: { ok?: boolean; checks?: Record<string, boolean> } };
  };
  const result = response.result?.value;
  if (result?.ok !== true) {
    const runtimeFailure = formatRemoteContentRuntimeEvaluationFailure(response);
    const checks = JSON.stringify(result?.checks ?? {});
    throw new Error(`远端内容性能诊断外部同步隔离失败：${runtimeFailure || checks}`);
  }
}

function buildInputLatencyProbeScript(): string {
  return `(() => {
    const existing = globalThis.__JDB_CONTENT_INPUT_PERF__;
    if (existing?.installed) return;
    const state = existing ?? {
      installed: true,
      eventCount: 0,
      maxEventDurationMs: 0,
      eventLoopSamples: 0,
      maxEventLoopDelayMs: 0,
    };
    state.installed = true;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const duration = Number(entry.duration) || 0;
          state.eventCount += 1;
          state.maxEventDurationMs = Math.max(state.maxEventDurationMs, duration);
        }
      });
      observer.observe({ type: 'event', buffered: true, durationThreshold: 16 });
      state.eventObserver = observer;
    } catch {
      state.eventObserver = null;
    }
    let expected = performance.now();
    const tick = () => {
      const now = performance.now();
      const delay = Math.max(0, now - expected);
      state.eventLoopSamples += 1;
      state.maxEventLoopDelayMs = Math.max(state.maxEventLoopDelayMs, delay);
      expected = now + 50;
      state.eventLoopTimer = setTimeout(tick, 50);
    };
    state.eventLoopTimer = setTimeout(tick, 50);
    globalThis.__JDB_CONTENT_INPUT_PERF__ = state;
  })()`;
}

async function installPagePerformanceProbes(page: Page): Promise<void> {
  await page.evaluate(buildWslPerformanceProbeScript());
  await page.evaluate(buildInputLatencyProbeScript());
}

async function readInputLatencySnapshot(page: Page): Promise<InputLatencySnapshot | null> {
  return page.evaluate(() => {
    const state = (globalThis as typeof globalThis & {
      __JDB_CONTENT_INPUT_PERF__?: InputLatencySnapshot;
    }).__JDB_CONTENT_INPUT_PERF__;
    if (!state) return null;
    return {
      eventCount: Number(state.eventCount) || 0,
      maxEventDurationMs: Number(state.maxEventDurationMs) || 0,
      eventLoopSamples: Number(state.eventLoopSamples) || 0,
      maxEventLoopDelayMs: Number(state.maxEventLoopDelayMs) || 0,
    };
  }).catch(() => null);
}

async function findExtensionContext(client: CDPSession): Promise<ExecutionContextInfo | null> {
  const contexts: ExecutionContextInfo[] = [];
  client.on('Runtime.executionContextCreated', event => contexts.push(event.context as ExecutionContextInfo));
  await client.send('Runtime.enable');
  await new Promise(resolve => setTimeout(resolve, 250));
  return contexts.find(context => context.origin?.startsWith('chrome-extension://')
    && context.auxData?.type === 'isolated') ?? null;
}

async function readDiagnostic(client: CDPSession, context: ExecutionContextInfo | null): Promise<DiagnosticSnapshot | null> {
  if (!context) return null;
  try {
    const response = await client.send('Runtime.evaluate', {
      contextId: context.id,
      returnByValue: true,
      awaitPromise: true,
      timeout: 1_000,
      expression: buildRemoteContentPerformanceReadExpression(),
    }) as RuntimeEvaluateResponse;
    return response.result?.value as DiagnosticSnapshot | null ?? null;
  } catch {
    return null;
  }
}

async function readSample(
  page: Page,
  client: CDPSession,
  context: ExecutionContextInfo | null,
  startedAt: number,
  options: RemoteContentPerformanceProbeOptions,
  processState: RemoteProcessState,
): Promise<ProbeSample> {
  const [pageSnapshot, processes, inputLatency] = await Promise.all([
    page.evaluate(buildWslPageMetricsExpression({ includeProbeState: true })) as Promise<Record<string, unknown>>,
    readRemoteProcesses({
      sshHost: options.sshHost,
      userDataDir: options.userDataDir,
      pssScope: 'all',
    }, processState),
    readInputLatencySnapshot(page),
  ]);
  return {
    elapsedMs: Date.now() - startedAt,
    items: await page.locator('.movie-list .item').count(),
    domNodes: await page.evaluate(() => document.querySelectorAll('*').length),
    diagnostics: await readDiagnostic(client, context),
    page: pageSnapshot,
    processes,
    processSummary: summarizeWslChromeProcesses(processes),
    processSummaryByCategory: summarizeWslChromeProcessesByCategory(processes),
    processSummaryByRole: summarizeWslChromeProcessesByRole(processes),
    inputLatency,
  };
}

async function appendDynamicItems(page: Page, options: RemoteContentPerformanceProbeOptions): Promise<void> {
  await page.evaluate(({ batches, batchSize, intervalMs }) => {
    void (async () => {
      const list = document.querySelector('.movie-list');
      if (!list) return;
      let next = list.querySelectorAll('.item').length + 1;
      for (let batch = 0; batch < batches; batch += 1) {
        const fragment = document.createDocumentFragment();
        for (let index = 0; index < batchSize; index += 1, next += 1) {
          const item = document.createElement('div');
          item.className = 'item';
          item.innerHTML = `<a class="box" href="/v/PERF-${String(next).padStart(4, '0')}"><div class="video-title"><strong>PERF-${String(next).padStart(4, '0')}</strong></div><div class="tags has-addons"></div></a>`;
          fragment.appendChild(item);
        }
        list.appendChild(fragment);
        if (intervalMs > 0) await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    })();
  }, {
    batches: options.dynamicBatches,
    batchSize: options.dynamicBatchSize,
    intervalMs: options.dynamicIntervalMs,
  });
}

export async function runRemoteContentPerformanceProbe(options: RemoteContentPerformanceProbeOptions): Promise<string> {
  const browser = await chromium.connectOverCDP(options.cdpUrl);
  const context = browser.contexts()[0];
  if (!context) throw new Error('远端 CDP 没有可用 BrowserContext。');
  const page = await context.newPage();
  try {
    await page.goto(options.sourceUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.waitForTimeout(2_200);
    let client = await context.newCDPSession(page);
    let extensionContext = await findExtensionContext(client);
    await disableRemoteContentExternalSync(client, extensionContext);
    await applyRemoteContentVariant(client, extensionContext, options.variant);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2_200);
    await client.detach().catch(() => undefined);
    client = await context.newCDPSession(page);
    extensionContext = await findExtensionContext(client);
    if (!extensionContext) {
      throw new Error(`远端内容性能诊断无效：${options.variant} reload 后未找到扩展隔离上下文。`);
    }
    await installPagePerformanceProbes(page);
    const processState: RemoteProcessState = new Map();
    const startedAt = Date.now();
    const samples: ProbeSample[] = [await readSample(page, client, extensionContext, startedAt, options, processState)];
    await appendDynamicItems(page, options);
    for (const targetMs of options.sampleAtMs.slice(1)) {
      const waitMs = Math.max(0, targetMs - (Date.now() - startedAt));
      if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
      samples.push(await readSample(page, client, extensionContext, startedAt, options, processState));
    }
    const report = {
      version: 1,
      capturedAt: new Date().toISOString(),
      environment: {
        browser: 'remote-cdp',
        cdpUrl: options.cdpUrl,
        sshHost: options.sshHost,
        userDataDir: options.userDataDir,
        variant: options.variant,
        sourceUrl: options.sourceUrl,
        extensionInjected: await page.evaluate(() => document.documentElement.dataset.javdbExtensionInjected === '1'),
        extensionContext: extensionContext ? { name: extensionContext.name, origin: extensionContext.origin } : null,
      },
      dynamic: {
        batches: options.dynamicBatches,
        batchSize: options.dynamicBatchSize,
        intervalMs: options.dynamicIntervalMs,
      },
      samples,
      conclusion: '每个变量必须使用独立远端 profile。processSummaryByRole.renderer 是当前源站页面 Renderer 的资源近似，计数、长任务、输入延迟和进程样本必须联合解读。',
    };
    await fs.mkdir(options.reportDir, { recursive: true });
    const reportPath = path.join(options.reportDir, `remote-content-${Date.now()}.json`);
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    await page.close().catch(() => undefined);
    return reportPath;
  } finally {
    // connectOverCDP 不主动关闭远端浏览器，避免探针影响其他隔离任务。
    await page.close().catch(() => undefined);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  runRemoteContentPerformanceProbe(readRemoteContentPerformanceProbeOptions())
    .then(reportPath => {
      console.log(JSON.stringify({ reportPath }, null, 2));
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      process.exit(1);
    });
}
