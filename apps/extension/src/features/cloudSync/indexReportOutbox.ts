/** Local scanner observations only. Pulled aggregate indexes never enter this outbox. */
import {
  createIndexReportPages,
  discoverIndexReports,
  SyncHttpError,
  type IndexReportApi,
  type IndexReportCapabilities,
  type IndexReportKind,
  type IndexReportPage,
  type IndexReportRequestOptions,
  type LocalIndexReport,
} from '@javdb/sync-client';
import { loadCloudSettings } from './cloudSettingsStorage';
import { loadCloudSession } from './chromeTokenStore';

const OUTBOX_PREFIX = 'cloud_index_report_outbox_v1:';
const SOURCE_PREFIX = 'cloud_index_report_sources_v1:';
const CAPABILITY_KEY = 'cloud_index_report_capabilities_v1';
export const INDEX_REPORT_FAILURE_MESSAGE = '媒体索引报告尚未上传，将在下次同步重试';
export const INDEX_REPORT_TERMINATED_MESSAGE = '媒体索引报告已失效，请重新扫描';
class TerminatedIndexReport extends Error {}
const SAVE_FAILURE_MESSAGE = '媒体索引报告保存失败，请重试';

type ReportJob = {
  id: string;
  operation: 'report' | 'retire';
  requestId: string;
  pages: IndexReportPage[];
  prepared?: boolean;
  runId?: string;
  nextPage: number;
  error?: string;
  terminated?: boolean;
};
type SourceQueue = {
  version: 1;
  identity: string;
  kind: IndexReportKind;
  sourceId: string;
  jobs: ReportJob[];
};
type RegisteredSource = Pick<SourceQueue, 'identity' | 'kind' | 'sourceId'> & { active: boolean; reportReady: boolean };
type CapabilityState = { identity: string; kinds: IndexReportKind[]; status?: 'unknown' | 'supported' | 'unsupported' };
export type IndexReportFlushResult = { supported: boolean | null; failed: number; terminated?: number };

const locks = new Map<string, Promise<unknown>>();

/** Same serialization convention as pending mutations, plus cross-context Web Locks. */
async function serialized<T>(name: string, work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(name, { mode: 'exclusive' }, work);
  }
  const previous = locks.get(name) ?? Promise.resolve();
  const current = previous.then(work, work);
  const settled = current.then(() => undefined, () => undefined);
  locks.set(name, settled);
  void settled.then(() => { if (locks.get(name) === settled) locks.delete(name); });
  return current;
}

/** Store structured JSON values, just like chromePendingStore; never stringify twice. */
function readStorage(keys: string[] | null): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.get(keys, (values) => {
        if (chrome.runtime?.lastError) reject(new Error(SAVE_FAILURE_MESSAGE));
        else resolve(values ?? {});
      });
    } catch { reject(new Error(SAVE_FAILURE_MESSAGE)); }
  });
}

function writeStorage(key: string, value: unknown, extra: Record<string, unknown> = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      if (chrome.runtime?.lastError) reject(new Error(SAVE_FAILURE_MESSAGE));
      else resolve();
    };
    try {
      if (value === undefined) chrome.storage.local.remove([key], done);
      else chrome.storage.local.set({ [key]: value, ...extra }, done);
    } catch { reject(new Error(SAVE_FAILURE_MESSAGE)); }
  });
}

async function currentIdentity(): Promise<string | null> {
  const [settings, session] = await Promise.all([loadCloudSettings(), loadCloudSession()]);
  const producer = session?.deviceId || settings.deviceId;
  if (!session?.accessToken || !session.userId || !producer || !settings.baseUrl) return null;
  const url = new URL(settings.baseUrl);
  // Credentials are not part of an outbox namespace.
  return JSON.stringify([
    `${url.origin}${url.pathname.replace(/\/+$/, '')}`,
    settings.accountIdentifier || '', session.userId, producer,
  ]);
}

