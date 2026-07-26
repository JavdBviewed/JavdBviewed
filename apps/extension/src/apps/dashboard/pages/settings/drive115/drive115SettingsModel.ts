/**
 * @file drive115SettingsModel.ts
 * @description 115 网盘设置纯数据模型：默认值、映射、校验
 * @module apps/dashboard/pages/settings/drive115
 */
import type { ExtensionSettings } from '../../../../../types';

export type Drive115AuthMode = 'openlist_manual' | 'openlist_scan' | 'self_app';

export type Drive115TokenStatus = 'valid' | 'invalid' | 'expired' | 'rate_limited' | 'unknown';

/** 媒体库片库根目录（与 downloadDir 字段独立，可相同） */
export type Drive115MediaLibraryRoot = {
  cid: string;
  name?: string;
  path?: string;
  enabled: boolean;
};

export type Drive115SettingsFormState = {
  enabled: boolean;
  v2AuthMode: Drive115AuthMode;
  v2ApiBaseUrl: string;
  v2ClientId: string;
  v2AccessToken: string;
  v2RefreshToken: string;
  v2TokenExpiresAt: number | null;
  v2RefreshTokenStatus: Drive115TokenStatus;
  v2RefreshTokenLastError?: string;
  v2RefreshTokenLastErrorCode?: number;
  v2RefreshTokenIssuedAtSec: number | null;
  v2AccessTokenStatus: Drive115TokenStatus;
  v2AccessTokenLastError?: string;
  v2AccessTokenLastErrorCode?: number;
  v2AutoRefresh: boolean;
  v2AutoRefreshSkewSec: number;
  v2MinRefreshIntervalMin: number;
  v2LastTokenRefreshAtSec: number | null;
  v2TokenRefreshHistorySec: number[];
  downloadDir: string;
  downloadDirName: string;
  downloadDirPath: string;
  verifyCount: number;
  maxFailures: number;
  /** 媒体库片库根目录列表（多根） */
  mediaLibraryRoots: Drive115MediaLibraryRoot[];
  /** 媒体库索引扫描深度：1=根下影片文件夹，2=分类/番号（默认），3=多一层分类 */
  mediaLibraryScanDepth: number;
  /** 上次手动索引时间（ms） */
  mediaLibraryLastIndexAt: number | null;
  mediaLibraryLastIndexError?: string;
  /** 预留：自动索引，MVP 默认关且无调度 */
  mediaLibraryAutoIndexEnabled: boolean;
  /** 缓存的用户信息（只读展示） */
  v2UserInfo: Record<string, unknown> | null;
  v2UserInfoExpired: boolean;
};

export type Drive115IndexProgressView = {
  running: boolean;
  phase?: string;
  message?: string;
  rootsTotal: number;
  rootsDone: number;
  foldersSeen: number;
  indexed: number;
  skipped: number;
  apiCalls: number;
  updatedAt: number;
};

export function mapDrive115IndexProgressSnapshot(
  raw: unknown,
): Drive115IndexProgressView | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  return {
    running: data.running === true,
    phase: typeof data.phase === 'string' ? data.phase : undefined,
    message: typeof data.message === 'string' ? data.message : undefined,
    rootsTotal: Number(data.rootsTotal) || 0,
    rootsDone: Number(data.rootsDone) || 0,
    foldersSeen: Number(data.foldersSeen) || 0,
    indexed: Number(data.indexed) || 0,
    skipped: Number(data.skipped) || 0,
    apiCalls: Number(data.apiCalls) || 0,
    updatedAt: Number(data.updatedAt) || 0,
  };
}
export const DEFAULT_DRIVE115_SETTINGS_FORM: Drive115SettingsFormState = {
  enabled: false,
  v2AuthMode: 'openlist_manual',
  v2ApiBaseUrl: 'https://proapi.115.com',
  v2ClientId: '',
  v2AccessToken: '',
  v2RefreshToken: '',
  v2TokenExpiresAt: null,
  v2RefreshTokenStatus: 'unknown',
  v2RefreshTokenLastError: undefined,
  v2RefreshTokenLastErrorCode: undefined,
  v2RefreshTokenIssuedAtSec: null,
  v2AccessTokenStatus: 'unknown',
  v2AccessTokenLastError: undefined,
  v2AccessTokenLastErrorCode: undefined,
  v2AutoRefresh: true,
  v2AutoRefreshSkewSec: 60,
  v2MinRefreshIntervalMin: 60,
  v2LastTokenRefreshAtSec: null,
  v2TokenRefreshHistorySec: [],
  downloadDir: '',
  downloadDirName: '',
  downloadDirPath: '',
  verifyCount: 5,
  maxFailures: 5,
  mediaLibraryRoots: [],
  mediaLibraryScanDepth: 2,
  mediaLibraryLastIndexAt: null,
  mediaLibraryLastIndexError: undefined,
  mediaLibraryAutoIndexEnabled: false,
  v2UserInfo: null,
  v2UserInfoExpired: false,
};

