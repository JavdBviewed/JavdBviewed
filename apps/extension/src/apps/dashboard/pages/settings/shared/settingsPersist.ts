/**
 * @file settingsPersist.ts
 * @description 设置页共用持久化助手：STATE 同步、防抖保存、storage 包装
 * @module apps/dashboard/pages/settings/shared
 */
import { useCallback, useEffect, useRef } from 'react';
import type { ExtensionSettings } from '../../../../../types';
import { getSettings, saveSettings } from '../../../../../utils/storage';
import { sendToJavdbSiteTabs } from '../../../../../utils/javdbSiteTabs';

export { getSettings, saveSettings };

/**
 * 模块级待写链：任一时刻只有一个设置页处于激活态。
 * 前一个页面的卸载 flush（卸载时补写最后防抖值）与下一个页面的挂载读
 * 存在竞态：后者可能先读到旧值。挂载流通过 awaitPendingSettingsPersist
 * 等待本链 settle 后再读，消除该竞态。
 */
let pendingSettingsPersist: Promise<unknown> = Promise.resolve();

/**
 * 等待模块级待写链 settle（超时 fail-open）。
 * 供设置子页挂载流（mountReactSettingsPage）在卸载旧页后、挂载新页前调用，
 * 保证新页挂载读不会读到旧页卸载 flush 尚未落盘的旧值。
 * 超时后重置链：避免单个挂起的 persist 卡死后续所有设置写入。
 */
export async function awaitPendingSettingsPersist(timeoutMs = 1500): Promise<void> {
  const target = pendingSettingsPersist;
  const settled = await Promise.race([
    target.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), timeoutMs);
    }),
  ]);
  if (!settled) {
    pendingSettingsPersist = Promise.resolve();
  }
}

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
 * 通知已打开的站点标签页设置已更新。
 * 目标=manifest content_scripts 站点主机集（主域+镜像，09-29-settings-broadcast-hosts）；
 * 内容侧收到后自行读存储刷新（本消息不带 payload）。
 */
export function notifyJavdbTabsSettingsUpdated(): void {
  try {
    void sendToJavdbSiteTabs({ type: 'settings-updated' });
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
  const mountedRef = useRef(true);
  const persistRef = useRef(persist);
  persistRef.current = persist;

  // 走模块级待写链（而非组件级 ref）：卸载 flush 入队后，
  // 下一个页面的挂载流才能从组件外部 await 到这次写入。
  const enqueuePersist = useCallback((value: T): Promise<TResult> => {
    const operation = pendingSettingsPersist.then(() => persistRef.current(value)) as Promise<TResult>;
    pendingSettingsPersist = operation.then(
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
