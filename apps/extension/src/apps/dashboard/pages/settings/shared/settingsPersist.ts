/**
 * @file settingsPersist.ts
 * @description 设置页共用持久化助手：STATE 同步、防抖保存、storage 包装
 * @module apps/dashboard/pages/settings/shared
 */
import { useCallback, useEffect, useRef } from 'react';
import type { ExtensionSettings } from '../../../../../types';
import { getSettings, saveSettings } from '../../../../../utils/storage';

export { getSettings, saveSettings };

/**
 * 同步 dashboard STATE.settings，避免与遗留面板状态脱节
 */
export async function syncDashboardState(settings: ExtensionSettings): Promise<void> {
  try {
    const { STATE } = await import('../../../../../dashboard/state');
    STATE.settings = settings;
  } catch {
    /* 非 dashboard 上下文可忽略 */
  }
}

/**
 * 通知已打开的 JavDB 标签页设置已更新
 */
export function notifyJavdbTabsSettingsUpdated(): void {
  try {
    chrome.tabs.query({ url: '*://javdb.com/*' }, (tabs) => {
      tabs.forEach((tab) => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { type: 'settings-updated' }, () => {
            if (chrome.runtime.lastError) {
              /* 标签页未注入 content script 时忽略 */
            }
          });
        }
      });
    });
  } catch {
    /* ignore */
  }
}

export type DebouncedSaveOptions<T, TResult = void> = {
  delayMs: number;
  persist: (value: T) => Promise<TResult> | TResult;
};

/**
 * React hook：对表单变更做防抖保存
 */
export function useDebouncedSettingsSave<T, TResult = void>(
  options: DebouncedSaveOptions<T, TResult>,
) {
  const { delayMs, persist } = options;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{ value: T } | null>(null);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mountedRef = useRef(true);
  const persistRef = useRef(persist);
  persistRef.current = persist;

  const enqueuePersist = useCallback((value: T): Promise<TResult> => {
    const operation = persistQueueRef.current.then(() => persistRef.current(value));
    persistQueueRef.current = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }, []);

  const persistPending = useCallback((): Promise<TResult> | null => {
    const pending = pendingRef.current;
    if (!pending) return null;
    pendingRef.current = null;
    return enqueuePersist(pending.value);
  }, [enqueuePersist]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      void persistPending();
    };
  }, [persistPending]);

  const scheduleSave = useCallback(
    (value: T) => {
      pendingRef.current = { value };
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void persistPending();
      }, delayMs);
    },
    [delayMs, persistPending],
  );

  const flush = useCallback(
    (value: T) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      pendingRef.current = null;
      return enqueuePersist(value);
    },
    [enqueuePersist],
  );

  return { scheduleSave, flush, mountedRef };
}