function normalizeSource(kind: IndexReportKind, sourceId: string): string {
  if (kind !== 'emby' && kind !== 'drive115') throw new Error('媒体索引报告来源无效');
  const source = sourceId.trim();
  if (!source || /[\u0000-\u001f]/.test(source)) throw new Error('媒体索引报告来源无效');
  if (kind === 'drive115') return source;
  try {
    const url = new URL(source);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch { throw new Error('媒体索引报告来源无效'); }
}

function newId(): string {
  return crypto.randomUUID();
}

async function appendJob(kind: IndexReportKind, sourceId: string, job: ReportJob, expectedIdentity?: string): Promise<void> {
  const identity = await currentIdentity();
  if (expectedIdentity && identity !== expectedIdentity) return;
  if (!identity) return;
  const key = `${OUTBOX_PREFIX}${encodeURIComponent(JSON.stringify([identity, kind, sourceId]))}`;
  await serialized(key, async () => {
    const registryKey = key.replace(OUTBOX_PREFIX, SOURCE_PREFIX);
    const stored = await readStorage([key, registryKey]);
    const previous = stored[key] as SourceQueue | undefined;
    const registered = stored[registryKey] as RegisteredSource | undefined;
    if (job.operation === 'retire' && registered?.active === false) return;
    const queue: SourceQueue = previous ?? { version: 1, identity, kind, sourceId, jobs: [] };
    const existing = queue.jobs.find((item) => item.requestId === job.requestId);
    if (existing) {
      if (existing.terminated) throw new Error(INDEX_REPORT_TERMINATED_MESSAGE);
      if (existing.operation !== job.operation || JSON.stringify(existing.pages.flatMap((p) => p.entries)) !== JSON.stringify(job.pages.flatMap((p) => p.entries))
        || existing.pages.at(-1)?.complete !== job.pages.at(-1)?.complete) throw new Error('媒体索引报告扫描 ID 已被使用');
      return;
    }
    queue.jobs.push(job);
    await writeStorage(key, queue, {
      [registryKey]: {
        identity, kind, sourceId, active: job.operation === 'report',
        reportReady: job.operation === 'report' || registered?.reportReady === true,
      } satisfies RegisteredSource,
    });
  });
}

/** Scanner boundary: call before merging cached or Cloud aggregate observations. */
export async function queueLocalIndexReport(input: LocalIndexReport): Promise<void> {
  const sourceId = normalizeSource(input.kind, input.sourceId);
  const requestId = input.requestId ?? newId();
  if (!requestId.trim() || new TextEncoder().encode(requestId).length > 128) throw new Error('媒体索引报告扫描 ID 无效');
  const pages = createIndexReportPages({ ...input, sourceId });
  await appendJob(input.kind, sourceId, { id: newId(), operation: 'report', requestId, pages, nextPage: 0 });
}

export async function queueIndexSourceRetirement(kind: IndexReportKind, sourceId: string): Promise<void> {
  await appendJob(kind, normalizeSource(kind, sourceId), {
    id: newId(), operation: 'retire', requestId: newId(), pages: [], nextPage: 0,
  });
}

/** Configured local sources only; offline sources must remain in activeSourceIds. */
export async function reconcileLocalIndexSources(kind: IndexReportKind, activeSourceIds: string[]): Promise<void> {
  const identity = await currentIdentity();
  if (!identity) return;
  const active = new Set(activeSourceIds.map((source) => normalizeSource(kind, source)));
  const stored = await readStorage(null);
  for (const [key, value] of Object.entries(stored)) {
    if (!key.startsWith(SOURCE_PREFIX)) continue;
    const source = value as RegisteredSource;
    if (source.identity !== identity || source.kind !== kind || !source.active || active.has(source.sourceId)) continue;
    await appendJob(kind, source.sourceId, {
      id: newId(), operation: 'retire', requestId: newId(), pages: [], nextPage: 0,
    }, identity);
  }
}

export async function getIndexReportKinds(): Promise<IndexReportKind[]> {
  const identity = await currentIdentity();
  if (!identity) return [];
  return serialized(CAPABILITY_KEY, async () => {
    const stored = await readStorage(null);
    const state = stored[CAPABILITY_KEY] as CapabilityState | undefined;
    const ready = new Set<IndexReportKind>();
    for (const [key, value] of Object.entries(stored)) {
      if (!key.startsWith(SOURCE_PREFIX)) continue;
      const source = value as RegisteredSource;
      if (source.identity === identity && source.reportReady) ready.add(source.kind);
    }
    if (state?.identity === identity && state.status !== 'unknown') {
      return state.kinds.filter((kind) => ready.has(kind));
    }
    if (state && state.identity !== identity) await writeStorage(CAPABILITY_KEY, undefined);
    // Unknown/transient discovery failures must never turn local report sources back into aggregate echoes.
    return [...ready];
  });
}

/** Re-read under the mutation lock after every upload await. Never save an old queue snapshot. */
async function updateJob(key: string, id: string, patch: Partial<ReportJob> | null): Promise<void> {
  await serialized(key, async () => {
    const queue = (await readStorage([key]))[key] as SourceQueue | undefined;
    if (!queue) return;
    queue.jobs = queue.jobs.flatMap((job) => job.id !== id ? [job] : patch === null ? [] : [{ ...job, ...patch }]);
    await writeStorage(key, queue.jobs.length ? queue : undefined);
  });
}

async function requireIdentity(identity: string): Promise<void> {
  if (await currentIdentity() !== identity) throw new Error(INDEX_REPORT_FAILURE_MESSAGE);
}

function checkReportCancellation(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('同步已取消', 'AbortError');
}

async function checkReportRequest(identity: string, options: IndexReportRequestOptions): Promise<void> {
  checkReportCancellation(options.signal);
  await requireIdentity(identity);
  checkReportCancellation(options.signal);
}

async function uploadJob(
  api: Required<IndexReportApi>, capabilities: IndexReportCapabilities, key: string, queue: SourceQueue, job: ReportJob, options: IndexReportRequestOptions,
): Promise<void> {
  const { kind, sourceId, identity } = queue;
  await checkReportRequest(identity, options);
  if (job.operation === 'retire') {
    const result = await api.retireIndexSource({ kind, sourceId }, options);
    if (!result.retired) throw new Error(INDEX_REPORT_FAILURE_MESSAGE);
    await updateJob(key, job.id, null);
    return;
  }
  if (!job.prepared) {
    job.pages = createIndexReportPages({
      kind, sourceId, entries: job.pages.flatMap((page) => page.entries), complete: job.pages.at(-1)?.complete === true,
    }, capabilities);
    job.prepared = true;
    await updateJob(key, job.id, { pages: job.pages, prepared: true });
  }
  if (!job.runId) {
    await checkReportRequest(identity, options);
    const result = await api.startIndexReport({ kind, sourceId, requestId: job.requestId }, options).catch((error: unknown) => {
      if (error instanceof SyncHttpError && error.status === 409) throw new TerminatedIndexReport(INDEX_REPORT_TERMINATED_MESSAGE);
      throw error;
    });
    if (!result.runId) throw new Error(INDEX_REPORT_FAILURE_MESSAGE);
    if (result.published || result.superseded) {
      await updateJob(key, job.id, null);
      return;
    }
    job.runId = result.runId;
    await updateJob(key, job.id, { runId: job.runId });
  }
  for (let page = job.nextPage; page < job.pages.length; page++) {
    await checkReportRequest(identity, options);
    const result = await api.putIndexReport(job.runId, job.pages[page], options).catch((error: unknown) => {
      if (error instanceof SyncHttpError && error.status === 404) throw new TerminatedIndexReport(INDEX_REPORT_TERMINATED_MESSAGE);
      throw error;
    });
    if (job.pages[page].final && !result.published && !result.superseded) throw new Error(INDEX_REPORT_FAILURE_MESSAGE);
    await updateJob(key, job.id, job.pages[page].final ? null : { nextPage: page + 1, error: undefined });
  }
}

/** Missing optional methods preserve old clients and existing test doubles. */
export async function flushIndexReportOutbox(api: IndexReportApi, flushOptions: { signal?: AbortSignal } = {}): Promise<IndexReportFlushResult> {
  checkReportCancellation(flushOptions.signal);
  if (typeof api.getIndexReportCapabilities !== 'function' || typeof api.startIndexReport !== 'function'
    || typeof api.putIndexReport !== 'function' || typeof api.retireIndexSource !== 'function') {
    // Legacy API objects must work even without a browser/session (existing adapters and tests).
    try {
      const identity = await currentIdentity();
      if (identity) await serialized(CAPABILITY_KEY, () => writeStorage(CAPABILITY_KEY, { identity, kinds: [], status: 'unsupported' }));
    } catch { /* No report state to use in this legacy context. */ }
    return { supported: false, failed: 0 };
  }
  return serialized('cloud-index-reports-flush', async () => {
    checkReportCancellation(flushOptions.signal);
    let supported: boolean | null = null;
    try {
      const identity = await currentIdentity();
      checkReportCancellation(flushOptions.signal);
      if (!identity) return { supported: false, failed: 0 };
      const options: IndexReportRequestOptions = {
        signal: flushOptions.signal,
        auth: { baseUrl: (JSON.parse(identity) as string[])[0], assertCurrent: () => requireIdentity(identity) },
      };
      await serialized(CAPABILITY_KEY, () => writeStorage(CAPABILITY_KEY, { identity, kinds: [], status: 'unknown' }));
      await checkReportRequest(identity, options);
      const capabilities = await discoverIndexReports(api, options);
      await checkReportRequest(identity, options);
      await serialized(CAPABILITY_KEY, () => writeStorage(CAPABILITY_KEY, { identity, kinds: capabilities?.kinds ?? [], status: capabilities ? 'supported' : 'unsupported' }));
      if (!capabilities) return { supported: false, failed: 0 };
      supported = true;
      const all = await readStorage(null);
      let failed = 0;
      let terminated = 0;
      for (const [key, value] of Object.entries(all)) {
        if (!key.startsWith(OUTBOX_PREFIX)) continue;
        const queue = value as SourceQueue;
        if (queue.identity !== identity || !capabilities.kinds.includes(queue.kind)) continue;
        // A bounded snapshot: reports arriving during this flush stay queued for the next sync.
        for (const job of queue.jobs) {
          checkReportCancellation(flushOptions.signal);
          if (job.terminated) { failed++; terminated++; continue; }
          try {
            await uploadJob(api as Required<IndexReportApi>, capabilities, key, queue, job, options);
          } catch (error) {
            checkReportCancellation(flushOptions.signal);
            if (error instanceof Error && error.name === 'AbortError') throw error;
            failed++;
            if (error instanceof TerminatedIndexReport) {
              terminated++;
              await updateJob(key, job.id, { terminated: true, pages: [], error: INDEX_REPORT_TERMINATED_MESSAGE });
              continue;
            }
            await updateJob(key, job.id, { error: INDEX_REPORT_FAILURE_MESSAGE });
            break; // Preserve report/retirement ordering within this source.
          }
        }
      }
      return { supported, failed, terminated };
    } catch (error) {
      checkReportCancellation(flushOptions.signal);
      if (error instanceof Error && error.name === 'AbortError') throw error;
      return { supported, failed: 1 };
    }
  });
}
