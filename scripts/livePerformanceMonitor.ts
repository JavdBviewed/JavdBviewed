/**
 * Local-network live monitor for manual Linux performance validation.
 * It reads only the explicitly selected Chrome profile and extension page.
 */
import { chromium, type Browser, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  buildWslPerformanceProbeScript,
  calculateWslIntervalCpuPercent,
  summarizeWslChromeProcesses,
  summarizeWslChromeProcessesByRole,
  type WslChromeProcessSummary,
} from './wslCdpPerformanceProbe';

const execFileAsync = promisify(execFile);
const DEFAULT_EXTENSION_ID = 'gnegjfjccmeafanpmbjboegcbchcghka';
const DEFAULT_CDP_URL = 'http://127.0.0.1:19241';
const DEFAULT_PROFILE_DIR = '/tmp/javdb-14k-profile-KdfuMW';
const DEFAULT_HOST = '192.168.0.134';
const DEFAULT_PORT = 19300;
const DEFAULT_INTERVAL_MS = 1_000;
const PSS_REFRESH_MS = 5_000;
const PAGE_REFRESH_MS = 5_000;
const TASK_REFRESH_MS = 15_000;

type LiveMonitorMark = {
  tabId: string;
  phase: string;
  at: number;
};

type LiveMonitorLongTask = {
  startTime: number;
  duration: number;
};

export type LiveMonitorEvent = {
  kind: 'activation' | 'long-task';
  at: number;
  tabId: string | null;
  phase?: string;
  duration?: number;
  afterContentActiveMs?: number;
  afterInitializeStartMs?: number;
  afterInitializeCompleteMs?: number;
};

export type LiveMonitorProcess = {
  pid: number;
  cpuJiffies: number;
  cpuPercent?: number;
  rssKb: number;
  pssKb: number;
  args: string;
};

type LivePageSample = {
  pageNow: number;
  activeTabId: string | null;
  longTaskEntries: LiveMonitorLongTask[];
  tabActivationMarks: LiveMonitorMark[];
  taskCenter?: unknown;
};

type CpuTotals = { total: number; busy: number };

type LiveMonitorTask = {
  label: string;
  pageType: string;
  phase: string;
  cost: string;
  status: string;
  waitReason?: string;
  progressPct?: number;
  stage?: string;
  endedAt?: number;
};

export type LiveMonitorTaskCenterSummary = {
  counts: Record<string, number>;
  active: Array<Omit<LiveMonitorTask, 'endedAt'>>;
  recent: Array<Omit<LiveMonitorTask, 'endedAt'>>;
};

export type LiveMonitorSnapshot = {
  at: number;
  system: { cpuPercent: number; memoryUsedBytes: number; memoryTotalBytes: number };
  chrome: WslChromeProcessSummary;
  extensionRenderer: WslChromeProcessSummary;
  activeTabId: string | null;
  sourceUrls: string[];
  taskCenter: LiveMonitorTaskCenterSummary;
  events: LiveMonitorEvent[];
  error: string | null;
};

export function selectLiveMonitorChromeProcesses(
  processes: readonly LiveMonitorProcess[],
  userDataDir: string,
): LiveMonitorProcess[] {
  const normalized = userDataDir.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized) return [];
  const marker = `--user-data-dir=${normalized}`;
  return processes.filter((process) => process.args.includes(marker));
}