export const DRIVE115_AUTH_MODE_OPTIONS = [
  { value: 'openlist_manual', label: '借用 OpenList 手动获取' },
  { value: 'openlist_scan', label: '借用 OpenList 扫码' },
  { value: 'self_app', label: '自有应用扫码' },
] as const;

export const OPENLIST_MANUAL_URL = 'https://api.oplist.org/';

function parseIntSafe(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeAuthMode(raw: unknown): Drive115AuthMode {
  if (raw === 'self_app') return 'self_app';
  if (raw === 'openlist_scan') return 'openlist_scan';
  return 'openlist_manual';
}

function normalizeTokenStatus(raw: unknown): Drive115TokenStatus {
  if (raw === 'valid' || raw === 'invalid' || raw === 'expired' || raw === 'rate_limited') {
    return raw;
  }
  return 'unknown';
}

/**
 * 规范化媒体库索引深度：UI 和 background 都按 1-8 层处理。
 */
export function normalizeMediaLibraryScanDepth(raw: unknown): number {
  const n = parseIntSafe(raw, DEFAULT_DRIVE115_SETTINGS_FORM.mediaLibraryScanDepth);
  if (!Number.isFinite(n)) return DEFAULT_DRIVE115_SETTINGS_FORM.mediaLibraryScanDepth;
  return Math.min(8, Math.max(1, Math.floor(n)));
}


/**
 * 规范化媒体库根目录列表：去空 cid、按 cid 去重（后写覆盖前写）
 */
export function normalizeMediaLibraryRoots(raw: unknown): Drive115MediaLibraryRoot[] {
  if (!Array.isArray(raw)) return [];
  const byCid = new Map<string, Drive115MediaLibraryRoot>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const cid = String(row.cid ?? '').trim();
    if (!cid) continue;
    byCid.set(cid, {
      cid,
      name: typeof row.name === 'string' ? row.name : undefined,
      path: typeof row.path === 'string' ? row.path : undefined,
      enabled: row.enabled !== false,
    });
  }
  return Array.from(byCid.values());
}

/**
 * 从完整设置 / drive115 子对象映射为表单
 */
