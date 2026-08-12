/**
 * @file wslCdpPerformanceProbe.ts
 * @description 连接 WSLg 中已启动的 Linux Chrome，采集页面与 WSL Chrome 进程指标
 * @module scripts
 */
import { type CDPSession, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  createDiagnosticSession,
  redactDiagnosticPayload,
  summarizeDiagnosticSamples,
  type DiagnosticSample,
  type DiagnosticPhase,
  type DiagnosticSummary,
} from './performanceDiagnostics';
import { buildPerformanceMediaFixture, type PerformanceMediaFixture } from './performanceMediaFixture';

const execFileAsync = promisify(execFile);
const DEFAULT_PORT = 9222;
const DEFAULT_SAMPLE_MS = 30_000;
const DEFAULT_INTERVAL_MS = 1_000;
const DEFAULT_EXTENSION_ID = 'gnegjfjccmeafanpmbjboegcbchcghka';
const DEFAULT_CDP_COMMAND_TIMEOUT_MS = 5_000;
const MIN_CDP_COMMAND_TIMEOUT_MS = 1_000;
const MAX_CDP_COMMAND_TIMEOUT_MS = 120_000;

export function resolveWslCdpCommandTimeoutMs(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CDP_COMMAND_TIMEOUT_MS;
  return Math.min(
    MAX_CDP_COMMAND_TIMEOUT_MS,
    Math.max(MIN_CDP_COMMAND_TIMEOUT_MS, Math.trunc(parsed)),
  );
}

type RawCdpTarget = WslCdpTargetInfo & {
  targetId: string;
  title?: string;
};

type RawCdpCommandError = {
  message?: string;
};

type RawCdpMessage = {
  id?: number;
  result?: unknown;
  error?: RawCdpCommandError;
};

class RawWslCdpConnection {
  private nextId = 0;
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    method: string;
    sessionId?: string;
  }>();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      let message: RawCdpMessage;
      try {
        message = JSON.parse(event.data) as RawCdpMessage;
      } catch {
        return;
      }
      if (typeof message.id !== 'number') return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new Error(
          `${message.error.message ?? 'CDP 命令失败。'} [method=${pending.method}${pending.sessionId ? `, session=${pending.sessionId}` : ''}]`,
        ));
      } else {
        pending.resolve(message.result);
      }
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('CDP WebSocket 已断开。'));
      }
      this.pending.clear();
    });
  }

  static async connect(port: number): Promise<RawWslCdpConnection> {
    const versionResponse = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (!versionResponse.ok) {
      throw new Error(`无法读取 WSL Chrome CDP 版本信息：HTTP ${versionResponse.status}`);
    }
    const version = await versionResponse.json() as { webSocketDebuggerUrl?: string };
    if (!version.webSocketDebuggerUrl) {
      throw new Error('WSL Chrome CDP 版本信息缺少 WebSocket 地址。');
    }
    const socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error('无法连接 WSL Chrome CDP WebSocket。')), { once: true });
    });
    return new RawWslCdpConnection(socket);
  }

  async send<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<T> {
    const id = ++this.nextId;
    const message = JSON.stringify({
      id,
      method,
      ...(params ? { params } : {}),
      ...(sessionId ? { sessionId } : {}),
    });
    return new Promise<T>((resolve, reject) => {
      const timeoutMs = resolveWslCdpCommandTimeoutMs(process.env.JAVDB_WSL_CDP_TIMEOUT_MS);
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP 命令超时：${method}（${timeoutMs}ms）`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
        method,
        sessionId,
      });
      try {
        this.socket.send(message);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async getTargets(): Promise<RawCdpTarget[]> {
    const result = await this.send<{ targetInfos?: RawCdpTarget[] }>('Target.getTargets');
    return result.targetInfos ?? [];
  }

  async close(): Promise<void> {
    this.socket.close();
  }
}

let activeWslCdpConnection: RawWslCdpConnection | null = null;
let activeWslProbeTargetIds: Set<string> | null = null;

type WslCdpCommandClient = {
  send<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<T>;
};

export interface WslTargetCloseFailure {
  targetId: string;
  message: string;
}

export function removeClosedWslTargetIds(
  activeTargetIds: Set<string> | null,
  targetIds: readonly (string | null | undefined)[],
  failures: readonly WslTargetCloseFailure[],
): void {
  if (!activeTargetIds) return;
  const failedTargetIds = new Set(failures.map((failure) => failure.targetId));
  targetIds.forEach((targetId) => {
    if (targetId && !failedTargetIds.has(targetId)) activeTargetIds.delete(targetId);
  });
}

export async function closeWslTargets(
  cdp: WslCdpCommandClient,
  targetIds: readonly (string | null | undefined)[],
): Promise<WslTargetCloseFailure[]> {
  const uniqueTargetIds = [...new Set(targetIds.filter((targetId): targetId is string => Boolean(targetId)))];
  const results = await Promise.all(uniqueTargetIds.map(async (targetId) => {
    try {
      await cdp.send('Target.closeTarget', { targetId });
      return null;
    } catch (error) {
      if (isMissingWslTargetError(error)) return null;
      return {
        targetId,
        message: error instanceof Error ? error.message : String(error),
      } satisfies WslTargetCloseFailure;
    }
  }));
  const failures = results.filter((failure): failure is WslTargetCloseFailure => failure !== null);
  failures.forEach((failure) => {
    console.warn(`[WSL 性能探针] 关闭 target 失败，将在统一清理阶段重试：${failure.targetId}：${failure.message}`);
  });
  return failures;
}

export async function closeWslProbeTargets(
  cdp: WslCdpCommandClient,
  targetIds: readonly (string | null | undefined)[],
  activeTargetIds: Set<string> | null,
): Promise<WslTargetCloseFailure[]> {
  const failures = await closeWslTargets(cdp, targetIds);
  removeClosedWslTargetIds(activeTargetIds, targetIds, failures);
  return failures;
}

export async function closeWslProbeTargetsWithRetry(
  cdp: WslCdpCommandClient,
  targetIds: readonly (string | null | undefined)[],
  activeTargetIds: Set<string> | null,
): Promise<WslTargetCloseFailure[]> {
  const failures = await closeWslProbeTargets(cdp, targetIds, activeTargetIds);
  if (failures.length === 0) return failures;
  return closeWslProbeTargets(
    cdp,
    failures.map((failure) => failure.targetId),
    activeTargetIds,
  );
}

export interface WslChromeProcess {
  pid: number;
  cpuPercent: number;
  cpuJiffies?: number;
  rssKb: number;
  pssKb?: number;
  command: string;
  args?: string;
  privateDirtyKb?: number;
  privateCleanKb?: number;
  sharedDirtyKb?: number;
  sharedCleanKb?: number;
  swapKb?: number;
}

export type WslTargetSummary = {
  type: string;
  url: string;
};

export function summarizeWslTargetInfos(
  targets: ReadonlyArray<{ type?: unknown; url?: unknown }>,
): WslTargetSummary[] {
  return targets
    .map((target) => {
      const type = typeof target.type === 'string' ? target.type.trim() : '';
      const url = typeof target.url === 'string' ? target.url : '';
      if (!type || !url) return null;
      const safeUrl = redactDiagnosticPayload(url, 'url');
      return {
        type,
        url: typeof safeUrl === 'string' ? safeUrl : '[REDACTED]',
      } satisfies WslTargetSummary;
    })
    .filter((target): target is WslTargetSummary => target !== null);
}

export interface WslChromeProcessSummary {
  processCount: number;
  cpuPercent: number;
  rssKb: number;
  pssKb?: number;
}

export type WslChromeProcessCategory = 'browser' | 'renderer' | 'gpu' | 'utility';

export type WslChromeProcessRole =
  | 'browser'
  | 'extension-renderer'
  | 'chrome-ui-renderer'
  | 'renderer'
  | 'gpu'
  | 'utility';

type WslRawCdpProcessInfo = {
  id?: unknown;
  type?: unknown;
  cpuTime?: unknown;
  privateMemory?: unknown;
  physicalMemory?: unknown;
  peakWorkingSetSize?: unknown;
};

type WslRawServiceWorkerHeapUsage = {
  usedSize?: unknown;
  totalSize?: unknown;
  embedderHeapUsedSize?: unknown;
  backingStorageSize?: unknown;
};

export type WslServiceWorkerHeapUsage = {
  usedBytes: number;
  totalBytes: number;
  embedderHeapUsedBytes: number;
  backingStorageBytes: number;
};

export function summarizeWslServiceWorkerHeapUsage(
  usage: WslRawServiceWorkerHeapUsage | null | undefined,
): WslServiceWorkerHeapUsage | null {
  const usedBytes = Number(usage?.usedSize);
  const totalBytes = Number(usage?.totalSize);
  if (!Number.isFinite(usedBytes) || usedBytes < 0 || !Number.isFinite(totalBytes) || totalBytes < 0) {
    return null;
  }
  const embedderHeapUsedBytes = Number(usage?.embedderHeapUsedSize);
  const backingStorageBytes = Number(usage?.backingStorageSize);
  return {
    usedBytes,
    totalBytes,
    embedderHeapUsedBytes: Number.isFinite(embedderHeapUsedBytes) && embedderHeapUsedBytes >= 0
      ? embedderHeapUsedBytes
      : 0,
    backingStorageBytes: Number.isFinite(backingStorageBytes) && backingStorageBytes >= 0
      ? backingStorageBytes
      : 0,
  };
}

export type WslCdpProcessInfoSummary = {
  pid: number;
  type: string;
  cpuTimeSeconds?: number;
  privateMemoryBytes?: number;
  physicalMemoryBytes?: number;
  peakWorkingSetSizeBytes?: number;
};

export function summarizeWslCdpProcessInfo(
  processInfo: readonly WslRawCdpProcessInfo[],
): WslCdpProcessInfoSummary[] {
  return processInfo
    .map((process) => {
      const pid = Number(process.id);
      const type = typeof process.type === 'string' ? process.type.trim() : '';
      if (!Number.isInteger(pid) || pid < 0 || !type) return null;
      const summary: WslCdpProcessInfoSummary = { pid, type };
      const cpuTime = Number(process.cpuTime);
      const privateMemory = Number(process.privateMemory);
      const physicalMemory = Number(process.physicalMemory);
      const peakWorkingSetSize = Number(process.peakWorkingSetSize);
      if (Number.isFinite(cpuTime) && cpuTime >= 0) summary.cpuTimeSeconds = cpuTime;
      if (Number.isFinite(privateMemory) && privateMemory >= 0) summary.privateMemoryBytes = privateMemory;
      if (Number.isFinite(physicalMemory) && physicalMemory >= 0) summary.physicalMemoryBytes = physicalMemory;
      if (Number.isFinite(peakWorkingSetSize) && peakWorkingSetSize >= 0) {
        summary.peakWorkingSetSizeBytes = peakWorkingSetSize;
      }
      return summary;
    })
    .filter((process): process is WslCdpProcessInfoSummary => process !== null);
}

export type WslChromeProcessCategorySummary = Record<
  WslChromeProcessCategory,
  WslChromeProcessSummary
>;

export type WslChromeProcessRoleSummary = Record<
  WslChromeProcessRole,
  WslChromeProcessSummary
>;

export type WslProcessAttributionPeak = WslChromeProcessSummary & { at: number };

export type WslProcessAttributionSummary = {
  peakByCategory: Partial<Record<WslChromeProcessCategory, WslProcessAttributionPeak>>;
  peakByRole: Partial<Record<WslChromeProcessRole, WslProcessAttributionPeak>>;
};

export interface WslDiagnosticProcessSample {
  at: number;
  processSummary: WslChromeProcessSummary;
  processSummaryByCategory?: Partial<WslChromeProcessCategorySummary>;
  processSummaryByRole?: Partial<WslChromeProcessRoleSummary>;
  phase?: DiagnosticPhase;
  page?: Record<string, unknown>;
}

function classifyWslChromeProcessRole(process: WslChromeProcess): WslChromeProcessRole {
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

export interface WslDiagnosticSnapshot {
  scenarioId: string;
  samples: DiagnosticSample[];
  summary: DiagnosticSummary;
  processAttribution: WslProcessAttributionSummary;
}

export interface WslExtensionRuntimeInspection {
  ok: boolean;
  extensionPageCount: number;
  serviceWorkerCount: number;
  reason: string | null;
}

export interface WslExtensionPageRuntime {
  url: string;
  domNodes?: number | null;
  appRootMounted?: boolean | null;
  activeTabId?: string | null;
  bodyText?: string | null;
}

export interface WslExtensionPageRuntimeInspection {
  ok: boolean;
  reason: string | null;
}

export type WslEventListenerInfo = { type?: string };

export type WslHeapProfileNode = {
  selfSize?: number;
  callFrame?: {
    functionName?: string;
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
  };
  children?: WslHeapProfileNode[];
};

export type WslHeapProfileSummary = {
  selfSizeBytes: number;
  functionName: string;
  source: '[extension]' | '[web]' | '[native]' | '[other]';
  lineNumber: number | null;
  columnNumber: number | null;
};

function summarizeHeapProfileSource(url: unknown): WslHeapProfileSummary['source'] {
  const value = String(url || '').trim();
  if (!value) return '[native]';
  if (value.startsWith('chrome-extension://')) return '[extension]';
  if (value.startsWith('http://') || value.startsWith('https://')) return '[web]';
  return '[other]';
}

function collectWslHeapProfileNodes(
  node: WslHeapProfileNode | undefined,
  output: WslHeapProfileNode[],
): void {
  if (!node) return;
  output.push(node);
  for (const child of node.children ?? []) collectWslHeapProfileNodes(child, output);
}

/**
 * 将 CDP HeapProfiler 结果压缩成脱敏的分配热点摘要。
 * 只保留节点自身分配大小和函数位置，不保留完整调用栈、URL 或对象内容。
 */
export function summarizeWslHeapProfile(
  profile: { nodes?: WslHeapProfileNode[]; head?: WslHeapProfileNode } | null | undefined,
  limit = 30,
): WslHeapProfileSummary[] {
  const nodes = Array.isArray(profile?.nodes) ? [...profile.nodes] : [];
  if (profile?.head) collectWslHeapProfileNodes(profile.head, nodes);
  return nodes
    .map((node) => {
      const callFrame = node.callFrame ?? {};
      return {
        selfSizeBytes: Math.max(0, Number(node.selfSize) || 0),
        functionName: String(callFrame.functionName || '(anonymous)').slice(0, 120),
        source: summarizeHeapProfileSource(callFrame.url),
        lineNumber: Number.isFinite(callFrame.lineNumber) ? Number(callFrame.lineNumber) : null,
        columnNumber: Number.isFinite(callFrame.columnNumber) ? Number(callFrame.columnNumber) : null,
      } satisfies WslHeapProfileSummary;
    })
    .filter((node) => node.selfSizeBytes > 0)
    .sort((left, right) => right.selfSizeBytes - left.selfSizeBytes)
    .slice(0, Math.max(1, Math.min(100, Math.trunc(limit))));
}

type WslCpuProfileNode = {
  id?: unknown;
  callFrame?: {
    functionName?: unknown;
    url?: unknown;
    lineNumber?: unknown;
    columnNumber?: unknown;
  };
};

export type WslCpuProfileSummary = {
  selfTimeMs: number;
  functionName: string;
  source: WslHeapProfileSummary['source'];
  lineNumber: number | null;
  columnNumber: number | null;
};

export function summarizeWslCpuProfile(
  profile: {
    nodes?: WslCpuProfileNode[];
    samples?: unknown[];
    timeDeltas?: unknown[];
  } | null | undefined,
  limit = 30,
): WslCpuProfileSummary[] {
  const nodes = new Map<number, WslCpuProfileNode>();
  for (const node of profile?.nodes ?? []) {
    const id = Number(node.id);
    if (Number.isInteger(id) && id >= 0) nodes.set(id, node);
  }
  const selfTimeByNode = new Map<number, number>();
  const samples = profile?.samples ?? [];
  const timeDeltas = profile?.timeDeltas ?? [];
  for (let index = 0; index < samples.length; index += 1) {
    const nodeId = Number(samples[index]);
    const timeDeltaUs = Number(timeDeltas[index]);
    if (!nodes.has(nodeId) || !Number.isFinite(timeDeltaUs) || timeDeltaUs < 0) continue;
    selfTimeByNode.set(nodeId, (selfTimeByNode.get(nodeId) ?? 0) + timeDeltaUs / 1_000);
  }
  return [...selfTimeByNode.entries()]
    .map(([nodeId, selfTimeMs]) => {
      const callFrame = nodes.get(nodeId)?.callFrame ?? {};
      const lineNumber = Number(callFrame.lineNumber);
      const columnNumber = Number(callFrame.columnNumber);
      return {
        selfTimeMs,
        functionName: String(callFrame.functionName || '(anonymous)').slice(0, 120),
        source: summarizeHeapProfileSource(callFrame.url),
        lineNumber: Number.isFinite(lineNumber) ? lineNumber : null,
        columnNumber: Number.isFinite(columnNumber) ? columnNumber : null,
      } satisfies WslCpuProfileSummary;
    })
    .sort((left, right) => right.selfTimeMs - left.selfTimeMs)
    .slice(0, Math.max(1, Math.min(100, Math.trunc(limit))));
}

export function shouldEnableWslHeapProfile(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

const SENSITIVE_EVENT_TYPE_PATTERN = /(?:password|passwd|token|secret|authorization|cookie|credential|api[_-]?key|access[_-]?token|refresh[_-]?token)/i;

function sanitizeDiagnosticEventType(type: string): string {
  return SENSITIVE_EVENT_TYPE_PATTERN.test(type) ? '[REDACTED]' : type;
}

export type WslEventListenerSummary = {
  targetCounts: Record<string, number>;
  typeCounts: Array<{ type: string; count: number }>;
};

export type WslContainerEventListenerSample = {
  selector: string;
  matchedCount: number;
  inspectedCount: number;
  listenerCount: number;
  listenerTypeCounts: Record<string, number>;
};

export type WslContainerEventListenerSummary = {
  selectors: WslContainerEventListenerSample[];
  totalMatchedCount: number;
  totalInspectedCount: number;
  totalListenerCount: number;
  listenerTypeCounts: Record<string, number>;
};

export type WslEventTargetProbeSample = {
  prototypeName: string;
  matchedCount: number;
  inspectedCount: number;
  domLikeCount: number;
  nonDomCount: number;
  listenerCount: number;
  domListenerCount: number;
  nonDomListenerCount: number;
  constructorCounts: Record<string, number>;
  nonDomConstructorCounts: Record<string, number>;
  listenerTypeCounts: Record<string, number>;
};

export type WslEventTargetSummary = {
  prototypes: WslEventTargetProbeSample[];
  totalNonDomCount: number;
  totalNonDomListenerCount: number;
};

export function summarizeWslEventTargetSamples(
  samples: readonly WslEventTargetProbeSample[],
): WslEventTargetSummary {
  return {
    prototypes: samples.map((sample) => ({
      prototypeName: sample.prototypeName,
      matchedCount: sample.matchedCount,
      inspectedCount: sample.inspectedCount,
      domLikeCount: sample.domLikeCount,
      nonDomCount: sample.nonDomCount,
      listenerCount: sample.listenerCount,
      domListenerCount: sample.domListenerCount,
      nonDomListenerCount: sample.nonDomListenerCount,
      constructorCounts: { ...sample.constructorCounts },
      nonDomConstructorCounts: { ...sample.nonDomConstructorCounts },
      listenerTypeCounts: { ...sample.listenerTypeCounts },
    })),
    totalNonDomCount: samples.reduce((total, sample) => total + sample.nonDomCount, 0),
    totalNonDomListenerCount: samples.reduce((total, sample) => total + sample.nonDomListenerCount, 0),
  };
}

export function summarizeWslContainerEventListeners(
  samples: readonly WslContainerEventListenerSample[],
): WslContainerEventListenerSummary {
  const listenerTypeCounts: Record<string, number> = {};
  let totalMatchedCount = 0;
  let totalInspectedCount = 0;
  let totalListenerCount = 0;

  for (const sample of samples) {
    totalMatchedCount += sample.matchedCount;
    totalInspectedCount += sample.inspectedCount;
    totalListenerCount += sample.listenerCount;
    for (const [type, count] of Object.entries(sample.listenerTypeCounts)) {
      listenerTypeCounts[type] = (listenerTypeCounts[type] ?? 0) + count;
    }
  }

  return {
    selectors: samples.map((sample) => ({
      selector: sample.selector,
      matchedCount: sample.matchedCount,
      inspectedCount: sample.inspectedCount,
      listenerCount: sample.listenerCount,
      listenerTypeCounts: { ...sample.listenerTypeCounts },
    })),
    totalMatchedCount,
    totalInspectedCount,
    totalListenerCount,
    listenerTypeCounts,
  };
}

export function summarizeWslEventListeners(
  listenersByTarget: Record<string, readonly WslEventListenerInfo[]>,
): WslEventListenerSummary {
  const targetCounts: Record<string, number> = {};
  const typeCounts: Record<string, number> = {};
  for (const [target, listeners] of Object.entries(listenersByTarget)) {
    targetCounts[target] = listeners.length;
    for (const listener of listeners) {
      const type = sanitizeDiagnosticEventType(listener.type?.trim() || 'unknown');
      typeCounts[type] = (typeCounts[type] ?? 0) + 1;
    }
  }
  return {
    targetCounts,
    typeCounts: Object.entries(typeCounts)
      .map(([type, count]) => ({ type, count }))
      .sort((left, right) => left.type.localeCompare(right.type)),
  };
}

export function isWslExtensionPageUrl(url: string, extensionId: string): boolean {
  return url.startsWith(`chrome-extension://${extensionId}/`);
}

export function inspectWslExtensionPageRuntime(input: {
  expectedExtensionId: string;
  pageRuntime: WslExtensionPageRuntime;
}): WslExtensionPageRuntimeInspection {
  if (input.pageRuntime.url.startsWith('chrome-error://')) {
    return {
      ok: false,
      reason: '扩展页面实际导航到错误页，不能形成性能证据。',
    };
  }
  if (!isWslExtensionPageUrl(input.pageRuntime.url, input.expectedExtensionId)) {
    return {
      ok: false,
      reason: 'CDP 页面实际 URL 不是目标扩展页面，不能形成性能证据。',
    };
  }
  if (input.pageRuntime.appRootMounted !== true) {
    return {
      ok: false,
      reason: '扩展页面已导航成功，但 Dashboard 尚未挂载，不能形成性能证据。',
    };
  }
  return { ok: true, reason: null };
}

export function parseWslChromeProcessLine(line: string): WslChromeProcess | null {
  const normalizedLine = line.trim();
  const extendedMatch = normalizedLine.match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)(?:\s+(.*))?$/);
  if (extendedMatch) {
    const command = extendedMatch[10];
    if (!/chrome/i.test(command)) return null;
    return {
      pid: Number(extendedMatch[1]),
      cpuPercent: Number(extendedMatch[2]),
      rssKb: Number(extendedMatch[3]),
      pssKb: Number(extendedMatch[4]),
      privateDirtyKb: Number(extendedMatch[5]),
      privateCleanKb: Number(extendedMatch[6]),
      sharedCleanKb: Number(extendedMatch[7]),
      sharedDirtyKb: Number(extendedMatch[8]),
      swapKb: Number(extendedMatch[9]),
      command,
      ...(extendedMatch[11] ? { args: extendedMatch[11].trim() } : {}),
    };
  }
  const pssMatch = normalizedLine.match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(\d+)\s+(\S+)(?:\s+(.*))?$/);
  const legacyMatch = normalizedLine.match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)(?:\s+(.*))?$/);
  const match = pssMatch ?? legacyMatch;
  if (!match) return null;
  const command = pssMatch ? match[5] : match[4];
  if (!/chrome/i.test(command)) return null;
  return {
    pid: Number(match[1]),
    cpuPercent: Number(match[2]),
    rssKb: Number(match[3]),
    ...(pssMatch ? { pssKb: Number(match[4]) } : {}),
    command,
    ...((pssMatch ? match[6] : match[5]) ? { args: (pssMatch ? match[6] : match[5]).trim() } : {}),
  };
}

