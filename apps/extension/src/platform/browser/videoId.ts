/**
 * @file videoId.ts
 * @description 浏览器端番号提取工具 —— 从 DOM 元素或文本中提取番号
 * @module platform/browser
 *
 * 基于 shared/utils/videoId 的提取逻辑，增加了 DOM 查询和日志支持。
 *
 * 提取语义（10-22-western-view-record 起）：
 * - 方法1（标题）/方法2（旧 panel）仅采纳严格番号命中（含 western-dot 欧美点分码）；
 *   严格未命中不再取首词兜底，落方法3（避免垃圾首词 ID 入库）。
 * - 方法3 URL code 用原始大小写（JAV 正常页标题 strict 必中，方法3 不可达，零漂移；
 *   仅标题+panel 双失败的退化边缘由大写 URL 码改为原始 URL 码）。
 */

import { extractVideoId as extractSharedVideoId } from '../../shared/utils/videoId';
import { getFirstVideoCodeFromText } from '../../shared/utils/videoCodeExtractor';

function logVideoId(...args: any[]): void {
    try {
        const verbose = typeof window !== 'undefined' && (window as any).__JDB_VERBOSE;
        if (verbose !== false) {
            console.log('[JavDB Ext]', ...args);
        }
    } catch {
        console.log('[JavDB Ext]', ...args);
    }
}

// 智能提取视频ID，过滤掉中文、空格等无关内容
export function extractVideoId(rawText: string): string | null {
    const extracted = extractSharedVideoId(rawText);
    logVideoId(extracted
        ? `Extracted video ID: "${extracted}" from raw text: "${rawText}"`
        : `Failed to extract video ID from raw text: "${rawText}"`);
    return extracted;
}


// 严格番号提取（10-22）：getFirstVideoCodeFromText 命中即采纳（含 western-dot），未命中返回 null
// —— 不做首词兜底；extractVideoIdFromPage 方法1/2 专用。
function extractStrictVideoId(rawText: string): string | null {
    const trimmed = rawText.trim();
    if (!trimmed) return null;
    return getFirstVideoCodeFromText(trimmed, { allowStandaloneFc2Number: true })?.display ?? null;
}

// 缓存提取结果，避免重复日志
let lastExtractedId: string | null = null;
let lastRawText: string = '';
let lastPathname: string = '';

// 从页面中提取视频ID的多种方法
export function extractVideoIdFromPage(): string | null {
    // 如果路径改变了，清除缓存
    if (window.location.pathname !== lastPathname) {
        lastExtractedId = null;
        lastRawText = '';
        lastPathname = window.location.pathname;
    }

    let videoId: string | null = null;

    // 方法1: 从页面标题中获取 (新的页面结构)
    const titleElement = document.querySelector<HTMLElement>('h2.title.is-4 strong:first-child');
    if (titleElement) {
        const rawText = titleElement.textContent?.trim();
        if (rawText) {
            // 如果原始文本没有变化，直接返回缓存结果
            if (rawText === lastRawText && lastExtractedId) {
                return lastExtractedId;
            }

            videoId = extractStrictVideoId(rawText);

            // 只在首次提取或内容变化时输出日志
            if (videoId && rawText !== lastRawText) {
                logVideoId(`Raw title text: "${rawText}" -> Extracted ID: "${videoId}"`);
                lastRawText = rawText;
                lastExtractedId = videoId;
            }
        }
    }

    // 方法2: 从panel-block中获取 (旧的页面结构)
    if (!videoId) {
        const panelBlock = document.querySelector<HTMLElement>('.panel-block.first-block');
        if (panelBlock) {
            const fullIdText = panelBlock.querySelector<HTMLElement>('.title.is-4');
            if (fullIdText) {
                const rawText = fullIdText.textContent?.trim();
                if (rawText && rawText !== lastRawText) {
                    videoId = extractStrictVideoId(rawText);
                    if (videoId) {
                        logVideoId(`Raw panel text: "${rawText}" -> Extracted ID: "${videoId}"`);
                        lastRawText = rawText;
                        lastExtractedId = videoId;
                    }
                }
            }
        }
    }

    // 方法3: 从URL中提取
    if (!videoId) {
        const urlMatch = window.location.pathname.match(/\/v\/([^\/]+)/);
        if (urlMatch) {
            const rawUrlId = urlMatch[1];
            if (rawUrlId !== lastRawText) {
                videoId = rawUrlId; // 10-22: URL code 原始大小写（不再经共享层大写）
                if (videoId) {
                    logVideoId(`Raw URL ID: "${rawUrlId}" -> Extracted ID: "${videoId}"`);
                    lastRawText = rawUrlId;
                    lastExtractedId = videoId;
                }
            }
        }
    }

    return videoId;
}
