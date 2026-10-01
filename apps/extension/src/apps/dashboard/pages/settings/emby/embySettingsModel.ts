/**
 * @file embySettingsModel.ts
 * @description Emby/Jellyfin 设置纯数据模型：默认值、映射、校验、媒体服务器列表助手
 * @module apps/dashboard/pages/settings/emby
 */
import type { ExtensionSettings } from '../../../../../types';
import type {
  EmbyLibraryStatusSettings,
  EmbyMediaServer,
  EmbyRealtimeCheckSettings,
  EmbyServerType,
} from '../../../../../features/embyLibrary/types';

/** 番号链接点击行为 */
export type EmbyLinkBehavior = 'javdb-search' | 'javdb-direct';

/** Emby 设置表单状态 */
export type EmbySettingsFormState = {
  /** 兼容/迁移载体：由 recognitionEnabled 或 libraryEnabled 任一为真派生（OR）。页面不再渲染为主开关。 */
  enabled: boolean;
  /** 番号识别 / 转 JavDB 链接能力（不依赖媒体服务器 API Key） */
  recognitionEnabled: boolean;
  /** 媒体库同步 / 入库状态能力（依赖至少一台已启用服务器） */
  libraryEnabled: boolean;
  matchUrls: string[];
  /** 非表单字段：额外匹配地址的编辑草稿（含空行），刷新后可继续编辑；落库 matchUrls 已过滤空行 */
  matchUrlDrafts?: string[];
  linkBehavior: EmbyLinkBehavior;
  showQuickSearchCode: boolean;
  showQuickSearchActor: boolean;
  mediaServers: EmbyMediaServer[];
  syncIntervalMinutes: number;
  /** 入库展示子项：写入 emby.libraryStatus.enabled（与 libraryEnabled 同源）。 */
  libraryStatusEnabled: boolean;
  libraryShowOnList: boolean;
  libraryShowOnDetail: boolean;
  realtimeCheckEnabled: boolean;
  /** 非表单编辑字段，映射时保留 */
  videoCodePatterns: string[];
  enableAutoDetection: boolean;
  highlightStyle: {
    backgroundColor: string;
    color: string;
    borderRadius: string;
    padding: string;
  };
  realtimeConcurrency: number;
  realtimeBatchSize: number;
  realtimeCacheTtlMinutes: number;
};

export const DEFAULT_VIDEO_CODE_PATTERNS = [
  '[A-Z]{2,6}-\\d{2,6}',
  'FC2-PPV-\\d+',
  '\\d{4,8}_\\d{1,3}',
  '\\d{6,12}',
  '[a-z0-9]+-\\d+_\\d+',
];

export const DEFAULT_HIGHLIGHT_STYLE = {
  backgroundColor: '#e3f2fd',
  color: '#1976d2',
  borderRadius: '4px',
  padding: '2px 4px',
};

export const DEFAULT_EMBY_SETTINGS_FORM: EmbySettingsFormState = {
  enabled: false,
  recognitionEnabled: false,
  libraryEnabled: false,
  matchUrls: [],
  linkBehavior: 'javdb-search',
  showQuickSearchCode: true,
  showQuickSearchActor: true,
  mediaServers: [],
  syncIntervalMinutes: 60,
  libraryStatusEnabled: false,
  libraryShowOnList: true,
  libraryShowOnDetail: true,
  realtimeCheckEnabled: false,
  videoCodePatterns: [...DEFAULT_VIDEO_CODE_PATTERNS],
  enableAutoDetection: true,
  highlightStyle: { ...DEFAULT_HIGHLIGHT_STYLE },
  realtimeConcurrency: 1,
  realtimeBatchSize: 20,
  realtimeCacheTtlMinutes: 10,
};

export const LINK_BEHAVIOR_OPTIONS = [
  { value: 'javdb-search', label: '跳转到JavDB搜索页面' },
  { value: 'javdb-direct', label: '直接跳转到JavDB详情页（如果存在）' },
] as const;

export const SERVER_TYPE_OPTIONS = [
  { value: 'emby', label: 'Emby' },
  { value: 'jellyfin', label: 'Jellyfin' },
] as const;