export function mapSettingsToDrive115Form(
  settings: Partial<ExtensionSettings> | Record<string, unknown> | null | undefined,
): Drive115SettingsFormState {
  const source =
    settings && typeof settings === 'object' && 'drive115' in (settings as object)
      ? ((settings as Partial<ExtensionSettings>).drive115 as Record<string, unknown> | undefined)
      : (settings as Record<string, unknown> | null | undefined);

  const raw = { ...(source || {}) } as Record<string, unknown>;
  const downloadDir = String(
    raw.downloadDir ?? raw.defaultWpPathId ?? DEFAULT_DRIVE115_SETTINGS_FORM.downloadDir,
  );
  const historyRaw = Array.isArray(raw.v2TokenRefreshHistorySec)
    ? (raw.v2TokenRefreshHistorySec as unknown[])
    : [];
  const history = historyRaw
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v > 0);

  const issuedAt = parseIntSafe(
    raw.v2RefreshTokenIssuedAtSec ?? raw.v2LastTokenRefreshAtSec,
    0,
  );

  return {
    enabled: !!raw.enabled,
    v2AuthMode: normalizeAuthMode(raw.v2AuthMode),
    v2ApiBaseUrl: String(raw.v2ApiBaseUrl ?? DEFAULT_DRIVE115_SETTINGS_FORM.v2ApiBaseUrl),
    v2ClientId: String(raw.v2ClientId ?? ''),
    v2AccessToken: String(raw.v2AccessToken ?? ''),
    v2RefreshToken: String(raw.v2RefreshToken ?? ''),
    v2TokenExpiresAt:
      typeof raw.v2TokenExpiresAt === 'number' && Number.isFinite(raw.v2TokenExpiresAt)
        ? raw.v2TokenExpiresAt
        : null,
    v2RefreshTokenStatus: normalizeTokenStatus(raw.v2RefreshTokenStatus),
    v2RefreshTokenLastError:
      typeof raw.v2RefreshTokenLastError === 'string' ? raw.v2RefreshTokenLastError : undefined,
    v2RefreshTokenLastErrorCode:
      typeof raw.v2RefreshTokenLastErrorCode === 'number'
        ? raw.v2RefreshTokenLastErrorCode
        : undefined,
    v2RefreshTokenIssuedAtSec: issuedAt > 0 ? issuedAt : null,
    v2AccessTokenStatus: normalizeTokenStatus(raw.v2AccessTokenStatus),
    v2AccessTokenLastError:
      typeof raw.v2AccessTokenLastError === 'string' ? raw.v2AccessTokenLastError : undefined,
    v2AccessTokenLastErrorCode:
      typeof raw.v2AccessTokenLastErrorCode === 'number'
        ? raw.v2AccessTokenLastErrorCode
        : undefined,
    v2AutoRefresh: raw.v2AutoRefresh !== false,
    v2AutoRefreshSkewSec: Math.max(
      0,
      parseIntSafe(raw.v2AutoRefreshSkewSec, DEFAULT_DRIVE115_SETTINGS_FORM.v2AutoRefreshSkewSec),
    ),
    v2MinRefreshIntervalMin: Math.min(
      120,
      Math.max(
        60,
        parseIntSafe(
          raw.v2MinRefreshIntervalMin,
          DEFAULT_DRIVE115_SETTINGS_FORM.v2MinRefreshIntervalMin,
        ),
      ),
    ),
    v2LastTokenRefreshAtSec: (() => {
      const n = parseIntSafe(raw.v2LastTokenRefreshAtSec, 0);
      return n > 0 ? n : null;
    })(),
    v2TokenRefreshHistorySec: history,
    downloadDir,
    downloadDirName: String(raw.downloadDirName ?? ''),
    downloadDirPath: String(raw.downloadDirPath ?? ''),
    verifyCount: Math.max(
      1,
      parseIntSafe(raw.verifyCount, DEFAULT_DRIVE115_SETTINGS_FORM.verifyCount),
    ),
    maxFailures: Math.max(
      0,
      parseIntSafe(raw.maxFailures, DEFAULT_DRIVE115_SETTINGS_FORM.maxFailures),
    ),
    mediaLibraryRoots: normalizeMediaLibraryRoots(raw.mediaLibraryRoots),
    mediaLibraryScanDepth: normalizeMediaLibraryScanDepth(raw.mediaLibraryScanDepth),
    mediaLibraryLastIndexAt: (() => {
      const n = Number(raw.mediaLibraryLastIndexAt);
      return Number.isFinite(n) && n > 0 ? n : null;
    })(),
    mediaLibraryLastIndexError:
      typeof raw.mediaLibraryLastIndexError === 'string' && raw.mediaLibraryLastIndexError.trim()
        ? raw.mediaLibraryLastIndexError
        : undefined,
    mediaLibraryAutoIndexEnabled: raw.mediaLibraryAutoIndexEnabled === true,
    v2UserInfo:
      raw.v2UserInfo && typeof raw.v2UserInfo === 'object'
        ? (raw.v2UserInfo as Record<string, unknown>)
        : null,
    v2UserInfoExpired: !!raw.v2UserInfoExpired,
  };
}

/**
 * 表单 → 写入 drive115 子对象的补丁（合并用）
 */
