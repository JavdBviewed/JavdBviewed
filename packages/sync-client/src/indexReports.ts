import { SyncHttpError } from './fetchTransport';
import type { IndexReportApi, IndexReportCapabilities, IndexReportPage, IndexReportRequestOptions, LocalIndexReport } from './types';

const MAX_PAGE_ENTRIES = 500;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_SCAN_ENTRIES = 100_000;
const MAX_SCAN_PAGES = 2_000;
const encoder = new TextEncoder();

export function hasIndexReportApi(api: IndexReportApi): api is Required<IndexReportApi> {
  return typeof api.getIndexReportCapabilities === 'function'
    && typeof api.startIndexReport === 'function'
    && typeof api.putIndexReport === 'function'
    && typeof api.retireIndexSource === 'function';
}

export async function discoverIndexReports(api: IndexReportApi, options?: IndexReportRequestOptions): Promise<IndexReportCapabilities | null> {
  if (!hasIndexReportApi(api)) return null;
  let capabilities: IndexReportCapabilities;
  try {
    capabilities = await api.getIndexReportCapabilities(options);
  } catch (error) {
    if (error instanceof SyncHttpError && error.status === 404) return null;
    throw error;
  }
  if (capabilities.version !== 1 || !Array.isArray(capabilities.kinds)
    || !Number.isInteger(capabilities.maxPageEntries) || capabilities.maxPageEntries <= 0
    || !Number.isInteger(capabilities.maxPageBytes) || capabilities.maxPageBytes <= 0) {
    throw new Error('索引报告能力无效');
  }
  return {
    ...capabilities,
    kinds: capabilities.kinds.filter((kind) => kind === 'emby' || kind === 'drive115'),
    maxPageEntries: Math.min(capabilities.maxPageEntries, MAX_PAGE_ENTRIES),
    maxPageBytes: Math.min(capabilities.maxPageBytes, MAX_PAGE_BYTES),
  };
}

/** Freeze JSON now, so retry bodies cannot change when a scanner mutates its result. */
export function createIndexReportPages(
  input: LocalIndexReport,
  limits: Pick<IndexReportCapabilities, 'maxPageEntries' | 'maxPageBytes'> = {
    maxPageEntries: MAX_PAGE_ENTRIES, maxPageBytes: MAX_PAGE_BYTES,
  },
): IndexReportPage[] {
  const maxEntries = Math.min(limits.maxPageEntries, MAX_PAGE_ENTRIES);
  const maxBytes = Math.min(limits.maxPageBytes, MAX_PAGE_BYTES);
  if (!Number.isInteger(maxEntries) || maxEntries <= 0 || !Number.isInteger(maxBytes) || maxBytes <= 0
    || input.entries.length > MAX_SCAN_ENTRIES) throw new Error('索引报告超过上限');
  const { kind, sourceId, complete } = input;
  const entries = JSON.parse(JSON.stringify(input.entries)) as LocalIndexReport['entries'];
  const pages: IndexReportPage[] = [];
  let offset = 0;
  do {
    const page: IndexReportPage = { kind, sourceId, page: pages.length, final: false, entries: [] };
    // Reserve the larger of final and nonfinal envelopes (including complete=false).
    const baseBytes = Math.max(
      encoder.encode(JSON.stringify(page)).length,
      encoder.encode(JSON.stringify({ ...page, final: true, complete })).length,
    );
    let bytes = baseBytes;
    if (bytes > maxBytes) throw new Error('索引报告超过上限');
    while (offset < entries.length && page.entries.length < maxEntries) {
      const entryBytes = encoder.encode(JSON.stringify(entries[offset])).length + (page.entries.length ? 1 : 0);
      if (bytes + entryBytes > maxBytes) break;
      page.entries.push(entries[offset++]);
      bytes += entryBytes;
    }
    if (!page.entries.length && offset < entries.length) throw new Error('索引报告单项超过上限');
    pages.push(page);
    if (pages.length > MAX_SCAN_PAGES) throw new Error('索引报告超过上限');
  } while (offset < entries.length);
  const final = pages[pages.length - 1];
  final.final = true;
  final.complete = complete;
  return pages;
}