export function parseWslChromeProcessLineWithJiffies(line: string): WslChromeProcess | null {
  const parsed = parseWslChromeProcessLine(line);
  if (!parsed || !Number.isInteger(parsed.cpuPercent) || parsed.cpuPercent < 0) return null;
  return {
    ...parsed,
    cpuPercent: 0,
    cpuJiffies: parsed.cpuPercent,
  };
}

export function calculateWslIntervalCpuPercent(
  previousJiffies: number,
  currentJiffies: number,
  elapsedMs: number,
  clockTicksPerSecond = 100,
): number {
  if (!Number.isFinite(previousJiffies)
    || !Number.isFinite(currentJiffies)
    || !Number.isFinite(elapsedMs)
    || !Number.isFinite(clockTicksPerSecond)
    || elapsedMs <= 0
    || clockTicksPerSecond <= 0
    || currentJiffies <= previousJiffies) {
    return 0;
  }
  return ((currentJiffies - previousJiffies) / clockTicksPerSecond)
    / (elapsedMs / 1_000)
    * 100;
}

export function selectWslChromeProcesses(
  processes: readonly WslChromeProcess[],
  userDataDir: string,
): WslChromeProcess[] {
  const normalizedDir = userDataDir.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalizedDir) return [];
  const marker = `--user-data-dir=${normalizedDir}`;
  return processes.filter((process) => process.args?.includes(marker) === true);
}

export function summarizeWslChromeProcesses(processes: WslChromeProcess[]): WslChromeProcessSummary {
  const summary = processes.reduce<WslChromeProcessSummary>((current, process) => ({
    processCount: current.processCount + 1,
    cpuPercent: current.cpuPercent + process.cpuPercent,
    rssKb: current.rssKb + process.rssKb,
  }), { processCount: 0, cpuPercent: 0, rssKb: 0 });
  const pssProcesses = processes.filter((process) => typeof process.pssKb === 'number');
  return pssProcesses.length > 0
    ? { ...summary, pssKb: pssProcesses.reduce((total, process) => total + (process.pssKb ?? 0), 0) }
    : summary;
}

export function summarizeWslChromeProcessesByCategory(
  processes: readonly WslChromeProcess[],
): Partial<WslChromeProcessCategorySummary> {
  const result: Partial<WslChromeProcessCategorySummary> = {};
  processes.forEach((process) => {
    const category: WslChromeProcessCategory = process.args?.includes('--type=renderer')
      ? 'renderer'
      : process.args?.includes('--type=gpu-process')
        ? 'gpu'
        : process.args?.includes('--type=utility')
          ? 'utility'
          : 'browser';
    const current = result[category] ?? { processCount: 0, cpuPercent: 0, rssKb: 0 };
    const pssKb = typeof process.pssKb === 'number'
      ? (current.pssKb ?? 0) + process.pssKb
      : current.pssKb;
    result[category] = {
      processCount: current.processCount + 1,
      cpuPercent: current.cpuPercent + process.cpuPercent,
      rssKb: current.rssKb + process.rssKb,
      ...(pssKb !== undefined ? { pssKb } : {}),
    };
  });
  return result;
}

export function summarizeWslChromeProcessesByRole(
  processes: readonly WslChromeProcess[],
): Partial<WslChromeProcessRoleSummary> {
  const result: Partial<WslChromeProcessRoleSummary> = {};
  processes.forEach((process) => {
    const role = classifyWslChromeProcessRole(process);
    const current = result[role] ?? { processCount: 0, cpuPercent: 0, rssKb: 0 };
    const pssKb = typeof process.pssKb === 'number'
      ? (current.pssKb ?? 0) + process.pssKb
      : current.pssKb;
    result[role] = {
      processCount: current.processCount + 1,
      cpuPercent: current.cpuPercent + process.cpuPercent,
      rssKb: current.rssKb + process.rssKb,
      ...(pssKb !== undefined ? { pssKb } : {}),
    };
  });
  return result;
}

function pickWslProcessAttributionPeak(
  current: WslProcessAttributionPeak | undefined,
  at: number,
  summary: WslChromeProcessSummary,
): WslProcessAttributionPeak {
  if (!current || summary.rssKb > current.rssKb) return { at, ...summary };
  return current;
}

export function summarizeWslProcessAttribution(
  samples: readonly WslDiagnosticProcessSample[],
): WslProcessAttributionSummary {
  const peakByCategory: Partial<Record<WslChromeProcessCategory, WslProcessAttributionPeak>> = {};
  const peakByRole: Partial<Record<WslChromeProcessRole, WslProcessAttributionPeak>> = {};
  for (const sample of samples) {
    for (const [category, summary] of Object.entries(sample.processSummaryByCategory ?? {})) {
      if (!summary) continue;
      peakByCategory[category as WslChromeProcessCategory] = pickWslProcessAttributionPeak(
        peakByCategory[category as WslChromeProcessCategory],
        sample.at,
        summary,
      );
    }
    for (const [role, summary] of Object.entries(sample.processSummaryByRole ?? {})) {
      if (!summary) continue;
      peakByRole[role as WslChromeProcessRole] = pickWslProcessAttributionPeak(
        peakByRole[role as WslChromeProcessRole],
        sample.at,
        summary,
      );
    }
  }
  return { peakByCategory, peakByRole };
}