export function formToDrive115Patch(
  form: Drive115SettingsFormState,
): Record<string, unknown> {
  return {
    enabled: form.enabled,
    v2AuthMode: form.v2AuthMode,
    v2ApiBaseUrl: form.v2ApiBaseUrl.trim().replace(/\/+$/, ''),
    v2ClientId: form.v2ClientId.trim(),
    v2AccessToken: form.v2AccessToken.trim(),
    v2RefreshToken: form.v2RefreshToken.trim(),
    v2TokenExpiresAt: form.v2TokenExpiresAt,
    v2RefreshTokenStatus: form.v2RefreshTokenStatus,
    v2RefreshTokenLastError: form.v2RefreshTokenLastError,
    v2RefreshTokenLastErrorCode: form.v2RefreshTokenLastErrorCode,
    v2RefreshTokenIssuedAtSec: form.v2RefreshTokenIssuedAtSec,
    v2AccessTokenStatus: form.v2AccessTokenStatus,
    v2AccessTokenLastError: form.v2AccessTokenLastError,
    v2AccessTokenLastErrorCode: form.v2AccessTokenLastErrorCode,
    v2AutoRefresh: form.v2AutoRefresh,
    v2AutoRefreshSkewSec: Math.max(0, Math.floor(form.v2AutoRefreshSkewSec) || 0),
    v2MinRefreshIntervalMin: Math.min(
      120,
      Math.max(60, Math.floor(form.v2MinRefreshIntervalMin) || 60),
    ),
    v2LastTokenRefreshAtSec: form.v2LastTokenRefreshAtSec,
    v2TokenRefreshHistorySec: form.v2TokenRefreshHistorySec,
    downloadDir: form.downloadDir.trim(),
    downloadDirName: form.downloadDirName,
    downloadDirPath: form.downloadDirPath,
    verifyCount: Math.max(1, Math.floor(form.verifyCount) || 1),
    maxFailures: Math.max(0, Math.floor(form.maxFailures) || 0),
    mediaLibraryRoots: normalizeMediaLibraryRoots(form.mediaLibraryRoots),
    mediaLibraryScanDepth: normalizeMediaLibraryScanDepth(form.mediaLibraryScanDepth),
    mediaLibraryLastIndexAt: form.mediaLibraryLastIndexAt,
    mediaLibraryLastIndexError: form.mediaLibraryLastIndexError,
    mediaLibraryAutoIndexEnabled: form.mediaLibraryAutoIndexEnabled === true,
    // 清除旧字段
    defaultWpPathId: undefined,
  };
}

/**
 * 合并表单回完整设置
 */
export function applyDrive115FormToSettings(
  current: ExtensionSettings,
  form: Drive115SettingsFormState,
): ExtensionSettings {
  const prev = ((current as any).drive115 || {}) as Record<string, unknown>;
  const patch = formToDrive115Patch(form);
  const nextDrive115: Record<string, unknown> = { ...prev, ...patch };
  delete nextDrive115.defaultWpPathId;
  return {
    ...current,
    drive115: nextDrive115,
  } as ExtensionSettings;
}

/**
 * 校验表单（对齐遗留 doValidateSettings / Drive115V2Pane.validate）
 */
export function validateDrive115Form(form: Drive115SettingsFormState): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!form.enabled) {
    return { isValid: true, errors, warnings };
  }

  const baseUrl = form.v2ApiBaseUrl.trim();
  if (baseUrl) {
    if (!/^https?:\/\//i.test(baseUrl)) {
      errors.push('v2 接口域名必须以 http(s):// 开头');
    }
    if (/\/$/.test(baseUrl)) {
      errors.push('v2 接口域名末尾不要带 /');
    }
  }

  const at = form.v2AccessToken.trim();
  const rt = form.v2RefreshToken.trim();
  if (at && at.length < 8) {
    errors.push('access_token 看起来不正确（长度过短）');
  }
  if (rt && rt.length < 8) {
    errors.push('refresh_token 看起来不正确（长度过短）');
  }

  if (!Number.isFinite(form.verifyCount) || form.verifyCount < 1 || form.verifyCount > 20) {
    errors.push('验证次数必须在 1-20 之间');
  }
  if (!Number.isFinite(form.maxFailures) || form.maxFailures < 0 || form.maxFailures > 50) {
    errors.push('最大失败数必须在 0-50 之间');
  }
  if (
    !Number.isFinite(form.v2AutoRefreshSkewSec) ||
    form.v2AutoRefreshSkewSec < 0
  ) {
    errors.push('提前刷新秒数不能为负');
  }
  if (
    !Number.isFinite(form.v2MinRefreshIntervalMin) ||
    form.v2MinRefreshIntervalMin < 60 ||
    form.v2MinRefreshIntervalMin > 120
  ) {
    errors.push('最小自动刷新间隔必须在 60-120 分钟之间');
  }

  if (
    !Number.isFinite(form.mediaLibraryScanDepth) ||
    form.mediaLibraryScanDepth < 1 ||
    form.mediaLibraryScanDepth > 8
  ) {
    errors.push('片库索引深度必须在 1-8 层之间');
  }

  if (form.v2AuthMode === 'self_app' && !form.v2ClientId.trim()) {
    warnings.push('自有应用扫码模式建议填写 APP ID');
  }
  if (!at && !rt) {
    warnings.push('尚未配置 access_token / refresh_token');
  }

  return { isValid: errors.length === 0, errors, warnings };
}

