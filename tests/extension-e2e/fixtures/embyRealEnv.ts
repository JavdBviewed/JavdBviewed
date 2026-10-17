/**
 * @file embyRealEnv.ts
 * @description 「已看影片整理」真实容器 E2E（mediaCleanup*Real 系 spec）共享环境夹具。
 *
 * 凭据口径（10-16-emby-e2e-fixture-fix 定案，38098=emby-test-b1 实测）：
 *   1. EMBY_E2E_API_KEY：显式注入的有效 api_key（注入后以 /System/Configuration 核 admin 性）。
 *      注意：emby-test-b1（emby_unlockd:4.9.5.0）build 级缺失 /ApiKeys 管理路由且无 key
 *      存储表，旧默认 key 恒 401 → 此夹具上 api_key 模式结构性不可用，token 模式为准。
 *   2. EMBY_E2E_USERNAME + EMBY_E2E_PASSWORD：产品同形 POST /Users/AuthenticateByName
 *      运行时登录取 token（10-13 x2 线口径；凭据零回显，仅记长度投影）。
 *   3. root 公开空密码哨兵（PRD ①「root 公开空密码或新 api_key」；哨兵只读登录、不修改）。
 * 解析链：api_key（有效）→ env 用户/密码登录 → root 哨兵登录；全失败=无凭据（preflight 显式 skip）。
 *
 * preflight 两级判定（PRD ③）：/System/Info 200=可达（并实读真实版本）+ 鉴权端点
 * （/Users/AuthenticateByName）凭据可用；无效凭据=显式 skip 带原因，不再静默跑满轮询上限。
 *
 * 轮询语义（PRD ④）：此 build /Tasks//Tasks/Status 404（任务态查询不可行）→
 * 90s 上限 + 401 快速失败。实测 RefreshMediaLibraryTask 3000 文件约 5s 完成，余量充足。
 *
 * 鉴权头=产品同形 buildMediaBrowserAuthHeader（embyUserAuth.ts）：此 build 强制
 * X-Emby-Authorization（缺失=400「appName null」）。
 */

export const EMBY_E2E_URL = (process.env.EMBY_E2E_URL ?? 'http://127.0.0.1:38098').replace(/\/+$/, '');
export const EMBY_E2E_MEDIA_ROOT = process.env.EMBY_E2E_MEDIA_ROOT ?? '/home/ryen/emby-b1/media/Movies';

/** 扫库索引等待上限（PRD ④：任务态查询此 build 不可行 → 90s 上限 + 401 快速失败）。 */
export const INDEX_POLL_TIMEOUT_MS = 90_000;

/** 单次 HTTP 超时（本地测试容器，10s 充足）。 */
const HTTP_TIMEOUT_MS = 10_000;

const EMBY_API_KEY_ENV = (process.env.EMBY_E2E_API_KEY ?? '').trim();
const EMBY_USERNAME_ENV = (process.env.EMBY_E2E_USERNAME ?? '').trim();
const EMBY_PASSWORD_ENV = (process.env.EMBY_E2E_PASSWORD ?? '').trim();

/** MediaBrowser 鉴权头（产品同形，embyUserAuth.ts buildMediaBrowserAuthHeader）。 */
function mediaBrowserAuthHeader(token: string | null): string {
  const tokenPart = token ? `, Token="${token}"` : '';
  return `MediaBrowser Client="JavdBviewed", Device="ChromeExtension", DeviceId="E2E-MediaCleanup", Version="4.9.5"${tokenPart}`;
}

export type EmbyAuth =
  | { mode: 'api_key'; apiKey: string }
  | { mode: 'token'; token: string; userId: string; userName: string; isAdministrator: boolean; source: 'env' | 'root-sentinel' };

export type EmbyAuthSet = {
  /** 主凭据：扩展 settings 播种 + 条目查询/删除。 */
  primary: EmbyAuth;
  /** 管理操作凭据（/Library/Refresh 等 admin 端点）。 */
  admin: EmbyAuth;
};

export type EmbyLoginResult = {
  token: string;
  userId: string;
  userName: string;
  isAdministrator: boolean;
};