export function buildLiveMonitorEvents(input: {
  sampledAt: number;
  pageNow: number;
  longTaskEntries: readonly LiveMonitorLongTask[];
  tabActivationMarks: readonly LiveMonitorMark[];
  activationHistory?: readonly LiveMonitorMark[];
}): LiveMonitorEvent[] {
  const pageEpoch = input.sampledAt - input.pageNow;
  const marks = [...(input.activationHistory ?? []), ...input.tabActivationMarks]
    .filter((mark) => Number.isFinite(mark.at))
    .sort((left, right) => left.at - right.at);
  const events: LiveMonitorEvent[] = input.tabActivationMarks.map((mark) => ({
    kind: 'activation',
    at: Math.round(pageEpoch + mark.at),
    tabId: mark.tabId,
    phase: mark.phase,
  }));
  input.longTaskEntries.forEach((entry) => {
    if (!Number.isFinite(entry.startTime) || !Number.isFinite(entry.duration)) return;
    const latestActivation = [...marks].reverse().find((mark) => mark.at <= entry.startTime);
    const currentTabMarks = latestActivation
      ? marks.filter((mark) => mark.tabId === latestActivation.tabId && mark.at <= entry.startTime)
      : [];
    const latestPhaseAt = (phase: string): number | undefined => [...currentTabMarks]
      .reverse()
      .find((mark) => mark.phase === phase)?.at;
    const afterPhase = (phase: string): number | undefined => {
      const phaseAt = latestPhaseAt(phase);
      return phaseAt === undefined ? undefined : Math.round((entry.startTime - phaseAt) * 10) / 10;
    };
    const event: LiveMonitorEvent = {
      kind: 'long-task',
      at: Math.round(pageEpoch + entry.startTime),
      tabId: latestActivation?.tabId ?? null,
      duration: Math.round(entry.duration * 10) / 10,
    };
    const afterContentActiveMs = afterPhase('content-active');
    const afterInitializeStartMs = afterPhase('initialize-start');
    const afterInitializeCompleteMs = afterPhase('initialize-complete');
    if (afterContentActiveMs !== undefined) event.afterContentActiveMs = afterContentActiveMs;
    if (afterInitializeStartMs !== undefined) event.afterInitializeStartMs = afterInitializeStartMs;
    if (afterInitializeCompleteMs !== undefined) event.afterInitializeCompleteMs = afterInitializeCompleteMs;
    events.push(event);
  });
  return events.sort((left, right) => left.at - right.at || (left.kind === 'activation' ? -1 : 1));
}

export function selectLiveMonitorSourceUrls(urls: readonly string[]): string[] {
  return [...new Set(urls.filter((url) => {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      return hostname === 'javdb.com' || hostname.endsWith('.javdb.com') || hostname === 'javdb570.com';
    } catch {
      return false;
    }
  }))];
}

function toLiveMonitorTask(value: unknown): LiveMonitorTask | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const label = typeof record.label === 'string' ? record.label : '';
  const status = typeof record.status === 'string' ? record.status : '';
  if (!label || !status) return null;
  const task: LiveMonitorTask = {
    label,
    pageType: typeof record.pageType === 'string' ? record.pageType : 'unknown',
    phase: typeof record.phase === 'string' ? record.phase : 'unknown',
    cost: typeof record.cost === 'string' ? record.cost : 'unknown',
    status,
  };
  if (typeof record.waitReason === 'string') task.waitReason = record.waitReason;
  if (Number.isFinite(record.progressPct)) task.progressPct = Number(record.progressPct);
  if (typeof record.stage === 'string') task.stage = record.stage;
  if (Number.isFinite(record.endedAt)) task.endedAt = Number(record.endedAt);
  return task;
}

function omitLiveMonitorTaskEndedAt(task: LiveMonitorTask): Omit<LiveMonitorTask, 'endedAt'> {
  const { endedAt: _endedAt, ...safeTask } = task;
  return safeTask;
}

export function summarizeLiveMonitorTaskCenter(value: unknown, now: number): LiveMonitorTaskCenterSummary {
  const rawTasks = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as { tasks?: unknown }).tasks
    : [];
  const tasks = (Array.isArray(rawTasks) ? rawTasks : [])
    .map(toLiveMonitorTask)
    .filter((task): task is LiveMonitorTask => task !== null);
  const counts = tasks.reduce<Record<string, number>>((result, task) => {
    result[task.status] = (result[task.status] ?? 0) + 1;
    return result;
  }, {});
  const activeStatuses = new Set(['registered', 'queued', 'leased', 'running', 'paused', 'error']);
  return {
    counts,
    active: tasks.filter((task) => activeStatuses.has(task.status)).slice(0, 40).map(omitLiveMonitorTaskEndedAt),
    recent: tasks.filter((task) => task.status === 'done' && (task.endedAt ?? 0) >= now - 10_000)
      .slice(-40)
      .map(omitLiveMonitorTaskEndedAt),
  };
}

function cpuTotals(): CpuTotals {
  return os.cpus().reduce<CpuTotals>((result, cpu) => {
    const times = cpu.times;
    const total = times.user + times.nice + times.sys + times.idle + times.irq;
    return { total: result.total + total, busy: result.busy + total - times.idle };
  }, { total: 0, busy: 0 });
}

function calculateSystemCpuPercent(previous: CpuTotals | null, current: CpuTotals): number {
  if (!previous || current.total <= previous.total) return 0;
  return Math.max(0, Math.min(100, ((current.busy - previous.busy) / (current.total - previous.total)) * 100));
}