/**
 * 格式化秒级时间戳
 */
export function formatDrive115DateTime(tsSec: number | null | undefined): string {
  if (!tsSec || !Number.isFinite(tsSec)) return '-';
  const d = new Date(tsSec * 1000);
  const Y = d.getFullYear();
  const M = d.getMonth() + 1;
  const D = d.getDate();
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mm = `${d.getMinutes()}`.padStart(2, '0');
  const ss = `${d.getSeconds()}`.padStart(2, '0');
  return `${Y}/${M}/${D}  ${hh}:${mm}:${ss}`;
}

/**
 * 剩余时间文案
 */
export function formatDrive115Remain(sec: number): string {
  if (!sec || sec <= 0) return '已过期';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (d > 0) return `${d}天${h}小时${m}分钟${s}秒`;
  if (h > 0) return `${h}小时${m}分钟${s}秒`;
  if (m > 0) return `${m}分钟${s}秒`;
  return `${s}秒`;
}

/**
 * access_token 到期展示
 */
export function getAccessTokenExpiryLabel(
  form: Pick<Drive115SettingsFormState, 'v2AccessToken' | 'v2TokenExpiresAt'>,
  nowSec = Math.floor(Date.now() / 1000),
): { text: string; tone: 'ok' | 'warn' | 'error' | 'muted' } {
  const ts = form.v2TokenExpiresAt;
  if (typeof ts === 'number' && ts > 0) {
    const remain = ts - nowSec;
    if (remain > 0) {
      return {
        text: `（${formatDrive115Remain(remain)}）有效`,
        tone: remain <= 3600 ? 'warn' : 'ok',
      };
    }
    return { text: '已过期', tone: 'error' };
  }
  if ((form.v2AccessToken || '').trim()) {
    return { text: '已填写（待验证）', tone: 'muted' };
  }
  return { text: '未填写', tone: 'muted' };
}

/**
 * refresh_token 状态标签
 */
export function getRefreshTokenStatusLabel(
  form: Pick<
    Drive115SettingsFormState,
    | 'v2RefreshToken'
    | 'v2RefreshTokenStatus'
    | 'v2RefreshTokenLastError'
    | 'v2RefreshTokenLastErrorCode'
    | 'v2RefreshTokenIssuedAtSec'
    | 'v2LastTokenRefreshAtSec'
  >,
  nowSec = Math.floor(Date.now() / 1000),
): { text: string; tone: 'ok' | 'warn' | 'error' | 'muted'; title?: string } {
  const refreshToken = (form.v2RefreshToken || '').trim();
  if (!refreshToken) {
    return {
      text: '未填写',
      tone: 'muted',
      title: '请填写 refresh_token 以便刷新 access_token',
    };
  }

  const status = form.v2RefreshTokenStatus || 'unknown';
  const lastError = form.v2RefreshTokenLastError;
  const lastErrorCode = form.v2RefreshTokenLastErrorCode;
  const errorTitle = lastError
    ? `${lastError}${lastErrorCode ? ` (错误码 ${lastErrorCode})` : ''}`
    : '需要重新授权获取 refresh_token';

  if (status === 'invalid') {
    return { text: '无效', tone: 'error', title: errorTitle };
  }
  if (status === 'expired') {
    return { text: '已过期', tone: 'error', title: errorTitle };
  }

  const issuedAt =
    Number(form.v2RefreshTokenIssuedAtSec || form.v2LastTokenRefreshAtSec || 0) || 0;
  const refreshExpireAt = issuedAt > 0 ? issuedAt + 365 * 24 * 60 * 60 : 0;
  if (refreshExpireAt > nowSec) {
    const d = new Date(refreshExpireAt * 1000);
    const dateOnly = `${d.getFullYear()}/${`${d.getMonth() + 1}`.padStart(2, '0')}/${`${d.getDate()}`.padStart(2, '0')}`;
    const days = Math.ceil((refreshExpireAt - nowSec) / 86400);
    return {
      text: `${dateOnly}（${days}天）有效`,
      tone: 'ok',
      title: `refresh_token 预计有效至 ${formatDrive115DateTime(refreshExpireAt)}`,
    };
  }

  if (status === 'valid') {
    return {
      text: '有效',
      tone: 'ok',
      title: 'refresh_token 当前可用于刷新 access_token',
    };
  }

  return {
    text: '未验证',
    tone: 'muted',
    title:
      '已填写 refresh_token，但尚未通过脚本校验；你可以点击验证有效性，或在自动刷新 access_token 时触发校验',
  };
}

