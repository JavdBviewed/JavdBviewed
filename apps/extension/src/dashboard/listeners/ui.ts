// src/dashboard/listeners/ui.ts
import { showMessage } from '../ui/toast';
import {
  DRIVE115_TOKEN_REFRESH_EVENT,
  DRIVE115_TOKEN_REFRESH_RUNTIME_MESSAGE,
  type Drive115TokenRefreshEventDetail,
} from '../../features/drive115/v2/tokenRefreshEvents';

type ToastType = 'info' | 'warn' | 'warning' | 'error' | 'success';

type DashboardRuntimeMessage = {
  type?: string;
  message?: string;
  toastType?: ToastType;
  detail?: Drive115TokenRefreshEventDetail;
};

declare global {
  interface Window {
    __DRIVE115_TOKEN_REFRESH_TOAST_BOUND__?: boolean;
  }
}

let drive115RefreshActive = false;
let lastDrive115StartToastAt = 0;
let lastDrive115SuccessToastAt = 0;
let lastDrive115ErrorToastAt = 0;

function handleDrive115TokenRefreshToast(detail: Drive115TokenRefreshEventDetail | undefined): void {
  if (!detail) return;
  const now = Date.now();
  if (detail.phase === 'start') {
    if (!drive115RefreshActive && now - lastDrive115StartToastAt > 3000) {
      showMessage(detail.source === 'manual' ? '正在刷新 115 凭证…' : '115 凭证已过期，正在自动刷新…', 'info', 8000);
      lastDrive115StartToastAt = now;
    }
    drive115RefreshActive = true;
    return;
  }
  if (detail.phase === 'reuse') {
    if (!drive115RefreshActive && now - lastDrive115StartToastAt > 3000) {
      showMessage('115 凭证正在刷新中，本次操作会等待刷新完成…', 'info', 8000);
      lastDrive115StartToastAt = now;
    }
    drive115RefreshActive = true;
    return;
  }
  if (detail.phase === 'success') {
    if (drive115RefreshActive || now - lastDrive115SuccessToastAt > 5000) {
      showMessage(detail.source === 'manual' ? '115 凭证刷新成功' : '115 凭证刷新成功，已继续当前操作', 'success');
      lastDrive115SuccessToastAt = now;
    }
    drive115RefreshActive = false;
    return;
  }
  if (detail.phase === 'error') {
    if (now - lastDrive115ErrorToastAt > 3000) {
      showMessage(`115 凭证刷新失败：${detail.message || '请稍后重试或重新授权'}`, 'error', 8000);
      lastDrive115ErrorToastAt = now;
    }
    drive115RefreshActive = false;
    return;
  }
  if (detail.phase === 'blocked') {
    if (now - lastDrive115ErrorToastAt > 3000) {
      showMessage(`115 凭证暂时无法刷新：${detail.message || '请稍后重试或重新授权'}`, 'warning', 8000);
      lastDrive115ErrorToastAt = now;
    }
    drive115RefreshActive = false;
  }
}

function asDashboardRuntimeMessage(message: unknown): DashboardRuntimeMessage | null {
  if (!message || typeof message !== 'object') return null;
  return message as DashboardRuntimeMessage;
}

export function bindUiListeners(): void {
  try {
    chrome.runtime.onMessage.addListener((rawMessage: unknown) => {
      const message = asDashboardRuntimeMessage(rawMessage);
      if (!message) return;
      if (message.type === 'show-toast' && typeof message.message === 'string') {
        try { showMessage(message.message, message.toastType || 'info'); } catch {}
      }
      if (message.type === DRIVE115_TOKEN_REFRESH_RUNTIME_MESSAGE) {
        try { handleDrive115TokenRefreshToast(message.detail); } catch {}
      }
      // 后台广播：115 用户信息已在后台刷新，通知 dashboard 更新 UI
      if (message.type === 'drive115.refresh_user_info') {
        try { window.dispatchEvent(new CustomEvent('drive115:refreshUserInfo')); } catch {}
      }
    });
  } catch {}

  try {
    if (!window.__DRIVE115_TOKEN_REFRESH_TOAST_BOUND__) {
      window.addEventListener(DRIVE115_TOKEN_REFRESH_EVENT, (event) => {
        try {
          handleDrive115TokenRefreshToast((event as CustomEvent<Drive115TokenRefreshEventDetail>).detail);
        } catch {}
      });
      window.__DRIVE115_TOKEN_REFRESH_TOAST_BOUND__ = true;
    }
  } catch {}
}