export function buildWslDiagnosticSnapshot(
  scenarioId: string,
  samples: readonly WslDiagnosticProcessSample[],
  maxSamples?: number,
): WslDiagnosticSnapshot {
  const session = createDiagnosticSession({ scenarioId, maxSamples });
  samples.forEach((sample) => {
    const diagnosticSample: DiagnosticSample = {
      phase: 'steady',
      module: 'wsl.chrome',
      at: sample.at,
      rssBytes: sample.processSummary.rssKb * 1024,
      cpuPercent: sample.processSummary.cpuPercent,
    };
    if (sample.phase) diagnosticSample.phase = sample.phase;
    const page = sample.page;
    if (typeof page?.jsHeapUsedBytes === 'number') {
      diagnosticSample.jsHeapUsedBytes = page.jsHeapUsedBytes;
    }
    if (Array.isArray(page?.longTaskDurationsMs)) {
      diagnosticSample.longTaskDurationsMs = page.longTaskDurationsMs
        .filter((duration): duration is number => typeof duration === 'number');
    }
    if (page?.lifecycleCounts && typeof page.lifecycleCounts === 'object' && !Array.isArray(page.lifecycleCounts)) {
      diagnosticSample.lifecycleCounts = Object.fromEntries(
        Object.entries(page.lifecycleCounts)
          .filter(([, count]) => typeof count === 'number' && Number.isFinite(count))
          .map(([event, count]) => [event, count as number]),
      );
    }
    if (page?.newWorksDiagnostics && typeof page.newWorksDiagnostics === 'object') {
      diagnosticSample.newWorksDiagnostics = page.newWorksDiagnostics;
    }
    session.record(diagnosticSample);
  });
  const snapshot = session.snapshot();
  return {
    scenarioId,
    samples: snapshot.samples,
    summary: summarizeDiagnosticSamples(snapshot.samples),
    processAttribution: summarizeWslProcessAttribution(samples),
  };
}

export function selectWslPageIndex(urls: readonly string[]): number {
  const dashboardIndex = urls.findIndex((url) => url.includes('/dashboard/dashboard.html'));
  if (dashboardIndex >= 0) return dashboardIndex;
  const sourceIndex = urls.findIndex((url) => url.startsWith('https://javdb.com'));
  if (sourceIndex >= 0) return sourceIndex;
  return urls.length > 0 ? 0 : -1;
}

/**
 * 宿主数据性能回归只保留被测 Dashboard 页面，避免快照中的其它页面污染进程指标。
 * 该选择器只返回 page target，不会关闭 Service Worker 或其它非页面目标。
 */
export function selectWslPageTargetIdsToClose(
  targets: ReadonlyArray<{ targetId: string; type: string }>,
  keepTargetId: string,
): string[] {
  return targets
    .filter((target) => target.type === 'page' && target.targetId !== keepTargetId)
    .map((target) => target.targetId);
}

export function isMissingWslTargetError(error: unknown): boolean {
  return /No target with given id/i.test(error instanceof Error ? error.message : String(error));
}

export type WslStorageValueSummary = {
  jsonBytes: number;
  entryCount: number;
  nfoSummaryChars: number;
  imageUrlChars: number;
};

export type WslStorageDiagnostics = Record<string, WslStorageValueSummary>;

export type WslStorageCollectionDiagnostics = {
  keyCount: number;
  totalJsonBytes: number;
  bytesInUse: number | null;
  largestKeys: Array<{ key: string; jsonBytes: number }>;
};

export type WslOriginStorageUsage = {
  usageBytes: number | null;
  quotaBytes: number | null;
  breakdown: Array<{ storageType: string; usageBytes: number }>;
};

export function summarizeWslStorageValue(value: unknown): WslStorageValueSummary {
  const record = isRecord(value) ? value : {};
  const rawEntries = record.entries;
  const entries = Array.isArray(rawEntries)
    ? rawEntries
    : isRecord(rawEntries)
      ? Object.values(rawEntries)
      : [];
  let nfoSummaryChars = 0;
  let imageUrlChars = 0;
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    if (isRecord(entry.nfoSummary)) {
      nfoSummaryChars += safeJsonLength(entry.nfoSummary);
    }
    if (isRecord(entry.imageUrls)) {
      for (const url of Object.values(entry.imageUrls)) {
        if (typeof url === 'string') imageUrlChars += url.length;
      }
    }
  }
  return {
    jsonBytes: safeJsonLength(value),
    entryCount: entries.length,
    nfoSummaryChars,
    imageUrlChars,
  };
}

export function summarizeWslStorageCollection(
  values: Record<string, unknown>,
  limit = 10,
): WslStorageCollectionDiagnostics {
  const entries = Object.entries(values).map(([key, value]) => ({
    key: key.slice(0, 80),
    jsonBytes: safeJsonLength(value),
  }));
  return {
    keyCount: entries.length,
    totalJsonBytes: entries.reduce((total, entry) => total + entry.jsonBytes, 0),
    bytesInUse: null,
    largestKeys: entries
      .sort((left, right) => right.jsonBytes - left.jsonBytes || left.key.localeCompare(right.key))
      .slice(0, Math.max(0, Math.trunc(limit))),
  };
}

export function summarizeWslOriginStorageUsage(value: unknown): WslOriginStorageUsage {
  const record = isRecord(value) ? value : {};
  const usage = typeof record.usage === 'number' && Number.isFinite(record.usage)
    ? record.usage
    : null;
  const quota = typeof record.quota === 'number' && Number.isFinite(record.quota)
    ? record.quota
    : null;
  const rawBreakdown = Array.isArray(record.usageBreakdown) ? record.usageBreakdown : [];
  const breakdown = rawBreakdown.flatMap((item) => {
    if (!isRecord(item)) return [];
    const storageType = typeof item.storageType === 'string' ? item.storageType : '';
    const usageBytes = typeof item.usage === 'number' && Number.isFinite(item.usage)
      ? item.usage
      : null;
    return storageType && usageBytes !== null ? [{ storageType, usageBytes }] : [];
  });
  return { usageBytes: usage, quotaBytes: quota, breakdown };
}

