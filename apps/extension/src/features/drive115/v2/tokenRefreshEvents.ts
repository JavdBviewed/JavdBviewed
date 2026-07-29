/**
 * @file tokenRefreshEvents.ts
 * @description 115 凭证刷新状态事件，供不同扩展上下文统一通知用户
 * @module features/drive115
 */

export type Drive115TokenRefreshPhase = 'start' | 'reuse' | 'success' | 'error' | 'blocked';

export type Drive115TokenRefreshEventDetail = {
  phase: Drive115TokenRefreshPhase;
  at: number;
  source?: 'auto' | 'manual';
  reused?: boolean;
  message?: string;
  expiresIn?: number;
};

export const DRIVE115_TOKEN_REFRESH_EVENT = 'drive115:tokenRefresh';
export const DRIVE115_TOKEN_REFRESH_RUNTIME_MESSAGE = 'drive115.token_refresh_status';

export function emitDrive115TokenRefreshEvent(detail: Omit<Drive115TokenRefreshEventDetail, 'at'> & { at?: number }): void {
  const payload: Drive115TokenRefreshEventDetail = {
    ...detail,
    at: typeof detail.at === 'number' ? detail.at : Date.now(),
  };

  try {
    const maybeWindow = typeof window !== 'undefined' ? window : undefined;
    maybeWindow?.dispatchEvent(new CustomEvent(DRIVE115_TOKEN_REFRESH_EVENT, { detail: payload }));
  } catch {
    // 不让用户提示影响 115 主流程。
  }

  try {
    const hasWindow = typeof window !== 'undefined';
    if (!hasWindow && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(
        { type: DRIVE115_TOKEN_REFRESH_RUNTIME_MESSAGE, detail: payload },
        () => {
          try { void chrome.runtime?.lastError; } catch {}
        },
      );
    }
  } catch {
    // Service Worker 里没有可接收页面时会进入 lastError，忽略即可。
  }
}