/**
 * access_token 状态小标签
 */
export function getAccessTokenStatusLabel(
  form: Pick<Drive115SettingsFormState, 'v2AccessToken' | 'v2AccessTokenStatus'>,
): { text: string; tone: 'ok' | 'warn' | 'error' | 'muted' } | null {
  if (!(form.v2AccessToken || '').trim()) return null;
  const status = form.v2AccessTokenStatus || 'unknown';
  if (status === 'valid') return { text: '可用', tone: 'ok' };
  if (status === 'expired') return { text: '已过期', tone: 'error' };
  if (status === 'rate_limited') return { text: '刷新受限', tone: 'warn' };
  return { text: '待验证', tone: 'muted' };
}

/**
 * 下次自动刷新时间（秒）
 */
export function computeNextAutoRefreshAt(
  form: Pick<
    Drive115SettingsFormState,
    | 'v2LastTokenRefreshAtSec'
    | 'v2MinRefreshIntervalMin'
    | 'v2TokenExpiresAt'
    | 'v2AutoRefreshSkewSec'
  >,
): number | null {
  const last = form.v2LastTokenRefreshAtSec || 0;
  const minMin = Math.min(120, Math.max(60, form.v2MinRefreshIntervalMin || 60));
  const skewSec = Math.max(0, form.v2AutoRefreshSkewSec || 0);
  const expAt = typeof form.v2TokenExpiresAt === 'number' ? form.v2TokenExpiresAt : 0;
  const nextByInterval = last > 0 ? last + minMin * 60 : 0;
  const nextByExpiry = expAt > 0 ? Math.max(0, expAt - skewSec) : 0;
  const positives = [nextByInterval, nextByExpiry].filter((v) => v > 0);
  if (positives.length === 0) return null;
  if (positives.length === 1) return positives[0];
  return Math.max(positives[0], positives[1]);
}

/**
 * 2 小时内刷新次数
 */
export function countRefreshIn2h(
  history: number[],
  nowSec = Math.floor(Date.now() / 1000),
): number {
  const twoHoursAgo = nowSec - 7200;
  return history.filter((ts) => Number.isFinite(ts) && ts >= twoHoursAgo).length;
}

/**
 * 从用户信息对象提取展示字段
 */
export function extractUserInfoDisplay(user: Record<string, unknown> | null | undefined): {
  uid: string;
  name: string;
  avatar: string;
  isVip: boolean;
  vipLevelName: string;
  vipExpireText: string;
  usedText: string;
  freeText: string;
  totalText: string;
  percent: number;
} | null {
  if (!user || typeof user !== 'object') return null;
  const u = user as any;
  const uid = String(u.uid || u.user_id || u.id || '-');
  const name = String(u.user_name || u.name || u.nick || u.username || `UID ${uid}`);
  const avatar = String(
    u.user_face_m || u.user_face_l || u.user_face_s || u.avatar_middle || u.avatar || u.avatar_small || '',
  );
  const vip = u.vip_info || {};
  const vipLevelName = String(vip.level_name || '');
  const vipExpireTs = typeof vip.expire === 'number' ? vip.expire : undefined;
  const vipExpireText = vipExpireTs
    ? formatExpireDate(vipExpireTs)
    : String(u.vip_expire || '');
  const isVip = vipLevelName
    ? true
    : typeof u.is_vip === 'boolean'
      ? u.is_vip
      : typeof u.is_vip === 'number'
        ? u.is_vip > 0
        : false;

  const space = u.rt_space_info || {};
  const totalSize: number | undefined = space?.all_total?.size;
  const usedSize: number | undefined = space?.all_use?.size;
  const freeSize: number | undefined = space?.all_remain?.size;
  const totalText: string = space?.all_total?.size_format || formatBytes(u.space_total);
  const usedText: string = space?.all_use?.size_format || formatBytes(u.space_used);
  const freeText: string = space?.all_remain?.size_format || formatBytes(u.space_free);
  let percent = 0;
  if (typeof usedSize === 'number' && typeof totalSize === 'number' && totalSize > 0) {
    percent = Math.max(0, Math.min(100, Math.round((usedSize / totalSize) * 100)));
  } else if (
    typeof freeSize === 'number' &&
    typeof totalSize === 'number' &&
    totalSize > 0
  ) {
    percent = Math.max(0, Math.min(100, Math.round(((totalSize - freeSize) / totalSize) * 100)));
  }

  return {
    uid,
    name,
    avatar,
    isVip,
    vipLevelName,
    vipExpireText,
    usedText,
    freeText,
    totalText,
    percent,
  };
}

