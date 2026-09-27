/**
 * @file actorIndexSnapshot.ts
 * @description SW 侧共享演员索引快照（S1-1a：列表 cold 相位治理）。
 *
 * 背景：每个列表 tab 初始化列表增强时都会发起一次全量演员查询
 * （DB:ACTORS_QUERY{sharedIndex}）。actorsQuery 的实现对每次查询都执行
 * `db.getAll('actors')` 全表扫描 —— 16 个列表 tab 就是 16 次全表读 +
 * 16 份全量演员表消息传输。本模块把短窗口（TTL）内的全量读合并为
 * 一次 IDB 读取，并返回 slim 投影（内容侧只用 id/name/aliases/blacklisted/favorited），
 * 显著降低 SW CPU 与消息传输体积。
 *
 * 一致性约定：actors 的所有写路径（PUT/BULK_PUT/DELETE/RESTORE/BULK_RESTORE/
 * PURGE/BULK_PURGE/过期清理）成功后必须调用 invalidate()；构建期间发生失效
 * 时，本次构建结果不落入快照（gen 校验），下一次 get 重新读取。
 * @module apps/background
 */
import type { ActorIndexRecord, ActorRecord } from '../../types';
import { actorsGetAllRecords } from '../../platform/storage/indexedDb';

/** 快照有效期：与内容侧 actorDataCache 的 5 分钟 TTL 对齐。 */
export const ACTOR_INDEX_SNAPSHOT_TTL_MS = 5 * 60 * 1000;

export interface ActorIndexSnapshotEntry {
  items: ActorIndexRecord[];
  total: number;
  at: number;
}

export interface ActorIndexSnapshotDeps {
  loadAll: () => Promise<ActorRecord[]>;
  ttlMs?: number;
  now?: () => number;
}

export interface ActorIndexSnapshot {
  get: () => Promise<ActorIndexSnapshotEntry>;
  invalidate: () => void;
  /** 调试/测试：当前是否存在有效快照。 */
  hasSnapshot: () => boolean;
}

function toSlim(actor: ActorRecord): ActorIndexRecord {
  const slim: ActorIndexRecord = {
    id: actor.id,
    name: actor.name,
    aliases: Array.isArray(actor.aliases) ? [...actor.aliases] : [],
    blacklisted: actor.blacklisted === true,
  };
  // favorited 缺省 = 已收藏：absent 时省略不序列化（快照保持小），内容侧按 !== false 判定
  if (actor.favorited !== undefined) {
    slim.favorited = actor.favorited;
  }
  return slim;
}

/** 与 actorsQuery 默认口径一致：排除软删除、按名称升序。 */
function buildEntry(all: ActorRecord[], at: number): ActorIndexSnapshotEntry {
  const items = all
    .filter((a) => !a.deletedAt)
    .sort((a, b) => (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase()))
    .map(toSlim);
  return { items, total: items.length, at };
}

export function createActorIndexSnapshot(deps: ActorIndexSnapshotDeps): ActorIndexSnapshot {
  const ttlMs = deps.ttlMs ?? ACTOR_INDEX_SNAPSHOT_TTL_MS;
  const now = deps.now ?? Date.now;
  let entry: ActorIndexSnapshotEntry | null = null;
  let inflight: Promise<ActorIndexSnapshotEntry> | null = null;
  let generation = 0;

  const build = (): Promise<ActorIndexSnapshotEntry> => {
    const gen = generation;
    return deps.loadAll()
      .then((all) => buildEntry(all, now()))
      .then((next) => {
        // 构建期间发生过失效（写）：本次结果可能已陈旧，不落入快照。
        if (gen === generation) {
          entry = next;
        }
        return next;
      });
  };

  return {
    get(): Promise<ActorIndexSnapshotEntry> {
      if (entry && now() - entry.at <= ttlMs) {
        return Promise.resolve(entry);
      }
      if (inflight) {
        return inflight;
      }
      inflight = build().finally(() => {
        inflight = null;
      });
      return inflight;
    },
    invalidate(): void {
      entry = null;
      generation += 1;
    },
    hasSnapshot(): boolean {
      return entry !== null;
    },
  };
}

/** SW 全局共享实例（真实 IDB 全量读依赖）。 */
export const actorIndexSnapshot = createActorIndexSnapshot({
  loadAll: actorsGetAllRecords,
});
