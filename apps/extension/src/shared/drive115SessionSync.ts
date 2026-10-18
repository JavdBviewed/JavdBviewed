/**
 * 115 网盘会话云同步模型（10-13 线，用户裁决 8）：pull 侧逐键方向性保护。
 *
 * 背景：settings 作为单个 storage_item 整 blob 上云（last-writer-wins）。115 会话
 * （settings.drive115 v2* 键，含 v2AccessToken/v2RefreshToken）经用户裁决=保留并跨设备
 * 云同步（与 emby 4 会话字段剥离方向相反，见 embyMediaServerSync.ts 头注释），
 * 因此 drive115 是 blob 内多生产者键：另一台设备的无关设置写（无会话 blob）可经 LWW
 * 胜出并静默抹掉云端会话，本端下次 pull 整 blob 替换后连本地会话一起丢失。
 *
 * 本模块是 settings 分支同步的合并层（纯函数，不改协议面 revision/LWW 信封）：
 * - 逐键方向性保护：对 7 个 v2* 会话键，local 非空 且 incoming 空/缺 → 保 local 该键；
 *   否则 incoming 原样胜（现状整 blob LWW 语义不变）；
 * - 不做时间戳比较：两侧均非空但新旧不同 = known-limitation（手动同步收敛，
 *   与 G4 refresh 轮换竞态窗同口径，服务端 token 失效自然收敛）；
 * - A 端清除/解除授权不传播到 B = known-limitation（服务端 token 失效收敛），不做；
 * - 键族边界：v2ClientId 等非会话配置键不保护，随整 blob LWW；
 * - emby.mediaServers 条目级深合并（embyMediaServerSync）与本函数键面不相交，
 *   由 extensionEntityStore settings 分支串联调用，互不干扰。
 */

type AnyRecord = Record<string, unknown>;

/** v2* 会话键族（10-13 线裁决 G3-ii 规格，逐字）。 */
export const DRIVE115_SESSION_KEYS = [
  'v2AuthMode',
  'v2AccessToken',
  'v2RefreshToken',
  'v2TokenExpiresAt',
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

/**
 * pull 应用层逐键方向性保护（与 mergeEmbyMediaServersForPull 并列，settings 分支串联）：
 *
 * - local 会话键非空 且 incoming 同键空/缺 → 保 local 该键（防另一台设备无关设置写抹会话）；
 * - 其余键/情形 → incoming 原样胜（现状语义）；
 * - 未触发保护时原样返回 incoming（同引用零漂移快路径）；
 * - 纯函数：不改 local/incoming 输入。
 */
export function mergeDrive115SessionForPull(localSettings: unknown, incomingSettings: unknown): unknown {
  const incomingRoot = asRecord(incomingSettings);
  if (!incomingRoot) return incomingSettings;

  const localDrive115 = asRecord(asRecord(localSettings)?.drive115);
  const incomingDrive115 = asRecord(incomingRoot.drive115);

  const preserved: AnyRecord = {};
  if (localDrive115) {
    for (const key of DRIVE115_SESSION_KEYS) {
      const localValue = localDrive115[key];
      const incomingValue = incomingDrive115 ? incomingDrive115[key] : undefined;
      if (isSessionValuePresent(localValue) && !isSessionValuePresent(incomingValue)) {
        preserved[key] = localValue;
      }
    }
  }

  if (Object.keys(preserved).length === 0) return incomingSettings;

  const mergedDrive115: AnyRecord = { ...(incomingDrive115 ?? {}), ...preserved };
  return { ...incomingRoot, drive115: mergedDrive115 };
}