export function shouldRefreshLiveMonitorPss(
  lastRefreshAt: number | undefined,
  now: number,
  intervalMs = PSS_REFRESH_MS,
): boolean {
  return lastRefreshAt === undefined || now - lastRefreshAt >= intervalMs;
}

export function shouldRefreshLiveMonitorPage(
  lastRefreshAt: number | undefined,
  now: number,
): boolean {
  return lastRefreshAt === undefined || now - lastRefreshAt >= PAGE_REFRESH_MS;
}

export function shouldRefreshLiveMonitorTasks(
  lastRefreshAt: number | undefined,
  now: number,
): boolean {
  return lastRefreshAt === undefined || now - lastRefreshAt >= TASK_REFRESH_MS;
}

function parseProcJiffies(stat: string): number | null {
  const closeParen = stat.lastIndexOf(')');
  if (closeParen < 0) return null;
  const fields = stat.slice(closeParen + 2).trim().split(/\s+/);
  const utime = Number(fields[11]);
  const stime = Number(fields[12]);
  return Number.isFinite(utime) && Number.isFinite(stime) ? utime + stime : null;
}

async function readOptionalFile(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

export function parseLiveMonitorProcessListing(
  listing: string,
  userDataDir: string,
): Array<{ pid: number; args: string }> {
  const normalized = userDataDir.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  const marker = `--user-data-dir=${normalized}`;
  return listing.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    const pid = Number(match?.[1]);
    const args = match?.[2]?.trim() ?? '';
    return Number.isInteger(pid) && pid > 0 && /chrome|chromium/i.test(args) && args.includes(marker)
      ? [{ pid, args }]
      : [];
  });
}

export function parseLiveMonitorPidListing(listing: string): number[] {
  return [...new Set(listing.split(/\s+/)
    .map((value) => Number(value))
    .filter((pid) => Number.isInteger(pid) && pid > 0))];
}

export function buildLiveMonitorPgrepArgs(userDataDir: string): string[] {
  const normalized = userDataDir.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  return ['-f', '--', `--user-data-dir=${normalized}`];
}

async function readLiveMonitorProcesses(userDataDir: string, includePss: boolean): Promise<LiveMonitorProcess[]> {
  const normalized = userDataDir.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  let pids: number[] = [];
  try {
    const { stdout } = await execFileAsync('/usr/bin/pgrep', buildLiveMonitorPgrepArgs(normalized), {
      maxBuffer: 8_192,
      timeout: 2_000,
    });
    pids = parseLiveMonitorPidListing(stdout);
  } catch {
    return [];
  }
  const marker = `--user-data-dir=${normalized}`;
  const processes = await Promise.all(pids.map(async (pid) => {
    const procDir = `/proc/${pid}`;
    const [cmdline, stat, status, smaps] = await Promise.all([
      readOptionalFile(`${procDir}/cmdline`),
      readOptionalFile(`${procDir}/stat`),
      readOptionalFile(`${procDir}/status`),
      includePss ? readOptionalFile(`${procDir}/smaps_rollup`) : Promise.resolve(null),
    ]);
    const processArgs = cmdline?.replace(/\0/g, ' ').trim() ?? '';
    const cpuJiffies = stat ? parseProcJiffies(stat) : null;
    const rssKb = Number(status?.match(/^VmRSS:\s+(\d+)/m)?.[1]);
    const pssKb = Number(smaps?.match(/^Pss:\s+(\d+)/m)?.[1]);
    if (!/chrome|chromium/i.test(processArgs)
      || !processArgs.includes(marker)
      || cpuJiffies === null
      || !Number.isFinite(rssKb)) return null;
    return {
      pid,
      cpuJiffies,
      rssKb,
      pssKb: Number.isFinite(pssKb) ? pssKb : 0,
      args: processArgs,
    } satisfies LiveMonitorProcess;
  }));
  return processes.filter((process): process is LiveMonitorProcess => process !== null);
}