function safeJsonLength(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === 'string' ? serialized.length : 0;
  } catch {
    return 0;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function inferWslExtensionId(serviceWorkerUrls: readonly string[]): string | null {
  const loaderUrl = serviceWorkerUrls.find((url) => (
    url.endsWith('/service-worker-loader.js') || url.endsWith('/service_worker.js')
  ));
  const match = loaderUrl?.match(/^chrome-extension:\/\/([^/]+)\/(?:service-worker-loader\.js|service_worker\.js)$/);
  return match?.[1] ?? null;
}

export interface WslCdpTargetInfo {
  type: string;
  url: string;
}

export function mergeWslExtensionRuntimeUrls(
  pageUrls: readonly string[],
  serviceWorkerUrls: readonly string[],
  targetInfos: readonly WslCdpTargetInfo[],
): { pageUrls: string[]; serviceWorkerUrls: string[] } {
  const workerUrls = targetInfos
    .filter((target) => target.type === 'service_worker' && target.url)
    .map((target) => target.url);
  return {
    pageUrls: [...new Set(pageUrls)],
    serviceWorkerUrls: [...new Set([...serviceWorkerUrls, ...workerUrls])],
  };
}

async function readWslCdpTargetInfos(client: CDPSession): Promise<WslCdpTargetInfo[]> {
  const response = await client.send('Target.getTargets') as {
    targetInfos?: Array<{ type?: string; url?: string }>;
  };
  return (response.targetInfos ?? [])
    .filter((target): target is { type: string; url: string } => (
      typeof target.type === 'string' && typeof target.url === 'string'
    ))
    .map((target) => ({ type: target.type, url: target.url }));
}

export function shouldRequireWslExtension(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized !== '0' && normalized !== 'false';
}

export function shouldEnableWslDeepDiagnostics(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export function shouldRunWslCloseRecovery(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export function shouldTouchWslDashboardLifecycle(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(normalized ?? '');
}

export function shouldForceWslCloseRecovery(value: string | undefined): boolean {
  return shouldRunWslCloseRecovery(value);
}

export function buildWslPerformanceProbeScript(): string {
  return `(() => {
    const existing = globalThis.__JAVDB_PERF_PROBE__;
    if (existing?.__installed) return;
    const state = existing ?? { lifecycleCounts: {}, longTaskDurationsMs: [], longTaskEntries: [], tabActivationMarks: [] };
    state.lifecycleCounts ??= {};
    state.longTaskDurationsMs ??= [];
    state.longTaskEntries ??= [];
    state.tabActivationMarks ??= [];
    state.__installed = true;
    if (typeof PerformanceObserver === 'function') {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (Number.isFinite(entry.duration)) {
              state.longTaskDurationsMs.push(entry.duration);
              state.longTaskEntries.push({ startTime: entry.startTime, duration: entry.duration });
              if (state.longTaskEntries.length > 100) state.longTaskEntries.splice(0, state.longTaskEntries.length - 100);
            }
          }
        });
        observer.observe({ type: 'longtask', buffered: true });
        state.__longTaskObserverInstalled = true;
      } catch {
        state.__longTaskObserverInstalled = false;
      }
    }
    globalThis.__JAVDB_PERF_PROBE__ = state;
  })()`;
}

export function parseWslDashboardHash(value: string | undefined): string {
  const normalized = value?.trim() ?? '';
  const hash = normalized.startsWith('#') ? normalized : `#${normalized}`;
  return /^#tab-[a-z0-9-]+$/.test(hash) ? hash : '#tab-home';
}

export function buildWslDashboardUrl(
  extensionId: string,
  dashboardHash: string | undefined,
  homeCharts: string | undefined,
  newWorksDiagnostic = '',
): string {
  const hash = parseWslDashboardHash(dashboardHash);
  const diagnostic = homeCharts?.trim().toLowerCase() ?? '';
  const newWorks = newWorksDiagnostic.trim().toLowerCase();
  const params = new URLSearchParams();
  if (/^[a-z-]+(?::(?:auto|g2plot|echarts))?$/.test(diagnostic)) {
    params.set('perfHomeCharts', diagnostic);
  }
  if (['full', 'no-stats', 'no-list', 'no-auto-sync'].includes(newWorks)) {
    params.set('perfNewWorks', newWorks);
  }
  const query = params.toString() ? `?${params.toString()}` : '';
  return `chrome-extension://${extensionId}/dashboard/dashboard.html${query}${hash}`;
}

export function parseWslDashboardTabSequence(
  value: string | undefined,
  fallbackHash: string,
  repeatCount = 1,
): string[] {
  const fallback = parseWslDashboardHash(fallbackHash);
  const hashes = (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => /^#?tab-[a-z0-9-]+$/.test(part))
    .map((part) => parseWslDashboardHash(part))
    .filter((hash, index, all) => all.indexOf(hash) === index);
  const sequence = hashes.length > 0 ? hashes : [fallback];
  const repeats = Number.isInteger(repeatCount) && repeatCount > 0
    ? Math.min(repeatCount, 20)
    : 1;
  return Array.from({ length: repeats }, () => sequence).flat();
}

export function parseWslTabCounts(value: string | undefined): number[] {
  const counts = (value ?? '1')
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((count) => Number.isInteger(count) && count > 0);
  return [...new Set(counts)].sort((left, right) => left - right).length > 0
    ? [...new Set(counts)].sort((left, right) => left - right)
    : [1];
}

export function buildWslScenarioName(prefix: string, tabCount: number): string {
  return `${prefix}-${tabCount}-${tabCount === 1 ? 'tab' : 'tabs'}`;
}

export function inspectWslSourceFixtureSnapshot(
  snapshot: {
    sourceFixtureMarker?: unknown;
    sourceFixtureItemCount?: unknown;
    extensionInjected?: unknown;
  },
  options: { expectedItemCount: number; requireExtension: boolean },
): { ok: boolean; reason: 'source-fixture-not-loaded' | 'content-script-not-injected' | null } {
  const expectedItemCount = Number.isFinite(options.expectedItemCount)
    ? Math.max(1, Math.trunc(options.expectedItemCount))
    : 1;
  const itemCount = typeof snapshot.sourceFixtureItemCount === 'number'
    ? Math.trunc(snapshot.sourceFixtureItemCount)
    : 0;
  if (snapshot.sourceFixtureMarker !== true || itemCount < expectedItemCount) {
    return { ok: false, reason: 'source-fixture-not-loaded' };
  }
  if (options.requireExtension && snapshot.extensionInjected !== true) {
    return { ok: false, reason: 'content-script-not-injected' };
  }
  return { ok: true, reason: null };
}

export type WslContentSettingsProfile = 'baseline' | 'list' | 'list-preview' | 'content-filter';

export function parseWslContentSettingsProfile(value: string | undefined): WslContentSettingsProfile {
  return value === 'list' || value === 'list-preview' || value === 'content-filter'
    ? value
    : 'baseline';
}

/** 仅用于隔离性能对照；不改变生产默认设置。 */
export function buildWslContentSettingsExpression(profile: WslContentSettingsProfile): string {
  const listEnabled = profile === 'list' || profile === 'list-preview';
  const previewEnabled = profile === 'list-preview';
  const filterEnabled = profile === 'content-filter';
  return `(async () => { await chrome.storage.local.set({ settings: {
    userExperience: {
      enablePasswordHelper: false,
      enableListEnhancement: ${listEnabled},
      enableContentFilter: ${filterEnabled},
      enableActorEnhancement: false
    },
    listEnhancement: {
      enableClickEnhancement: ${listEnabled},
      enableClickEnhancementList: ${listEnabled},
      enableClickEnhancementDetail: false,
      enableVideoPreview: ${previewEnabled},
      enableVideoPreviewList: ${previewEnabled},
      enableVideoPreviewDetail: false,
      enableListOptimization: ${listEnabled},
      enableScrollPaging: false,
      enableRightClickBackground: false,
      enableActorWatermark: false,
      hideBlacklistedActorsInList: false,
      hideNonFavoritedActorsInList: false,
      hideUnrecognizedActorsInList: false
    }
  } }); return true; })()`;
}

export function shouldNavigateWslDashboardTarget(
  requireExtension: boolean,
  dashboardHash: string | null,
): boolean {
  return requireExtension && dashboardHash !== null;
}

export function inspectWslExtensionRuntime(input: {
  expectedExtensionId: string;
  pageUrls: readonly string[];
  serviceWorkerUrls: readonly string[];
  allowMissingServiceWorker?: boolean;
  pageRuntime?: WslExtensionPageRuntime;
}): WslExtensionRuntimeInspection {
  const extensionPageCount = input.pageUrls.filter((url) => (
    isWslExtensionPageUrl(url, input.expectedExtensionId)
  )).length;
  const serviceWorkerCount = input.serviceWorkerUrls.filter((url) => (
    isWslExtensionPageUrl(url, input.expectedExtensionId)
  )).length;
  const pageInspection = input.pageRuntime
    ? inspectWslExtensionPageRuntime({
      expectedExtensionId: input.expectedExtensionId,
      pageRuntime: input.pageRuntime,
    })
    : null;
  const ok = extensionPageCount > 0 && (
    serviceWorkerCount > 0 || input.allowMissingServiceWorker === true
  ) && (pageInspection?.ok ?? true);
  return {
    ok,
    extensionPageCount,
    serviceWorkerCount,
    reason: ok
      ? serviceWorkerCount > 0
        ? null
        : '扩展页面已加载，但 MV3 Service Worker 当前处于休眠状态，CDP 未观察到 Worker 目标。'
      : pageInspection && !pageInspection.ok
        ? pageInspection.reason
      : '目标扩展页面或 Service Worker 未加载，不能形成性能证据。',
  };
}

type WslCpuUsageState = Map<number, { cpuJiffies: number; atMs: number }>;

const CHROME_PROCESS_SNAPSHOT_COMMAND = 'ps -eo pid=,rss=,comm=,args= | awk \'$3 ~ /^(chrome|chromium)/\' | while read -r pid rss comm args; do '
  + 'cpuJiffies=$(awk \'{print $14+$15}\' "/proc/$pid/stat" 2>/dev/null || printf "0"); '
  + 'memory=$(awk \'/^Pss:/ {pss=$2} /^Private_Dirty:/ {privateDirty=$2} /^Private_Clean:/ {privateClean=$2} /^Shared_Dirty:/ {sharedDirty=$2} /^Shared_Clean:/ {sharedClean=$2} /^Swap:/ {swap=$2} END {printf "%d %d %d %d %d %d %d", pss+0, privateDirty+0, privateClean+0, sharedClean+0, sharedDirty+0, swap+0, 0}\' "/proc/$pid/smaps_rollup" 2>/dev/null || printf "0 0 0 0 0 0 0"); '
  + 'read -r pss privateDirty privateClean sharedClean sharedDirty swap unused <<< "$memory"; '
  + 'printf "%s %s %s %s %s %s %s %s %s %s %s\\n" "$pid" "${cpuJiffies:-0}" "$rss" "${pss:-0}" "${privateDirty:-0}" "${privateClean:-0}" "${sharedClean:-0}" "${sharedDirty:-0}" "${swap:-0}" "$comm" "$args"; '
  + 'done; exit 0';

export function buildChromeProcessSnapshotInvocation(
  hostPlatform: NodeJS.Platform = process.platform,
): { file: string; args: string[] } {
  const shellArgs = ['-lc', CHROME_PROCESS_SNAPSHOT_COMMAND];
  return hostPlatform === 'win32'
    ? {
      file: 'wsl.exe',
      args: ['--distribution', 'Ubuntu-22.04', '--exec', '/bin/bash', ...shellArgs],
    }
    : {
      file: '/bin/bash',
      args: shellArgs,
    };
}

export function appendContentPerformanceDiagnosticQuery(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('perfContent', '1');
    return parsed.toString();
  } catch {
    return url;
  }
}

async function readWslChromeProcesses(
  userDataDir: string,
  cpuUsageState: WslCpuUsageState,
): Promise<WslChromeProcess[]> {
  const invocation = buildChromeProcessSnapshotInvocation();
  const { stdout } = await execFileAsync(invocation.file, invocation.args, {
    maxBuffer: 1_000_000,
    timeout: 5_000,
    windowsHide: true,
  });
  const processes = stdout
    .split(/\r?\n/)
    .map(parseWslChromeProcessLineWithJiffies)
    .filter((process): process is WslChromeProcess => process !== null);
  const now = Date.now();
  return selectWslChromeProcesses(processes, userDataDir).map((process) => {
    const currentJiffies = process.cpuJiffies ?? 0;
    const previous = cpuUsageState.get(process.pid);
    const cpuPercent = previous
      ? calculateWslIntervalCpuPercent(
        previous.cpuJiffies,
        currentJiffies,
        now - previous.atMs,
      )
      : 0;
    cpuUsageState.set(process.pid, { cpuJiffies: currentJiffies, atMs: now });
    return { ...process, cpuPercent };
  });
}

async function readWslCdpProcessInfo(
  cdp: RawWslCdpConnection,
): Promise<WslCdpProcessInfoSummary[]> {
  try {
    const response = await cdp.send<{ processInfo?: WslRawCdpProcessInfo[] }>('SystemInfo.getProcessInfo');
    return summarizeWslCdpProcessInfo(response.processInfo ?? []);
  } catch {
    return [];
  }
}

async function collectWslCpuProfile(
  cdp: RawWslCdpConnection,
  sessionId: string,
  delayMs: number,
  sampleMs: number,
): Promise<WslCpuProfileSummary[] | null> {
  let started = false;
  try {
    if (delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
    await cdp.send('Profiler.enable', undefined, sessionId);
    await cdp.send('Profiler.start', undefined, sessionId);
    started = true;
    await new Promise<void>((resolve) => setTimeout(resolve, sampleMs));
    const response = await cdp.send<{
      profile?: {
        nodes?: WslCpuProfileNode[];
        samples?: unknown[];
        timeDeltas?: unknown[];
      };
    }>('Profiler.stop', undefined, sessionId);
    started = false;
    return summarizeWslCpuProfile(response.profile);
  } catch {
    return null;
  } finally {
    if (started) {
      await cdp.send('Profiler.stop', undefined, sessionId).catch(() => undefined);
    }
    await cdp.send('Profiler.disable', undefined, sessionId).catch(() => undefined);
  }
}

/**
 * 返回不包含媒体正文、标题或 URL 的页面结构计数表达式，供 WSL 诊断使用。
 * 这些计数用于区分“首批渐进挂载”与“页面已经挂载完整目录”。
 */
export function buildWslPageMetricsExpression(options: { includeProbeState?: boolean } = {}): string {
  const probeState = options.includeProbeState === true
    ? `,
          ...(globalThis.__JAVDB_PERF_PROBE__ ? {
            longTaskDurationsMs: Array.isArray(globalThis.__JAVDB_PERF_PROBE__.longTaskDurationsMs)
              ? globalThis.__JAVDB_PERF_PROBE__.longTaskDurationsMs.splice(0)
              : [],
            longTaskEntries: Array.isArray(globalThis.__JAVDB_PERF_PROBE__.longTaskEntries)
              ? globalThis.__JAVDB_PERF_PROBE__.longTaskEntries.splice(0)
              : [],
            lifecycleCounts: { ...(globalThis.__JAVDB_PERF_PROBE__.lifecycleCounts ?? {}) },
            recordsLifecycleSnapshots: Array.isArray(globalThis.__JAVDB_PERF_PROBE__.recordsLifecycleSnapshots)
              ? globalThis.__JAVDB_PERF_PROBE__.recordsLifecycleSnapshots.splice(0)
              : [],
            tabActivationMarks: Array.isArray(globalThis.__JAVDB_PERF_PROBE__.tabActivationMarks)
              ? globalThis.__JAVDB_PERF_PROBE__.tabActivationMarks.splice(0)
              : [],
          } : {})`
    : '';
  return `(() => {
      const memory = 'memory' in performance ? performance.memory : undefined;
      return {
        readyState: document.readyState,
        domNodes: document.getElementsByTagName('*').length,
        imageCount: document.images.length,
        imagePixelCount: Array.from(document.images).reduce((total, image) => {
          const width = Number(image.naturalWidth) || 0;
          const height = Number(image.naturalHeight) || 0;
          return total + width * height;
        }, 0),
        canvasCount: document.querySelectorAll('canvas').length,
        canvasPixelCount: Array.from(document.querySelectorAll('canvas')).reduce((total, canvas) => {
          const width = Number(canvas.width) || 0;
          const height = Number(canvas.height) || 0;
          return total + width * height;
        }, 0),
        svgCount: document.querySelectorAll('svg').length,
        videoCount: document.getElementsByTagName('video').length,
        activeTabId: document.querySelector('.tab-content.active')?.id ?? null,
        appRootMounted: Boolean(document.querySelector('#app-root')?.childElementCount),
        iframeCount: document.querySelectorAll('iframe').length,
        iframeKinds: Array.from(document.querySelectorAll('iframe')).map((frame) => {
          const src = frame.getAttribute('src') || '';
          return src.startsWith('chrome-extension://')
            ? 'extension'
            : src.startsWith('http://') || src.startsWith('https://')
              ? 'web'
              : src ? 'other' : 'empty';
        }),
        dashboardTabContentCount: document.querySelectorAll('.tab-content').length,
        hiddenDashboardTabContentCount: document.querySelectorAll('.tab-content:not(.active)').length,
        activeDashboardTabContentCount: document.querySelectorAll('.tab-content.active').length,
        dashboardTabMetrics: Array.from(document.querySelectorAll('.tab-content')).map((node) => {
          const element = node;
          const rect = element.getBoundingClientRect();
          return {
            id: element.id || '[anonymous]',
            active: element.classList.contains('active'),
            domNodes: element.querySelectorAll('*').length + 1,
            imageCount: element.querySelectorAll('img').length,
            canvasCount: element.querySelectorAll('canvas').length,
            childMetrics: Array.from(element.children).map((child) => ({
              tag: child.tagName.toLowerCase(),
              id: child.id || null,
              className: typeof child.className === 'string' ? child.className.slice(0, 120) : null,
              domNodes: child.querySelectorAll('*').length + 1,
              imageCount: child.querySelectorAll('img').length,
            })),
            visible: rect.width > 0 && rect.height > 0,
          };
        }),
        overlayShellCount: document.querySelectorAll('[data-ui-pattern="overlay-shell"]').length,
        mediaCardCount: document.querySelectorAll('[data-layout-card="1"]').length,
        mediaGridItemCount: document.querySelectorAll('#mediaLibraryGrid > .ml-grid-item').length,
        mediaCardImageCount: document.querySelectorAll('#mediaLibraryGrid .ml-card img').length,
        visibleMediaCardCount: Array.from(document.querySelectorAll('#mediaLibraryGrid .ml-card'))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }).length,
        recordsFilterMetrics: {
          filterRowCount: document.querySelectorAll('#tab-records .filter-row').length,
          renderedOptionCount: document.querySelectorAll('#tab-records .filter-row .tag-option').length,
          videoListDomNodes: document.querySelector('#tab-records #videoList')?.querySelectorAll('*').length ?? 0,
        },
        resourceCount: performance.getEntriesByType('resource').length,
        resourceTransferBytes: performance.getEntriesByType('resource').reduce((total, entry) => {
          const transferSize = Number(entry.transferSize) || 0;
          return total + transferSize;
        }, 0),
        resourceDecodedBytes: performance.getEntriesByType('resource').reduce((total, entry) => {
          const decodedBodySize = Number(entry.decodedBodySize) || 0;
          return total + decodedBodySize;
        }, 0),
        sourceFixtureMarker: Boolean(document.querySelector('[data-javdb-performance-source-fixture="1"]')),
        sourceFixtureItemCount: document.querySelectorAll('[data-performance-source-item="1"]').length,
        extensionInjected: document.documentElement?.dataset.javdbExtensionInjected === '1',
        jsHeapUsedBytes: typeof memory?.usedJSHeapSize === 'number' ? memory.usedJSHeapSize : null,
        jsHeapLimitBytes: typeof memory?.jsHeapSizeLimit === 'number' ? memory.jsHeapSizeLimit : null,
        newWorksDiagnostics: globalThis.__JAVDB_NEW_WORKS_DIAGNOSTICS__ ?? null${probeState},
      };
    })()`;
}

export function buildContentPerformanceReadExpression(): string {
  return `(() => new Promise((resolve) => {
    const requestId = 'content-perf-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    const timeout = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve(null);
    }, 500);
    const onMessage = (event) => {
      const data = event.data;
      if ((event.source !== window && event.source !== null)
        || data?.type !== 'JDB_CONTENT_PERF_SNAPSHOT'
        || data?.requestId !== requestId) return;
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      resolve(data.snapshot ?? null);
    };
    window.addEventListener('message', onMessage);
    window.postMessage({ type: 'JDB_CONTENT_PERF_READ', requestId }, '*');
  }))()`;
}

async function readPageSnapshot(page: Page, client: CDPSession): Promise<Record<string, unknown>> {
  const pageMetricsResponse = await client.send('Runtime.evaluate', {
    expression: buildWslPageMetricsExpression(),
    returnByValue: true,
    awaitPromise: false,
    timeout: 1_500,
  }) as {
    result?: { value?: Record<string, unknown> };
    exceptionDetails?: unknown;
  };
  const pageMetrics = {
    url: page.url(),
    ...(pageMetricsResponse.result?.value ?? {
      readyState: null,
      domNodes: null,
      imageCount: null,
      videoCount: null,
      jsHeapUsedBytes: null,
      jsHeapLimitBytes: null,
      pageEvaluationTimedOut: true,
    }),
  };
  const performanceResponse = await client.send('Performance.getMetrics') as {
    metrics?: Array<{ name: string; value: number }>;
  };
  const cdpMetrics = Object.fromEntries(
    (performanceResponse.metrics ?? [])
      .filter((metric) => Number.isFinite(metric.value))
      .map((metric) => [metric.name, metric.value]),
  );
  const safeUrl = redactDiagnosticPayload(pageMetrics.url, 'url');
  return {
    ...pageMetrics,
    url: typeof safeUrl === 'string' ? safeUrl : '[REDACTED]',
    cdpMetrics,
  };
}

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : fallback;
}

type WslScenarioSample = {
  at: number;
  page: Record<string, unknown>;
  processes: WslChromeProcess[];
  processSummary: WslChromeProcessSummary;
  processSummaryByCategory: Partial<WslChromeProcessCategorySummary>;
  processSummaryByRole: Partial<WslChromeProcessRoleSummary>;
  cdpProcessInfo: WslCdpProcessInfoSummary[];
  targetSummary: WslTargetSummary[];
  pageCount: number;
  serviceWorkerHeapUsage?: WslServiceWorkerHeapUsage | null;
  diagnosticPhase?: DiagnosticPhase;
};

async function sampleWslPage(
  context: import('@playwright/test').BrowserContext,
  page: Page,
  userDataDir: string,
  sampleMs: number,
  intervalMs: number,
): Promise<WslScenarioSample[]> {
  const client = await context.newCDPSession(page);
  await client.send('Performance.enable');
  await new Promise<void>((resolve) => setTimeout(resolve, 3_000));
  const samples: WslScenarioSample[] = [];
  const cpuUsageState: WslCpuUsageState = new Map();
  const startedAt = Date.now();
  try {
    while (Date.now() - startedAt < sampleMs) {
      const [pageSnapshot, processes] = await Promise.all([
        readPageSnapshot(page, client),
        readWslChromeProcesses(userDataDir, cpuUsageState),
      ]);
      samples.push({
        at: Date.now(),
        page: pageSnapshot,
        processes,
        processSummary: summarizeWslChromeProcesses(processes),
        processSummaryByCategory: summarizeWslChromeProcessesByCategory(processes),
        processSummaryByRole: summarizeWslChromeProcessesByRole(processes),
        cdpProcessInfo: [],
        targetSummary: [],
        pageCount: context.pages().length,
      });
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    }
  } finally {
    await client.detach().catch(() => undefined);
  }
  return samples;
}

async function waitForRawTarget(
  cdp: RawWslCdpConnection,
  targetId: string,
  timeoutMs = 10_000,
): Promise<RawCdpTarget> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const target = (await cdp.getTargets()).find((candidate) => candidate.targetId === targetId);
    if (target) return target;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`等待 CDP 页面目标超时：${targetId}`);
}

async function readRawTargetRuntime(
  cdp: RawWslCdpConnection,
  targetId: string,
): Promise<WslExtensionPageRuntime> {
  const attached = await cdp.send<{ sessionId?: string }>('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  if (!attached.sessionId) throw new Error(`CDP 页面目标未返回 sessionId：${targetId}`);
  const sessionId = attached.sessionId;
  try {
    const response = await cdp.send<{
      result?: { value?: WslExtensionPageRuntime };
    }>('Runtime.evaluate', {
      expression: `(() => ({
        url: location.href,
        readyState: document.readyState,
        domNodes: document.getElementsByTagName('*').length,
        appRootMounted: Boolean(document.querySelector('#app-root')?.childElementCount),
        activeTabId: document.querySelector('.tab-content.active')?.id ?? null,
        bodyText: document.body?.innerText?.slice(0, 500) ?? '',
      }))()`,
      returnByValue: true,
      awaitPromise: false,
      timeout: 1_500,
    }, sessionId);
    return response.result?.value ?? {
      url: '',
      domNodes: null,
      appRootMounted: false,
      activeTabId: null,
      bodyText: '',
    };
  } finally {
    await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => undefined);
  }
}

async function readRawServiceWorkerHeapUsage(
  cdp: RawWslCdpConnection,
  targets: readonly RawCdpTarget[],
  extensionId: string | undefined,
): Promise<WslServiceWorkerHeapUsage | null> {
  if (!extensionId) return null;
  const target = targets.find((candidate) => (
    candidate.type === 'service_worker'
    && candidate.url.startsWith(`chrome-extension://${extensionId}/`)
  ));
  if (!target) return null;
  const attached = await cdp.send<{ sessionId?: string }>('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true,
  }).catch(() => null);
  if (!attached?.sessionId) return null;
  const sessionId = attached.sessionId;
  try {
    const response = await cdp.send<WslRawServiceWorkerHeapUsage>(
      'Runtime.getHeapUsage',
      undefined,
      sessionId,
    );
    return summarizeWslServiceWorkerHeapUsage(response);
  } catch {
    return null;
  } finally {
    await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => undefined);
  }
}

