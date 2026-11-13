/**
 * 115 网盘会话云同步模型（10-13 线 G3-ii 键级保护 → issue #58 升级为 token 组级时间戳 LWW）。
 *
 * 背景：settings 作为单个 storage_item 整 blob 上云（last-writer-wins）。115 会话
 * （settings.drive115 v2* 键，含 v2AccessToken/v2RefreshToken）经用户裁决=保留并跨设备
 * 云同步（与 emby 4 会话字段剥离方向相反，见 embyMediaServerSync.ts 头注释）。
 *
 * issue #58：10-13 的 G4 已知限制「两侧均非空 → incoming 胜（无时间戳比较）」在真机
 * 表现为 flip-flop——A 设备扫码/刷新拿到新 token 后，陈旧设备 B 的整 settings blob
 * （旧 token）经任一同步周期胜出云端 → A pull 整 blob 替换 → 新 token 被翻回旧值
 * （2 分钟=自动同步周期）。与 10-16 线 emby mediaServers「陈旧设备整 push 覆写云端
 * 较新 in-place 变更」同根，按同一先例修复：
 *
 * 本模块是 settings 分支同步的合并层（纯函数，不改协议面 revision/LWW 信封）：
 * - token 三件套（v2AccessToken/v2RefreshToken/v2TokenExpiresAt）= 一个原子组，
 *   按 v2RefreshTokenIssuedAtSec 组级 LWW（与 emby 条目级 updatedAt LWW 同口径，
 *   服务端 merge_settings.go mergeDrive115Objects 语义逐字对齐）：
 *   local 戳 > incoming 戳 → local 整组胜；incoming 组非空 → incoming 整组胜
 *   （戳更新/平手/双无戳）；incoming 组全空 → 清除不传播，local 组非空则整组保留；
 * - 组外会话键（v2AuthMode/状态/最近刷新时间）保留 10-13 键级保护：
 *   local 非空 + incoming 空/缺 → 保 local；
 * - 键族边界不变：v2ClientId 等非会话配置键不保护，随整 blob LWW（G3-ii 裁决保留）；
 * - A 端清除不传播到 B = known-limitation（服务端 token 失效收敛）；
 * - emby.mediaServers 条目级深合并（embyMediaServerSync）与本函数键面不相交，
 *   由 extensionEntityStore settings 分支串联调用，互不干扰。
 */

type AnyRecord = Record<string, unknown>;

/** v2* 会话键族（10-13 线裁决 G3-ii 规格，逐字；兼容导出）。 */
export const DRIVE115_SESSION_KEYS = [
  'v2AuthMode',
  'v2AccessToken',
  'v2RefreshToken',
  'v2TokenExpiresAt',
  'v2RefreshTokenStatus',
  'v2AccessTokenStatus',
  'v2LastTokenRefreshAtSec',
] as const;

/** token 三件套组（issue #58）：必须作为整体组同步，不得逐键分裂。 */
export const DRIVE115_TOKEN_GROUP_KEYS = ['v2AccessToken', 'v2RefreshToken', 'v2TokenExpiresAt'] as const;

/** 组共享时间戳键：每次 token 写入路径（扫码/手动粘贴/自动刷新）都会写入。 */
export const DRIVE115_TOKEN_GROUP_STAMP_KEY = 'v2RefreshTokenIssuedAtSec';

/** 组外保留旧键级保护的会话键。 */
export const DRIVE115_PROTECTED_SESSION_KEYS = [
  'v2AuthMode',
  'v2RefreshTokenStatus',
  'v2AccessTokenStatus',
  'v2LastTokenRefreshAtSec',
] as const;

function asRecord(value: unknown): AnyRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as AnyRecord;
}

/**
 * 「非空」判定：undefined/null=空；string trim 后为空=空（含空串）；
 * 其余（含 finite number 0）=非空。
 */
function isSessionValuePresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