function buildLivePageExpression(includeTaskCenter: boolean): string {
  return `(async () => {
    ${buildWslPerformanceProbeScript()};
    const probe = globalThis.__JAVDB_PERF_PROBE__ ?? {};
    const taskCenter = ${includeTaskCenter ? "await chrome.runtime.sendMessage({ type: 'task-center:query' }).catch(() => null)" : 'undefined'};
    return {
      pageNow: performance.now(),
      activeTabId: document.querySelector('.tab-content.active')?.id ?? null,
      longTaskEntries: Array.isArray(probe.longTaskEntries) ? probe.longTaskEntries.splice(0) : [],
      tabActivationMarks: Array.isArray(probe.tabActivationMarks) ? probe.tabActivationMarks.splice(0) : [],
      taskCenter,
    };
  })()`;
}

function selectDashboardPage(browser: Browser, extensionId: string): Page | null {
  const prefix = `chrome-extension://${extensionId}/`;
  return browser.contexts()
    .flatMap((context) => context.pages())
    .find((page) => page.url().startsWith(prefix)) ?? null;
}

class LivePageReader {
  private browser: Browser | null = null;

  constructor(private readonly cdpUrl: string, private readonly extensionId: string) {}

  async read(includeTaskCenter: boolean): Promise<{ page: LivePageSample | null; sourceUrls: string[] }> {
    try {
      if (!this.browser || !this.browser.isConnected()) {
        this.browser = await chromium.connectOverCDP(this.cdpUrl);
      }
      const sourceUrls = selectLiveMonitorSourceUrls(
        this.browser.contexts().flatMap((context) => context.pages()).map((candidate) => candidate.url()),
      );
      const page = selectDashboardPage(this.browser, this.extensionId);
      if (!page) return { page: null, sourceUrls };
      return {
        page: await page.evaluate(buildLivePageExpression(includeTaskCenter)) as LivePageSample,
        sourceUrls,
      };
    } catch {
      await this.close();
      return { page: null, sourceUrls: [] };
    }
  }

  async close(): Promise<void> {
    const browser = this.browser;
    this.browser = null;
    await browser?.close().catch(() => undefined);
  }
}

export type LivePerformanceMonitorOptions = {
  cdpUrl?: string;
  extensionId?: string;
  host?: string;
  intervalMs?: number;
  port?: number;
  userDataDir?: string;
};

export type LivePerformanceMonitor = {
  start: () => Promise<string>;
  stop: () => Promise<void>;
};

