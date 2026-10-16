/**
 * Emby 媒体源云同步模型（X2，10-13 线）：会话剥离 + 按源 id 并集合并 + 墓碑前移 + 条目级 updatedAt 戳。
 *
 * 背景（M8 定性）：settings 作为单个 storage_item 整 blob 上云，last-writer-wins，导致
 * ① emby.mediaServers 会话字段随 blob 跨设备流转（隐私面）；
 * ② 一台设备的整 blob 推/拉冲掉另一台的媒体源列表，且墓碑只在 import 过滤、挡不住 pull 回灌（数据可靠面）。
 *
 * 本模块是 settings 分支同步的合并层（纯函数，不改协议面 revision/LWW）：
 * - push 前：stripEmbySessionFieldsFromValue 剥离 4 会话字段（accessToken/userId/userDisplayName/tokenObtainedAt），
 *   本地 storage 不动；
 * - pull 应用层：mergeEmbyMediaServersForPull 按条目 id 并集合并 + 丢弃远端会话 + 墓碑（local∪remote）
 *   前置过滤远端活体条目（删源不复活）；
 * - 保存侧：stampEmbyMediaServerUpdateTimes 给新增/变更条目打 updatedAt（同 id 冲突 last-write 的依据，
 *   与既有 applyEmbyDeletedServerTombstones 同址调用，fail-open）。
 *
 * 用户 10-15 裁决（红线内定案）：115 会话（settings.drive115 v2* 键，含 v2AccessToken）= 保留并跨设备云同步，
 * 与 emby 4 会话字段方向相反；本模块只动 emby.mediaServers 条目，drive115 零触碰。
 */

import { readEmbyDeletedServerIds, unionServerIds } from './embyDeletedServers';

type AnyRecord = Record<string, unknown>;

/** 剥离范围=4 会话字段（PRD §二.1）。凭据类字段（username/password/apiKey）不在范围。 */
export const EMBY_SESSION_FIELDS = [
  'accessToken',
  'userId',
  'userDisplayName',
  'tokenObtainedAt',
] as const;

function asRecord(value: unknown): AnyRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as AnyRecord;
}

/** 归一化 server id（与 embyDeletedServers 同语义：任意类型转 string + trim，空值 ''）。 */
function normalizedServerId(server: unknown): string {
  const record = asRecord(server);
  if (!record) return '';
  return String(record.id ?? '').trim();
}

/** 条目级时间戳：有限 number 才有效，否则 0（旧 blob 无戳=无元数据）。 */
function entryTimestamp(entry: unknown): number {
  const record = asRecord(entry);
  const ts = record?.updatedAt;
  return typeof ts === 'number' && Number.isFinite(ts) ? ts : 0;
}

/** 深比较用稳定序列化（键排序）。仅用于小体量 settings 条目，非热路径。 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const s = JSON.stringify(value);
    return s === undefined ? 'undefined' : s;
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as AnyRecord).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as AnyRecord)[k])}`).join(',')}}`;
}

function hasOwn(rec: AnyRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(rec, key);
}

/** 读 mediaServers 数组（非数组/缺失 → 空数组）。 */
function readServerList(embyRec: AnyRecord | null | undefined): unknown[] {
  const v = embyRec?.mediaServers;
  return Array.isArray(v) ? (v as unknown[]) : [];
}

/**
 * push 前剥离：去掉 emby.mediaServers 各条目的 4 会话字段。
 *
 * - 无 emby / 无 mediaServers 数组 / 无会话字段时原样返回（同引用，零拷贝）；
 * - 纯函数：不改输入；drive115 等其余键零触碰（115 会话=保留跨设备云同步，用户 10-15 定案）。
 */
export function stripEmbySessionFieldsFromValue(settingsValue: unknown): unknown {
  const root = asRecord(settingsValue);
  if (!root) return settingsValue;
  const emby = asRecord(root.emby);
  if (!emby || !Array.isArray(emby.mediaServers)) return settingsValue;

  let changed = false;
  const mediaServers = emby.mediaServers.map((server) => {
    const rec = asRecord(server);
    if (!rec) return server;
    if (!EMBY_SESSION_FIELDS.some((f) => hasOwn(rec, f))) return server;
    changed = true;
    const copy: AnyRecord = { ...rec };
    for (const f of EMBY_SESSION_FIELDS) delete copy[f];
    return copy;
  });
  if (!changed) return settingsValue;
  return { ...root, emby: { ...emby, mediaServers } };
}

/**
 * pull 应用层合并（替换整 blob LWW 的 settings 分支）：
 *
 * - 顶层/emby 子设置：远端 LWW（整 blob 权威不变，协议面零改动）；
 * - emby.mediaServers：按条目 id 并集（双端各自新增源互不冲掉）；
 * - 同 id 冲突：非会话字段按条目 updatedAt last-write（双方无戳=远端胜，实体级 LWW 权威）；
 * - 会话字段=local-only 属性：远端会话一律丢弃，本地已有会话保留（session 永不跨设备）；
 * - 墓碑前移：合并结果先过 local∪remote deletedServerIds 再落盘（远端陈旧活体不复活）；
 * - 兼容：远端无 emby 对象 → 本地 emby 配置保留（不再被整 blob 冲掉）；双端均无 emby / 远端非对象 → 远端原样；
 *   旧 blob（含会话、无 updatedAt）→ 剥离会话 + 按现有 id 落；无 id 条目远端保留、本地丢弃（对齐既有语义）；
 * - 纯函数：不改 local/remote 输入。
 */
