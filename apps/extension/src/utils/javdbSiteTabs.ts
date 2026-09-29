/**
 * @file javdbSiteTabs.ts
 * @description 站点标签页广播的共享目标构造（09-29-settings-broadcast-hosts）：
 *   设置类广播（settings-updated 等）的 tabs.query url 匹配模式统一从
 *   manifest content_scripts 的 javdb/javbus 主机集推导——即「content script
 *   实际可注入的站点 tab」集合。历史上广播点硬编码 `*://javdb.com/*`，
 *   查不到镜像域（javdb570/575 等 manifest 一等主机）tab，导致镜像上改设置
 *   不 live reapply（B6 根因）。manifest 新增镜像主机时本 helper 自动跟随，
 *   无需改广播点。
 *   红线：本模块只影响「广播目标匹配模式」，不改消息语义/结构。
 * @module utils
 */

/** 识别站点主机匹配模式：javdb（含 javdbNNN 镜像）/ javbus，通配子域或裸域。 */
const SITE_HOST_MATCH = /^.*:\/\/(\*\.)?(?:javdb\d*|javbus)\.com\/\*$/;

/** 最小 manifest 结构（测试注入用；运行时取 chrome.runtime.getManifest()）。 */
export interface SiteTabManifestLike {
  content_scripts?: Array<{ matches?: string[] }> | null;
}

/**
 * 站点 tab 的 tabs.query url 匹配模式（保序去重）。
 * 纯函数：manifest 可注入（测试）；缺省时读 chrome.runtime.getManifest()；
 * 两者都不可用时返回 []（调用方按「无目标」处理，不抛错）。
 */
export function getJavdbSiteTabUrlPatterns(manifest?: SiteTabManifestLike | null): string[] {
  const source =
    manifest ??
    (typeof chrome !== 'undefined' && chrome.runtime?.getManifest
      ? (chrome.runtime.getManifest() as unknown as SiteTabManifestLike)
      : undefined);

  const seen = new Set<string>();
  const patterns: string[] = [];
  for (const cs of source?.content_scripts ?? []) {
    for (const pattern of cs?.matches ?? []) {
      if (SITE_HOST_MATCH.test(pattern) && !seen.has(pattern)) {
        seen.add(pattern);
        patterns.push(pattern);
      }
    }
  }
  return patterns;
}

/**
 * 向所有站点标签页（主域 + 镜像，主机集=manifest content_scripts 站点主机）
 * 广播同一消息。按 tab.id 去重（多模式可命中同一 tab），单 tab 发送失败
 * （未注入 content script 等）静默跳过。
 *
 * @returns 实际收到消息的 tab 数（resolve 恒不 reject）
 */
export function sendToJavdbSiteTabs(message: unknown): Promise<number> {
  return new Promise((resolve) => {
    let patterns: string[];
    try {
      patterns = getJavdbSiteTabUrlPatterns();
    } catch {
      resolve(0);
      return;
    }
    if (patterns.length === 0) {
      resolve(0);
      return;
    }
    try {
      chrome.tabs.query({ url: patterns }, (tabs) => {
        const sent = new Set<number>();
        for (const tab of tabs ?? []) {
          if (tab.id == null || sent.has(tab.id)) continue;
          sent.add(tab.id);
          try {
            const result = chrome.tabs.sendMessage(tab.id, message as object) as unknown;
            // MV3 sendMessage 返回 Promise（reject=无接收方）；兼容回调形返回 undefined
            if (result && typeof (result as Promise<void>).catch === 'function') {
              (result as Promise<void>).catch(() => {
                /* 标签页未注入 content script 时忽略 */
              });
            }
          } catch {
            /* ignore */
          }
        }
        if (sent.size > 0) {
          const type = (message as { type?: unknown } | null | undefined)?.type;
        console.log(`[javdbSiteTabs] broadcast → ${sent.size} site tab(s)`, type ?? '');
        }
        resolve(sent.size);
      });
    } catch {
      resolve(0);
    }
  });
}
