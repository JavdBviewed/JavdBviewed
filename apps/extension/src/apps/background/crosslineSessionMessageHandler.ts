import { describeCrosslineError, getJavdbCrosslineStatus, refreshJavdbCrosslineSessions, setJavdbCrosslineEnabled } from '../../features/routeManagement/crosslineCookieBridge';
import type { CrosslineSessionResponse } from '../../shared/protocols/crosslineSession';

/** Dashboard 也可能带 sender.tab，以扩展来源核验，不能据此拒绝。 */
export async function handleCrosslineSessionMessage(
  message: { type: string; enabled?: unknown },
  sender: chrome.runtime.MessageSender,
): Promise<CrosslineSessionResponse> {
  const root = chrome.runtime.getURL('');
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(root) ||
    (sender.origin !== undefined && sender.origin !== root.slice(0, -1))) {
    return { success: false, error: '仅扩展设置页可操作登录态' };
  }
  try {
    if (message.type === 'JAVDB_CROSSLINE:SET_ENABLED') {
      if (typeof message.enabled !== 'boolean') return { success: false, error: '开关参数无效' };
      await setJavdbCrosslineEnabled(message.enabled);
    }
    const status = message.type === 'JAVDB_CROSSLINE:REFRESH'
      ? await refreshJavdbCrosslineSessions()
      : await getJavdbCrosslineStatus();
    return { success: true, status };
  } catch (error) {
    const diagnostic = describeCrosslineError(error);
    return { success: false, error: diagnostic.message, stage: diagnostic.stage };
  }
}
