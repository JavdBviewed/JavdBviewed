import { CROSSLINE_DISMISS_MS, CROSSLINE_SUPPRESSION_KEY, crosslineScopeKey, type CrosslineSuppression } from './crosslinePromptPolicy';
const probes = new Map<string, number>();
export function isCrosslineProbeActive(host: string, storeId: string): boolean {
  return (probes.get(crosslineScopeKey(storeId, host)) || 0) > 0;
}
export async function withCrosslineProbeGuard<T>(hosts: string[], storeId: string, action: () => Promise<T>): Promise<T> {
  const keys = [...new Set(hosts)].map(host => crosslineScopeKey(storeId, host));
  for (const key of keys) probes.set(key, (probes.get(key) || 0) + 1);
  try { return await action(); }
  finally {
    // Cookie notifications from the response are dispatched asynchronously.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    for (const key of keys) {
      const count = (probes.get(key) || 1) - 1;
      if (count) probes.set(key, count); else probes.delete(key);
    }
  }
}
export async function readCrosslineStorage(area: 'local' | 'session', key: string): Promise<unknown> {
  const nativeSession = area === 'session' && !!chrome.storage.session;
  const storage = area === 'local' || !nativeSession ? chrome.storage.local : chrome.storage.session;
  const result = await new Promise<unknown>((resolve, reject) => storage.get(key, data => {
    if (chrome.runtime.lastError) reject(new Error('读取登录提示状态失败'));
    else resolve(data[key]);
  }));
  if (area === 'session' && !nativeSession) {
    const fallback = result as { until?: number; value?: unknown } | undefined;
    return fallback?.until && fallback.until > Date.now() ? fallback.value : undefined;
  }
  return result;
}
export async function writeCrosslineStorage(area: 'local' | 'session', key: string, value: unknown): Promise<void> {
  const nativeSession = area === 'session' && !!chrome.storage.session;
  const storage = area === 'local' || !nativeSession ? chrome.storage.local : chrome.storage.session;
  const stored = area === 'session' && !nativeSession ? { until: Date.now() + CROSSLINE_DISMISS_MS, value } : value;
  await new Promise<void>((resolve, reject) => storage.set({ [key]: stored }, () => {
    if (chrome.runtime.lastError) reject(new Error('保存登录提示状态失败')); else resolve();
  }));
}
export async function isCrosslineLogoutSuppressed(host: string, storeId: string): Promise<boolean> {
  const items = await readCrosslineStorage('local', CROSSLINE_SUPPRESSION_KEY) as CrosslineSuppression | undefined;
  const item = items?.[crosslineScopeKey(storeId, host)];
  return item?.reason === 'logout' && item.until > Date.now();
}