export function mergeEmbyMediaServersForPull(localSettings: unknown, remoteSettings: unknown): unknown {
  const remoteRoot = asRecord(remoteSettings);
  if (!remoteRoot) return remoteSettings;

  const localEmby = asRecord(asRecord(localSettings)?.emby);
  const remoteEmby = asRecord(remoteRoot.emby);
  if (!remoteEmby && !localEmby) return remoteSettings;

  const tombstones = unionServerIds(
    readEmbyDeletedServerIds(localEmby),
    readEmbyDeletedServerIds(remoteEmby),
  );
  const tombstoneSet = new Set(tombstones);

  // emby 对象基底：远端在 → 远端子设置 LWW；远端无 emby → 保留本地 emby 配置
  const baseEmby: AnyRecord = remoteEmby ? { ...remoteEmby } : { ...(localEmby as AnyRecord) };

  const localServers: unknown[] = readServerList(localEmby);
  const remoteServers: unknown[] = readServerList(remoteEmby);

  // 远端条目：先剥会话（不接收任何远端会话）
  const strippedRemote = remoteServers.map((server) => {
    const rec = asRecord(server);
    if (!rec) return server;
    const copy: AnyRecord = { ...rec };
    for (const f of EMBY_SESSION_FIELDS) delete copy[f];
    return copy;
  });

  const localById = new Map<string, AnyRecord>();
  for (const server of localServers) {
    const rec = asRecord(server);
    const id = normalizedServerId(rec);
    if (rec && id) localById.set(id, rec);
  }

  const merged: unknown[] = [];
  for (const server of strippedRemote) {
    const rec = asRecord(server);
    const id = normalizedServerId(rec);
    if (!rec) {
      merged.push(server);
      continue;
    }
    if (!id) {
      merged.push(server); // 无 id 条目：保留远端（对齐既有 import 过滤语义）
      continue;
    }
    if (tombstoneSet.has(id)) continue; // 墓碑前移：远端活体条目先过滤
    const localRec = localById.get(id);
    localById.delete(id);
    if (!localRec) {
      merged.push(server);
      continue;
    }
    // 同 id：非会话字段 last-write（无戳/平手 → 远端胜）
    const winner: AnyRecord =
      entryTimestamp(server) >= entryTimestamp(localRec) ? (server as AnyRecord) : localRec;
    const out: AnyRecord = { ...winner };
    for (const f of EMBY_SESSION_FIELDS) delete out[f];
    for (const f of EMBY_SESSION_FIELDS) {
      if (hasOwn(localRec, f)) out[f] = localRec[f]; // 会话字段仅取自本地
    }
    merged.push(out);
  }
  // local-only 并集：本端新增源在 pull 后保留（不再被整 blob 覆盖冲掉）
  for (const rec of localById.values()) {
    if (tombstoneSet.has(normalizedServerId(rec))) continue;
    merged.push(rec);
  }

  const nextEmby: AnyRecord = { ...baseEmby, mediaServers: merged };
  if (tombstones.length > 0) {
    nextEmby.deletedServerIds = tombstones;
  } else {
    delete nextEmby.deletedServerIds;
  }
  return { ...remoteRoot, emby: nextEmby };
}

/**
 * 保存侧条目级 updatedAt 戳（与 applyEmbyDeletedServerTombstones 同址、同 fail-open 契约）：
 *
 * - 新增条目 / 字段变更条目（stableStringify 深比较，updatedAt 自身除外）→ updatedAt = now；
 * - 未变更条目：已有戳保留（条目经 normalizeMediaServer 重建丢 updatedAt 键时从 prev 补拷原戳）、
 *   无戳不加键（零漂移，避免无谓 blob 变更；最小新增，报备见收口报）；
 * - 原地更新 nextSettings 并返回；不改 prev；next 无 emby 时 no-op 且不创建 emby 键。
 *
 * @param now 注入时间戳（测试用），缺省 Date.now()
 */
export function stampEmbyMediaServerUpdateTimes(
  prevSettings: unknown,
  nextSettings: AnyRecord,
  now?: number,
): AnyRecord {
  const nextEmby = asRecord(nextSettings.emby);
  if (!nextEmby || !Array.isArray(nextEmby.mediaServers)) return nextSettings;

  const prevEmby = asRecord(asRecord(prevSettings)?.emby);
  const prevById = new Map<string, AnyRecord>();
  if (prevEmby && Array.isArray(prevEmby.mediaServers)) {
    for (const server of prevEmby.mediaServers) {
      const rec = asRecord(server);
      const id = normalizedServerId(rec);
      if (rec && id) prevById.set(id, rec);
    }
  }

  const ts = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  for (const server of nextEmby.mediaServers) {
    const rec = asRecord(server);
    const id = normalizedServerId(rec);
    if (!rec || !id) continue; // 无 id 条目不可按 id 追踪，不打戳
    const prevRec = prevById.get(id);
    const unchanged =
      prevRec !== undefined &&
      stableStringify({ ...rec, updatedAt: undefined }) === stableStringify({ ...prevRec, updatedAt: undefined });
    if (unchanged) {
      // 未变更：已有戳保留、无戳不加键（零漂移）。
      // 条目经 normalizeMediaServer 重建（表单保存路径，固定字段集不含 updatedAt）会丢键，
      // 此时从 prev 补拷原戳，落实上方「已有戳保留」契约（R2 裁决，2026-10-16）。
      if (rec.updatedAt === undefined && typeof prevRec.updatedAt === 'number' && Number.isFinite(prevRec.updatedAt)) {
        rec.updatedAt = prevRec.updatedAt;
      }
      continue;
    }
    rec.updatedAt = ts; // 新增/字段变更 → 打戳（同 id 冲突 last-write 依据）
  }
  return nextSettings;
}
