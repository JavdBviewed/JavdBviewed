/**
 * @file mediaClientPreview.ts
 * @description 媒体库客户端预告的版本化本地显示状态。
 */

export const MEDIA_CLIENT_PREVIEW_STORAGE_KEY = 'ml_client_preview_dismissed_v1';

export function readMediaClientPreviewHidden(): boolean {
  try {
    return globalThis.localStorage?.getItem(MEDIA_CLIENT_PREVIEW_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeMediaClientPreviewHidden(hidden: boolean): void {
  try {
    globalThis.localStorage?.setItem(MEDIA_CLIENT_PREVIEW_STORAGE_KEY, hidden ? '1' : '0');
  } catch {
    // 存储不可用时不阻断媒体库浏览。
  }
}
