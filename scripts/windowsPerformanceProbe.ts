/**
 * @file windowsPerformanceProbe.ts
 * @description 在 Windows 独立 Chrome 中采集扩展页面、CDP 和 Chrome 进程性能数据
 * @module scripts
 */
import { chromium, type BrowserContext, type CDPSession, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { extensionPageUrl, readExtensionId } from './extensionHarness';

const execFileAsync = promisify(execFile);
const DEFAULT_SAMPLE_INTERVAL_MS = 1_000;
const DEFAULT_WARMUP_MS = 20_000;
const DEFAULT_SAMPLE_MS = 60_000;
const DEFAULT_COOLDOWN_MS = 30_000;

export interface WindowsProcessSample {
  pid: number;
  processName: string;
  processType?: string | null;
  workingSetBytes: number;
  privateBytes: number;
  cpuTimeSeconds: number;
}

export type WindowsProcessCategory = 'browser' | 'renderer' | 'gpu' | 'utility' | 'other' | 'unclassified';

export interface ChromeProcessInfo {
  id: number;
  type: string;
  cpuTimeSeconds: number;
}

export type ChromeTargetCategory = 'extension' | 'website' | 'other';

export interface ChromeTargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
  attached: boolean;
  category: ChromeTargetCategory;
}

export interface WindowsProcessAggregate {
  processCount: number;
  workingSetBytes: number;
  privateBytes: number;
  /** 按整机逻辑处理器总数归一化，接近 Windows 任务管理器的总 CPU 口径。 */
  cpuPercent: number;
  /** 按单个逻辑处理器归一化，用于识别单进程超过 100% 的多核占用。 */
  cpuPercentSingleCore: number;
}

export interface WindowsProcessAggregateByCategory extends WindowsProcessAggregate {
  processCategory: WindowsProcessCategory;
}

export interface PagePerformanceSnapshot {
  url: string;
  readyState: string;
  domNodes: number;
  imageCount: number;
  videoCount: number;
  jsHeapUsedBytes: number | null;
  jsHeapLimitBytes: number | null;
  cdpMetrics: Record<string, number>;
}

export interface WindowsProbeSample {
  at: number;
  page: PagePerformanceSnapshot | null;
  processes: WindowsProcessSample[];
  cdpProcesses: ChromeProcessInfo[];
  targets: ChromeTargetInfo[];
  aggregate: WindowsProcessAggregate;
  aggregatesByCategory: WindowsProcessAggregateByCategory[];
}

export interface WindowsProbeScenario {
  name: string;
  warmupMs: number;
  sampleMs: number;
  cooldownMs?: number;
  samples: WindowsProbeSample[];
  errors: string[];
}

export interface WindowsPerformanceReport {
  version: 4;
  platform: NodeJS.Platform;
  capturedAt: number;
  browserExecutable: string;
  browserChannel: string;
  browserVersion: string;
  extensionId: string;
  extensionDir: string;
  profileDir: string;
  sampleIntervalMs: number;
  logicalProcessorCount: number;
  scenarios: WindowsProbeScenario[];
  consoleErrors: string[];
}

export interface PerformanceMediaFixture {
  settings: Record<string, never>;
  emby_library_state: {
    updatedAt: number;
    entries: Record<string, Array<{
      serverType: 'emby';
      serverName: string;
    serverUrl: '';
    itemId: string;
    itemName: string;
    path: string;
    coverImageUrl?: string;
    imageUrls?: Partial<Record<'Primary' | 'Thumb' | 'Backdrop', string>>;
    updatedAt: number;
    }> >;
  };
  drive115_library_state: {
    updatedAt: number;
    entries: Array<{
      code: string;
      title: string;
      videoFileId: string;
      pickCode: string;
      fileName: string;
      folderName: string;
      updatedAt: number;
    }>;
  };
}

interface Mock115Server {
  url: string;
  requestCount: number;
  close: () => Promise<void>;
}

interface MockCoverServer {
  url: string;
  requestCount: number;
  close: () => Promise<void>;
}

const MOCK_COVER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

