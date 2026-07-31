// src/dashboard/listeners/ui.ts
import { showMessage, showPersistentMessage, type ToastHandle } from '../ui/toast';
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
let drive115RefreshToast: ToastHandle | null = null;
let lastDrive115FinalSignature = '';
let lastDrive115FinalAt = 0;

const DRIVE115_FINAL_TOAST_DEDUP_WINDOW_MS = 2500;

function ensureDrive115RefreshToast(message: string): void {
  if (!drive115RefreshToast) {
    drive115RefreshToast = showPersistentMessage(message, 'info');
    return;
  }
  drive115RefreshToast.update(message, 'info');
}

function finishDrive115RefreshToast(message: string, type: ToastType, duration = 5000): void {
  const now = Date.now();
  const signature = `${type}:${message}`;
  if (
    lastDrive115FinalSignature === signature
    && now - lastDrive115FinalAt <= DRIVE115_FINAL_TOAST_DEDUP_WINDOW_MS
  ) {
    return;
  }
  lastDrive115FinalSignature = signature;
  lastDrive115FinalAt = now;

  const toast = drive115RefreshToast || showPersistentMessage(message, type);
  toast.update(message, type, duration);
  drive115RefreshToast = null;
}

function handleDrive115TokenRefreshToast(detail: Drive115TokenRefreshEventDetail | undefined): void {
  if (!detail) return;
  const now = Date.now();
  if (detail.phase === 'start') {
    if (!drive115RefreshActive && now - lastDrive115StartToastAt > 3000) {
      ensureDrive115RefreshToast('正在刷新 115 凭证…');
      lastDrive115StartToastAt = now;
    }
    drive115RefreshActive = true;
    return;
  }
  if (detail.phase === 'reuse') {
    ensureDrive115RefreshToast('115 凭证正在刷新，等待结果…');
    lastDrive115StartToastAt = now;
    drive115RefreshActive = true;
    return;
  }
  if (detail.phase === 'success') {
    if (drive115RefreshActive || now - lastDrive115SuccessToastAt > 5000) {
      finishDrive115RefreshToast('115 凭证刷新成功', 'success', 3500);
      lastDrive115SuccessToastAt = now;
    }
    drive115RefreshActive = false;
    return;
  }
  if (detail.phase === 'error') {
    if (now - lastDrive115ErrorToastAt > 3000) {
      finishDrive115RefreshToast(`115 凭证刷新失败：${detail.message || '请稍后重试或重新授权'}`, 'error', 9000);
      lastDrive115ErrorToastAt = now;
    }
    drive115RefreshActive = false;
    return;
  }
  if (detail.phase === 'blocked') {
    if (now - lastDrive115ErrorToastAt > 3000) {
      finishDrive115RefreshToast(`115 凭证暂时无法刷新：${detail.message || '请稍后重试或重新授权'}`, 'warning', 9000);
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
