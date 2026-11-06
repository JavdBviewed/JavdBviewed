/**
 * @file backgroundProxy.ts
 * @description OpenList 请求的 Service Worker 代理，避免内容脚本跨源请求受 CORS 限制
 * @module features/openlist
 */
import { addOfflineDownload, testConnection, type AddOfflineDownloadParams } from './openlistClient';

type ProxyMessage = { type?: string; payload?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isConnectionPayload(value: unknown): value is { baseUrl: string; token: string } {
  return isRecord(value) && typeof value.baseUrl === 'string' && !!value.baseUrl.trim() && typeof value.token === 'string';
}

function isAddPayload(value: unknown): value is AddOfflineDownloadParams {
  if (!isConnectionPayload(value) || !value.token.trim()) return false;
  const payload: Record<string, unknown> = value;
  return typeof payload.path === 'string'
    && typeof payload.tool === 'string'
    && !!payload.tool.trim()
    && Array.isArray(payload.urls)
    && payload.urls.length > 0
    && payload.urls.every((url: unknown) => typeof url === 'string' && !!url.trim());
}

export function installOpenListProxy(): void {
  const state = globalThis as typeof globalThis & { __openlist_proxy_installed?: boolean };
  if (state.__openlist_proxy_installed || typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;
  state.__openlist_proxy_installed = true;
  chrome.runtime.onMessage.addListener((message: ProxyMessage, _sender, sendResponse) => {
    if (message?.type === 'openlist.add_offline_download') {
      if (!isAddPayload(message.payload)) {
        sendResponse({ success: false, message: '缺少 OpenList 服务器地址、token 或下载参数' });
        return false;
      }
      void addOfflineDownload(message.payload, globalThis.fetch.bind(globalThis))
        .then(sendResponse)
        .catch((error: unknown) => sendResponse({ success: false, message: error instanceof Error ? error.message : 'OpenList 后台请求失败' }));
      return true;
    }
    if (message?.type === 'openlist.test_connection') {
      if (!isConnectionPayload(message.payload)) {
        sendResponse({ ok: false, message: '缺少 OpenList 服务器地址' });
        return false;
      }
      void testConnection(message.payload, globalThis.fetch.bind(globalThis))
        .then(sendResponse)
        .catch((error: unknown) => sendResponse({ ok: false, message: error instanceof Error ? error.message : 'OpenList 后台请求失败' }));
      return true;
    }
    return false;
  });
}
