/**
 * @file utilityMessageHandlers.ts
 * @description 工具类消息处理器 —— 请求调度器配置、WebDAV闹钟注册、观看状态更新、隐私锁
 * @module apps/background
 */
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../../utils/config';
import {
  getValue as defaultGetValue,
} from '../../utils/storage';
import {
  viewedGet as defaultViewedGet,
  viewedPut as defaultViewedPut,
} from '../../platform/storage/indexedDb';
import { requestScheduler as defaultRequestScheduler } from '../../platform/network/requestScheduler';
import { WEBDAV_SYNC_ALARM } from './scheduler';

type SendResponse = (response: any) => void;  // chrome.runtime 消息回调类型

export interface SchedulerConfigDependencies {
  getValue?: typeof defaultGetValue;              // 读取设置的存储函数
  requestScheduler?: typeof defaultRequestScheduler;  // 请求调度器
}

/**
 * 从设置中读取并发配置并应用到请求调度器
 */

export async function applySchedulerConfigFromSettings(deps: SchedulerConfigDependencies = {}): Promise<void> {
  const getValue = deps.getValue ?? defaultGetValue;
  const requestScheduler = deps.requestScheduler ?? defaultRequestScheduler;

  try {
    const settings = await getValue<any>(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS as any);
    const cc = settings?.magnetSearch?.concurrency || {};
    requestScheduler.updateConfig({
      globalMaxConcurrent: typeof cc.bgGlobalMaxConcurrent === 'number' ? cc.bgGlobalMaxConcurrent : 4,
      perHostMaxConcurrent: typeof cc.bgPerHostMaxConcurrent === 'number' ? cc.bgPerHostMaxConcurrent : 1,
      perHostRateLimitPerMin: typeof cc.bgPerHostRateLimitPerMin === 'number' ? cc.bgPerHostRateLimitPerMin : 12,
    });
    console.info('[Background] RequestScheduler config applied:', {
      global: cc.bgGlobalMaxConcurrent,
      perHost: cc.bgPerHostMaxConcurrent,
      rate: cc.bgPerHostRateLimitPerMin,
    });
  } catch (error) {
    console.warn('[Background] applySchedulerConfigFromSettings failed:', error);
  }
}

export interface WebDAVSyncAlarmDependencies {
  getValue?: typeof defaultGetValue;    // 读取设置的存储函数
  alarmName?: string;                   // chrome.alarms 名称（可注入用于测试）
}

/**
 * 根据设置注册 WebDAV 自动同步闹钟
 * 读取 syncInterval 设置（最小5分钟，最大24小时）
 */

export async function setupWebDAVSyncAlarm(deps: WebDAVSyncAlarmDependencies = {}): Promise<void> {
  const getValue = deps.getValue ?? defaultGetValue;
  const alarmName = deps.alarmName ?? WEBDAV_SYNC_ALARM;

  try {
    if (!('alarms' in chrome) || !chrome.alarms) return;
    const settings = await getValue<any>(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS as any);
    const webdav = settings?.webdav || {};
    try { await chrome.alarms.clear(alarmName); } catch {}
    if (!webdav.enabled || !webdav.autoSync) return;
    if (!webdav.url || !webdav.username || !webdav.password) return;
    let interval = Number(webdav.syncInterval ?? 30);
    if (!Number.isFinite(interval)) interval = 30;
    if (interval < 5) interval = 5;
    if (interval > 1440) interval = 1440;
    chrome.alarms.create(alarmName, { delayInMinutes: interval, periodInMinutes: interval });
  } catch {}
}

/**
 * 处理更新观看状态的消息 —— 在 IndexedDB 中写入一条 viewed 记录
 */
export async function handleUpdateWatchedStatus(
  message: any,
  sendResponse: SendResponse,
  viewedPut: typeof defaultViewedPut = defaultViewedPut,
  viewedGet: typeof defaultViewedGet = defaultViewedGet,
): Promise<void> {
  try {
    const videoId = message?.videoId;
    if (!videoId) {
      sendResponse({ success: false, error: 'No videoId provided' });
      return;
    }
    const now = Date.now();
    const existing = await viewedGet(videoId);
    const record: any = existing
      ? { ...existing, status: 'viewed', updatedAt: now }
      : { id: videoId, title: '', status: 'viewed', tags: [], createdAt: now, updatedAt: now };
    await viewedPut(record);
    sendResponse({ success: true, record });
  } catch (error: any) {
    console.error('[Background] Failed to update watched status:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * 处理隐私锁消息 —— 向所有 dashboard 标签页广播隐私锁触发
 */
export async function handlePrivacyLock(sendResponse: SendResponse): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('dashboard/dashboard.html') });

    for (const tab of tabs) {
      if (tab.id) {
        try {
          console.log('[Background] Sending privacy-lock-trigger to dashboard tab:', { tabId: tab.id, url: tab.url });
          await chrome.tabs.sendMessage(tab.id, { type: 'privacy-lock-trigger' });
        } catch (error) {
          console.error('Failed to send lock message to tab:', error);
        }
      }
    }

    sendResponse({ success: true });
  } catch (error: any) {
    console.error('[Background] Failed to handle privacy lock:', error);
    sendResponse({ success: false, error: error.message });
  }
}