/** 组时间戳：有限 number 才有效，否则 0（0=无戳=无元数据，与 emby entryTimestamp 同口径）。 */
function tokenGroupStamp(record: AnyRecord | null): number {
  if (!record) return 0;
  const ts = record[DRIVE115_TOKEN_GROUP_STAMP_KEY];
  return typeof ts === 'number' && Number.isFinite(ts) ? ts : 0;
}

/** 三件套任一键非空（isSessionValuePresent 同口径）。 */
function tokenGroupPresent(record: AnyRecord | null): boolean {
  if (!record) return false;
  return DRIVE115_TOKEN_GROUP_KEYS.some((key) => isSessionValuePresent(record[key]));
}

/** 把 src 的 token 三件套 + 时间戳键原子写入 out（src 缺键则从 out 删除，防组内键跨侧混杂）。 */
function applyTokenGroup(out: AnyRecord, src: AnyRecord): void {
  const keys = [...DRIVE115_TOKEN_GROUP_KEYS, DRIVE115_TOKEN_GROUP_STAMP_KEY] as const;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(src, key)) {
      out[key] = src[key];
    } else {
      delete out[key];
    }
  }
}

/** 浅比较（值均为基本类型）：判断合并结果是否与 incoming 原样，供零漂移快路径。 */
function isSameRecord(a: AnyRecord, b: AnyRecord | null): boolean {
  const aKeys = Object.keys(a);
  const bKeys = b ? Object.keys(b) : [];
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!b || !Object.prototype.hasOwnProperty.call(b, key) || a[key] !== b[key]) return false;
  }
  return true;
}

/**
 * pull 应用层合并（与 mergeEmbyMediaServersForPull 并列，settings 分支串联）：
 *
 * - token 三件套按 v2RefreshTokenIssuedAtSec 组级 LWW（issue #58；语义与
 *   Cloud 服务端 mergeDrive115Objects 逐字对齐）；
 * - 组外会话键：local 非空 + incoming 空/缺 → 保 local（10-13 键级保护不变）；
 * - 未触发任何保护时原样返回 incoming（同引用零漂移快路径）；
 * - 纯函数：不改 local/incoming 输入。
 */
export function mergeDrive115SessionForPull(localSettings: unknown, incomingSettings: unknown): unknown {
  const incomingRoot = asRecord(incomingSettings);
  if (!incomingRoot) return incomingSettings;

  const localDrive115 = asRecord(asRecord(localSettings)?.drive115);
  if (!localDrive115) return incomingSettings;

  const incomingDrive115 = asRecord(incomingRoot.drive115);
  const mergedDrive115: AnyRecord = { ...(incomingDrive115 ?? {}) };

  const localStamp = tokenGroupStamp(localDrive115);
  const incomingStamp = tokenGroupStamp(incomingDrive115);
  if (localStamp > incomingStamp) {
    // local 组严格更新：local 整组胜（三件套 + 时间戳键），拒收 incoming 组
    applyTokenGroup(mergedDrive115, localDrive115);
  } else if (incomingDrive115 && tokenGroupPresent(incomingDrive115)) {
    // incoming 组胜（戳更新/平手/双无戳）：整组原子写入
    applyTokenGroup(mergedDrive115, incomingDrive115);
  } else if (tokenGroupPresent(localDrive115)) {
    // incoming 组全空：清除不传播（10-13 known-limitation）——local 组非空则整组保留
    applyTokenGroup(mergedDrive115, localDrive115);
  }

  // 组外会话键：10-13 键级保护（local 非空 + incoming 空/缺 → 保 local）
  for (const key of DRIVE115_PROTECTED_SESSION_KEYS) {
    const localValue = localDrive115[key];
    const incomingValue = incomingDrive115 ? incomingDrive115[key] : undefined;
    if (isSessionValuePresent(localValue) && !isSessionValuePresent(incomingValue)) {
      mergedDrive115[key] = localValue;
    }
  }

  if (isSameRecord(mergedDrive115, incomingDrive115)) return incomingSettings;
  return { ...incomingRoot, drive115: mergedDrive115 };
}
