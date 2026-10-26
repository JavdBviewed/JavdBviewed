/**
 * @file libraryIndexReconcile.ts
 * @description 资料库索引对账（storage 级）：emby 设置保存成功 / 云 pull-apply
 * 应用成功后，按「当前启用来源白名单」即时清除孤儿索引条目；来源配置变化
 * （改地址 / 删来源 / 停用 / 凭证）且入库功能开启时，请求一次后台
 * 「立即同步资料库」。
 * @module features/embyLibrary
 *
 * 10-26-emby-index-reconcile：既有清孤儿只在「同步时」跑（自动同步默认
 * 60 分钟），等待窗口内媒体库页 / 清理面板持续渲染失效条目。本模块把
 * 对账前移到设置落盘成功时刻。整体 fail-open：任何异常不影响保存 / 同步主流程。
 */
import { STORAGE_KEYS } from '../../utils/config';
import { getValue, setValue } from '../../utils/storage';
import { sendRuntimeMessage } from '../../platform/browser/runtimeMessages';
import {
  countLibraryEntries,
  isEmbyServerConfigChanged,
  isLibraryFeatureEnabled,
  reconcileLibraryEntries,
  resolveEnabledMediaServers,
} from './domain/indexReconcile';
import { mediaLog } from './mediaLibraryLogger';
import type { EmbyLibraryState } from './types';

const DEFAULT_STATE: EmbyLibraryState = { entries: {}, updatedAt: 0 };

export type LibraryIndexReconcileResult = {
  /** 索引是否发生变化（仅变化时写回存储） */
  changed: boolean;
  /** 被清除的孤儿条目数 */
  removedEntryCount: number;
  /** 来源配置变化且入库功能开启 → 建议触发一次后台同步 */
  syncSuggested: boolean;
};

/**
 * 以「当前启用来源白名单」对账 emby_library_state：
 * 读 → reconcile → 有变化才写；syncSuggested = 配置 diff 命中 && 入库功能开启
 * （功能关闭时只 reconcile 不触发同步）。整体 fail-open。
 */
export async function reconcileEmbyLibraryIndexAfterSettingsChange(input: {
  prevSettings: unknown;
  nextSettings: unknown;
}): Promise<LibraryIndexReconcileResult> {
  try {
    const nextSettings = input.nextSettings as { emby?: unknown } | null | undefined;
    const servers = resolveEnabledMediaServers(input.nextSettings);
    const state = await getValue<EmbyLibraryState>(STORAGE_KEYS.EMBY_LIBRARY_STATE, DEFAULT_STATE);
    const previousEntries = state?.entries || {};
    const nextEntries = reconcileLibraryEntries(previousEntries, servers);
    const removedEntryCount = countLibraryEntries(previousEntries) - countLibraryEntries(nextEntries);
    // 配置 diff 判定不随「无孤儿」早退短路：凭据变化（登录保存令牌）/空索引改地址等
    // 场景没有可清孤儿，但仍需触发一次后台同步以按新配置重建索引。
    const syncSuggested =
      isEmbyServerConfigChanged(input.prevSettings, input.nextSettings)
      && isLibraryFeatureEnabled(nextSettings?.emby);
    if (removedEntryCount <= 0) {
      return { changed: false, removedEntryCount: 0, syncSuggested };
    }
    await setValue(STORAGE_KEYS.EMBY_LIBRARY_STATE, { ...state, entries: nextEntries });
    return { changed: true, removedEntryCount, syncSuggested };
  } catch (error) {
    mediaLog.warn('资料库索引对账跳过（fail-open）', { error: String(error) });
    return { changed: false, removedEntryCount: 0, syncSuggested: false };
  }
}

/**
 * 请求一次后台「立即同步资料库」（manual=true 绕过同步间隔 skip）。
 * 上下文分流：SW（无 window）直接调用同步 handler；页面上下文发 runtime 消息。
 * 失败仅告警不抛（触发 fail-open，不影响设置保存 / 云同步主流程）。
 */
export async function requestEmbyLibrarySyncAfterConfigChange(source: string): Promise<void> {
  try {
    if (typeof window === 'undefined') {
      const { handleEmbyLibrarySync } = await import('./background/handlers');
      await new Promise<void>((resolve) => {
        void handleEmbyLibrarySync({ manual: true }, () => resolve());
      });
      return;
    }
    await sendRuntimeMessage({ type: 'EMBY_LIBRARY_SYNC', manual: true });
  } catch (error) {
    mediaLog.warn('资料库索引自动同步请求失败', { source, error: String(error) });
  }
}