export function createLivePerformanceMonitor(options: LivePerformanceMonitorOptions = {}): LivePerformanceMonitor {
  const cdpUrl = options.cdpUrl ?? DEFAULT_CDP_URL;
  const extensionId = options.extensionId ?? DEFAULT_EXTENSION_ID;
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const intervalMs = Math.max(500, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  const userDataDir = options.userDataDir ?? DEFAULT_PROFILE_DIR;
  const pageReader = new LivePageReader(cdpUrl, extensionId);
  const clients = new Set<ServerResponse>();
  const processCpu = new Map<number, { jiffies: number; at: number }>();
  const processPss = new Map<number, number>();
  let previousSystemCpu: CpuTotals | null = null;
  let lastPssRefreshAt: number | undefined;
  let lastPageRefreshAt: number | undefined;
  let lastTaskRefreshAt: number | undefined;
  let latestTaskCenter: unknown = null;
  let latestBrowserSample: { page: LivePageSample | null; sourceUrls: string[] } = { page: null, sourceUrls: [] };
  let activationHistory: LiveMonitorMark[] = [];
  let events: LiveMonitorEvent[] = [];
  let latestSnapshot: LiveMonitorSnapshot | null = null;
  let interval: NodeJS.Timeout | null = null;
  let sampling = false;
  let server: Server | null = null;
  const sessionPath = path.join('/tmp', `javdb-live-monitor-${Date.now()}.jsonl`);
  let sessionWrite: Promise<void> = Promise.resolve();

  const broadcast = (snapshot: LiveMonitorSnapshot): void => {
    const payload = `data: ${JSON.stringify(snapshot)}\n\n`;
    clients.forEach((client) => client.write(payload));
  };

  const appendSessionSample = (snapshot: LiveMonitorSnapshot, newEvents: LiveMonitorEvent[]): void => {
    const record = { ...snapshot, events: newEvents };
    sessionWrite = sessionWrite
      .then(() => fs.appendFile(sessionPath, `${JSON.stringify(record)}\n`, 'utf8'))
      .catch((error) => console.warn('[Live monitor] Failed to append session sample:', error));
  };

  const sample = async (): Promise<void> => {
    if (sampling) return;
    sampling = true;
    try {
      const at = Date.now();
      const refreshPss = shouldRefreshLiveMonitorPss(lastPssRefreshAt, at);
      const refreshPage = shouldRefreshLiveMonitorPage(lastPageRefreshAt, at);
      const refreshTasks = shouldRefreshLiveMonitorTasks(lastTaskRefreshAt, at);
      const [allProcesses, browserSample] = await Promise.all([
        readLiveMonitorProcesses(userDataDir, refreshPss),
        refreshPage ? pageReader.read(refreshTasks) : Promise.resolve(latestBrowserSample),
      ]);
      if (refreshPage) {
        latestBrowserSample = browserSample;
        lastPageRefreshAt = at;
      }
      const page = browserSample.page;
      if (refreshTasks && page) {
        latestTaskCenter = page.taskCenter ?? null;
        lastTaskRefreshAt = at;
      }
      const processes = selectLiveMonitorChromeProcesses(allProcesses, userDataDir).map((process) => {
        const previous = processCpu.get(process.pid);
        const cpuPercent = previous
          ? calculateWslIntervalCpuPercent(previous.jiffies, process.cpuJiffies, at - previous.at)
          : 0;
        processCpu.set(process.pid, { jiffies: process.cpuJiffies, at });
        const pssKb = refreshPss
          ? process.pssKb
          : processPss.get(process.pid) ?? 0;
        if (refreshPss) processPss.set(process.pid, pssKb);
        return { ...process, pssKb, cpuPercent };
      });
      if (refreshPss) lastPssRefreshAt = at;
      const summaryProcesses = processes.map((process) => ({ ...process, command: 'chrome' }));
      const summaries = summarizeWslChromeProcessesByRole(summaryProcesses);
      const newEvents = page && refreshPage ? buildLiveMonitorEvents({
        sampledAt: at,
        pageNow: page.pageNow,
        longTaskEntries: page.longTaskEntries,
        tabActivationMarks: page.tabActivationMarks,
        activationHistory,
      }) : [];
      if (page && refreshPage) {
        activationHistory = [...activationHistory, ...page.tabActivationMarks]
          .filter((mark) => mark.at <= page.pageNow && mark.at >= page.pageNow - 120_000)
          .slice(-100);
      }
      events = [...events, ...newEvents].slice(-100);
      const currentSystemCpu = cpuTotals();
      latestSnapshot = {
        at,
        system: {
          cpuPercent: calculateSystemCpuPercent(previousSystemCpu, currentSystemCpu),
          memoryUsedBytes: os.totalmem() - os.freemem(),
          memoryTotalBytes: os.totalmem(),
        },
        chrome: summarizeWslChromeProcesses(summaryProcesses),
        extensionRenderer: summaries['extension-renderer'] ?? { processCount: 0, cpuPercent: 0, rssKb: 0 },
        activeTabId: page?.activeTabId ?? null,
        sourceUrls: browserSample.sourceUrls,
        taskCenter: summarizeLiveMonitorTaskCenter(latestTaskCenter, at),
        events,
        error: processes.length === 0
          ? 'Isolated Chrome profile is not running.'
          : page ? null : 'Dashboard page is not available through CDP.',
      };
      previousSystemCpu = currentSystemCpu;
      appendSessionSample(latestSnapshot, newEvents);
      broadcast(latestSnapshot);
    } finally {
      sampling = false;
    }
  };

  const requestHandler = (request: IncomingMessage, response: ServerResponse): void => {
    if (request.url === '/events') {
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      response.write(': connected\n\n');
      clients.add(response);
      if (latestSnapshot) response.write(`data: ${JSON.stringify(latestSnapshot)}\n\n`);
      request.on('close', () => clients.delete(response));
      return;
    }
    if (request.url === '/' || request.url?.startsWith('/?')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(buildLiveMonitorHtml());
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  };

  return {
    async start(): Promise<string> {
      if (server) throw new Error('Live performance monitor is already running.');
      server = createServer(requestHandler);
      await fs.writeFile(sessionPath, '', 'utf8');
      await new Promise<void>((resolve, reject) => {
        server?.once('error', reject);
        server?.listen(port, host, resolve);
      });
      await sample();
      interval = setInterval(() => void sample(), intervalMs);
      return `http://${host}:${port}`;
    },
    async stop(): Promise<void> {
      if (interval) clearInterval(interval);
      interval = null;
      clients.forEach((client) => client.end());
      clients.clear();
      await pageReader.close();
      await sessionWrite;
      const currentServer = server;
      server = null;
      if (currentServer) await new Promise<void>((resolve) => currentServer.close(() => resolve()));
    },
  };
}

export function buildLiveMonitorHtml(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>JavdBviewed Live Performance</title><style>
*{box-sizing:border-box}body{margin:0;background:#111827;color:#e5e7eb;font:14px system-ui,sans-serif;letter-spacing:0}main{max-width:1180px;margin:0 auto;padding:20px}.top{display:flex;align-items:baseline;justify-content:space-between;border-bottom:1px solid #334155;padding-bottom:14px}h1{margin:0;font-size:20px;font-weight:650}.status{color:#94a3b8;font-variant-numeric:tabular-nums}.metrics{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:10px;margin:16px 0}.metric{background:#182235;border:1px solid #334155;border-radius:6px;padding:12px;min-height:86px}.metric label{display:block;color:#94a3b8;font-size:12px}.value{font-size:25px;font-variant-numeric:tabular-nums;margin-top:7px}.sub{color:#94a3b8;font-size:12px;margin-top:4px}.lower{display:grid;grid-template-columns:1.3fr 1fr;gap:16px}.panel{border-top:1px solid #334155;padding-top:12px}h2{font-size:14px;font-weight:650;margin:0 0 10px}.chart{width:100%;height:96px;background:#0b1220;border:1px solid #263449;border-radius:4px}.events{height:300px;overflow:auto;background:#0b1220;border:1px solid #263449;border-radius:4px}.event{display:grid;grid-template-columns:78px 86px 1fr;gap:8px;padding:8px 10px;border-bottom:1px solid #1e293b;font-variant-numeric:tabular-nums}.activation{color:#93c5fd}.long{color:#fbbf24}.long.slow{color:#fb7185}.work{min-height:220px;max-height:300px;overflow:auto;background:#0b1220;border:1px solid #263449;border-radius:4px}.work-row{padding:8px 10px;border-bottom:1px solid #1e293b;overflow-wrap:anywhere}.work-label{color:#cbd5e1}.work-meta{color:#94a3b8;font-size:12px;margin-top:3px}.empty{color:#64748b;padding:16px}.error{color:#fca5a5}@media(max-width:760px){main{padding:14px}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.lower{grid-template-columns:1fr}.top{align-items:flex-start;gap:10px;flex-direction:column}}
 </style></head><body><main><div class="top"><h1>Live Performance</h1><div id="status" class="status">Connecting</div></div><div class="metrics"><div class="metric"><label>System CPU</label><div id="systemCpu" class="value">-</div><div id="systemMem" class="sub">-</div></div><div class="metric"><label>Isolated Chrome</label><div id="chromeCpu" class="value">-</div><div id="chromeMem" class="sub">-</div></div><div class="metric"><label>Extension Renderer</label><div id="rendererCpu" class="value">-</div><div id="rendererMem" class="sub">-</div></div><div class="metric"><label>Active Tab</label><div id="tab" class="value">-</div><div id="sourceCount" class="sub">-</div><div id="error" class="sub">-</div></div></div><div class="lower"><section class="panel"><h2>CPU / Renderer PSS, 90 seconds</h2><canvas id="chart" class="chart" width="760" height="192"></canvas></section><section class="panel"><h2>Activation and long tasks</h2><div id="events" class="events"><div class="empty">No page events yet</div></div></section><section class="panel"><h2>Original Pages and Task Center</h2><div id="work" class="work"><div class="empty">No page or task data yet</div></div></section></div></main><script>
const history=[];const $=id=>document.getElementById(id);const mb=b=>b?(b/1048576).toFixed(1)+' MiB':'-';const pct=n=>Number(n||0).toFixed(1)+'%';const time=at=>new Date(at).toLocaleTimeString([], {hour12:false});const esc=v=>String(v??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function renderChart(){const c=$('chart'),x=c.getContext('2d'),w=c.width,h=c.height; x.clearRect(0,0,w,h);x.strokeStyle='#263449';x.lineWidth=1;for(let i=1;i<4;i++){const y=h*i/4;x.beginPath();x.moveTo(0,y);x.lineTo(w,y);x.stroke()}const line=(key,color,max)=>{if(history.length<2)return;x.strokeStyle=color;x.lineWidth=3;x.beginPath();history.forEach((s,i)=>{const px=i*w/89,py=h-(Math.min(max,Math.max(0,key(s)))/max)*h;i?x.lineTo(px,py):x.moveTo(px,py)});x.stroke()};line(s=>s.system.cpuPercent,'#38bdf8',100);line(s=>s.extensionRenderer.cpuPercent,'#a3e635',100);line(s=>(s.extensionRenderer.pssKb||0)/1024,'#fbbf24',512)}
function render(snapshot){history.push(snapshot);if(history.length>90)history.shift();$('status').textContent=time(snapshot.at)+' server sample';$('systemCpu').textContent=pct(snapshot.system.cpuPercent);$('systemMem').textContent=mb(snapshot.system.memoryUsedBytes)+' / '+mb(snapshot.system.memoryTotalBytes);$('chromeCpu').textContent=pct(snapshot.chrome.cpuPercent);$('chromeMem').textContent=snapshot.chrome.processCount+' processes, '+mb((snapshot.chrome.pssKb||0)*1024)+' PSS';$('rendererCpu').textContent=pct(snapshot.extensionRenderer.cpuPercent);$('rendererMem').textContent=snapshot.extensionRenderer.processCount+' processes, '+mb((snapshot.extensionRenderer.pssKb||0)*1024)+' PSS';$('tab').textContent=snapshot.activeTabId||'-';$('sourceCount').textContent=(snapshot.sourceUrls||[]).length+' original pages';$('error').textContent=snapshot.error||'';$('error').className=snapshot.error?'sub error':'sub';renderChart();const items=snapshot.events.slice(-30).reverse();$('events').innerHTML=items.length?items.map(e=>{const detail=e.kind==='long-task'?e.duration.toFixed(1)+' ms'+(e.afterContentActiveMs!==undefined?' · +'+e.afterContentActiveMs.toFixed(1)+'ms content':''):e.phase;return '<div class="event '+(e.kind==='long-task'?'long '+(e.duration>=250?'slow':''):'activation')+'"><span>'+time(e.at)+'</span><span>'+detail+'</span><span>'+(e.tabId||'unattributed')+'</span></div>'}).join(''):'<div class="empty">No page events yet</div>';const task=snapshot.taskCenter||{counts:{},active:[],recent:[]};const rows=[];for(const url of snapshot.sourceUrls||[])rows.push('<div class="work-row"><div class="work-label">'+esc(url)+'</div></div>');rows.push('<div class="work-row"><div class="work-label">'+esc(Object.entries(task.counts||{}).map(([k,v])=>k+': '+v).join('  ')||'No tasks')+'</div></div>');for(const entry of [...(task.active||[]),...(task.recent||[])].slice(0,18))rows.push('<div class="work-row"><div class="work-label">'+esc(entry.label)+'</div><div class="work-meta">'+esc(entry.status+' · '+entry.pageType+' · '+entry.phase+' · '+entry.cost+(entry.waitReason?' · '+entry.waitReason:'')+(entry.progressPct!==undefined?' · '+entry.progressPct+'%':''))+'</div></div>');$('work').innerHTML=rows.length?rows.join(''):'<div class="empty">No page or task data yet</div>'}
const source=new EventSource('/events');source.onmessage=e=>render(JSON.parse(e.data));source.onerror=()=>{$('status').textContent='Reconnecting'};
</script></body></html>`;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function main(): Promise<void> {
  const monitor = createLivePerformanceMonitor({
    cdpUrl: process.env.JAVDB_LIVE_MONITOR_CDP_URL ?? DEFAULT_CDP_URL,
    extensionId: process.env.JAVDB_LIVE_MONITOR_EXTENSION_ID ?? DEFAULT_EXTENSION_ID,
    host: process.env.JAVDB_LIVE_MONITOR_HOST ?? DEFAULT_HOST,
    intervalMs: positiveInteger(process.env.JAVDB_LIVE_MONITOR_INTERVAL_MS, DEFAULT_INTERVAL_MS),
    port: positiveInteger(process.env.JAVDB_LIVE_MONITOR_PORT, DEFAULT_PORT),
    userDataDir: process.env.JAVDB_LIVE_MONITOR_PROFILE ?? DEFAULT_PROFILE_DIR,
  });
  const url = await monitor.start();
  console.log(`Live monitor: ${url}`);
  const stop = async (): Promise<void> => {
    await monitor.stop();
    process.exit(0);
  };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