/** 产品同形登录：POST /Users/AuthenticateByName（失败返回 null，凭据零回显）。 */
export async function embyLoginUser(username: string, password: string): Promise<EmbyLoginResult | null> {
  try {
    const response = await fetch(`${EMBY_E2E_URL}/Users/AuthenticateByName`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Emby-Authorization': mediaBrowserAuthHeader(null),
        Accept: 'application/json',
      },
      body: JSON.stringify({ Username: username, Pw: password, Password: password }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body: any = await response.json().catch(() => null);
    const token = String(body?.AccessToken || '').trim();
    const userId = String(body?.User?.Id || '').trim();
    if (!token || !userId) return null;
    return {
      token,
      userId,
      userName: String(body?.User?.Name || username).trim(),
      isAdministrator: Boolean(body?.User?.Policy?.IsAdministrator),
    };
  } catch {
    return null;
  }
}

/** 凭据解析链：api_key（/System/Configuration 核 admin）→ env 用户/密码 → root 哨兵。 */
export async function resolveEmbyAuthSet(): Promise<EmbyAuthSet | null> {
  let admin: EmbyAuth | null = null;

  if (EMBY_API_KEY_ENV) {
    try {
      const response = await fetch(
        `${EMBY_E2E_URL}/System/Configuration?api_key=${encodeURIComponent(EMBY_API_KEY_ENV)}`,
        { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) },
      );
      if (response.ok) {
        // 200=有效且 admin（admin 端点）→ 单一凭据覆盖两种角色
        return { primary: { mode: 'api_key', apiKey: EMBY_API_KEY_ENV }, admin: { mode: 'api_key', apiKey: EMBY_API_KEY_ENV } };
      }
    } catch {
      /* 不可达等 → 落到后续凭据 */
    }
  }

  // env 用户登录（primary 候选）；env 用户 isAdministrator=true 才兼 admin，
  // 否则 admin 回落 root 哨兵（MyEmbyUser 非 admin，/Library/Refresh 需 admin 凭据）。
  let envUser: EmbyLoginResult | null = null;
  if (EMBY_USERNAME_ENV && EMBY_PASSWORD_ENV) {
    envUser = await embyLoginUser(EMBY_USERNAME_ENV, EMBY_PASSWORD_ENV);
  }

  if (envUser?.isAdministrator) {
    admin = { mode: 'token', ...envUser, source: 'env' };
  } else {
    const root = await embyLoginUser('root', '');
    if (root) admin = { mode: 'token', ...root, source: 'root-sentinel' };
  }
  if (!admin) return null;

  // primary=env 用户（用户视角读+删）；无 env 凭据时 admin（root 哨兵）兼两职。
  const primary: EmbyAuth = envUser ? { mode: 'token', ...envUser, source: 'env' } : admin;
  return { primary, admin };
}

let authSetPromise: Promise<EmbyAuthSet | null> | null = null;
export function getEmbyAuthSet(): Promise<EmbyAuthSet | null> {
  if (!authSetPromise) authSetPromise = resolveEmbyAuthSet();
  return authSetPromise;
}

/** 两级 preflight（PRD ③）：可达性（/System/Info 实读版本）+ 鉴权端点凭据可用。 */
export async function embyPreflight(): Promise<{ ok: boolean; reason: string; version: string | null }> {
  let version: string | null = null;
  try {
    const response = await fetch(`${EMBY_E2E_URL}/System/Info`, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    if (!response.ok) {
      return { ok: false, reason: `Emby 测试容器不可达（${EMBY_E2E_URL} /System/Info HTTP ${response.status}）`, version: null };
    }
    const info: any = await response.json().catch(() => null);
    version = typeof info?.Version === 'string' ? info.Version : null;
  } catch {
    return { ok: false, reason: `Emby 测试容器不可达（${EMBY_E2E_URL}）`, version: null };
  }
  const set = await getEmbyAuthSet();
  if (!set) {
    return {
      ok: false,
      reason:
        `Emby 夹具凭据不可用（v${version ?? '?'}）：api_key 未注入或无效、env 凭据登录失败、root 哨兵登录失败`
        + '（此 build 无 API key 管理路由，无法新建 api_key；注入 EMBY_E2E_API_KEY 或 EMBY_E2E_USERNAME/EMBY_E2E_PASSWORD 后重跑）',
      version,
    };
  }
  return { ok: true, reason: '', version };
}

/** 请求头（产品同形 buildEmbyAuthHeaders：token→X-Emby-Token+完整 MediaBrowser 头）。 */
export function embyAuthHeaders(auth: EmbyAuth): Record<string, string> {
  if (auth.mode === 'token') {
    return { Accept: 'application/json', 'X-Emby-Token': auth.token, 'X-Emby-Authorization': mediaBrowserAuthHeader(auth.token) };
  }
  return { Accept: 'application/json' };
}

/** api_key 模式拼 query；token 模式走头。 */
export function embyAuthPath(pathAndQuery: string, auth: EmbyAuth): string {
  if (auth.mode === 'api_key') {
    const sep = pathAndQuery.includes('?') ? '&' : '?';
    return `${pathAndQuery}${sep}api_key=${encodeURIComponent(auth.apiKey)}`;
  }
  return pathAndQuery;
}

/**
 * 统一请求入口。auth 缺省=primary 凭据；401 由调用方 fast-fail 判别。
 */
export async function embyJson(
  pathAndQuery: string,
  init?: RequestInit,
  authOverride?: EmbyAuth,
): Promise<{ status: number; body: any }> {
  let auth = authOverride;
  if (!auth) {
    const set = await getEmbyAuthSet();
    if (!set) throw new Error('EMBY 凭据不可用（preflight 应先 skip，此处为防御性抛出）');
    auth = set.primary;
  }
  const response = await fetch(`${EMBY_E2E_URL}${embyAuthPath(pathAndQuery, auth)}`, {
    ...init,
    headers: { ...embyAuthHeaders(auth), ...(init?.headers || {}) },
    signal: init?.signal ?? AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const text = await response.text().catch(() => '');
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body };
}

/**
 * 扩展 settings 播种用服务器条目：api_key 模式=旧形状（apiKey）；
 * token 模式=用户会话形状（accessToken+userId+username，与 PermissionReal 先例一致）。
 */
export function buildSeededServerEntry(auth: EmbyAuth, id: string, name: string): Record<string, unknown> {
  if (auth.mode === 'api_key') {
    return { id, type: 'emby', name, url: EMBY_E2E_URL, apiKey: auth.apiKey, enabled: true };
  }
  return {
    id,
    type: 'emby',
    name,
    url: EMBY_E2E_URL,
    apiKey: '',
    username: auth.userName,
    userDisplayName: auth.userName,
    accessToken: auth.token,
    userId: auth.userId,
    enabled: true,
  };
}