async function startMockCoverServer(): Promise<MockCoverServer> {
  let requestCount = 0;
  const server: Server = createServer((_request, response) => {
    requestCount += 1;
    response.writeHead(200, {
      'content-type': 'image/png',
      'cache-control': 'no-store',
      'content-length': MOCK_COVER_PNG.length,
    });
    response.end(MOCK_COVER_PNG);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('无法获取本地封面 Mock 地址。');
  }
  return {
    url: `http://127.0.0.1:${address.port}/covers`,
    get requestCount() {
      return requestCount;
    },
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

async function startMock115Server(folderCount: number): Promise<Mock115Server> {
  const normalizedFolderCount = Math.max(1, Math.trunc(folderCount));
  let requestCount = 0;
  const server: Server = createServer((request, response) => {
    requestCount += 1;
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    const cid = requestUrl.searchParams.get('cid') || 'root';
    const offset = Number(requestUrl.searchParams.get('offset') ?? 0) || 0;
    const limit = Math.max(1, Number(requestUrl.searchParams.get('limit') ?? 1150) || 1150);
    const folders = Array.from({ length: normalizedFolderCount }, (_, index) => {
      const serial = String(index + 1).padStart(4, '0');
      return {
        fc: '0',
        cid: `mock-folder-${index + 1}`,
        file_name: `PERF-${serial}`,
      };
    });
    const isRoot = cid === 'root' || cid === 'mock-root';
    const data = isRoot
      ? folders.slice(offset, offset + limit)
      : (() => {
        const match = cid.match(/mock-folder-(\d+)/);
        const index = match ? Number(match[1]) : 1;
        const serial = String(index).padStart(4, '0');
        return [
          {
            fc: '1',
            fid: `mock-video-${index}`,
            file_name: `PERF-${serial}.mp4`,
            pick_code: `mock-pick-${index}`,
            file_size: 10_000_000,
          },
          {
            fc: '1',
            fid: `mock-cover-${index}`,
            file_name: 'fanart.jpg',
            pick_code: `mock-cover-pick-${index}`,
            file_size: 100_000,
          },
          {
            fc: '1',
            fid: `mock-nfo-${index}`,
            file_name: 'movie.nfo',
            pick_code: `mock-nfo-pick-${index}`,
            file_size: 2_000,
          },
        ];
      })();
    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.end(JSON.stringify({
      state: true,
      data,
      count: isRoot ? folders.length : data.length,
      limit,
      offset,
      cid,
    }));
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('无法读取 115 Mock 服务端口');
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    get requestCount() {
      return requestCount;
    },
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

export function normalizeChromeProcessCategory(value: string | null | undefined): WindowsProcessCategory {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (!normalized) {
    return 'unclassified';
  }
  if (normalized === 'browser') {
    return 'browser';
  }
  if (normalized === 'renderer') {
    return 'renderer';
  }
  if (normalized === 'gpu') {
    return 'gpu';
  }
  if (
    normalized === 'utility'
    || normalized.startsWith('network.')
    || normalized.includes('.mojom.')
    || normalized.endsWith('service')
  ) {
    return 'utility';
  }
  return 'other';
}

export function aggregateWindowsProcessSamples(
  current: readonly WindowsProcessSample[],
  previous: readonly WindowsProcessSample[],
  intervalMs: number,
  processorCount: number,
): WindowsProcessAggregate {
  const previousByPid = new Map(previous.map((sample) => [sample.pid, sample]));
  const cpuDeltaSeconds = current.reduce((sum, sample) => {
    const previousSample = previousByPid.get(sample.pid);
    // 新进程的 CPU 时间从进程启动时累计，不能直接归入当前窗口，否则启动峰值会被夸大。
    const delta = previousSample ? sample.cpuTimeSeconds - previousSample.cpuTimeSeconds : 0;
    return sum + Math.max(0, delta);
  }, 0);
  const normalizedIntervalMs = Math.max(1, intervalMs);
  const normalizedProcessorCount = Math.max(1, processorCount);

  return {
    processCount: current.length,
    workingSetBytes: current.reduce((sum, sample) => sum + sample.workingSetBytes, 0),
    privateBytes: current.reduce((sum, sample) => sum + sample.privateBytes, 0),
    cpuPercent: Number(((cpuDeltaSeconds * 100_000) / normalizedIntervalMs / normalizedProcessorCount).toFixed(2)),
    cpuPercentSingleCore: Number(((cpuDeltaSeconds * 100_000) / normalizedIntervalMs).toFixed(2)),
  };
}

export function aggregateWindowsProcessSamplesByCategory(
  current: readonly WindowsProcessSample[],
  previous: readonly WindowsProcessSample[],
  intervalMs: number,
  processorCount: number,
): WindowsProcessAggregateByCategory[] {
  const categories = [...new Set(current.map((sample) => normalizeChromeProcessCategory(sample.processType)))];
  return categories.map((processCategory) => ({
    processCategory,
    ...aggregateWindowsProcessSamples(
      current.filter((sample) => normalizeChromeProcessCategory(sample.processType) === processCategory),
      previous.filter((sample) => normalizeChromeProcessCategory(sample.processType) === processCategory),
      intervalMs,
      processorCount,
    ),
  }));
}

export function redactDiagnosticUrl(value: string): string {
  try {
    const url = new URL(value);
    const origin = url.origin === 'null'
      ? `${url.protocol}//${url.host}`
      : url.origin;
    return `${origin}${url.pathname}`;
  } catch {
    return '[invalid-url]';
  }
}

export function selectTrackedWindowsProcessIds(
  processIds: readonly number[],
  ignoredPids: ReadonlySet<number>,
): number[] {
  return processIds.filter((pid) => Number.isInteger(pid) && pid > 0 && !ignoredPids.has(pid));
}

export function buildPerformanceMediaFixture(
  itemCount: number,
  now = Date.now(),
  coverBaseUrl?: string,
): PerformanceMediaFixture {
  const count = Math.max(0, Math.trunc(itemCount));
  const embyEntries: PerformanceMediaFixture['emby_library_state']['entries'] = {};
  const driveEntries: PerformanceMediaFixture['drive115_library_state']['entries'] = [];
  const normalizedCoverBaseUrl = coverBaseUrl?.replace(/\/+$/, '');

  for (let index = 0; index < count; index += 1) {
    const number = index + 1;
    const code = `PERF-${String(number).padStart(4, '0')}`;
    const fileName = `${code}.mp4`;
    const coverUrl = normalizedCoverBaseUrl ? `${normalizedCoverBaseUrl}/${code}.jpg` : undefined;
    embyEntries[code] = [{
      serverType: 'emby',
      serverName: '性能测试 Emby',
      serverUrl: '',
      itemId: `perf-emby-item-${number}`,
      itemName: `${code} 测试影片`,
      path: fileName,
      ...(coverUrl ? { imageUrls: { Thumb: coverUrl } } : {}),
      updatedAt: now,
    }];
    driveEntries.push({
      code,
      title: `${code} 测试影片`,
      videoFileId: `perf-file-${number}`,
      pickCode: `perf-pick-${number}`,
      fileName,
      folderName: code,
      updatedAt: now,
    });
  }

  return {
    settings: {},
    emby_library_state: { updatedAt: now, entries: embyEntries },
    drive115_library_state: { updatedAt: now, entries: driveEntries },
  };
}

export function buildContentStressHtml(): string {
  const passwordInputs = Array.from({ length: 500 }, (_, index) => (
    `<input type="password" name="perf-password-${index}" value="fixture">`
  )).join('');
  const textRows = Array.from({ length: 1_000 }, (_, index) => (
    `<p>PERF-${String((index % 1_289) + 1).padStart(4, '0')} 静态内容 ${index}</p>`
  )).join('');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Performance fixture</title></head>
<body data-performance-stress="1">
  <main id="static-content">${passwordInputs}${textRows}</main>
  <section id="dynamic-content"></section>
  <script>
    let tick = 0;
    const appendMutation = () => {
      const node = document.createElement('p');
      node.textContent = 'PERF-DYNAMIC-' + tick;
      document.getElementById('dynamic-content')?.appendChild(node);
      tick += 1;
      if (tick < 160) setTimeout(appendMutation, 100);
    };
    setTimeout(appendMutation, 100);
  </script>
</body></html>`;
}

export function buildJavDbStressHtml(itemCount: number): string {
  const count = Math.max(0, Math.trunc(itemCount));
  const items = Array.from({ length: count }, (_, index) => {
    const code = `PERF-${String(index + 1).padStart(4, '0')}`;
    return `<div class="item"><a class="box" href="/v/${code}"><div class="video-title">${code} 测试影片</div><img alt="${code}" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="></a><div class="tags"><a class="tag">测试</a><a class="tag">列表</a></div></div>`;
  }).join('');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>JavDB performance fixture</title></head>
<body data-javdb-performance-stress="1">
  <main class="movie-list">${items}</main>
  <script>
    let tick = 0;
    const list = document.querySelector('.movie-list');
    const appendMutation = () => {
      if (!list || tick >= 120) return;
      const code = 'PERF-DYNAMIC-' + String(tick).padStart(4, '0');
      const item = document.createElement('div');
      item.className = 'item';
      const link = document.createElement('a');
      link.className = 'box';
      link.href = '/v/' + code;
      link.textContent = code;
      item.appendChild(link);
      list.appendChild(item);
      tick += 1;
      setTimeout(appendMutation, 100);
    };
    setTimeout(appendMutation, 100);
  </script>
</body></html>`;
}

function sanitizeDiagnosticText(value: string): string {
  return value
    .replace(/https?:\/\/[^\s)]+/gi, (url) => redactDiagnosticUrl(url))
    .replace(/((?:access[_-]?token|refresh[_-]?token|api[_-]?key|password|passwd|secret)=)[^&\s]+/gi, '$1[redacted]');
}

export function parseChromeTargetInfos(response: unknown): ChromeTargetInfo[] {
  if (!isRecord(response) || !Array.isArray(response.targetInfos)) {
    return [];
  }

  return response.targetInfos.flatMap((row) => {
    if (!isRecord(row)
      || typeof row.targetId !== 'string'
      || typeof row.type !== 'string'
      || typeof row.url !== 'string') {
      return [];
    }
    return [{
      targetId: row.targetId,
      type: row.type,
      title: typeof row.title === 'string' ? row.title : '',
      url: redactDiagnosticUrl(row.url),
      attached: row.attached === true,
      category: normalizeChromeTargetCategory(row.url),
    }];
  });
}

function normalizeChromeTargetCategory(url: string): ChromeTargetCategory {
  if (url.startsWith('chrome-extension://')) {
    return 'extension';
  }
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return 'website';
  }
  return 'other';
}

async function getChromeProcessInfo(client: CDPSession | null): Promise<ChromeProcessInfo[]> {
  if (!client) {
    return [];
  }
  const response = await client.send('SystemInfo.getProcessInfo') as unknown;
  if (!isRecord(response) || !Array.isArray(response.processInfo)) {
    return [];
  }
  return response.processInfo.flatMap((row) => {
    if (!isRecord(row)) {
      return [];
    }
    const id = toFiniteNumber(row.id);
    const cpuTimeSeconds = toFiniteNumber(row.cpuTime);
    if (id === null || cpuTimeSeconds === null || typeof row.type !== 'string') {
      return [];
    }
    return [{ id, type: row.type, cpuTimeSeconds }];
  });
}

async function getChromeTargetInfos(client: CDPSession | null): Promise<ChromeTargetInfo[]> {
  if (!client) {
    return [];
  }
  const response = await client.send('Target.getTargets') as unknown;
  return parseChromeTargetInfos(response);
}

async function getChromeProcessSamples(
  pids: ReadonlySet<number>,
  processInfo: readonly ChromeProcessInfo[],
): Promise<WindowsProcessSample[]> {
  if (pids.size === 0) {
    return [];
  }

  const serializedPids = [...pids].filter(Number.isInteger).join(',');
  const command = `
    $ids = @(${serializedPids});
    @(Get-Process -Name chrome -ErrorAction SilentlyContinue |
      Where-Object { $ids -contains $_.Id } |
      ForEach-Object {
        [pscustomobject]@{
          pid = [int]$_.Id;
          processName = [string]$_.ProcessName;
          workingSetBytes = [int64]$_.WorkingSet64;
          privateBytes = [int64]$_.PrivateMemorySize64;
          cpuTimeSeconds = if ($null -eq $_.CPU) { 0.0 } else { [double]$_.CPU }
        }
      }) | ConvertTo-Json -Compress
  `;
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    command,
  ], { windowsHide: true, maxBuffer: 1024 * 1024 });
  return parseProcessSamples(stdout, new Map(processInfo.map((process) => [process.id, process.type])));
}

async function getChromeProcessIds(): Promise<number[]> {
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '(Get-Process -Name chrome -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id) -join ","',
  ], { windowsHide: true, maxBuffer: 64 * 1024 });
  return stdout
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function parseProcessSamples(raw: string, processTypeByPid: ReadonlyMap<number, string>): WindowsProcessSample[] {
  const text = raw.trim();
  if (!text) {
    return [];
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }

  const rows = Array.isArray(value) ? value : [value];
  return rows.flatMap((row) => {
    if (!isRecord(row)) {
      return [];
    }
    const pid = toFiniteNumber(row.pid);
    const workingSetBytes = toFiniteNumber(row.workingSetBytes);
    const privateBytes = toFiniteNumber(row.privateBytes);
    const cpuTimeSeconds = toFiniteNumber(row.cpuTimeSeconds);
    if (pid === null || workingSetBytes === null || privateBytes === null || cpuTimeSeconds === null) {
      return [];
    }
    return [{
      pid,
      processName: typeof row.processName === 'string' ? row.processName : 'chrome',
      processType: processTypeByPid.get(pid) ?? null,
      workingSetBytes,
      privateBytes,
      cpuTimeSeconds,
    }];
  });
}

async function readPageSnapshot(page: Page, client: CDPSession): Promise<PagePerformanceSnapshot> {
  const pageState = await page.evaluate(() => {
    const memory = 'memory' in performance
      ? (performance as Performance & {
          memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number };
        }).memory
      : undefined;
    return {
      url: location.href,
      readyState: document.readyState,
      domNodes: document.getElementsByTagName('*').length,
      imageCount: document.images.length,
      videoCount: document.getElementsByTagName('video').length,
      jsHeapUsedBytes: typeof memory?.usedJSHeapSize === 'number' ? memory.usedJSHeapSize : null,
      jsHeapLimitBytes: typeof memory?.jsHeapSizeLimit === 'number' ? memory.jsHeapSizeLimit : null,
    };
  });
  const response = await client.send('Performance.getMetrics') as { metrics?: Array<{ name: string; value: number }> };
  const cdpMetrics = Object.fromEntries(
    (response.metrics ?? [])
      .filter((metric) => typeof metric.name === 'string' && Number.isFinite(metric.value))
      .map((metric) => [metric.name, metric.value]),
  );

  return {
    url: redactDiagnosticUrl(pageState.url),
    readyState: pageState.readyState,
    domNodes: pageState.domNodes,
    imageCount: pageState.imageCount,
    videoCount: pageState.videoCount,
    jsHeapUsedBytes: pageState.jsHeapUsedBytes,
    jsHeapLimitBytes: pageState.jsHeapLimitBytes,
    cdpMetrics,
  };
}

async function waitForMilliseconds(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) {
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function collectWindowsProcessSnapshot(
  browserClient: CDPSession | null,
  trackedPids: Set<number>,
  ignoredPids: ReadonlySet<number>,
  errors: string[],
): Promise<{ processes: WindowsProcessSample[]; cdpProcesses: ChromeProcessInfo[]; targets: ChromeTargetInfo[] }> {
  const currentPids = await getChromeProcessIds().catch((error: unknown) => {
    errors.push(`读取 Chrome 进程失败：${sanitizeDiagnosticText(String(error))}`);
    return [];
  });
  selectTrackedWindowsProcessIds(currentPids, ignoredPids).forEach((pid) => trackedPids.add(pid));
  const cdpProcesses = await getChromeProcessInfo(browserClient).catch((error: unknown) => {
    errors.push(`读取 Chrome CDP 进程类型失败：${sanitizeDiagnosticText(String(error))}`);
    return [];
  });
  const targets = await getChromeTargetInfos(browserClient).catch((error: unknown) => {
    errors.push(`读取 Chrome target 清单失败：${sanitizeDiagnosticText(String(error))}`);
    return [];
  });
  const processes = await getChromeProcessSamples(trackedPids, cdpProcesses).catch((error: unknown) => {
    errors.push(`采集 Chrome 进程失败：${sanitizeDiagnosticText(String(error))}`);
    return [];
  });
  return { processes, cdpProcesses, targets };
}

async function sampleScenario(
  page: Page | null,
  client: CDPSession | null,
  browserClient: CDPSession | null,
  trackedPids: Set<number>,
  ignoredPids: ReadonlySet<number>,
  name: string,
  options: { warmupMs: number; sampleMs: number; cooldownMs?: number; intervalMs: number },
  consoleErrors: string[],
): Promise<WindowsProbeScenario> {
  const errors: string[] = [];
  await waitForMilliseconds(options.warmupMs);
  const samples: WindowsProbeSample[] = [];
  let previousProcesses: WindowsProcessSample[] = [];
  const startedAt = Date.now();
  let lastSampleAt = startedAt;

  while (Date.now() - startedAt < options.sampleMs) {
    const processSnapshot = await collectWindowsProcessSnapshot(browserClient, trackedPids, ignoredPids, errors);
    const { processes, cdpProcesses, targets } = processSnapshot;
    const at = Date.now();
    const pageSnapshot = page && client && !page.isClosed()
      ? await readPageSnapshot(page, client).catch((error: unknown) => {
        errors.push(`采集页面指标失败：${sanitizeDiagnosticText(String(error))}`);
        return null;
      })
      : null;
    samples.push({
      at,
      page: pageSnapshot,
      processes,
      cdpProcesses,
      targets,
      aggregate: aggregateWindowsProcessSamples(
        processes,
        previousProcesses,
        Math.max(1, at - lastSampleAt),
        os.cpus().length,
      ),
      aggregatesByCategory: aggregateWindowsProcessSamplesByCategory(
        processes,
        previousProcesses,
        Math.max(1, at - lastSampleAt),
        os.cpus().length,
      ),
    });
    previousProcesses = processes;
    lastSampleAt = at;
    await waitForMilliseconds(options.intervalMs);
  }

  if (options.cooldownMs && options.cooldownMs > 0) {
    const cooldownStartedAt = Date.now();
    while (Date.now() - cooldownStartedAt < options.cooldownMs) {
      const processSnapshot = await collectWindowsProcessSnapshot(browserClient, trackedPids, ignoredPids, errors);
      const { processes, cdpProcesses, targets } = processSnapshot;
      const at = Date.now();
      samples.push({
        at,
        page: null,
        processes,
        cdpProcesses,
        targets,
        aggregate: aggregateWindowsProcessSamples(
          processes,
          previousProcesses,
          Math.max(1, at - lastSampleAt),
          os.cpus().length,
        ),
        aggregatesByCategory: aggregateWindowsProcessSamplesByCategory(
          processes,
          previousProcesses,
          Math.max(1, at - lastSampleAt),
          os.cpus().length,
        ),
      });
      previousProcesses = processes;
      lastSampleAt = at;
      await waitForMilliseconds(options.intervalMs);
    }
  }

  return {
    name,
    warmupMs: options.warmupMs,
    sampleMs: options.sampleMs,
    ...(options.cooldownMs ? { cooldownMs: options.cooldownMs } : {}),
    samples,
    errors,
  };
}

async function resolveChromeExecutable(): Promise<string> {
  const configured = process.env.JAVDB_CHROME_EXECUTABLE?.trim();
  const candidates = [
    configured,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // 继续尝试下一个系统 Chrome 位置。
    }
  }
  throw new Error('未找到 Windows Chrome，请设置 JAVDB_CHROME_EXECUTABLE。');
}

async function resolveProfileDirectory(): Promise<string> {
  const configured = process.env.JAVDB_PERF_PROFILE?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.resolve(process.cwd(), '.test-profiles', `windows-performance-${Date.now()}`);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : fallback;
}

export function shouldRunNoExtensionControl(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
}

export function shouldDisableGpu(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
}

export function parsePerformanceScenarioSelection(value: string | undefined): Set<string> | null {
  const names = (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (names.length === 0 || names.some((name) => name.toLowerCase() === 'all')) {
    return null;
  }
  return new Set(names);
}

export function shouldRunPerformanceScenario(selection: Set<string> | null, name: string): boolean {
  return selection === null
    || selection.has(name)
    || (name.startsWith('drive115-index-mock-') && selection.has('drive115-index-mock'));
}

export function selectInitialDashboardHash(selection: Set<string> | null): '#tab-home' | '#tab-media' {
  return selection === null
    || selection.has('dashboard-home')
    || selection.has('dashboard-multi-tab')
    || selection.has('popup-dashboard-reuse')
    || selection.has('dashboard-javdb-multi-tab')
    || selection.has('dashboard-insights-message-churn')
    || selection.has('dashboard-tab-switch-churn')
    || selection.has('dashboard-media-115-multi-tab')
    || selection.has('dashboard-media-115-same-tab')
    ? '#tab-home'
    : '#tab-media';
}

async function runNoExtensionControl(options: {
  extensionDir: string;
  profileDir: string;
  reportDir: string;
  sampleIntervalMs: number;
  warmupMs: number;
  sampleMs: number;
  cooldownMs: number;
  browserChannel: string;
  browserExecutable: string;
  useSystemChrome: boolean;
  disableGpu: boolean;
}): Promise<void> {
  const profileDir = `${options.profileDir}-no-extension`;
  await fs.rm(profileDir, { recursive: true, force: true });
  await fs.mkdir(profileDir, { recursive: true });
  const trackedPids = new Set<number>();
  const ignoredPids = new Set(await getChromeProcessIds().catch(() => []));
  const context = await chromium.launchPersistentContext(profileDir, {
    ...(options.useSystemChrome
      ? { executablePath: options.browserExecutable }
      : { channel: options.browserChannel }),
    headless: false,
    ...(options.useSystemChrome ? { ignoreDefaultArgs: ['--disable-extensions'] } : {}),
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      ...(options.disableGpu ? ['--disable-gpu'] : []),
    ],
  });
  try {
    const browser = context.browser();
    const browserClient = browser ? await browser.newBrowserCDPSession() : null;
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto('about:blank', { waitUntil: 'domcontentloaded' });
    const client = await context.newCDPSession(page);
    await client.send('Performance.enable');
    const scenario = await sampleScenario(
      page,
      client,
      browserClient,
      trackedPids,
      ignoredPids,
      'windows-browser-no-extension-control',
      {
        warmupMs: options.warmupMs,
        sampleMs: options.sampleMs,
        cooldownMs: options.cooldownMs,
        intervalMs: options.sampleIntervalMs,
      },
      [],
    );
    const report: WindowsPerformanceReport = {
      version: 4,
      platform: process.platform,
      capturedAt: Date.now(),
      browserExecutable: options.browserExecutable,
      browserChannel: options.browserChannel,
      browserVersion: browser?.version() ?? 'unknown',
      extensionId: '',
      extensionDir: options.extensionDir,
      profileDir,
      sampleIntervalMs: options.sampleIntervalMs,
      logicalProcessorCount: os.cpus().length,
      scenarios: [scenario],
      consoleErrors: [],
    };
    const reportPath = path.join(options.reportDir, `windows-control-${report.capturedAt}.json`);
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`Windows 无扩展对照已写入：${reportPath}`);
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('Windows 性能采样器只能在 Windows 上运行。');
  }

  const extensionDir = path.resolve(process.env.JAVDB_EXTENSION_DIST ?? 'dist');
  const profileDir = await resolveProfileDirectory();
  const reportDir = path.resolve(process.env.JAVDB_PERF_REPORT_DIR ?? 'test-results/performance');
  const sampleIntervalMs = parsePositiveInteger(process.env.JAVDB_PERF_INTERVAL_MS, DEFAULT_SAMPLE_INTERVAL_MS);
  const warmupMs = parsePositiveInteger(process.env.JAVDB_PERF_WARMUP_MS, DEFAULT_WARMUP_MS);
  const sampleMs = parsePositiveInteger(process.env.JAVDB_PERF_SAMPLE_MS, DEFAULT_SAMPLE_MS);
  const cooldownMs = parsePositiveInteger(process.env.JAVDB_PERF_COOLDOWN_MS, DEFAULT_COOLDOWN_MS);
  const browserChannel = process.env.JAVDB_PERF_BROWSER_CHANNEL?.trim() || 'chromium';
  const scenarioSelection = parsePerformanceScenarioSelection(process.env.JAVDB_PERF_SCENARIOS);
  const shouldRunScenario = (name: string): boolean => shouldRunPerformanceScenario(scenarioSelection, name);
  const disableGpu = shouldDisableGpu(process.env.JAVDB_PERF_DISABLE_GPU);
  const useSystemChrome = browserChannel === 'chrome' || browserChannel === 'msedge';
  const browserExecutable = useSystemChrome
    ? await resolveChromeExecutable()
    : chromium.executablePath();
  await fs.mkdir(reportDir, { recursive: true });
  await fs.rm(profileDir, { recursive: true, force: true });
  await fs.mkdir(profileDir, { recursive: true });

  if (shouldRunNoExtensionControl(process.env.JAVDB_PERF_NO_EXTENSION)) {
    await runNoExtensionControl({
      extensionDir,
      profileDir,
      reportDir,
      sampleIntervalMs,
      warmupMs,
      sampleMs,
      cooldownMs,
      browserChannel,
      browserExecutable,
      useSystemChrome,
      disableGpu,
    });
    return;
  }

  const trackedPids = new Set<number>();
  const beforePids = await getChromeProcessIds().catch(() => []);
  const ignoredPids = new Set(beforePids);
  const context = await chromium.launchPersistentContext(profileDir, {
    ...(useSystemChrome ? { executablePath: browserExecutable } : { channel: browserChannel }),
    headless: false,
    ...(useSystemChrome ? { ignoreDefaultArgs: ['--disable-extensions'] } : {}),
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      ...(disableGpu ? ['--disable-gpu'] : []),
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  });
  const browser = context.browser();
  const browserClient = browser ? await browser.newBrowserCDPSession() : null;

  const consoleErrors: string[] = [];
  const capturePageErrors = (page: Page): void => {
    page.on('pageerror', (error) => {
      consoleErrors.push(sanitizeDiagnosticText(error.message));
    });
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(sanitizeDiagnosticText(message.text()));
      }
    });
  };
  context.pages().forEach(capturePageErrors);

  let extensionId: string;
  try {
    extensionId = await readExtensionId(context);
  } catch (error) {
    await context.close();
    throw error;
  }
  const page = context.pages()[0] ?? await context.newPage();
  capturePageErrors(page);
  const initialDashboardHash = selectInitialDashboardHash(scenarioSelection);
  await page.goto(extensionPageUrl(extensionId, `dashboard/dashboard.html${initialDashboardHash}`), {
    waitUntil: 'domcontentloaded',
  });
  const client = await context.newCDPSession(page);
  await client.send('Performance.enable');
  const currentPids = await getChromeProcessIds();
  selectTrackedWindowsProcessIds(currentPids, ignoredPids).forEach((pid) => trackedPids.add(pid));

  const scenarios: WindowsProbeScenario[] = [];
  if (shouldRunScenario('popup-dashboard-reuse')) {
    const popupPage = await context.newPage();
    let dashboardPageCount = 0;
    try {
      await popupPage.goto(extensionPageUrl(extensionId, 'popup/popup.html'), {
        waitUntil: 'domcontentloaded',
      });
      const dashboardButton = popupPage.locator('#dashboard-button');
      await dashboardButton.waitFor({ state: 'visible' });
      await dashboardButton.click();
      await popupPage.waitForTimeout(250);
      await dashboardButton.click();
      await popupPage.waitForTimeout(250);

      const dashboardPrefix = extensionPageUrl(extensionId, 'dashboard/dashboard.html');
      dashboardPageCount = context.pages()
        .filter((candidate) => candidate.url().startsWith(dashboardPrefix)).length;
    } finally {
      await popupPage.close();
    }
    if (dashboardPageCount !== 1) {
      consoleErrors.push(`Popup Dashboard 复用验收失败：当前页面数=${dashboardPageCount}`);
    }
    scenarios.push(await sampleScenario(page, client, browserClient, trackedPids, ignoredPids, 'popup-dashboard-reuse', {
      warmupMs: 500,
      sampleMs: Math.min(sampleMs, 5_000),
      cooldownMs: 0,
      intervalMs: sampleIntervalMs,
    }, consoleErrors));
  }
  if (shouldRunScenario('dashboard-insights-message-churn')) {
    const senderPage = await context.newPage();
    try {
      capturePageErrors(senderPage);
      await senderPage.goto(extensionPageUrl(extensionId, 'popup/popup.html'), {
        waitUntil: 'domcontentloaded',
      });
      const messageChurn = senderPage.evaluate(async () => {
        for (let index = 0; index < 40; index += 1) {
          try {
            chrome.runtime.sendMessage(
              {
                type: 'DB:INSIGHTS_VIEWS_CHANGED',
                payload: { date: '2026-08-03', count: 1 },
              },
              () => { void chrome.runtime.lastError; },
            );
          } catch {}
          await new Promise<void>((resolve) => setTimeout(resolve, 100));
        }
      });
      scenarios.push(await sampleScenario(page, client, browserClient, trackedPids, ignoredPids, 'dashboard-insights-message-churn', {
        warmupMs: 500,
        sampleMs: Math.min(sampleMs, 8_000),
        cooldownMs: 0,
        intervalMs: sampleIntervalMs,
      }, consoleErrors));
      await messageChurn;
    } finally {
      await senderPage.close();
    }
  }
  if (scenarioSelection?.has('dashboard-multi-tab')) {
    const multiTabCount = Math.max(2, parsePositiveInteger(process.env.JAVDB_PERF_MULTI_TAB_COUNT, 4));
    const extraPages: Page[] = [];
    try {
      for (let index = 1; index < multiTabCount; index += 1) {
        const extraPage = await context.newPage();
        capturePageErrors(extraPage);
        await extraPage.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-home'), {
          waitUntil: 'domcontentloaded',
        });
        extraPages.push(extraPage);
      }
      scenarios.push(await sampleScenario(page, client, browserClient, trackedPids, ignoredPids, 'dashboard-multi-tab', {
        warmupMs,
        sampleMs,
        cooldownMs: 0,
        intervalMs: sampleIntervalMs,
      }, consoleErrors));
    } finally {
      await Promise.all(extraPages.map((extraPage) => extraPage.close()));
    }
  }
  if (shouldRunScenario('dashboard-home')) {
    scenarios.push(await sampleScenario(page, client, browserClient, trackedPids, ignoredPids, 'dashboard-home', {
      warmupMs,
      sampleMs,
      cooldownMs: 0,
      intervalMs: sampleIntervalMs,
    }, consoleErrors));
  }

  if (shouldRunScenario('dashboard-tab-switch-churn')) {
    const churnFixture = buildPerformanceMediaFixture(
      parsePositiveInteger(process.env.JAVDB_PERF_MEDIA_ITEMS, 1_289),
      Date.now(),
    );
    await page.evaluate(async (fixtureValue: PerformanceMediaFixture) => {
      await chrome.storage.local.set(fixtureValue);
    }, churnFixture);
    await page.waitForTimeout(500);
    const tabSequence = [
      'tab-home',
      'tab-records',
      'tab-media',
      'tab-actors',
      'tab-new-works',
      'tab-settings',
    ];
    const rounds = Math.max(1, parsePositiveInteger(process.env.JAVDB_PERF_TAB_SWITCH_ROUNDS, 30));
    const tabSwitchChurn = page.evaluate(async ({ sequence, repeat }) => {
      for (let round = 0; round < repeat; round += 1) {
        for (const tabId of sequence) {
          window.location.hash = `#${tabId}`;
          await new Promise<void>((resolve) => setTimeout(resolve, 100));
        }
      }
    }, { sequence: tabSequence, repeat: rounds });
    const churnScenario = sampleScenario(page, client, browserClient, trackedPids, ignoredPids, 'dashboard-tab-switch-churn', {
      warmupMs: 500,
      sampleMs: Math.min(sampleMs, Math.max(15_000, rounds * tabSequence.length * 100)),
      cooldownMs: 5_000,
      intervalMs: sampleIntervalMs,
    }, consoleErrors);
    const [scenario] = await Promise.all([churnScenario, tabSwitchChurn]);
    scenarios.push(scenario);
  }

  const mixedScenarioName = scenarioSelection?.has('dashboard-media-115-same-tab')
    ? 'dashboard-media-115-same-tab'
    : 'dashboard-media-115-multi-tab';
  if (shouldRunScenario('dashboard-media-115-multi-tab') || shouldRunScenario('dashboard-media-115-same-tab')) {
    const mediaPage = await context.newPage();
    const drive115Page = mixedScenarioName === 'dashboard-media-115-multi-tab'
      ? await context.newPage()
      : mediaPage;
    const mixedFixture = buildPerformanceMediaFixture(
      parsePositiveInteger(process.env.JAVDB_PERF_MEDIA_ITEMS, 1_289),
      Date.now(),
    );
    const mixedFolderCount = parsePositiveInteger(process.env.JAVDB_PERF_115_FOLDERS, 128);
    const mixed115 = await startMock115Server(mixedFolderCount);
    try {
      capturePageErrors(mediaPage);
      if (drive115Page !== mediaPage) capturePageErrors(drive115Page);
      await mediaPage.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-media'), {
        waitUntil: 'domcontentloaded',
      });
      await mediaPage.evaluate(async (fixtureValue: PerformanceMediaFixture) => {
        await chrome.storage.local.set(fixtureValue);
      }, mixedFixture);
      await mediaPage.reload({ waitUntil: 'domcontentloaded' });

      if (drive115Page !== mediaPage) {
        await drive115Page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-media'), {
          waitUntil: 'domcontentloaded',
        });
      }
      await drive115Page.evaluate(async (baseUrl: string) => {
        await chrome.storage.local.set({
          settings: {
            drive115: {
              enabled: true,
              v2AccessToken: 'windows-perf-mixed-token',
              v2TokenExpiresAt: Math.floor(Date.now() / 1000) + 7_200,
              v2AutoRefresh: true,
              v2ApiBaseUrl: baseUrl,
              mediaLibraryScanDepth: 1,
              mediaLibraryRoots: [{ cid: 'mock-root', name: '性能测试片库', enabled: true }],
            },
          },
        });
      }, mixed115.url);
      const indexPromise = drive115Page.evaluate(() => new Promise<unknown>((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'DRIVE115_MEDIA_LIBRARY_INDEX' },
          (response: unknown) => resolve(response ?? null),
        );
      }));
      scenarios.push(await sampleScenario(page, client, browserClient, trackedPids, ignoredPids, mixedScenarioName, {
        warmupMs: 1_000,
        sampleMs: Math.max(20_000, Math.min(sampleMs, 30_000)),
        cooldownMs: 5_000,
        intervalMs: sampleIntervalMs,
      }, consoleErrors));
      await indexPromise;
    } finally {
      await mediaPage.close();
      if (drive115Page !== mediaPage) await drive115Page.close();
      await mixed115.close();
    }
  }

  await page.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html#tab-media'), {
    waitUntil: 'domcontentloaded',
  });
  if (shouldRunScenario('media-library-empty-profile')) {
    scenarios.push(await sampleScenario(page, client, browserClient, trackedPids, ignoredPids, 'media-library-empty-profile', {
      warmupMs,
      sampleMs,
      cooldownMs: 0,
      intervalMs: sampleIntervalMs,
    }, consoleErrors));
  }

  const fixtureCount = parsePositiveInteger(process.env.JAVDB_PERF_MEDIA_ITEMS, 1_289);
  const mediaItemsScenario = `media-library-${fixtureCount}-items`;
  const mediaSearchScenario = `media-library-${fixtureCount}-items-search`;
  const mediaChurnScenario = `media-library-${fixtureCount}-items-storage-churn`;
  const mediaCoverScenario = `media-library-${fixtureCount}-items-cover-scroll`;
  const shouldRunMediaCoverScenario = shouldRunScenario(mediaCoverScenario);
  const mockCover = shouldRunMediaCoverScenario ? await startMockCoverServer() : null;
  const shouldPrepareMediaFixture = [mediaItemsScenario, mediaSearchScenario, mediaChurnScenario, mediaCoverScenario]
    .some((name) => shouldRunScenario(name));
  let fixture: PerformanceMediaFixture | null = null;
  if (shouldPrepareMediaFixture) {
    fixture = buildPerformanceMediaFixture(fixtureCount, Date.now(), mockCover?.url);
    await page.evaluate(async (value: PerformanceMediaFixture) => {
      await chrome.storage.local.set(value);
    }, fixture);
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  if (fixture && shouldRunScenario(mediaItemsScenario)) {
    scenarios.push(await sampleScenario(page, client, browserClient, trackedPids, ignoredPids, mediaItemsScenario, {
      warmupMs,
      sampleMs,
      cooldownMs: 0,
      intervalMs: sampleIntervalMs,
    }, consoleErrors));
  }

  if (fixture && shouldRunScenario(mediaSearchScenario)) {
    const searchInput = page.locator('input[aria-label="搜索媒体库"]');
    if (await searchInput.count() > 0) {
      await searchInput.fill('PERF-0002');
      scenarios.push(await sampleScenario(page, client, browserClient, trackedPids, ignoredPids, mediaSearchScenario, {
        warmupMs: 1_000,
        sampleMs: Math.min(sampleMs, 15_000),
        cooldownMs: 0,
        intervalMs: sampleIntervalMs,
      }, consoleErrors));
      await searchInput.fill('');
    }
  }

  if (fixture && shouldRunScenario(mediaChurnScenario)) {
    const snapshotChurnEntries = fixture.drive115_library_state.entries;
    await page.evaluate((entries: PerformanceMediaFixture['drive115_library_state']['entries']) => {
      const scope = globalThis as typeof globalThis & { __javdbPerfSnapshotChurn?: Promise<void> };
      scope.__javdbPerfSnapshotChurn = (async () => {
        for (let index = 1; index <= 60; index += 1) {
          await chrome.storage.local.set({
            drive115_library_state: {
              updatedAt: Date.now(),
              entries: entries.slice(0, Math.min(entries.length, Math.max(1, index * 24))),
            },
          });
          await new Promise<void>((resolve) => setTimeout(resolve, 100));
        }
      })();
    }, snapshotChurnEntries);
    scenarios.push(await sampleScenario(page, client, browserClient, trackedPids, ignoredPids, mediaChurnScenario, {
      warmupMs: 500,
      sampleMs: Math.min(sampleMs, 15_000),
      cooldownMs: 0,
      intervalMs: sampleIntervalMs,
    }, consoleErrors));
  }

  if (fixture && shouldRunMediaCoverScenario) {
    await page.evaluate(async () => {
      const step = Math.max(window.innerHeight || 600, 600);
      const maxTop = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      for (let top = 0; top < maxTop; top += step) {
        window.scrollTo(0, top);
        await new Promise<void>((resolve) => setTimeout(resolve, 75));
      }
      window.scrollTo(0, 0);
    });
    scenarios.push(await sampleScenario(page, client, browserClient, trackedPids, ignoredPids, mediaCoverScenario, {
      warmupMs: 1_000,
      sampleMs: Math.min(sampleMs, 15_000),
      cooldownMs: 0,
      intervalMs: sampleIntervalMs,
    }, consoleErrors));
    console.log(`封面 Mock 请求数：${mockCover?.requestCount ?? 0}`);
  }
  if (mockCover) {
    await mockCover.close();
  }

  const mock115FolderCount = parsePositiveInteger(process.env.JAVDB_PERF_115_FOLDERS, 24);
  const mock115SampleMs = parsePositiveInteger(
    process.env.JAVDB_PERF_115_SAMPLE_MS,
    Math.min(sampleMs, Math.max(8_000, mock115FolderCount * 350)),
  );
  const mock115Scenario = `drive115-index-mock-${mock115FolderCount}`;
  const mock115PostIndexScenario = `${mock115Scenario}-post-index`;
  const shouldRunMock115BaseAlias = scenarioSelection?.has('drive115-index-mock') === true;
  const shouldRunMock115 = shouldRunScenario(mock115Scenario)
    || shouldRunScenario(mock115PostIndexScenario)
    || shouldRunMock115BaseAlias;
  const shouldRunMock115PostIndex = shouldRunScenario(mock115PostIndexScenario) || shouldRunMock115BaseAlias;
  if (shouldRunMock115) {
    const mock115 = await startMock115Server(mock115FolderCount);
    try {
      await page.evaluate(async (baseUrl: string) => {
        await chrome.storage.local.set({
          settings: {
            drive115: {
              enabled: true,
              v2AccessToken: 'windows-perf-mock-token',
              v2TokenExpiresAt: Math.floor(Date.now() / 1000) + 7_200,
              v2AutoRefresh: true,
              v2ApiBaseUrl: baseUrl,
              mediaLibraryScanDepth: 1,
              mediaLibraryRoots: [{ cid: 'mock-root', name: '性能测试片库', enabled: true }],
            },
          },
        });
      }, mock115.url);
      const indexPromise = page.evaluate(() => new Promise<unknown>((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'DRIVE115_MEDIA_LIBRARY_INDEX' },
          (response: unknown) => resolve(response ?? null),
        );
      }));
      scenarios.push(await sampleScenario(page, client, browserClient, trackedPids, ignoredPids, mock115Scenario, {
        warmupMs: 500,
        sampleMs: mock115SampleMs,
        cooldownMs: 3_000,
        intervalMs: sampleIntervalMs,
      }, consoleErrors));
      const indexResult = await indexPromise;
      const resultRecord = isRecord(indexResult) ? indexResult : {};
      const resultStats = isRecord(resultRecord.stats) ? resultRecord.stats : {};
      console.log(`115 Mock 索引完成：folders=${mock115FolderCount}, requests=${mock115.requestCount}, result=${JSON.stringify({
        success: resultRecord.success,
        message: resultRecord.message,
        indexed: resultStats.indexed,
        skipped: resultStats.skipped,
        apiCalls: resultStats.apiCalls,
      })}`);
      if (shouldRunMock115PostIndex) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        scenarios.push(await sampleScenario(page, client, browserClient, trackedPids, ignoredPids, mock115PostIndexScenario, {
          warmupMs: 2_000,
          sampleMs: Math.min(mock115SampleMs, 15_000),
          cooldownMs: 5_000,
          intervalMs: sampleIntervalMs,
        }, consoleErrors));
      }
    } finally {
      await mock115.close();
    }
  }

  const writeExtensionSettings = async (settings: unknown): Promise<void> => {
    await page.goto(extensionPageUrl(extensionId, `dashboard/dashboard.html${initialDashboardHash}`), {
      waitUntil: 'domcontentloaded',
    });
    await page.evaluate(async (value: unknown) => {
      await chrome.storage.local.set({ settings: value });
    }, settings);
  };

  const contentStressHtml = buildContentStressHtml();
  const javDbStressHtml = buildJavDbStressHtml(
    parsePositiveInteger(process.env.JAVDB_PERF_JAVDB_ITEMS, 1_289),
  );
  const contentPage = page;
  const contentClient = client;

  const contentBaseSettings = {
    userExperience: {
      enablePasswordHelper: false,
      enableListEnhancement: false,
      enableContentFilter: false,
      enableActorEnhancement: false,
    },
    emby: {
      enabled: false,
      mediaServers: [],
    },
  };
  const routeStressPage = async (route: Parameters<Parameters<BrowserContext['route']>[1]>[0]): Promise<void> => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: contentStressHtml,
    });
  };
  const routeJavDbPage = async (route: Parameters<Parameters<BrowserContext['route']>[1]>[0]): Promise<void> => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: javDbStressHtml,
    });
  };

  if (shouldRunScenario('dashboard-javdb-multi-tab')) {
    await context.route('https://javdb.com/*', routeJavDbPage);
    const javdbPage = await context.newPage();
    try {
      await page.evaluate(async () => {
        await chrome.storage.local.set({
          settings: {
            userExperience: {
              enablePasswordHelper: false,
              enableListEnhancement: true,
              enableContentFilter: false,
              enableActorEnhancement: false,
            },
            listEnhancement: {
              enableClickEnhancement: true,
              enableClickEnhancementList: true,
              enableClickEnhancementDetail: true,
              enableVideoPreview: false,
              enableListOptimization: true,
              enableScrollPaging: false,
              enableRightClickBackground: true,
            },
          },
        });
      });
      capturePageErrors(javdbPage);
      await javdbPage.goto('https://javdb.com/search?q=PERF', { waitUntil: 'domcontentloaded' });
      scenarios.push(await sampleScenario(page, client, browserClient, trackedPids, ignoredPids, 'dashboard-javdb-multi-tab', {
        warmupMs: 2_000,
        sampleMs: Math.min(sampleMs, 15_000),
        cooldownMs: 0,
        intervalMs: sampleIntervalMs,
      }, consoleErrors));
    } finally {
      await javdbPage.close();
      await context.unroute('https://javdb.com/*');
    }
  }

  const shouldRunPasswordHelper = shouldRunScenario('password-helper-disabled')
    || shouldRunScenario('password-helper-enabled');
  if (shouldRunPasswordHelper) {
    await context.route('https://example.com/*', routeStressPage);
    await writeExtensionSettings(contentBaseSettings);
    await contentPage.goto('https://example.com/performance', { waitUntil: 'domcontentloaded' });
    if (shouldRunScenario('password-helper-disabled')) {
      scenarios.push(await sampleScenario(contentPage, contentClient, browserClient, trackedPids, ignoredPids, 'password-helper-disabled', {
        warmupMs: 1_000,
        sampleMs: Math.min(sampleMs, 15_000),
        cooldownMs: 0,
        intervalMs: sampleIntervalMs,
      }, consoleErrors));
    }

    if (shouldRunScenario('password-helper-enabled')) {
      await writeExtensionSettings({
        ...contentBaseSettings,
        userExperience: { ...contentBaseSettings.userExperience, enablePasswordHelper: true },
        passwordHelper: { showMethod: 0, waitTime: 300 },
      });
      await contentPage.reload({ waitUntil: 'domcontentloaded' });
      scenarios.push(await sampleScenario(contentPage, contentClient, browserClient, trackedPids, ignoredPids, 'password-helper-enabled', {
        warmupMs: 1_000,
        sampleMs: Math.min(sampleMs, 15_000),
        cooldownMs: 0,
        intervalMs: sampleIntervalMs,
      }, consoleErrors));
    }
    await context.unroute('https://example.com/*');
  }

  if (shouldRunScenario('javdb-list-enhancement')) {
    await context.route('https://javdb.com/*', routeJavDbPage);
    await writeExtensionSettings({
      ...contentBaseSettings,
      userExperience: {
        ...contentBaseSettings.userExperience,
        enableListEnhancement: true,
      },
      listEnhancement: {
        enableClickEnhancement: true,
        enableClickEnhancementList: true,
        enableClickEnhancementDetail: true,
        enableVideoPreview: false,
        enableListOptimization: true,
        enableScrollPaging: false,
        enableRightClickBackground: true,
      },
    });
    await contentPage.goto('https://javdb.com/search?q=PERF', { waitUntil: 'domcontentloaded' });
    scenarios.push(await sampleScenario(contentPage, contentClient, browserClient, trackedPids, ignoredPids, 'javdb-list-enhancement', {
      warmupMs: 2_000,
      sampleMs: Math.min(sampleMs, 15_000),
      cooldownMs: 0,
      intervalMs: sampleIntervalMs,
    }, consoleErrors));
    await context.unroute('https://javdb.com/*');
  }

  const shouldRunEmbyEnhancement = shouldRunScenario('emby-enhancement-disabled')
    || shouldRunScenario('emby-enhancement-enabled');
  if (shouldRunEmbyEnhancement) {
    await context.route('http://localhost/web/*', routeStressPage);
    await writeExtensionSettings(contentBaseSettings);
    await contentPage.goto('http://localhost/web/performance', { waitUntil: 'domcontentloaded' });
    if (shouldRunScenario('emby-enhancement-disabled')) {
      scenarios.push(await sampleScenario(contentPage, contentClient, browserClient, trackedPids, ignoredPids, 'emby-enhancement-disabled', {
        warmupMs: 1_000,
        sampleMs: Math.min(sampleMs, 15_000),
        cooldownMs: 0,
        intervalMs: sampleIntervalMs,
      }, consoleErrors));
    }

    if (shouldRunScenario('emby-enhancement-enabled')) {
      await writeExtensionSettings({
        ...contentBaseSettings,
        emby: {
          enabled: true,
          mediaServers: [{
            id: 'perf-emby',
            type: 'emby',
            name: '性能测试 Emby',
            url: 'http://localhost',
            enabled: true,
          }],
          enableAutoDetection: true,
          videoCodePatterns: [],
          linkBehavior: 'javdb-search',
        },
      });
      await contentPage.reload({ waitUntil: 'domcontentloaded' });
      scenarios.push(await sampleScenario(contentPage, contentClient, browserClient, trackedPids, ignoredPids, 'emby-enhancement-enabled', {
        warmupMs: 2_000,
        sampleMs: Math.min(sampleMs, 15_000),
        cooldownMs: 0,
        intervalMs: sampleIntervalMs,
      }, consoleErrors));
    }
    await context.unroute('http://localhost/web/*');
  }
  await contentPage.close();

  if (shouldRunScenario('after-dashboard-close')) {
    scenarios.push(await sampleScenario(null, null, browserClient, trackedPids, ignoredPids, 'after-dashboard-close', {
      warmupMs: 0,
      sampleMs: cooldownMs,
      intervalMs: sampleIntervalMs,
    }, consoleErrors));
  }

  const report: WindowsPerformanceReport = {
    version: 4,
    platform: process.platform,
    capturedAt: Date.now(),
    browserExecutable,
    browserChannel,
    browserVersion: context.browser()?.version() ?? 'unknown',
    extensionId,
    extensionDir,
    profileDir,
    sampleIntervalMs,
    logicalProcessorCount: os.cpus().length,
    scenarios,
    consoleErrors: [...new Set(consoleErrors)].slice(0, 100),
  };
  const reportPath = path.join(reportDir, `windows-baseline-${report.capturedAt}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  await context.close();
  console.log(`Windows 性能基线已写入：${reportPath}`);
  console.log(`浏览器：${report.browserChannel} ${report.browserVersion}，扩展：${report.extensionId}`);
  for (const scenario of scenarios) {
    const validSamples = scenario.samples.filter((sample) => sample.aggregate.processCount > 0);
    const peakCpu = Math.max(0, ...validSamples.map((sample) => sample.aggregate.cpuPercent));
    const peakCpuSingleCore = Math.max(0, ...validSamples.map((sample) => sample.aggregate.cpuPercentSingleCore));
    const peakMemory = Math.max(0, ...validSamples.map((sample) => sample.aggregate.workingSetBytes));
    console.log(`${scenario.name}: samples=${scenario.samples.length}, peakCPU=${peakCpu}% all-core / ${peakCpuSingleCore}% single-core, peakWorkingSet=${peakMemory} bytes`);
  }
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
