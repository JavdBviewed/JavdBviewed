/**
 * @file dynamicContentScripts.ts
 * @description dynamicContentScripts
 * @module apps/background
 */
import { getSettings } from '../../utils/storage';
import { isEmbyRecognitionEnabled } from '../../utils/config';
import { registerEmbyDynamicScripts } from './embyDynamicContentScripts';

let routesTabListener: ((tabId: number, changeInfo: any, tab: chrome.tabs.Tab) => void) | null = null;

export async function registerDynamicContentScripts(showNotification: boolean = false): Promise<void> {
  try {
    const settings = await getSettings();
    const routes = settings?.routes;
    const urlPrefixes: string[] = [];
    const prefixSet = new Set<string>();

    if (routes?.javdb) {
      [routes.javdb.primary, ...(routes.javdb.alternatives?.filter((a: any) => a.enabled && a.url).map((a: any) => a.url) || [])]
        .forEach((u: string) => {
          try {
            const { origin } = new URL(u);
            prefixSet.add(origin + '/');
          } catch {}
        });
    }
    if (routes?.javbus) {
      [routes.javbus.primary, ...(routes.javbus.alternatives?.filter((a: any) => a.enabled && a.url).map((a: any) => a.url) || [])]
        .forEach((u: string) => {
          try {
            const { origin } = new URL(u);
            prefixSet.add(origin + '/');
          } catch {}
        });
    }

    urlPrefixes.push(...Array.from(prefixSet));

    if (routesTabListener) {
      chrome.tabs.onUpdated.removeListener(routesTabListener);
      routesTabListener = null;
    }

    if (urlPrefixes.length === 0) {
      console.debug('[Background] No route domains to watch');
      return;
    }

    const manifest = chrome.runtime.getManifest();
    const mainScript = manifest.content_scripts?.find(
      (cs: any) => cs.js?.some((j: string) => j.includes('index.ts-loader')),
    );
    const jsFiles: string[] = mainScript?.js || [];
    const cssFiles: string[] = mainScript?.css || [];

    if (jsFiles.length === 0) {
      console.warn('[Background] 未找到主 content script JS 文件');
      return;
    }

    routesTabListener = (tabId, changeInfo, tab) => {
      if (changeInfo.status !== 'complete' || !tab.url) return;
      const tabUrl = tab.url;
      const matched = urlPrefixes.some(prefix => tabUrl.startsWith(prefix));
      if (!matched) return;

      if (cssFiles.length > 0) {
        chrome.scripting.insertCSS({ target: { tabId }, files: cssFiles }).catch(() => {});
      }

      chrome.scripting.executeScript({
        target: { tabId },
        func: () => !!(window as any).__javdbExtensionInjected,
      }).then(results => {
        if (results?.[0]?.result) return;
        chrome.scripting.executeScript({ target: { tabId }, files: jsFiles })
          .then(() => console.info(`[Background] 线路 content script 已注入: ${tabUrl}`))
          .catch((e) => console.warn(`[Background] 线路 content script 注入失败: ${e?.message || e}`));
      }).catch(() => {
        chrome.scripting.executeScript({ target: { tabId }, files: jsFiles }).catch(() => {});
      });
    };

    chrome.tabs.onUpdated.addListener(routesTabListener);
    console.info('[Background] 线路 tab 监听器已设置，前缀:', urlPrefixes);

    if (showNotification && urlPrefixes.length > 0) {
      try {
        await chrome.notifications.create({
          type: 'basic',
          iconUrl: 'assets/favicons/light/favicon-128x128.png',
          title: 'Jav 助手 - 线路已更新',
          message: `已为 ${urlPrefixes.length} 个域名启用扩展功能，请刷新页面使用`,
          priority: 1,
        });
      } catch {}
    }
  } catch (e: any) {
    console.warn('[Background] Error in registerDynamicContentScripts:', e?.message || e);
  }
}

export async function registerEmbyDynamicContentScriptsOnStartup(): Promise<void> {
  try {
    const settings = await getSettings();
    if (isEmbyRecognitionEnabled(settings?.emby)) {
      await registerEmbyDynamicScripts(settings.emby);
    }
  } catch (e: any) {
    console.warn('[Background] 启动时注册 Emby 脚本失败:', e?.message || e);
  }
}
