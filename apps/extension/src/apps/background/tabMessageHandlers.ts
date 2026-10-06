/**
 * @file tabMessageHandlers.ts
 * @description 标签页与 115 推送的消息处理器 —— 后台打开标签页、转发消息到 115.com
 * @module apps/background
 */
type SendResponse = (response: any) => void;  // chrome.runtime 消息回调类型

/**
 * 在后台打开一个新标签页（active=false，不抢占焦点）
 */
export async function handleOpenTabBackground(message: any, sendResponse: SendResponse): Promise<void> {
  try {
    const { url } = message;
    if (!url) {
      sendResponse({ success: false, error: 'No URL provided' });
      return;
    }
    const tab = await chrome.tabs.create({ url, active: false });
    sendResponse({ success: true, tabId: tab.id });
  } catch (error: any) {
    console.error('[Background] Failed to open background tab:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * 将磁力推送消息转发到 115.com 的 content script
 * 先查询已打开的 115.com 标签页，通过 tabs.sendMessage 桥接
 */
export async function handleDrive115Push(message: any, sendResponse: SendResponse): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ url: '*://115.com/*' });
    if (!tabs.length) {
      sendResponse({ type: 'DRIVE115_PUSH_RESPONSE', requestId: message?.requestId, success: false, error: '未找到 115.com 标签页' });
      return;
    }
    const tabId = tabs[0].id;
    if (!tabId) {
      sendResponse({ type: 'DRIVE115_PUSH_RESPONSE', requestId: message?.requestId, success: false, error: '标签页ID无效' });
      return;
    }
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[Background] DRIVE115_PUSH sendMessage failed:', { tabId, error: chrome.runtime.lastError.message });
        sendResponse({ type: 'DRIVE115_PUSH_RESPONSE', requestId: message?.requestId, success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse(response || { type: 'DRIVE115_PUSH_RESPONSE', requestId: message?.requestId, success: true });
      }
    });
  } catch (error: any) {
    console.error('[Background] Failed to handle DRIVE115_PUSH:', error);
    sendResponse({ type: 'DRIVE115_PUSH_RESPONSE', requestId: message?.requestId, success: false, error: error.message });
  }
}

/**
 * 将验证请求转发到 115.com 的 content script
 */
export async function handleDrive115Verify(message: any, sendResponse: SendResponse): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ url: '*://115.com/*' });
    if (!tabs.length) {
      sendResponse({ success: false, error: '未找到 115.com 标签页' });
      return;
    }
    const tabId = tabs[0].id;
    if (!tabId) {
      sendResponse({ success: false, error: '标签页ID无效' });
      return;
    }
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[Background] DRIVE115_VERIFY sendMessage failed:', { tabId, error: chrome.runtime.lastError.message });
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse(response ?? { success: true });
      }
    });
  } catch (error: any) {
    console.error('[Background] Failed to handle DRIVE115_VERIFY:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * 关闭当前标签页（锚点优化「關閉當前頁面」按钮，content 侧发 CLOSE_CURRENT_TAB）
 * tabId 以 sender.tab.id 为权威来源（content 侧不可指定目标 tab）
 */
export async function handleCloseCurrentTab(sender: any, sendResponse: SendResponse): Promise<void> {
  try {
    const tabId = sender?.tab?.id;
    if (!Number.isInteger(tabId)) {
      sendResponse({ success: false, error: 'No tab id in sender' });
      return;
    }
    await chrome.tabs.remove(tabId);
    sendResponse({ success: true });
  } catch (error: any) {
    console.error('[Background] Failed to close current tab:', error);
    sendResponse({ success: false, error: error.message });
  }
}
