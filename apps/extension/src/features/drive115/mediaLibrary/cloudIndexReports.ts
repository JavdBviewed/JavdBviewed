import { queueLocalIndexReport, reconcileLocalIndexSources } from '../../cloudSync/indexReportOutbox';
import type { Drive115MediaLibraryRoot, Drive115SourceReport } from './types';

function accountId(settings: unknown): string | null {
  const user = (settings as { drive115?: { v2UserInfo?: { user_id?: unknown; uid?: unknown; id?: unknown } } } | null)?.drive115?.v2UserInfo;
  const id = String(user?.user_id ?? user?.uid ?? user?.id ?? '').trim();
  return /^\d{1,32}$/.test(id) && id !== '0' ? id : null;
}

export function drive115IndexSourceId(settings: unknown, rootCid: string): string | null {
  const account = accountId(settings);
  return account && /^\d{1,32}$/.test(rootCid) ? `uid:${account}:root:${rootCid}` : null;
}

export async function reconcileDrive115IndexSources(
  settings: unknown,
  roots: Drive115MediaLibraryRoot[],
  reconcile: typeof reconcileLocalIndexSources = reconcileLocalIndexSources,
): Promise<void> {
  if (!accountId(settings)) return;
  const sources = roots.filter((root) => root.enabled !== false).map((root) => drive115IndexSourceId(settings, root.cid)).filter((id): id is string => id !== null);
  await reconcile('drive115', sources);
}

export async function queueDrive115SourceReports(
  settings: unknown,
  reports: Drive115SourceReport[],
  queue: typeof queueLocalIndexReport = queueLocalIndexReport,
): Promise<void> {
  for (const report of reports) {
    const sourceId = drive115IndexSourceId(settings, report.rootCid);
    if (!sourceId || (!report.complete && report.entries.length === 0)) continue;
    await queue({ kind: 'drive115', sourceId, entries: report.entries.map((data) => ({ code: data.code, data })), complete: report.complete });
  }
}