function formatExpireDate(tsSec: number): string {
  try {
    const d = new Date(tsSec * 1000);
    const y = d.getFullYear();
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch {
    return '';
  }
}

function formatBytes(n?: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

/**
 * 解码 OpenList 内置扫码 APP ID（与遗留 Drive115V2Pane 一致）
 */
export function decodeOpenlistScanClientId(): string {
  const seedParts = [5 + 6, 10 - 3, 20 - 1, 1 + 2];
  const keyBase = seedParts.reduce((acc, value, index) => acc + value * (index + 2), 0);
  const cipherParts = [141, 135, 158, 144, 161, 164, 185, 189, 183];
  const maskAt = (index: number) => [0x30 + 0x0a, 0x2f + 0x0b, 0x38 + 0x02][index % 3];
  return cipherParts
    .map((value, index) => {
      const key = (keyBase + index * 7) & 0xff;
      return String.fromCharCode((value ^ key) ^ maskAt(index));
    })
    .join('');
}

/** 设置页日志列表展示条目（与 Drive115AppLogger 字段对齐的最小视图） */
export type Drive115LogViewEntry = {
  type: string;
  videoId?: string;
  message: string;
  timestamp: number;
};

export type Drive115LogStatsView = {
  total: number;
  recent24h: number;
  byType: Record<string, number>;
};

/** 日志类型中文标签 */
export const DRIVE115_LOG_TYPE_LABELS: Record<string, string> = {
  push_start: '推送开始',
  push_success: '推送成功',
  push_failed: '推送失败',
  offline_start: '离线开始',
  offline_success: '离线成功',
  offline_failed: '离线失败',
  verify_start: '校验开始',
  verify_success: '校验成功',
  verify_failed: '校验失败',
  batch_start: '批量开始',
  batch_complete: '批量完成',
};

/**
 * 格式化日志统计摘要（legacy #drive115LogStats 文案）
 */
export function formatDrive115LogStatsText(stats: Drive115LogStatsView | null | undefined): string {
  if (!stats) return '暂无日志';
  const total = Number(stats.total || 0);
  const recent = Number(stats.recent24h || 0);
  if (total <= 0) return '暂无日志';
  const byType = stats.byType || {};
  const top = Object.entries(byType)
    .filter(([, n]) => Number(n) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 4)
    .map(([k, n]) => `${DRIVE115_LOG_TYPE_LABELS[k] || k} ${n}`)
    .join(' · ');
  const head = `共 ${total} 条，近 24h ${recent} 条`;
  return top ? `${head}（${top}）` : head;
}

/**
 * 单条日志展示行
 */
export function formatDrive115LogEntryText(entry: Drive115LogViewEntry): string {
  // logger 使用 Date.now() 毫秒；formatDrive115DateTime 入参为秒
  const tsMs = typeof entry.timestamp === 'number' ? entry.timestamp : 0;
  const tsSec = tsMs > 1e12 ? Math.floor(tsMs / 1000) : tsMs > 0 ? tsMs : null;
  const ts = formatDrive115DateTime(tsSec);
  const typeLabel = DRIVE115_LOG_TYPE_LABELS[entry.type] || entry.type || '日志';
  const vid = entry.videoId ? ` [${entry.videoId}]` : '';
  const msg = String(entry.message || '').trim() || '(无消息)';
  return `${ts} · ${typeLabel}${vid} · ${msg}`;
}

/**
 * 取最近 N 条（按时间倒序）
 */
export function takeRecentDrive115Logs(
  entries: Drive115LogViewEntry[] | null | undefined,
  limit = 100,
): Drive115LogViewEntry[] {
  const list = Array.isArray(entries) ? [...entries] : [];
  list.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  const n = Math.max(1, Math.min(500, Number(limit) || 100));
  return list.slice(0, n);
}
