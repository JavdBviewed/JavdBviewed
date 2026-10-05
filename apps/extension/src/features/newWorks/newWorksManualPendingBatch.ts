/**
 * @file newWorksManualPendingBatch.ts
 * @description 10-19：手动扫描「收集-确认-入库」pending 批次持久化（chrome.storage.session）：
 *              confirm 模式终态（done/cancelled）且 pending>0 时把完整作品落盘，刷新后页面
 *              经只读通道取回并弹入库确认弹窗（响应直达通道在页面刷新时死亡，作品否则丢失）。
 *
 * 生命周期不变式（测试锁定）：
 * - 每个持久化批次只弹一次确认弹窗：确认流程收口（入库成功 / 不入库 / pending=0 / 异常）后
 *   页面侧必发 consume 清盘，永不再现。
 * - 新 confirm 扫描终态覆盖旧未确认批次（不合并、不阻塞、log 登记）。
 * - fetch 只读不消费；consume 幂等；空 works 不落盘；超阈值跳过落盘 + log（保持现状=仅摘要 toast）。
 * - storage.session 随浏览器会话结束自然清零——契合「扫描不可能跨浏览器重启」语义，零迁移。
 * @module features/newWorks
 */
import { resolveSessionStorage, type ManualScanStorage } from './newWorksScanState';
import type { NewWorkRecord } from '../../types';

/** storage.session 持久化键（批次；与状态机的 new_works_manual_scan_state 分离，生命周期各自独立） */
export const MANUAL_PENDING_BATCH_KEY = 'new_works_manual_pending_works';

/**
 * 批次作品条数阈值：超过则跳过持久化（log 登记，保持现状=仅摘要 toast、无确认弹窗）。
 * 300 条 ≈ 600KB（单条 ~2KB JSON），远低于 storage.session 单浏览器会话容量上限。
 */
export const MAX_MANUAL_PENDING_BATCH_WORKS = 300;

/** 六桶分项（与 handleManualCheck 的 breakdown 聚合形状一致） */
export interface ManualPendingBreakdown {
  dateRange: number;
  viewed: number;
  browsed: number;
  want: number;
  ar: number;
  categoryBlack: number;
}

/** 终态（done/cancelled）收集到、尚未写入新作品库的完整批次 */
export interface ManualPendingBatch {
  status: 'done' | 'cancelled';
  startedAt: number;
  terminalAt: number;
  pendingCount: number;
  identifiedTotal: number;
  existingCount: number;
  breakdown: ManualPendingBreakdown;
  works: NewWorkRecord[];
}

export interface ManualPendingBatchStore {
  save(batch: ManualPendingBatch): Promise<'saved' | 'skipped-empty' | 'skipped-over-threshold'>;
  /** 只读取回（不消费）：页面回填路径 */
  fetch(): Promise<ManualPendingBatch | null>;
  /** 清盘（幂等）：页面确认流程收口后发送 */
  consume(): Promise<void>;
}

export interface ManualPendingBatchStoreOptions {
  storage: ManualScanStorage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 非法条目防御：只留带非空 string id 的对象条目（与 new-works-manual-commit 的入库形状口径一致） */
function normalizeWorks(value: unknown): NewWorkRecord[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).filter(
    (w): w is NewWorkRecord => isRecord(w) && typeof w.id === 'string' && w.id.length > 0,
  );
}

function normalizeBreakdown(value: unknown): ManualPendingBreakdown {
  const src = isRecord(value) ? value : {};
  const pick = (key: keyof ManualPendingBreakdown): number => {
    const n = Number(src[key]);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  return {
    dateRange: pick('dateRange'),
    viewed: pick('viewed'),
    browsed: pick('browsed'),
    want: pick('want'),
    ar: pick('ar'),
    categoryBlack: pick('categoryBlack'),
  };
}

export function createManualPendingBatchStore(options: ManualPendingBatchStoreOptions): ManualPendingBatchStore {
  const { storage } = options;

  const fetch: ManualPendingBatchStore['fetch'] = async () => {
    try {
      const raw = await storage.get(MANUAL_PENDING_BATCH_KEY);
      if (!isRecord(raw)) return null;
      if (raw.status !== 'done' && raw.status !== 'cancelled') return null;
      const works = normalizeWorks(raw.works);
      if (works.length === 0) return null; // 无可用作品 = 无批次（损坏形状同路径防御）
      return {
        status: raw.status,
        startedAt: Number(raw.startedAt) || 0,
        terminalAt: Number(raw.terminalAt) || 0,
        pendingCount: works.length,
        identifiedTotal: Number(raw.identifiedTotal) || 0,
        existingCount: Number(raw.existingCount) || 0,
        breakdown: normalizeBreakdown(raw.breakdown),
        works,
      };
    } catch {
      return null;
    }
  };

  return {
    async save(batch) {
      const works = normalizeWorks(batch.works);
      if (works.length === 0) return 'skipped-empty';
      if (works.length > MAX_MANUAL_PENDING_BATCH_WORKS) {
        console.log(`[NewWorks] pending 批次超阈值（${works.length} > ${MAX_MANUAL_PENDING_BATCH_WORKS}），跳过持久化（保持现状：仅摘要 toast）`);
        return 'skipped-over-threshold';
      }
      const existing = await fetch();
      if (existing) {
        console.log(`[NewWorks] 新扫描终态覆盖旧未确认 pending 批次（旧 terminalAt=${existing.terminalAt}，新 terminalAt=${batch.terminalAt}，不合并）`);
      }
      await storage.set({
        [MANUAL_PENDING_BATCH_KEY]: {
          status: batch.status,
          startedAt: batch.startedAt,
          terminalAt: batch.terminalAt,
          pendingCount: works.length,
          identifiedTotal: batch.identifiedTotal,
          existingCount: batch.existingCount,
          breakdown: { ...batch.breakdown },
          works,
        },
      });
      return 'saved';
    },
    fetch,
    async consume() {
      await storage.remove(MANUAL_PENDING_BATCH_KEY);
    },
  };
}

/** SW 侧单例（与扫描状态机共用同一套 session storage 解析） */
export const manualPendingBatchStore: ManualPendingBatchStore = createManualPendingBatchStore({
  storage: resolveSessionStorage(),
});