function parseIntSafe(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 生成媒体服务器 id
 */
export function createMediaServerId(): string {
  return `media-server-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeLibraryIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((id) => String(id || '').trim()).filter(Boolean);
}

function normalizeLibraryOptions(
  raw: unknown,
): NonNullable<EmbyMediaServer['libraryOptions']> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const options = raw
    .map((item) => {
      const opt = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const id = String(opt.id || '').trim();
      if (!id) return null;
      return {
        id,
        name: String(opt.name || id).trim(),
        collectionType: opt.collectionType ? String(opt.collectionType) : undefined,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  return options.length > 0 ? options : undefined;
}

/**
 * 规范化单台媒体服务器（保留登录会话与媒体库选择，勿只落 url/apiKey）
 */
export function normalizeMediaServer(raw: unknown, index = 0): EmbyMediaServer {
  const server = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const type: EmbyServerType = server.type === 'jellyfin' ? 'jellyfin' : 'emby';
  const libraryIds = normalizeLibraryIds(server.libraryIds);
  const libraryOptions = normalizeLibraryOptions(server.libraryOptions);
  const username = String(server.username || '').trim();
  const password = String(server.password ?? '');
  const accessToken = String(server.accessToken || '').trim();
  const userId = String(server.userId || '').trim();
  const userDisplayName = String(server.userDisplayName || '').trim();
  const tokenObtainedAt = Number(server.tokenObtainedAt);
  return {
    id: String(server.id || `media-server-${Date.now()}-${index}`),
    type,
    name: String(server.name || (type === 'jellyfin' ? 'Jellyfin' : 'Emby')),
    url: String(server.url || '').trim().replace(/\/+$/, ''),
    apiKey: String(server.apiKey || '').trim(),
    enabled: server.enabled !== false,
    ...(libraryIds.length > 0 ? { libraryIds } : {}),
    ...(libraryOptions ? { libraryOptions } : {}),
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    ...(accessToken ? { accessToken } : {}),
    ...(userId ? { userId } : {}),
    ...(userDisplayName ? { userDisplayName } : {}),
    ...(Number.isFinite(tokenObtainedAt) && tokenObtainedAt > 0
      ? { tokenObtainedAt }
      : {}),
  };
}

/**
 * 规范化媒体服务器列表
 */
export function normalizeMediaServers(raw: unknown): EmbyMediaServer[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => normalizeMediaServer(item, index))
    .filter((server) => server.url || server.apiKey || server.accessToken);
}

/**
 * 校验 http/https 服务器地址
 */
export function isValidServerUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 校验 URL 通配模式
 */
export function isValidUrlPattern(pattern: string): boolean {
  try {
    const regex = pattern.replace(/\*/g, '.*').replace(/\./g, '\\.');
    // eslint-disable-next-line no-new
    new RegExp(regex);
    return true;
  } catch {
    return false;
  }
}

/**
 * 从完整设置 / emby 子对象映射为表单
 */
export function mapSettingsToEmbyForm(
  settings: Partial<ExtensionSettings> | Record<string, unknown> | null | undefined,
): EmbySettingsFormState {
  const source =
    settings && typeof settings === 'object' && 'emby' in (settings as object)
      ? ((settings as Partial<ExtensionSettings>).emby as Record<string, unknown> | undefined)
      : (settings as Record<string, unknown> | null | undefined);

  const emby = source && typeof source === 'object' ? source : {};
  const libraryStatus = (emby.libraryStatus || {}) as Partial<EmbyLibraryStatusSettings>;
  const realtimeCheck = (emby.realtimeCheck || {}) as Partial<EmbyRealtimeCheckSettings>;
  const highlightStyle = (emby.highlightStyle || {}) as Record<string, unknown>;
  const linkBehavior: EmbyLinkBehavior =
    emby.linkBehavior === 'javdb-direct' ? 'javdb-direct' : 'javdb-search';
  const patterns = Array.isArray(emby.videoCodePatterns)
    ? (emby.videoCodePatterns as string[]).map(String)
    : [...DEFAULT_VIDEO_CODE_PATTERNS];
  const matchUrls = Array.isArray(emby.matchUrls)
    ? (emby.matchUrls as string[]).map((u) => String(u))
    : [];
  // 空行草稿：持久化时保留（map 原样），以便刷新页面后仍可继续编辑；
  // 落库的 matchUrls 已在 formToEmbySettings 中过滤为空值。
  const matchUrlDrafts = Array.isArray(emby.matchUrlDrafts)
    ? (emby.matchUrlDrafts as string[]).map((u) => String(u))
    : matchUrls;

  // 主开关拆分：优先读新字段；旧数据（无 recognitionEnabled/libraryEnabled）
  // 回退到 enabled 总闸 + libraryStatus.enabled，与 storage.ts 迁移规则一致。
  const hasNewFields =
    'recognitionEnabled' in emby || 'libraryEnabled' in emby;
  // 旧数据 enabled: true 表示"启用"，undefined/false 表示未启用
  const legacyEnabled = emby.enabled === true;
  const recognitionEnabled = hasNewFields
    ? emby.recognitionEnabled === true
    : legacyEnabled;
  const libraryEnabled = hasNewFields
    ? emby.libraryEnabled === true
    : legacyEnabled && libraryStatus.enabled === true;

  return {
    enabled: recognitionEnabled || libraryEnabled,
    recognitionEnabled,
    libraryEnabled,
    matchUrls: matchUrlDrafts,
    matchUrlDrafts,
    linkBehavior,
    showQuickSearchCode: emby.showQuickSearchCode !== false,
    showQuickSearchActor: emby.showQuickSearchActor !== false,
    mediaServers: normalizeMediaServers(emby.mediaServers),
    syncIntervalMinutes: Math.max(
      5,
      parseIntSafe(emby.syncIntervalMinutes, DEFAULT_EMBY_SETTINGS_FORM.syncIntervalMinutes),
    ),
    libraryStatusEnabled: libraryStatus.enabled === true,
    libraryShowOnList: libraryStatus.showOnList !== false,
    libraryShowOnDetail: libraryStatus.showOnDetail !== false,
    realtimeCheckEnabled: realtimeCheck.enabled === true,
    videoCodePatterns: patterns.length > 0 ? patterns : [...DEFAULT_VIDEO_CODE_PATTERNS],
    enableAutoDetection: emby.enableAutoDetection !== false,
    highlightStyle: {
      backgroundColor: String(
        highlightStyle.backgroundColor ?? DEFAULT_HIGHLIGHT_STYLE.backgroundColor,
      ),
      color: String(highlightStyle.color ?? DEFAULT_HIGHLIGHT_STYLE.color),
      borderRadius: String(
        highlightStyle.borderRadius ?? DEFAULT_HIGHLIGHT_STYLE.borderRadius,
      ),
      padding: String(highlightStyle.padding ?? DEFAULT_HIGHLIGHT_STYLE.padding),
    },
    realtimeConcurrency: parseIntSafe(
      realtimeCheck.concurrency,
      DEFAULT_EMBY_SETTINGS_FORM.realtimeConcurrency,
    ),
    realtimeBatchSize: parseIntSafe(
      realtimeCheck.batchSize,
      DEFAULT_EMBY_SETTINGS_FORM.realtimeBatchSize,
    ),
    realtimeCacheTtlMinutes: parseIntSafe(
      realtimeCheck.cacheTtlMinutes,
      DEFAULT_EMBY_SETTINGS_FORM.realtimeCacheTtlMinutes,
    ),
  };
}

/**
 * 表单 → emby 设置子对象
 */
export function formToEmbySettings(form: EmbySettingsFormState): Record<string, unknown> {
  // 主开关拆分：enabled 由两个能力开关 OR 派生；
  // libraryStatus.enabled 与 libraryEnabled 同源，保留供展示子项与旧读点使用。
  const recognitionEnabled = form.recognitionEnabled;
  const libraryEnabled = form.libraryEnabled;

  return {
    enabled: recognitionEnabled || libraryEnabled,
    recognitionEnabled,
    libraryEnabled,
    // 空行（新建未填/刚清空）直接丢弃，避免空字符串进入设置或触发校验错误
    matchUrls: form.matchUrls.map((u) => u.trim()).filter(Boolean),
    matchUrlDrafts: form.matchUrls,

    videoCodePatterns:
      form.videoCodePatterns.length > 0
        ? [...form.videoCodePatterns]
        : [...DEFAULT_VIDEO_CODE_PATTERNS],
    linkBehavior: form.linkBehavior,
    enableAutoDetection: true,
    highlightStyle: { ...form.highlightStyle },
    showQuickSearchCode: form.showQuickSearchCode,
    showQuickSearchActor: form.showQuickSearchActor,
    mediaServers: normalizeMediaServers(form.mediaServers),
    syncIntervalMinutes: Math.max(5, Number(form.syncIntervalMinutes || 60)),
    libraryStatus: {
      enabled: form.libraryEnabled,
      showOnList: form.libraryShowOnList,
      showOnDetail: form.libraryShowOnDetail,
    },
    realtimeCheck: {
      enabled: form.realtimeCheckEnabled,
      concurrency: form.realtimeConcurrency || 1,
      batchSize: form.realtimeBatchSize || 20,
      cacheTtlMinutes: form.realtimeCacheTtlMinutes || 10,
    },
  };
}

/**
 * 合并表单回完整设置对象
 */
export function applyEmbyFormToSettings(
  current: ExtensionSettings,
  form: EmbySettingsFormState,
): ExtensionSettings {
  return {
    ...current,
    emby: formToEmbySettings(form),
  };
}

/**
 * 服务器是否具备至少一种可用凭据（API Key / 访问令牌 / 用户名+密码）。
 * 对齐桌面端 MediaSourceCredentialsSummary.usable 契约：云同步/旧设备可能只带
 * 登录会话而无 apiKey，不应整页阻断保存；运行时（embyUserAuth/embyPlayback）
 * 亦支持 accessToken 与用户会话鉴权。
 */
export function hasUsableServerCredentials(
  server: Pick<EmbyMediaServer, 'apiKey' | 'accessToken' | 'username' | 'password'>,
): boolean {
  if (server.apiKey && server.apiKey.trim()) return true;
  if (server.accessToken && server.accessToken.trim()) return true;
  if (
    server.username &&
    server.username.trim() &&
    server.password &&
    server.password.trim()
  ) {
    return true;
  }
  return false;
}

/**
 * 服务器标识文案：`媒体服务器 N「名称」（地址）`。
 * - name 为空/全空白 → 回退类型名（Jellyfin / Emby）；
 * - url 为空 → 不拼括号；url 两侧空白先 trim；
 * 用于整表单保存报错与编辑弹窗关闭门禁红字，让用户直接看出是哪一台。
 */
export function mediaServerIdentityLabel(
  server: Pick<EmbyMediaServer, 'name' | 'url' | 'type'>,
  index: number,
): string {
  const name = String(server?.name ?? '').trim()
    || (server?.type === 'jellyfin' ? 'Jellyfin' : 'Emby');
  const url = String(server?.url ?? '').trim();
  const head = `媒体服务器 ${index + 1}「${name}」`;
  return url ? `${head}（${url}）` : head;
}

/**
 * 单台媒体服务器的保存校验（编辑弹窗关闭门禁共用口径）。
 *
 * 停用（enabled === false）的来源不参与保存校验：地址与凭据都可留空。
 * 报错顺序 = 先地址后凭据；返回首个失败项，供弹窗把红字挂到对应字段。
 */
export function validateMediaServerForSave(
  server: EmbyMediaServer,
  index: number,
): {
  ok: boolean;
  message?: string;
  field?: 'url' | 'credentials';
} {
  if (server?.enabled === false) return { ok: true };
  const identity = mediaServerIdentityLabel(server, index);
  if (!isValidServerUrl(String(server?.url ?? '').trim())) {
    return { ok: false, message: `${identity}地址需要使用 http 或 https`, field: 'url' };
  }
  if (!hasUsableServerCredentials(server)) {
    return {
      ok: false,
      message: `${identity}需要至少一种凭据（API Key / 访问令牌 / 用户名+密码）`,
      field: 'credentials',
    };
  }
  return { ok: true };
}

/**
 * 校验 Emby 表单（对齐遗留 doValidateSettings）
 */
export function validateEmbyForm(form: EmbySettingsFormState): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const url of form.matchUrls) {
    if (!url.trim()) {
      errors.push('额外匹配地址不能为空');
      continue;
    }
    if (!isValidUrlPattern(url)) {
      warnings.push(`额外匹配地址可能无效: ${url}`);
    }
  }

  form.mediaServers.forEach((server, index) => {
    // 停用来源不参与保存校验（用户报障：某台停用且未配凭据时整表单保存被阻断）
    if (server?.enabled === false) return;
    const identity = mediaServerIdentityLabel(server, index);
    if (!isValidServerUrl(server.url)) {
      errors.push(`${identity}地址需要使用 http 或 https`);
    }
    if (!hasUsableServerCredentials(server)) {
      errors.push(`${identity}需要至少一种凭据（API Key / 访问令牌 / 用户名+密码）`);
    }
  });

  if (
    !Number.isFinite(form.syncIntervalMinutes) ||
    form.syncIntervalMinutes < 5 ||
    form.syncIntervalMinutes > 10080
  ) {
    errors.push('自动同步间隔必须在 5-10080 分钟之间');
  }

  return { isValid: errors.length === 0, errors, warnings };
}

/**
 * 新建服务器草稿（确认前）
 */
export function createEmptyMediaServerDraft(): EmbyMediaServer {
  return {
    id: createMediaServerId(),
    type: 'emby',
    name: 'Emby',
    url: '',
    apiKey: '',
    enabled: true,
  };
}

/**
 * 服务器凭据形态（用于新增/编辑弹窗的功能可用性提示与校验）。
 * 两种凭据对应媒体集成的不同功能，可同时配置：
 * - API Key：媒体库同步 / 详情拉取 / 播放解析（只读链路）
 * - 用户名+密码：登录获得用户会话后支持进度写回 / 标记已看
 */
export type ServerCredentialMode = 'none' | 'apiKey' | 'account' | 'both';

export function serverCredentialMode(
  input: Pick<EmbyMediaServer, 'apiKey' | 'username' | 'password'>,
): ServerCredentialMode {
  const hasKey = Boolean(input.apiKey && input.apiKey.trim());
  const hasAccount = Boolean(
    input.username && input.username.trim() && input.password && input.password.trim(),
  );
  if (hasKey && hasAccount) return 'both';
  if (hasKey) return 'apiKey';
  if (hasAccount) return 'account';
  return 'none';
}

/**
 * 凭据形态 → 功能可用性提示行（表单内展示，真机核实口径见任务线 research）。
 * loggedIn=true（编辑弹窗已登录会话）时全部功能可用。
 */
export function serverCredentialCapabilityLines(
  input: Pick<EmbyMediaServer, 'apiKey' | 'username' | 'password'> & { loggedIn?: boolean },
): string[] {
  if (input.loggedIn) {
    return [
      '用户会话已登录：媒体库同步、详情拉取、播放解析、进度写回、标记已看全部可用（会话令牌优先，API Key 兜底）',
    ];
  }
  switch (serverCredentialMode(input)) {
    case 'both':
      return [
        'API Key + 账号密码均已配置：媒体库同步、详情拉取、播放解析立即可用；进度写回与标记已看建议在编辑中登录用户账号后使用（登录后会话令牌优先）',
      ];
    case 'apiKey':
      return [
        '仅 API Key：媒体库同步、详情拉取、播放解析可用；进度写回与标记已看需再配置用户名（保存后可在编辑中填写）或登录用户账号',
      ];
    case 'account':
      return [
        '仅账号+密码：保存后请先在编辑弹窗中「登录并保存令牌」；登录前媒体库同步、详情拉取、播放解析不可用',
      ];
    default:
      return [
        '请至少配置一种凭据：API Key，或 用户名+密码（两者可同时配置，分别对应不同功能）',
      ];
  }
}

/**
 * 校验新增/确认服务器。
 * 凭据二选一即可（API Key / 用户名+密码），两者都配置同样合法。
 */
export function validateMediaServerInput(
  server: Pick<EmbyMediaServer, 'url' | 'apiKey' | 'username' | 'password'>,
): {
  ok: boolean;
  message?: string;
  field?: 'url' | 'credentials';
} {
  const url = server.url.trim().replace(/\/+$/, '');
  if (!isValidServerUrl(url)) {
    return { ok: false, message: '媒体服务器地址需要使用 http 或 https', field: 'url' };
  }
  if (serverCredentialMode(server) === 'none') {
    return {
      ok: false,
      message: '媒体服务器需要至少一种凭据（API Key / 访问令牌 / 用户名+密码）',
      field: 'credentials',
    };
  }
  return { ok: true };
}

/**
 * 更新某一服务器字段（会话字段可被 patch 覆盖/清空）
 */
export function updateMediaServerAt(
  servers: EmbyMediaServer[],
  index: number,
  patch: Partial<EmbyMediaServer>,
): EmbyMediaServer[] {
  if (index < 0 || index >= servers.length) return servers;
  const next = [...servers];
  const current = next[index];
  const type: EmbyServerType =
    patch.type === 'jellyfin' || patch.type === 'emby' ? patch.type : current.type;
  const merged: EmbyMediaServer = {
    ...current,
    ...patch,
    id: current.id,
    type,
    name:
      patch.name !== undefined
        ? String(patch.name)
        : current.name || (type === 'jellyfin' ? 'Jellyfin' : 'Emby'),
    url:
      patch.url !== undefined
        ? String(patch.url).trim().replace(/\/+$/, '')
        : current.url,
    apiKey: patch.apiKey !== undefined ? String(patch.apiKey) : current.apiKey,
    enabled: patch.enabled !== undefined ? patch.enabled !== false : current.enabled,
  };
  next[index] = normalizeMediaServer(merged, index);
  return next;
}

/**
 * 删除服务器
 */
export function removeMediaServerAt(
  servers: EmbyMediaServer[],
  index: number,
): EmbyMediaServer[] {
  if (index < 0 || index >= servers.length) return servers;
  const next = [...servers];
  next.splice(index, 1);
  return next;
}

/**
 * 追加服务器
 */
export function addMediaServer(
  servers: EmbyMediaServer[],
  input: Omit<EmbyMediaServer, 'id'> & { id?: string },
): EmbyMediaServer[] {
  const type: EmbyServerType = input.type === 'jellyfin' ? 'jellyfin' : 'emby';
  const server = normalizeMediaServer(
    {
      ...input,
      id: input.id || createMediaServerId(),
      type,
      name: input.name || (type === 'jellyfin' ? 'Jellyfin' : 'Emby'),
      url: input.url,
      apiKey: input.apiKey,
      enabled: input.enabled !== false,
    },
    servers.length,
  );
  return [...servers, server];
}

/**
 * 清除用户登录会话（保留用户名，便于重新登录）
 */
export function clearMediaServerUserSession(server: EmbyMediaServer): EmbyMediaServer {
  const {
    accessToken: _a,
    userId: _u,
    userDisplayName: _d,
    tokenObtainedAt: _t,
    ...rest
  } = server;
  return normalizeMediaServer(rest);
}

/**
 * 更新匹配 URL
 */
export function updateMatchUrlAt(urls: string[], index: number, value: string): string[] {
  if (index < 0 || index >= urls.length) return urls;
  const next = [...urls];
  next[index] = value;
  return next;
}

/**
 * 删除匹配 URL
 */
export function removeMatchUrlAt(urls: string[], index: number): string[] {
  if (index < 0 || index >= urls.length) return urls;
  const next = [...urls];
  next.splice(index, 1);
  return next;
}

/**
 * 追加匹配 URL
 */
export function addMatchUrl(urls: string[], value = ''): string[] {
  return [...urls, value];
}