type WslStorageInspection = {
  entries: WslStorageDiagnostics;
  collection: WslStorageCollectionDiagnostics;
  origin: WslOriginStorageUsage;
};

async function readWslStorageDiagnostics(
  cdp: RawWslCdpConnection,
  targetId: string,
): Promise<WslStorageInspection> {
  const attached = await cdp.send<{ sessionId?: string }>('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  if (!attached.sessionId) throw new Error(`CDP 页面目标未返回 sessionId：${targetId}`);
  const sessionId = attached.sessionId;
  try {
    let originStorageUsage = summarizeWslOriginStorageUsage({});
    try {
      const originResponse = await cdp.send<{
        result?: { value?: string };
      }>('Runtime.evaluate', {
        expression: 'location.origin',
        returnByValue: true,
        awaitPromise: false,
        timeout: 1_000,
      }, sessionId);
      const origin = originResponse.result?.value;
      if (origin) {
        const usageResponse = await cdp.send<unknown>('Storage.getUsageAndQuota', { origin }, sessionId);
        originStorageUsage = summarizeWslOriginStorageUsage(usageResponse);
      }
    } catch {
      // 某些 Chrome for Testing 版本不提供 Storage.getUsageAndQuota，保留空摘要。
    }
    const response = await cdp.send<{
      result?: { value?: WslStorageInspection };
    }>('Runtime.evaluate', {
      expression: `(async () => {
        const keys = ['settings', 'emby_library_state', 'drive115_library_state', 'media_watch_evidence'];
        const stored = await chrome.storage.local.get(null);
        let bytesInUse = null;
        try { bytesInUse = await chrome.storage.local.getBytesInUse(null); } catch {}
        const safeJsonLength = (value) => {
          try {
            const serialized = JSON.stringify(value);
            return typeof serialized === 'string' ? serialized.length : 0;
          } catch { return 0; }
        };
        const isRecord = (value) => value && typeof value === 'object' && !Array.isArray(value);
        const summarize = (value) => {
          const record = isRecord(value) ? value : {};
          const rawEntries = record.entries;
          const entries = Array.isArray(rawEntries)
            ? rawEntries
            : isRecord(rawEntries) ? Object.values(rawEntries) : [];
          let nfoSummaryChars = 0;
          let imageUrlChars = 0;
          for (const entry of entries) {
            if (!isRecord(entry)) continue;
            if (isRecord(entry.nfoSummary)) nfoSummaryChars += safeJsonLength(entry.nfoSummary);
            if (isRecord(entry.imageUrls)) {
              for (const url of Object.values(entry.imageUrls)) {
                if (typeof url === 'string') imageUrlChars += url.length;
              }
            }
          }
          return {
            jsonBytes: safeJsonLength(value),
            entryCount: entries.length,
            nfoSummaryChars,
            imageUrlChars,
          };
        };
        const collectionEntries = Object.entries(stored).map(([key, value]) => ({
          key: String(key).slice(0, 80),
          jsonBytes: safeJsonLength(value),
        }));
        return {
          entries: Object.fromEntries(keys.map((key) => [key, summarize(stored[key])])),
          collection: {
            keyCount: collectionEntries.length,
            totalJsonBytes: collectionEntries.reduce((total, entry) => total + entry.jsonBytes, 0),
            bytesInUse: typeof bytesInUse === 'number' ? bytesInUse : null,
            largestKeys: collectionEntries
              .sort((left, right) => right.jsonBytes - left.jsonBytes || left.key.localeCompare(right.key))
              .slice(0, 10),
          },
        };
      })()`,
      returnByValue: true,
      awaitPromise: true,
      timeout: 5_000,
    }, sessionId);
    const inspection = response.result?.value ?? {
      entries: {},
      collection: summarizeWslStorageCollection({}),
    };
    return { ...inspection, origin: originStorageUsage };
  } catch {
    return {
      entries: {},
      collection: summarizeWslStorageCollection({}),
      origin: summarizeWslOriginStorageUsage({}),
    };
  } finally {
    await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => undefined);
  }
}

export async function closeWslPageTargetsExcept(
  cdp: WslCdpCommandClient & {
    getTargets(): Promise<ReadonlyArray<{ targetId: string; type: string }>>;
  },
  keepTargetId: string,
  activeTargetIds: Set<string> | null = activeWslProbeTargetIds,
): Promise<void> {
  const targets = await cdp.getTargets();
  const targetIds = selectWslPageTargetIdsToClose(targets, keepTargetId);
  await closeWslProbeTargets(cdp, targetIds, activeTargetIds);
}

async function installWslPerformanceProbe(
  cdp: RawWslCdpConnection,
  targetId: string,
): Promise<void> {
  const attached = await cdp.send<{ sessionId?: string }>('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  if (!attached.sessionId) throw new Error(`CDP 页面目标未返回 sessionId：${targetId}`);
  const sessionId = attached.sessionId;
  try {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: buildWslPerformanceProbeScript(),
    }, sessionId);
    const initialized = await cdp.send<{
      result?: { value?: boolean };
    }>('Runtime.evaluate', {
      expression: `${buildWslPerformanceProbeScript()}; Boolean(globalThis.__JAVDB_PERF_PROBE__)`,
      returnByValue: true,
      awaitPromise: false,
    }, sessionId);
    if (initialized.result?.value !== true) {
      throw new Error(`WSL 性能探针未能初始化页面状态：${targetId}`);
    }
  } finally {
    await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => undefined);
  }
}

async function dispatchDashboardPagehideAndReadSnapshot(
  cdp: RawWslCdpConnection,
  targetId: string,
): Promise<Record<string, unknown>> {
  const attached = await cdp.send<{ sessionId?: string }>('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  if (!attached.sessionId) throw new Error(`CDP 页面目标未返回 sessionId：${targetId}`);
  const sessionId = attached.sessionId;
  try {
    const target = await waitForRawTarget(cdp, targetId);
    await cdp.send('Runtime.evaluate', {
      expression: `window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));`,
      returnByValue: false,
      awaitPromise: false,
    }, sessionId);
    return readRawPageSnapshot(cdp, sessionId, target.url);
  } finally {
    await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => undefined);
  }
}

async function createWslBlankTarget(cdp: RawWslCdpConnection): Promise<string> {
  const created = await cdp.send<{ targetId?: string }>('Target.createTarget', {
    url: 'about:blank',
  });
  if (!created.targetId) throw new Error('无法创建关闭回落验证用的扩展页面。');
  return created.targetId;
}

async function createWslExtensionTargetForCloseRecovery(
  cdp: RawWslCdpConnection,
  extensionId: string,
  dashboardHash: string,
): Promise<string> {
  const targetId = await createWslBlankTarget(cdp);
  activeWslProbeTargetIds?.add(targetId);
  try {
    await navigateWslExtensionTarget(
      cdp,
      targetId,
      extensionId,
      dashboardHash,
      true,
    );
    await installWslPerformanceProbe(cdp, targetId);
    return targetId;
  } catch (error) {
    await closeWslProbeTargets(cdp, [targetId], activeWslProbeTargetIds);
    throw error;
  }
}

async function ensureWslExtensionTargetForCloseRecovery(
  cdp: RawWslCdpConnection,
  targetId: string,
  extensionId: string,
  dashboardHash: string,
): Promise<string> {
  const target = (await cdp.getTargets()).find((candidate) => candidate.targetId === targetId);
  if (target) return targetId;
  return createWslExtensionTargetForCloseRecovery(cdp, extensionId, dashboardHash);
}

async function touchDashboardLifecycle(
  cdp: RawWslCdpConnection,
  targetId: string,
): Promise<void> {
  const attached = await cdp.send<{ sessionId?: string }>('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  if (!attached.sessionId) throw new Error(`CDP 页面目标未返回 sessionId：${targetId}`);
  const sessionId = attached.sessionId;
  try {
    await cdp.send('Runtime.evaluate', {
      expression: `(async () => {
        const original = location.hash || '#tab-home';
        const alternate = original === '#tab-home' ? '#tab-media' : '#tab-home';
        location.hash = alternate;
        await new Promise((resolve) => setTimeout(resolve, 150));
        location.hash = original;
        await new Promise((resolve) => setTimeout(resolve, 150));
        return true;
      })()`,
      returnByValue: true,
      awaitPromise: true,
      timeout: 2_000,
    }, sessionId);
  } finally {
    await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => undefined);
  }
}

async function injectWslPerformanceMediaFixture(
  cdp: RawWslCdpConnection,
  targetId: string,
  fixture: PerformanceMediaFixture,
): Promise<void> {
  const attached = await cdp.send<{ sessionId?: string }>('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  if (!attached.sessionId) throw new Error(`CDP 页面目标未返回 sessionId：${targetId}`);
  const sessionId = attached.sessionId;
  try {
    const serializedFixture = JSON.stringify(fixture);
    const response = await cdp.send<{
      exceptionDetails?: unknown;
      result?: { value?: unknown };
    }>('Runtime.evaluate', {
      expression: `(async () => {
        await chrome.storage.local.set(${serializedFixture});
        return true;
      })()`,
      returnByValue: true,
      awaitPromise: true,
      timeout: 5_000,
    }, sessionId);
    if (response.exceptionDetails || response.result?.value !== true) {
      throw new Error('WSL 扩展性能 fixture 写入 chrome.storage.local 失败。');
    }
    await cdp.send('Page.reload', { ignoreCache: false }, sessionId);
  } finally {
    await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => undefined);
  }
}

export function buildWslExternalSyncIsolationExpression(options: {
  clearCloudPending?: boolean;
} = {}): string {
  const clearCloudPending = options.clearCloudPending === true
    ? '      cloud_sync_pending_v1: [],\n'
    : '';
  return `(async () => {
    await Promise.all([
      'cloud-auto-sync',
      'emby.library.sync',
      'drive115.daily_user_refresh',
      'drive115-library-index-resume',
      'webdav-auto-sync',
    ].map((name) => chrome.alarms?.clear(name)?.catch(() => false)));
    const stored = await chrome.storage.local.get([
      'settings',
      'cloud_auto_sync_settings_v1',
    ]);
    const isRecord = (value) => value && typeof value === 'object' && !Array.isArray(value);
    const settings = isRecord(stored.settings) ? stored.settings : {};
    const nextSettings = { ...settings };
    if (isRecord(settings.emby)) {
      nextSettings.emby = {
        ...settings.emby,
        enabled: false,
        libraryStatus: isRecord(settings.emby.libraryStatus)
          ? { ...settings.emby.libraryStatus, enabled: false }
          : settings.emby.libraryStatus,
        mediaServers: Array.isArray(settings.emby.mediaServers)
          ? settings.emby.mediaServers.map((server) => isRecord(server)
            ? { ...server, enabled: false }
            : server)
          : settings.emby.mediaServers,
      };
    }
    if (isRecord(settings.drive115)) {
      nextSettings.drive115 = {
        ...settings.drive115,
        enabled: false,
        mediaLibraryRoots: Array.isArray(settings.drive115.mediaLibraryRoots)
          ? settings.drive115.mediaLibraryRoots.map((root) => isRecord(root)
            ? { ...root, enabled: false }
            : root)
          : settings.drive115.mediaLibraryRoots,
      };
    }
    const currentAutoSync = isRecord(stored.cloud_auto_sync_settings_v1)
      ? stored.cloud_auto_sync_settings_v1
      : {};
    await chrome.storage.local.set({
      settings: nextSettings,
${clearCloudPending}
      cloud_auto_sync_settings_v1: {
        ...currentAutoSync,
        enabled: false,
        updatedAt: Date.now(),
      },
    });
    let verifyPending = true;
    if (${options.clearCloudPending === true ? 'true' : 'false'}) {
      // 设置变更会先经过后台入队；等它完成后再清空，避免把异步入队误判成同步仍在运行。
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await chrome.storage.local.set({ cloud_sync_pending_v1: [] });
      await new Promise((resolve) => setTimeout(resolve, 500));
      await chrome.storage.local.set({ cloud_sync_pending_v1: [] });
      const pendingCheck = await chrome.storage.local.get(['cloud_sync_pending_v1']);
      verifyPending = !Array.isArray(pendingCheck.cloud_sync_pending_v1)
        || pendingCheck.cloud_sync_pending_v1.length === 0;
    }
    const verification = await chrome.storage.local.get([
      'settings',
      'cloud_auto_sync_settings_v1',
    ]);
    const verifySettings = isRecord(verification.settings) ? verification.settings : {};
    const verifyEmby = !isRecord(verifySettings.emby)
      || (verifySettings.emby.enabled === false
        && (!Array.isArray(verifySettings.emby.mediaServers)
          || verifySettings.emby.mediaServers.every((server) => !isRecord(server) || server.enabled === false)));
    const verifyDrive115 = !isRecord(verifySettings.drive115)
      || (verifySettings.drive115.enabled === false
        && (!Array.isArray(verifySettings.drive115.mediaLibraryRoots)
          || verifySettings.drive115.mediaLibraryRoots.every((root) => !isRecord(root) || root.enabled === false)));
    const verifyCloud = isRecord(verification.cloud_auto_sync_settings_v1)
      && verification.cloud_auto_sync_settings_v1.enabled === false;
    const checks = {
      emby: verifyEmby,
      drive115: verifyDrive115,
      cloud: verifyCloud,
      pending: verifyPending,
    };
    return {
      ok: Object.values(checks).every(Boolean),
      checks,
    };
  })()`;
}

