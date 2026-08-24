/**
 * @file embyDynamicContentScripts.ts
 * @description embyDynamicContentScripts
 * @module apps/background
 */
import { getEffectiveEmbyMatchUrls, matchesEmbyUrlPattern } from '../../features/embyEnhancement/domain/matchUrls';
import { isEmbyRecognitionEnabled } from '../../utils/config';

export async function registerEmbyDynamicScripts(embyConfig: any): Promise<void> {
  setupEmbyTabListener(embyConfig);
}

let embyTabListener: Parameters<typeof chrome.tabs.onUpdated.addListener>[0] | null = null;

function setupEmbyTabListener(embyConfig: any): void {
  if (embyTabListener) {
    chrome.tabs.onUpdated.removeListener(embyTabListener);
    embyTabListener = null;
  }

  if (!isEmbyRecognitionEnabled(embyConfig)) {
    console.info('[Background] Emby 未启用或无 URL，移除 tab 监听器');
    return;
  }

  const matchPatterns = getEffectiveEmbyMatchUrls(embyConfig);

  if (matchPatterns.length === 0) return;

  const manifest = chrome.runtime.getManifest();
  const mainScript = manifest.content_scripts?.find(
    (cs: any) => cs.js?.some((j: string) => j.includes('index.ts-loader'))
  );
  const jsFiles: string[] = mainScript?.js || [];
  const cssFiles: string[] = mainScript?.css || [];

  if (jsFiles.length === 0) {
    console.warn('[Background] 未找到主 content script JS 文件');
    return;
  }

  embyTabListener = (tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url) return;

    const tabUrl = tab.url;
    const matched = matchPatterns.some(pattern => matchesEmbyUrlPattern(tabUrl, pattern));
    if (!matched) return;

    if (cssFiles.length > 0) {
      chrome.scripting.insertCSS({ target: { tabId }, files: cssFiles }).catch(() => {});
    }

    chrome.scripting.executeScript({
      target: { tabId },
      func: () => !!(window as any).__javdbExtensionInjected
    }).then(results => {
      const alreadyInjected = results?.[0]?.result;
      if (alreadyInjected) return;

      chrome.scripting.executeScript({
        target: { tabId },
        files: jsFiles
      }).then(() => {
        console.info(`[Background] Emby content script 已注入: ${tabUrl}`);
      }).catch((e) => {
        console.warn(`[Background] Emby content script 注入失败: ${e?.message || e}`);
      });
    }).catch(() => {
      chrome.scripting.executeScript({
        target: { tabId },
        files: jsFiles
      }).catch(() => {});
    });
  };

  chrome.tabs.onUpdated.addListener(embyTabListener);
  console.info('[Background] Emby tab 监听器已设置，匹配模式:', matchPatterns);
}
