import type { CrosslinePageContext, CrosslinePageResponse } from '../../shared/protocols/crosslineSession';
import { mirrorHost, readEnabledHosts } from '../../features/routeManagement/crosslineCookieBridge';
import { crosslinePromptService, getCrosslineCookieStores } from '../../features/routeManagement/crosslinePromptBrowser';

export async function resolveCrosslinePageContext(sender: chrome.runtime.MessageSender): Promise<CrosslinePageContext | null> {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || typeof sender.tab?.id !== 'number' ||
    !sender.url || !sender.documentId) return null;
  try {
    const url = new URL(sender.url);
    const host = mirrorHost(url.hostname);
    if (url.protocol !== 'https:' || url.port || !host || (sender.origin !== undefined && sender.origin !== url.origin) ||
      !(await readEnabledHosts()).includes(host)) return null;
    const tab = await chrome.tabs.get(sender.tab.id);
    if (!tab.url || new URL(tab.url).origin !== url.origin) return null;
    const stores = (await getCrosslineCookieStores()).filter(store => store.tabIds.includes(sender.tab?.id ?? -1));
    if (stores.length !== 1) return null;
    return { tabId: sender.tab.id, documentId: sender.documentId, origin: url.origin,
      targetHost: host, storeId: stores[0].id, incognito: !!tab.incognito };
  } catch { return null; }
}
export async function handleCrosslinePromptMessage(message: Record<string, unknown>, sender: chrome.runtime.MessageSender): Promise<CrosslinePageResponse> {
  const type = message.type;
  const allowed = ['JAVDB_CROSSLINE_PAGE:STATUS', 'JAVDB_CROSSLINE_PAGE:CLAIM', 'JAVDB_CROSSLINE_PAGE:DISMISS', 'JAVDB_CROSSLINE_PAGE:COPY', 'JAVDB_CROSSLINE_PAGE:LOGOUT'];
  if (typeof type !== 'string' || !allowed.includes(type) || 'targetHost' in message || 'storeId' in message ||
    ((type.endsWith(':CLAIM') || type.endsWith(':DISMISS') || type.endsWith(':COPY')) && typeof message.offerId !== 'string') ||
    (type.endsWith(':COPY') && typeof message.sourceHost !== 'string')) return { success: false, error: '登录操作参数无效' };
  const ctx = await resolveCrosslinePageContext(sender);
  if (!ctx) return { success: false, error: '当前页面无法操作线路登录态' };
  try {
    switch (type) {
      case 'JAVDB_CROSSLINE_PAGE:STATUS': return { success: true, status: await crosslinePromptService.status(ctx) };
      case 'JAVDB_CROSSLINE_PAGE:CLAIM': return { success: true, show: await crosslinePromptService.claim(ctx, message.offerId as string) };
      case 'JAVDB_CROSSLINE_PAGE:DISMISS': await crosslinePromptService.dismiss(ctx, message.offerId as string); return { success: true };
      case 'JAVDB_CROSSLINE_PAGE:LOGOUT': await crosslinePromptService.logout(ctx); return { success: true };
      case 'JAVDB_CROSSLINE_PAGE:COPY': return { success: true, outcome: await crosslinePromptService.copy(ctx, message.offerId as string, message.sourceHost as string) };
      default: return { success: false, error: '登录操作无效' };
    }
  } catch {
    // Do not echo raw browser/network errors, which may contain account material.
    return { success: false, error: '暂时无法检查或同步登录态，请稍后重试。' };
  }
}