async function disableWslExternalSync(
  cdp: RawWslCdpConnection,
  targetId: string,
  clearCloudPending = false,
): Promise<void> {
  const attached = await cdp.send<{ sessionId?: string }>('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  if (!attached.sessionId) throw new Error(`CDP 页面目标未返回 sessionId：${targetId}`);
  const sessionId = attached.sessionId;
  try {
    const response = await cdp.send<{
      exceptionDetails?: unknown;
      result?: { value?: unknown };
    }>('Runtime.evaluate', {
      expression: buildWslExternalSyncIsolationExpression({ clearCloudPending }),
      returnByValue: true,
      awaitPromise: true,
      timeout: 5_000,
    }, sessionId);
    const isolationResult = response.result?.value;
    if (response.exceptionDetails || !isolationResult
      || typeof isolationResult !== 'object'
      || (isolationResult as { ok?: unknown }).ok !== true) {
      const checks = isolationResult && typeof isolationResult === 'object'
        ? (isolationResult as { checks?: unknown }).checks
        : undefined;
      const checkSummary = checks && typeof checks === 'object'
        ? ` 检查结果：${JSON.stringify(checks)}`
        : '';
      throw new Error(`WSL 宿主数据测试无法关闭外部同步。${checkSummary}`);
    }
    await cdp.send('Page.reload', { ignoreCache: false }, sessionId);
  } finally {
    await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => undefined);
  }
}

async function configureWslSourceContentSettings(
  cdp: RawWslCdpConnection,
  targetId: string,
  profile: WslContentSettingsProfile,
): Promise<void> {
  const attached = await cdp.send<{ sessionId?: string }>('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  if (!attached.sessionId) throw new Error(`CDP 页面目标未返回 sessionId：${targetId}`);
  const sessionId = attached.sessionId;
  try {
    const response = await cdp.send<{
      exceptionDetails?: unknown;
      result?: { value?: unknown };
    }>('Runtime.evaluate', {
      expression: buildWslContentSettingsExpression(profile),
      returnByValue: true,
      awaitPromise: true,
      timeout: 5_000,
    }, sessionId);
    if (response.exceptionDetails || response.result?.value !== true) {
      throw new Error(`无法写入源站性能对照设置：${profile}`);
    }
  } finally {
    await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => undefined);
  }
}

async function navigateWslExtensionTarget(
  cdp: RawWslCdpConnection,
  targetId: string,
  extensionId: string,
  dashboardHash: string,
  installProbe = false,
): Promise<void> {
  const attached = await cdp.send<{ sessionId?: string }>('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  if (!attached.sessionId) throw new Error(`CDP 页面目标未返回 sessionId：${targetId}`);
  try {
    if (installProbe) {
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: buildWslPerformanceProbeScript(),
      }, attached.sessionId);
    }
    await cdp.send('Page.navigate', {
      url: buildWslDashboardUrl(
        extensionId,
        dashboardHash,
        process.env.JAVDB_WSL_HOME_CHARTS,
        process.env.JAVDB_WSL_NEW_WORKS_DIAGNOSTIC,
      ),
    }, attached.sessionId);
  } finally {
    await cdp.send('Target.detachFromTarget', { sessionId: attached.sessionId }).catch(() => undefined);
  }
  await waitForWslExtensionPage(cdp, targetId, extensionId, dashboardHash);
}

