/**
 * @file recordsDataBackfill.ts
 * @description 10-08 扩项（288）：全量滤路径数据源一次性回填守卫。
 * 背景：IDB 非空主用户态（285 补迁后）bootstrap 按设计 STATE.records=[]（state.ts），
 * 本地路径全量滤（媒体值 + 既有系列/番号/片商/導演多选）数据源为空 → 0 行。
 * 本模块在本地路径首次渲染前把 IDB 全量一次性回填进 STATE.records：
 *   - dbViewedCount() 实时判定：=0 → no-op（legacy bootstrap 数组有效，防误伤）；
 *   - >0 → dbViewedQuery({limit}) 空条件走 viewedPage 索引快路径全量读 → 整体覆写；
 *   - total > items（count 与查询间新增）→ 防御性二次读（limit=total）；
 *   - per-tab 一次性；并发进入共享同一 in-flight；失败吞错 + 不置完成位（下次可重试）。
 * 红线：谓词语义零改动 / 零新存储键 / select 值不持久化。
 * @module records
 */
import type { VideoRecord } from '../../../types';

export interface RecordsDataBackfillDeps {
  /** 实时 IDB 计数（空条件=全库）。 */
  dbViewedCount: () => Promise<number>;
  /** 全量读（limit 封顶、空条件快路径）。 */
  dbViewedQueryAll: (limit: number) => Promise<{ items: VideoRecord[]; total: number }>;
  /** 整体覆写 STATE.records。 */
  setRecords: (items: VideoRecord[]) => void;
  /** 吞错上报（不抛出、不阻断渲染）。 */
  onError?: (error: unknown) => void;
}

export interface RecordsDataBackfill {
  /** 一次性回填：完成即返回；并发共享 in-flight；失败不置完成位可重试。 */
  ensureLoaded: () => Promise<void>;
  /** 回填是否已完成（no-op 或成功覆写）。 */
  isLoaded: () => boolean;
}

export function createRecordsDataBackfill(deps: RecordsDataBackfillDeps): RecordsDataBackfill {
  let done = false;
  let inflight: Promise<void> | null = null;

  const run = async (): Promise<void> => {
    let count: number;
    try {
      count = await deps.dbViewedCount();
    } catch (error) {
      // count 失败 → 按空处理（no-op），不置完成位，下次进入可重试
      deps.onError?.(error);
      return;
    }
    if (count <= 0) {
      // IDB 空：legacy bootstrap 数组有效，防误伤（不覆写）
      done = true;
      return;
    }
    let page = await deps.dbViewedQueryAll(count);
    if (page.total > page.items.length) {
      // 防御：count 与查询之间新增 → 按 total 二读一次
      page = await deps.dbViewedQueryAll(page.total);
    }
    deps.setRecords(page.items);
    done = true;
  };

  const ensureLoaded = (): Promise<void> => {
    if (done) return Promise.resolve();
    if (inflight) return inflight;
    inflight = run()
      .catch((error: unknown) => {
        // 查询失败 → 吞错（本次进入照常渲染），不置完成位，下次进入可重试
        deps.onError?.(error);
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  return {
    ensureLoaded,
    isLoaded: () => done,
  };
}