async function waitForWslExtensionPage(
  cdp: RawWslCdpConnection,
  targetId: string,
  extensionId: string,
  dashboardHash?: string,
  timeoutMs = numberFromEnv('JAVDB_WSL_PAGE_TIMEOUT_MS', 10_000),
): Promise<RawCdpTarget> {
  const startedAt = Date.now();
  let lastUrl = '';
  let lastActiveTabId: string | null = null;
  while (Date.now() - startedAt < timeoutMs) {
    const target = (await cdp.getTargets()).find((candidate) => candidate.targetId === targetId);
    if (target) {
      lastUrl = target.url;
      if (isWslExtensionPageUrl(target.url, extensionId)) {
        const pageRuntime = await readRawTargetRuntime(cdp, targetId);
        lastUrl = pageRuntime.url || lastUrl;
        lastActiveTabId = pageRuntime.activeTabId ?? null;
        const inspection = inspectWslExtensionPageRuntime({
          expectedExtensionId: extensionId,
          pageRuntime,
        });
        const expectedTabId = dashboardHash?.replace(/^#/, '').split('/')[0];
        const isExpectedTab = !expectedTabId || pageRuntime.activeTabId === expectedTabId;
        const isExpectedHash = !dashboardHash || pageRuntime.url.includes(dashboardHash);
        if (inspection.ok && isExpectedTab && isExpectedHash) return target;
        if (pageRuntime.url.startsWith('chrome-error://')) {
          throw new Error(`${inspection.reason} 实际 URL：${pageRuntime.url}，页面信息：${pageRuntime.bodyText ?? '[empty]'}`);
        }
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`等待扩展页面加载超时：${targetId}，最后 URL：${lastUrl || '[unknown]'}，最后激活 Tab：${lastActiveTabId || '[none]'}`);
}

async function readRawPageSnapshot(
  cdp: RawWslCdpConnection,
  sessionId: string,
  pageUrl: string,
  includeDeepEventDiagnostics = false,
  includeContentPerformanceDiagnostics = false,
): Promise<Record<string, unknown>> {
  let pageMetrics: Record<string, unknown> = {
    url: pageUrl,
    readyState: null,
    domNodes: null,
    imageCount: null,
    videoCount: null,
    jsHeapUsedBytes: null,
    jsHeapLimitBytes: null,
    pageEvaluationTimedOut: true,
  };
  try {
    const response = await cdp.send<{
      result?: { value?: Record<string, unknown> };
    }>('Runtime.evaluate', {
      expression: buildWslPageMetricsExpression({ includeProbeState: true }),
      returnByValue: true,
      awaitPromise: false,
      timeout: 1_500,
    }, sessionId);
    pageMetrics = { url: pageUrl, ...(response.result?.value ?? pageMetrics) };
  } catch (error) {
    pageMetrics = {
      ...pageMetrics,
      pageEvaluationError: error instanceof Error ? error.message : String(error),
    };
  }

  if (includeContentPerformanceDiagnostics) {
    try {
      const response = await cdp.send<{
        result?: { value?: unknown };
      }>('Runtime.evaluate', {
        expression: buildContentPerformanceReadExpression(),
        returnByValue: true,
        awaitPromise: true,
        timeout: 1_000,
      }, sessionId);
      pageMetrics = {
        ...pageMetrics,
        contentPerformanceDiagnostics: response.result?.value ?? null,
      };
    } catch (error) {
      pageMetrics = {
        ...pageMetrics,
        contentPerformanceDiagnosticsError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  let cdpMetrics: Record<string, number> = {};
  try {
    const performanceResponse = await cdp.send<{
      metrics?: Array<{ name: string; value: number }>;
    }>('Performance.getMetrics', undefined, sessionId);
    cdpMetrics = Object.fromEntries(
      (performanceResponse.metrics ?? [])
        .filter((metric) => Number.isFinite(metric.value))
        .map((metric) => [metric.name, metric.value]),
    );
  } catch (error) {
    pageMetrics = {
      ...pageMetrics,
      cdpMetricsError: error instanceof Error ? error.message : String(error),
    };
  }
  const directEventListeners = await readRawEventListenerSummary(
    cdp,
    sessionId,
    includeDeepEventDiagnostics,
  );
  const eventTargetDiagnostics = includeDeepEventDiagnostics
    ? await readRawEventTargetSummary(cdp, sessionId)
    : undefined;
  const safeUrl = redactDiagnosticPayload(pageUrl, 'url');
  return {
    ...pageMetrics,
    url: typeof safeUrl === 'string' ? safeUrl : '[REDACTED]',
    cdpMetrics,
    directEventListeners,
    ...(eventTargetDiagnostics ? { eventTargetDiagnostics } : {}),
  };
}

async function readRawEventListenerSummary(
  cdp: RawWslCdpConnection,
  sessionId: string,
  includeDeepEventDiagnostics = false,
): Promise<WslEventListenerSummary & { containerEventListeners?: WslContainerEventListenerSummary }> {
  const listenersByTarget: Record<string, WslEventListenerInfo[]> = {};
  for (const [target, expression] of Object.entries({
    window: 'window',
    document: 'document',
    documentRoot: 'document.body',
  })) {
    try {
      const evaluated = await cdp.send<{
        result?: { objectId?: string };
      }>('Runtime.evaluate', {
        expression,
        returnByValue: false,
        awaitPromise: false,
      }, sessionId);
      const objectId = evaluated.result?.objectId;
      if (!objectId) continue;
      try {
        const response = await cdp.send<{
          listeners?: WslEventListenerInfo[];
        }>('DOMDebugger.getEventListeners', { objectId }, sessionId);
        listenersByTarget[target] = response.listeners ?? [];
      } finally {
        await cdp.send('Runtime.releaseObject', { objectId }, sessionId).catch(() => undefined);
      }
    } catch {
      listenersByTarget[target] = [];
    }
  }
  const summary = summarizeWslEventListeners(listenersByTarget);
  if (!includeDeepEventDiagnostics) return summary;

  const containerSamples: WslContainerEventListenerSample[] = [];
  for (const selector of [
    '#app-root',
    '#tab-home',
    '#tab-media',
    '#tab-records',
    '#tab-actors',
    '#tab-new-works',
    '#tab-settings',
    '#mediaLibraryGrid',
    '.ml-card',
    '.ml-card *',
    '.ml-card button',
    '.ml-card img',
  ]) {
    containerSamples.push(await readRawContainerEventListeners(cdp, sessionId, selector, 500));
  }
  return {
    ...summary,
    containerEventListeners: summarizeWslContainerEventListeners(containerSamples),
  };
}

async function readRawContainerEventListeners(
  cdp: RawWslCdpConnection,
  sessionId: string,
  selector: string,
  inspectLimit = 200,
): Promise<WslContainerEventListenerSample> {
  const safeSelector = JSON.stringify(selector);
  let matchedCount = 0;
  let inspectedCount = 0;
  let listenerCount = 0;
  const listenerTypeCounts: Record<string, number> = {};
  let collectionObjectId: string | undefined;

  try {
    const countResponse = await cdp.send<{
      result?: { value?: number };
    }>('Runtime.evaluate', {
      expression: `document.querySelectorAll(${safeSelector}).length`,
      returnByValue: true,
      awaitPromise: false,
    }, sessionId);
    matchedCount = Number(countResponse.result?.value) || 0;

    const collectionResponse = await cdp.send<{
      result?: { objectId?: string };
    }>('Runtime.evaluate', {
      expression: `Array.from(document.querySelectorAll(${safeSelector})).slice(0, ${Math.max(1, inspectLimit)})`,
      returnByValue: false,
      awaitPromise: false,
    }, sessionId);
    collectionObjectId = collectionResponse.result?.objectId;
    if (!collectionObjectId) {
      return { selector, matchedCount, inspectedCount, listenerCount, listenerTypeCounts };
    }

    const properties = await cdp.send<{
      result?: Array<{ name?: string; value?: { objectId?: string } }>;
    }>('Runtime.getProperties', {
      objectId: collectionObjectId,
      ownProperties: true,
      accessorPropertiesOnly: false,
    }, sessionId);
    const nodeObjectIds = (properties.result ?? [])
      .filter((property) => /^\d+$/.test(property.name ?? '') && property.value?.objectId)
      .map((property) => property.value?.objectId)
      .filter((objectId): objectId is string => typeof objectId === 'string');
    inspectedCount = nodeObjectIds.length;

    for (const objectId of nodeObjectIds) {
      try {
        const response = await cdp.send<{
          listeners?: WslEventListenerInfo[];
        }>('DOMDebugger.getEventListeners', { objectId }, sessionId);
        for (const listener of response.listeners ?? []) {
          listenerCount += 1;
          const type = sanitizeDiagnosticEventType(listener.type?.trim() || 'unknown');
          listenerTypeCounts[type] = (listenerTypeCounts[type] ?? 0) + 1;
        }
      } catch {
        // 诊断失败不能影响页面性能采样主流程。
      } finally {
        await cdp.send('Runtime.releaseObject', { objectId }, sessionId).catch(() => undefined);
      }
    }
  } catch {
    // 诊断失败不能影响页面性能采样主流程。
  } finally {
    if (collectionObjectId) {
      await cdp.send('Runtime.releaseObject', { objectId: collectionObjectId }, sessionId).catch(() => undefined);
    }
  }

  return { selector, matchedCount, inspectedCount, listenerCount, listenerTypeCounts };
}

async function readRawEventTargetSummary(
  cdp: RawWslCdpConnection,
  sessionId: string,
): Promise<WslEventTargetSummary> {
  const prototypes = [
    ['EventTarget', 'EventTarget.prototype'],
    ['AbortSignal', 'globalThis.AbortSignal?.prototype'],
    ['WebSocket', 'globalThis.WebSocket?.prototype'],
    ['BroadcastChannel', 'globalThis.BroadcastChannel?.prototype'],
    ['MessagePort', 'globalThis.MessagePort?.prototype'],
    ['XMLHttpRequest', 'globalThis.XMLHttpRequest?.prototype'],
  ] as const;
  const samples: WslEventTargetProbeSample[] = [];
  for (const [prototypeName, expression] of prototypes) {
    samples.push(await readRawEventTargetPrototypeSummary(cdp, sessionId, prototypeName, expression));
  }
  return summarizeWslEventTargetSamples(samples);
}

async function readRawEventTargetPrototypeSummary(
  cdp: RawWslCdpConnection,
  sessionId: string,
  prototypeName: string,
  expression: string,
  inspectLimit = 200,
): Promise<WslEventTargetProbeSample> {
  const sample: WslEventTargetProbeSample = {
    prototypeName,
    matchedCount: 0,
    inspectedCount: 0,
    domLikeCount: 0,
    nonDomCount: 0,
    listenerCount: 0,
    domListenerCount: 0,
    nonDomListenerCount: 0,
    constructorCounts: {},
    nonDomConstructorCounts: {},
    listenerTypeCounts: {},
  };
  let prototypeObjectId: string | undefined;
  let collectionObjectId: string | undefined;
  try {
    const prototypeResponse = await cdp.send<{
      result?: { objectId?: string };
    }>('Runtime.evaluate', {
      expression,
      returnByValue: false,
      awaitPromise: false,
    }, sessionId);
    prototypeObjectId = prototypeResponse.result?.objectId;
    if (!prototypeObjectId) return sample;

    const queryResponse = await cdp.send<{
      objects?: { objectId?: string };
    }>('Runtime.queryObjects', { prototypeObjectId }, sessionId);
    collectionObjectId = queryResponse.objects?.objectId;
    if (!collectionObjectId) return sample;

    const properties = await cdp.send<{
      result?: Array<{ name?: string; value?: { value?: unknown; objectId?: string } }>;
    }>('Runtime.getProperties', {
      objectId: collectionObjectId,
      ownProperties: true,
      accessorPropertiesOnly: false,
    }, sessionId);
    const lengthProperty = properties.result?.find((property) => property.name === 'length');
    sample.matchedCount = Math.max(0, Number(lengthProperty?.value?.value) || 0);
    const objectIds = (properties.result ?? [])
      .filter((property) => /^\d+$/.test(property.name ?? '') && property.value?.objectId)
      .slice(0, Math.max(1, inspectLimit))
      .map((property) => property.value?.objectId)
      .filter((objectId): objectId is string => typeof objectId === 'string');
    sample.inspectedCount = objectIds.length;

    for (const objectId of objectIds) {
      let domLike = false;
      try {
        const metadata = await cdp.send<{
          result?: { value?: { domLike?: boolean; constructorName?: string } };
        }>('Runtime.callFunctionOn', {
          objectId,
          functionDeclaration: `function () {
            return {
              domLike: Boolean(this && (
                typeof this.nodeType === 'number'
                || typeof this.tagName === 'string'
                || this === window
                || this === document
              )),
              constructorName: typeof this?.constructor?.name === 'string'
                ? this.constructor.name
                : 'unknown',
            };
          }`,
          returnByValue: true,
          awaitPromise: false,
        }, sessionId);
        domLike = metadata.result?.value?.domLike === true;
        const constructorName = metadata.result?.value?.constructorName?.trim() || 'unknown';
        sample.constructorCounts[constructorName] = (sample.constructorCounts[constructorName] ?? 0) + 1;
        if (!domLike) {
          sample.nonDomConstructorCounts[constructorName] = (
            sample.nonDomConstructorCounts[constructorName] ?? 0
          ) + 1;
        }
      } catch {
        // 元数据读取失败时按非 DOM 对象保守记录，但不影响主采样。
      }
      if (domLike) sample.domLikeCount += 1;
      else sample.nonDomCount += 1;

      try {
        const response = await cdp.send<{
          listeners?: WslEventListenerInfo[];
        }>('DOMDebugger.getEventListeners', { objectId }, sessionId);
        const listeners = response.listeners ?? [];
        sample.listenerCount += listeners.length;
        if (domLike) sample.domListenerCount += listeners.length;
        else sample.nonDomListenerCount += listeners.length;
        for (const listener of listeners) {
          const type = sanitizeDiagnosticEventType(listener.type?.trim() || 'unknown');
          sample.listenerTypeCounts[type] = (sample.listenerTypeCounts[type] ?? 0) + 1;
        }
      } catch {
        // 诊断失败不能影响页面性能采样主流程。
      } finally {
        await cdp.send('Runtime.releaseObject', { objectId }, sessionId).catch(() => undefined);
      }
    }
  } catch {
    // 旧版 CDP 或页面不支持 queryObjects 时返回空样本。
  } finally {
    if (collectionObjectId) {
      await cdp.send('Runtime.releaseObject', { objectId: collectionObjectId }, sessionId).catch(() => undefined);
    }
    if (prototypeObjectId) {
      await cdp.send('Runtime.releaseObject', { objectId: prototypeObjectId }, sessionId).catch(() => undefined);
    }
  }
  return sample;
}

async function sampleRawWslTarget(
  cdp: RawWslCdpConnection,
  targetId: string,
  userDataDir: string,
  sampleMs: number,
  intervalMs: number,
  includeDeepEventDiagnostics: boolean,
  diagnosticPhase: DiagnosticPhase = 'steady',
  includeHeapProfile = false,
  collectGarbage = false,
  includeCpuProfile = false,
  cpuProfileMs = 5_000,
  cpuProfileDelayMs = 3_000,
  serviceWorkerExtensionId?: string,
  includeContentPerformanceDiagnostics = false,
): Promise<{
  samples: WslScenarioSample[];
  heapProfile: WslHeapProfileSummary[] | null;
  cpuProfile: WslCpuProfileSummary[] | null;
}> {
  const attached = await cdp.send<{ sessionId?: string }>('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  if (!attached.sessionId) throw new Error(`CDP 页面目标未返回 sessionId：${targetId}`);
  const sessionId = attached.sessionId;
  await cdp.send('Performance.enable', undefined, sessionId);
  if (collectGarbage) {
    await cdp.send('HeapProfiler.collectGarbage', undefined, sessionId).catch(() => undefined);
  }
  let heapSamplingStarted = false;
  let cpuProfile: WslCpuProfileSummary[] | null = null;
  if (includeCpuProfile) {
    cpuProfile = await collectWslCpuProfile(cdp, sessionId, cpuProfileDelayMs, cpuProfileMs);
  }
  if (includeHeapProfile) {
    try {
      await cdp.send('HeapProfiler.enable', undefined, sessionId);
      await cdp.send('HeapProfiler.startSampling', {
        samplingInterval: 32 * 1024,
        includeObjectsCollectedByMajorGC: false,
        includeObjectsCollectedByMinorGC: false,
      }, sessionId);
      heapSamplingStarted = true;
    } catch {
      // 老版本 Chrome 不支持 HeapProfiler 时不影响普通性能采样。
    }
  }
  const samples: WslScenarioSample[] = [];
  const cpuUsageState: WslCpuUsageState = new Map();
  let heapProfile: WslHeapProfileSummary[] | null = null;
  const startedAt = Date.now();
  try {
    while (Date.now() - startedAt < sampleMs) {
      const target = await waitForRawTarget(cdp, targetId);
      const targets = await cdp.getTargets();
      const [pageSnapshot, processes, cdpProcessInfo, serviceWorkerHeapUsage] = await Promise.all([
        readRawPageSnapshot(
          cdp,
          sessionId,
          target.url,
          includeDeepEventDiagnostics && samples.length === 0,
          includeContentPerformanceDiagnostics,
        ),
        readWslChromeProcesses(userDataDir, cpuUsageState),
        readWslCdpProcessInfo(cdp),
        readRawServiceWorkerHeapUsage(cdp, targets, serviceWorkerExtensionId),
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
        pageCount: targets.filter((candidate) => candidate.type === 'page').length,
        serviceWorkerHeapUsage,
        diagnosticPhase,
      });
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    }
    if (samples.length > 0) {
      const target = await waitForRawTarget(cdp, targetId);
      const finalPageSnapshot = await readRawPageSnapshot(
        cdp,
        sessionId,
        target.url,
        includeDeepEventDiagnostics,
        includeContentPerformanceDiagnostics,
      );
      const lastSample = samples[samples.length - 1];
      if (lastSample) {
        samples[samples.length - 1] = { ...lastSample, page: finalPageSnapshot };
      }
    }
  } finally {
    if (heapSamplingStarted) {
      try {
        const profile = await cdp.send<{
          profile?: { nodes?: WslHeapProfileNode[]; head?: WslHeapProfileNode };
        }>('HeapProfiler.stopSampling', undefined, sessionId);
        heapProfile = summarizeWslHeapProfile(profile.profile);
      } catch {
        heapProfile = null;
      }
      await cdp.send('HeapProfiler.disable', undefined, sessionId).catch(() => undefined);
    }
    await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => undefined);
  }
  return { samples, heapProfile, cpuProfile };
}

async function main(): Promise<void> {
  const port = numberFromEnv('JAVDB_WSL_CDP_PORT', DEFAULT_PORT);
  const sampleMs = numberFromEnv('JAVDB_WSL_SAMPLE_MS', DEFAULT_SAMPLE_MS);
  const intervalMs = Math.max(250, numberFromEnv('JAVDB_WSL_SAMPLE_INTERVAL_MS', DEFAULT_INTERVAL_MS));
  const includeDeepEventDiagnostics = shouldEnableWslDeepDiagnostics(
    process.env.JAVDB_WSL_DEEP_DIAGNOSTICS,
  );
  const includeHeapProfile = shouldEnableWslHeapProfile(process.env.JAVDB_WSL_HEAP_PROFILE);
  const includeCpuProfile = shouldEnableWslHeapProfile(process.env.JAVDB_WSL_CPU_PROFILE);
  const cpuProfileMs = Math.max(1_000, numberFromEnv('JAVDB_WSL_CPU_PROFILE_MS', 5_000));
  const cpuProfileDelayMs = Math.max(0, numberFromEnv('JAVDB_WSL_CPU_PROFILE_DELAY_MS', 3_000));
  const collectGarbage = shouldEnableWslHeapProfile(process.env.JAVDB_WSL_COLLECT_GARBAGE);
  const runCloseRecovery = shouldRunWslCloseRecovery(process.env.JAVDB_WSL_RUN_CLOSE_RECOVERY);
  const forceCloseRecovery = shouldForceWslCloseRecovery(process.env.JAVDB_WSL_FORCE_CLOSE_RECOVERY);
  const touchDashboardLifecycleForDiagnostics = shouldTouchWslDashboardLifecycle(
    process.env.JAVDB_WSL_TOUCH_DASHBOARD_LIFECYCLE,
  );
  const userDataDir = process.env.JAVDB_WSL_USER_DATA_DIR?.trim();
  if (!userDataDir) {
    throw new Error('WSL 性能探针需要 JAVDB_WSL_USER_DATA_DIR，以避免汇总其他测试 Chrome。');
  }
  const cdp = await RawWslCdpConnection.connect(port);
  activeWslCdpConnection = cdp;
  activeWslProbeTargetIds = new Set<string>();
  let targetInfos = await cdp.getTargets();
  let pages = targetInfos.filter((target) => target.type === 'page');
  let serviceWorkerUrls = targetInfos
    .filter((target) => target.type === 'service_worker')
    .map((target) => target.url);
  let pagesUrls = pages.map((page) => page.url);
  const requireExtension = shouldRequireWslExtension(process.env.JAVDB_WSL_REQUIRE_EXTENSION);
  const dashboardHash = parseWslDashboardHash(process.env.JAVDB_WSL_DASHBOARD_HASH);
  const dashboardTabSequence = parseWslDashboardTabSequence(
    process.env.JAVDB_WSL_DASHBOARD_TAB_SEQUENCE,
    dashboardHash,
    Math.max(1, Math.min(20, numberFromEnv('JAVDB_WSL_DASHBOARD_TAB_LOOPS', 1))),
  );
  const initialDashboardHash = dashboardTabSequence[0] ?? dashboardHash;
  const shouldInjectMediaFixture = shouldRequireWslExtension(process.env.JAVDB_WSL_INJECT_MEDIA_FIXTURE);
  const shouldDisableExternalSync = shouldRequireWslExtension(
    process.env.JAVDB_WSL_DISABLE_EXTERNAL_SYNC,
  );
  const shouldClearCloudPending = shouldRequireWslExtension(
    process.env.JAVDB_WSL_CLEAR_CLOUD_PENDING,
  );
  const shouldIsolateSinglePage = shouldRequireWslExtension(
    process.env.JAVDB_WSL_SINGLE_PAGE_ISOLATION,
  );
  const mediaFixtureItemCount = numberFromEnv('JAVDB_WSL_MEDIA_ITEMS', 0);
  const discoveredExtensionId = inferWslExtensionId(serviceWorkerUrls);
  const expectedExtensionId = process.env.JAVDB_WSL_EXTENSION_ID?.trim()
    || discoveredExtensionId
    || DEFAULT_EXTENSION_ID;
  let extensionRuntime: WslExtensionRuntimeInspection | null = null;
  let extensionPageRuntime: WslExtensionPageRuntime | null = null;
  let storageDiagnostics: WslStorageDiagnostics = {};
  let storageCollectionDiagnostics: WslStorageCollectionDiagnostics = summarizeWslStorageCollection({});
  let originStorageUsage: WslOriginStorageUsage = summarizeWslOriginStorageUsage({});
  let heapProfile: WslHeapProfileSummary[] | null = null;
  let cpuProfile: WslCpuProfileSummary[] | null = null;
  let extensionPageTargetId: string | null = null;
  let extensionPageCreatedByProbe = false;
  if (requireExtension) {
    let extensionPageTarget = pages.find((candidate) => (
      candidate.url.startsWith(`chrome-extension://${expectedExtensionId}/`)
      && candidate.url.includes(`/dashboard/dashboard.html${initialDashboardHash}`)
    ));
    if (!extensionPageTarget) {
      const extensionPage = await cdp.send<{ targetId?: string }>('Target.createTarget', {
        url: 'about:blank',
      });
      if (!extensionPage.targetId) throw new Error('无法创建扩展 Dashboard 页面目标。');
      extensionPageCreatedByProbe = true;
      activeWslProbeTargetIds.add(extensionPage.targetId);
      await navigateWslExtensionTarget(
        cdp,
        extensionPage.targetId,
        expectedExtensionId,
        initialDashboardHash,
        true,
      );
      await waitForWslExtensionPage(cdp, extensionPage.targetId, expectedExtensionId, initialDashboardHash);
      targetInfos = await cdp.getTargets();
      pages = targetInfos.filter((target) => target.type === 'page');
      serviceWorkerUrls = targetInfos
        .filter((target) => target.type === 'service_worker')
        .map((target) => target.url);
      pagesUrls = pages.map((page) => page.url);
      extensionPageTarget = pages.find((candidate) => candidate.targetId === extensionPage.targetId);
    }
    if (!extensionPageTarget) {
      throw new Error(`未找到目标扩展 Dashboard 页面。期望扩展 ID：${expectedExtensionId}`);
    }
    extensionPageTargetId = extensionPageTarget.targetId;
    await waitForWslExtensionPage(cdp, extensionPageTarget.targetId, expectedExtensionId, initialDashboardHash);
    await navigateWslExtensionTarget(
      cdp,
      extensionPageTarget.targetId,
      expectedExtensionId,
      initialDashboardHash,
      true,
    );
    if (shouldDisableExternalSync) {
      await disableWslExternalSync(
        cdp,
        extensionPageTarget.targetId,
        shouldClearCloudPending,
      );
      await waitForWslExtensionPage(cdp, extensionPageTarget.targetId, expectedExtensionId, initialDashboardHash);
    }
    await installWslPerformanceProbe(cdp, extensionPageTarget.targetId);
    if (touchDashboardLifecycleForDiagnostics) {
      await touchDashboardLifecycle(cdp, extensionPageTarget.targetId);
    }
    await waitForWslExtensionPage(cdp, extensionPageTarget.targetId, expectedExtensionId, initialDashboardHash);
    extensionPageRuntime = await readRawTargetRuntime(cdp, extensionPageTarget.targetId);
    if (shouldInjectMediaFixture && mediaFixtureItemCount > 0) {
      await injectWslPerformanceMediaFixture(
        cdp,
        extensionPageTarget.targetId,
        buildPerformanceMediaFixture(mediaFixtureItemCount, Date.now()),
      );
      await waitForWslExtensionPage(cdp, extensionPageTarget.targetId, expectedExtensionId, initialDashboardHash);
      await installWslPerformanceProbe(cdp, extensionPageTarget.targetId);
      if (touchDashboardLifecycleForDiagnostics) {
        await touchDashboardLifecycle(cdp, extensionPageTarget.targetId);
      }
      await waitForWslExtensionPage(cdp, extensionPageTarget.targetId, expectedExtensionId, initialDashboardHash);
      extensionPageRuntime = await readRawTargetRuntime(cdp, extensionPageTarget.targetId);
      targetInfos = await cdp.getTargets();
      pages = targetInfos.filter((target) => target.type === 'page');
      serviceWorkerUrls = targetInfos
        .filter((target) => target.type === 'service_worker')
        .map((target) => target.url);
      pagesUrls = pages.map((page) => page.url);
    }
    if (shouldIsolateSinglePage) {
      // 宿主快照可能预先打开了 Dashboard；创建新 target 才能保证每轮都有 initialize 证据。
      const freshTargetId = await createWslBlankTarget(cdp);
      activeWslProbeTargetIds.add(freshTargetId);
      await closeWslPageTargetsExcept(cdp, freshTargetId);
      await navigateWslExtensionTarget(
        cdp,
        freshTargetId,
        expectedExtensionId,
        initialDashboardHash,
        true,
      );
      await installWslPerformanceProbe(cdp, freshTargetId);
      extensionPageTargetId = freshTargetId;
      extensionPageCreatedByProbe = true;
      targetInfos = await cdp.getTargets();
      pages = targetInfos.filter((target) => target.type === 'page');
      serviceWorkerUrls = targetInfos
        .filter((target) => target.type === 'service_worker')
        .map((target) => target.url);
      pagesUrls = pages.map((page) => page.url);
      extensionPageTarget = pages.find((candidate) => candidate.targetId === freshTargetId);
      if (!extensionPageTarget) {
        throw new Error(`无法保留单页隔离用 Dashboard target：${freshTargetId}`);
      }
      if (touchDashboardLifecycleForDiagnostics) {
        await touchDashboardLifecycle(cdp, freshTargetId);
      }
      await waitForWslExtensionPage(cdp, freshTargetId, expectedExtensionId, initialDashboardHash);
      extensionPageRuntime = await readRawTargetRuntime(cdp, freshTargetId);
    }
    if (extensionPageTargetId) {
      const storageInspection = await readWslStorageDiagnostics(cdp, extensionPageTargetId);
      storageDiagnostics = storageInspection.entries;
      storageCollectionDiagnostics = storageInspection.collection;
      originStorageUsage = storageInspection.origin;
    }
    const mergedRuntimeUrls = mergeWslExtensionRuntimeUrls(pagesUrls, serviceWorkerUrls, targetInfos);
    extensionRuntime = inspectWslExtensionRuntime({
      expectedExtensionId,
      pageUrls: mergedRuntimeUrls.pageUrls,
      serviceWorkerUrls: mergedRuntimeUrls.serviceWorkerUrls,
      allowMissingServiceWorker: true,
      pageRuntime: extensionPageRuntime,
    });
    if (!extensionRuntime.ok) {
      throw new Error(`${extensionRuntime.reason} 期望扩展 ID：${expectedExtensionId}`);
    }
  }
  if (pages.length === 0) {
    throw new Error('CDP 浏览器中没有可采样的 BrowserContext。');
  }

  const sourceUrl = process.env.JAVDB_WSL_SOURCE_URL?.trim();
  const includeContentPerformanceDiagnostics = shouldEnableWslDeepDiagnostics(
    process.env.JAVDB_WSL_CONTENT_DIAGNOSTICS,
  );
  const effectiveSourceUrl = sourceUrl && includeContentPerformanceDiagnostics
    ? appendContentPerformanceDiagnosticQuery(sourceUrl)
    : sourceUrl;
  const sourceFixtureMode = shouldEnableWslDeepDiagnostics(process.env.JAVDB_WSL_SOURCE_FIXTURE);
  const sourceFixtureExpectedItemCount = Math.max(1, numberFromEnv('JAVDB_WSL_SOURCE_FIXTURE_ITEMS', 240));
  const sourceContentProfile = parseWslContentSettingsProfile(process.env.JAVDB_WSL_SOURCE_CONTENT_PROFILE);
  const tabCounts = effectiveSourceUrl ? parseWslTabCounts(process.env.JAVDB_WSL_SOURCE_TAB_COUNTS) : [1];
  const scenarios: Array<{ name: string; tabCount: number; samples: WslScenarioSample[] }> = [];
  let sourceFixtureInspection: { fixtureLoaded: boolean; itemCount: number; extensionInjected: boolean } | null = null;
  if (effectiveSourceUrl && sourceFixtureMode && requireExtension && extensionPageTargetId) {
    await configureWslSourceContentSettings(cdp, extensionPageTargetId, sourceContentProfile);
  }
  const scenarioRuns = effectiveSourceUrl
    ? tabCounts.map((tabCount) => ({ tabCount, dashboardHash: null as string | null }))
    : dashboardTabSequence.map((hash) => ({ tabCount: 1, dashboardHash: hash }));
  for (const scenarioRun of scenarioRuns) {
    const tabCount = scenarioRun.tabCount;
    const createdTargetIds: string[] = [];
    try {
      let scenarioTargetId: string | undefined;
      if (effectiveSourceUrl) {
        for (let index = 0; index < tabCount; index += 1) {
          const sourceTarget = await cdp.send<{ targetId?: string }>('Target.createTarget', {
            url: effectiveSourceUrl,
          });
          if (!sourceTarget.targetId) throw new Error('无法创建源站页面目标。');
          createdTargetIds.push(sourceTarget.targetId);
          activeWslProbeTargetIds?.add(sourceTarget.targetId);
          await waitForRawTarget(cdp, sourceTarget.targetId);
          if (!scenarioTargetId) scenarioTargetId = sourceTarget.targetId;
        }
        if (sourceFixtureMode && requireExtension && extensionPageTargetId) {
          await configureWslSourceContentSettings(cdp, extensionPageTargetId, sourceContentProfile);
          for (const targetId of createdTargetIds) {
            const attached = await cdp.send<{ sessionId?: string }>('Target.attachToTarget', {
              targetId,
              flatten: true,
            });
            if (!attached.sessionId) throw new Error(`无法重新导航源站 fixture：${targetId}`);
            try {
              await cdp.send('Page.navigate', { url: effectiveSourceUrl }, attached.sessionId);
            } finally {
              await cdp.send('Target.detachFromTarget', { sessionId: attached.sessionId }).catch(() => undefined);
            }
            await waitForRawTarget(cdp, targetId);
          }
        }
      } else {
        const candidatePages = requireExtension
          ? pages.filter((candidate) => candidate.url.startsWith(`chrome-extension://${expectedExtensionId}/`))
          : pages;
        const pageIndex = selectWslPageIndex(candidatePages.map((candidate) => candidate.url));
        scenarioTargetId = pageIndex >= 0 ? candidatePages[pageIndex]?.targetId : undefined;
        const dashboardHash = scenarioRun.dashboardHash;
        if (scenarioTargetId && dashboardHash !== null
          && shouldNavigateWslDashboardTarget(requireExtension, dashboardHash)) {
          await navigateWslExtensionTarget(
            cdp,
            scenarioTargetId,
            expectedExtensionId,
            dashboardHash,
          );
        }
      }
      if (!scenarioTargetId) {
        throw new Error('CDP 浏览器中没有可采样的页面。请提供 JAVDB_WSL_SOURCE_URL 或先打开测试页面。');
      }
      const sampleResult = await sampleRawWslTarget(
        cdp,
        scenarioTargetId,
        userDataDir,
        sampleMs,
        intervalMs,
        includeDeepEventDiagnostics,
        'steady',
        includeHeapProfile && scenarios.length === 0,
        collectGarbage,
        includeCpuProfile && scenarios.length === 0,
        cpuProfileMs,
        cpuProfileDelayMs,
        requireExtension ? expectedExtensionId : undefined,
        includeContentPerformanceDiagnostics,
      );
      const samples = sampleResult.samples;
      if (sourceFixtureMode) {
        const latestPage = samples.at(-1)?.page ?? {};
        const inspection = inspectWslSourceFixtureSnapshot(latestPage, {
          expectedItemCount: sourceFixtureExpectedItemCount,
          requireExtension,
        });
        sourceFixtureInspection = {
          fixtureLoaded: inspection.reason !== 'source-fixture-not-loaded',
          itemCount: typeof latestPage.sourceFixtureItemCount === 'number'
            ? latestPage.sourceFixtureItemCount
            : 0,
          extensionInjected: latestPage.extensionInjected === true,
        };
        if (!inspection.ok) {
          throw new Error(`源站性能 fixture 无法形成有效证据：${inspection.reason}；页面=${JSON.stringify({
            url: latestPage.url,
            readyState: latestPage.readyState,
            marker: latestPage.sourceFixtureMarker,
            itemCount: latestPage.sourceFixtureItemCount,
            extensionInjected: latestPage.extensionInjected,
          })}`);
        }
      }
      if (!heapProfile && sampleResult.heapProfile) heapProfile = sampleResult.heapProfile;
      if (!cpuProfile && sampleResult.cpuProfile) cpuProfile = sampleResult.cpuProfile;
      scenarios.push({
        name: process.env.JAVDB_WSL_SCENARIO_ID?.trim()
          || (effectiveSourceUrl
            ? buildWslScenarioName('wsl-javdb-source', tabCount)
            : `wsl-javdb-dashboard-${scenarioRun.dashboardHash?.slice(1) ?? 'tab-home'}`),
        tabCount,
        samples,
      });
    } finally {
      await closeWslProbeTargets(cdp, createdTargetIds, activeWslProbeTargetIds);
    }
  }

  if (
    runCloseRecovery
    && requireExtension
    && !effectiveSourceUrl
    && extensionPageTargetId
    && (extensionPageCreatedByProbe || forceCloseRecovery)
  ) {
    const keepAliveTarget = await cdp.send<{ targetId?: string }>('Target.createTarget', {
      url: 'about:blank',
    });
    if (!keepAliveTarget.targetId) throw new Error('无法创建关闭回落保活页面。');
    const keepAliveTargetId = keepAliveTarget.targetId;
    activeWslProbeTargetIds.add(keepAliveTargetId);
    let recoveryTargetId: string | null = null;
    try {
      recoveryTargetId = await ensureWslExtensionTargetForCloseRecovery(
        cdp,
        extensionPageTargetId,
        expectedExtensionId,
        dashboardTabSequence[dashboardTabSequence.length - 1] ?? dashboardHash,
      );
      await waitForRawTarget(cdp, keepAliveTargetId);
      let pagehideSnapshot: Record<string, unknown>;
      try {
        pagehideSnapshot = await dispatchDashboardPagehideAndReadSnapshot(cdp, recoveryTargetId);
      } catch (error) {
        if (!isMissingWslTargetError(error)) throw error;
        recoveryTargetId = await createWslExtensionTargetForCloseRecovery(
          cdp,
          expectedExtensionId,
          dashboardTabSequence[dashboardTabSequence.length - 1] ?? dashboardHash,
        );
        pagehideSnapshot = await dispatchDashboardPagehideAndReadSnapshot(cdp, recoveryTargetId);
      }
      const closeCpuUsageState: WslCpuUsageState = new Map();
      const processes = await readWslChromeProcesses(userDataDir, closeCpuUsageState);
      const targets = await cdp.getTargets();
      const cdpProcessInfo = await readWslCdpProcessInfo(cdp);
      const serviceWorkerHeapUsage = await readRawServiceWorkerHeapUsage(
        cdp,
        targets,
        expectedExtensionId,
      );
      const closeSample: WslScenarioSample = {
        at: Date.now(),
        page: pagehideSnapshot,
        processes,
        processSummary: summarizeWslChromeProcesses(processes),
        processSummaryByCategory: summarizeWslChromeProcessesByCategory(processes),
        processSummaryByRole: summarizeWslChromeProcessesByRole(processes),
        cdpProcessInfo,
        targetSummary: summarizeWslTargetInfos(targets),
        pageCount: targets.filter((candidate) => candidate.type === 'page').length,
        serviceWorkerHeapUsage,
        diagnosticPhase: 'steady',
      };
      const cooldownResult = await sampleRawWslTarget(
        cdp,
        keepAliveTargetId,
        userDataDir,
        Math.max(1_000, numberFromEnv('JAVDB_WSL_CLOSE_COOLDOWN_MS', 5_000)),
        intervalMs,
        false,
        'cooldown',
        false,
        false,
        false,
        5_000,
        3_000,
        expectedExtensionId,
      );
      scenarios.push({
        name: 'wsl-javdb-dashboard-close-recovery',
        tabCount: 0,
        samples: [closeSample, ...cooldownResult.samples],
      });
    } finally {
      const recoveryTargetIds = [recoveryTargetId, keepAliveTargetId];
      await closeWslProbeTargets(cdp, recoveryTargetIds, activeWslProbeTargetIds);
    }
  }

  const firstScenario = scenarios[0];
  if (!firstScenario) {
    throw new Error('没有生成可采样的 WSL 场景。');
  }

  const diagnostic = buildWslDiagnosticSnapshot(
    firstScenario.name,
    scenarios.flatMap((scenario) => scenario.samples)
      .map((sample) => ({
        at: sample.at,
        phase: sample.diagnosticPhase,
        page: sample.page,
        processSummary: sample.processSummary,
        processSummaryByCategory: sample.processSummaryByCategory,
        processSummaryByRole: sample.processSummaryByRole,
      })),
  );
  const report = {
    version: 2,
    capturedAt: Date.now(),
    browser: (await cdp.send<{ product?: string }>('Browser.getVersion')).product ?? 'unknown',
    cdpPort: port,
    extensionId: requireExtension ? expectedExtensionId : null,
    extensionRuntime,
    extensionPageRuntime: extensionPageRuntime
      ? {
        url: extensionPageRuntime.url,
        domNodes: extensionPageRuntime.domNodes ?? null,
        appRootMounted: extensionPageRuntime.appRootMounted === true,
      }
      : null,
    storageDiagnostics,
    storageCollectionDiagnostics,
    originStorageUsage,
    heapProfile,
    cpuProfile,
    dashboardHash,
    mediaFixture: {
      enabled: shouldInjectMediaFixture && mediaFixtureItemCount > 0,
      itemCount: shouldInjectMediaFixture ? mediaFixtureItemCount : 0,
    },
    sourceFixture: sourceFixtureInspection,
    contentPerformanceDiagnosticsEnabled: includeContentPerformanceDiagnostics,
    sampleMs,
    intervalMs,
    deepEventDiagnostics: includeDeepEventDiagnostics,
    heapProfileEnabled: includeHeapProfile,
    cpuProfileEnabled: includeCpuProfile,
    userDataDir,
    diagnostic,
    scenarios,
  };
  const reportDir = path.resolve(process.env.JAVDB_WSL_REPORT_DIR ?? 'test-results/performance/wsl-cdp');
  await fs.mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `wsl-cdp-${report.capturedAt}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  const allSamples = scenarios.flatMap((scenario) => scenario.samples);
  const peak = allSamples.reduce((current, sample) => Math.max(current, sample.processSummary.rssKb), 0);
  const peakCpu = allSamples.reduce((current, sample) => Math.max(current, sample.processSummary.cpuPercent), 0);
  console.log(JSON.stringify({ reportPath, browser: report.browser, scenarios: scenarios.length, samples: allSamples.length, peakRssMb: Math.round(peak / 1024), peakCpuPercent: peakCpu }, null, 2));
  await closeWslProbeTargetsWithRetry(
    cdp,
    [...(activeWslProbeTargetIds ?? [])],
    activeWslProbeTargetIds,
  );
  await cdp.close();
  activeWslProbeTargetIds?.clear();
  activeWslProbeTargetIds = null;
  activeWslCdpConnection = null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(async (error: unknown) => {
    if (activeWslCdpConnection && activeWslProbeTargetIds) {
      await closeWslProbeTargetsWithRetry(
        activeWslCdpConnection,
        [...activeWslProbeTargetIds],
        activeWslProbeTargetIds,
      );
      activeWslProbeTargetIds.clear();
    }
    await activeWslCdpConnection?.close().catch(() => undefined);
    activeWslProbeTargetIds = null;
    activeWslCdpConnection = null;
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
