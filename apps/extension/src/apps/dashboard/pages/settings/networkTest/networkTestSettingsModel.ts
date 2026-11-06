/**
 * @file networkTestSettingsModel.ts
 * @description 网络配置设置纯数据模型：默认值、映射、线路 CRUD、校验
 * @module apps/dashboard/pages/settings/networkTest
 */
import type { ExtensionSettings } from '../../../../../types';
import { mergeJavdbRoutesForPull, stampJavdbRouteEdit } from '../../../../../shared/javdbRouteSync';

/** GitHub 加速代理服务 */
export type GithubProxyService =
  | 'ghproxy'
  | 'mirror'
  | 'api99988866'
  | 'jsdelivr'
  | 'custom';

export type RouteAlternative = {
  url: string;
  enabled: boolean;
  description: string;
  addedAt: number;
};

export type ServiceRoutesConfig = {
  primary: string;
  preferredUrl?: string;
  alternatives: RouteAlternative[];
  updatedAt?: number;
};

export type RoutesConfig = {
  javdb: ServiceRoutesConfig;
  javbus: ServiceRoutesConfig;
};

/** 线路展示行（主线路 + 备用） */
export type RouteListItem = {
  url: string;
  enabled: boolean;
  description: string;
  isPrimary: boolean;
  addedAt: number;
};

export type NetworkTestSettingsFormState = {
  githubEnabled: boolean;
  proxyService: GithubProxyService;
  customProxyUrl: string;
  routes: RoutesConfig;
};

export const GITHUB_PROXY_OPTIONS: { value: GithubProxyService; label: string }[] = [
  { value: 'ghproxy', label: 'ghproxy.com（推荐）' },
  { value: 'mirror', label: 'mirror.ghproxy.com' },
  { value: 'api99988866', label: 'gh.api.99988866.xyz' },
  { value: 'jsdelivr', label: 'jsDelivr CDN' },
  { value: 'custom', label: '自定义代理' },
];

export const PROXY_URL_MAP: Record<Exclude<GithubProxyService, 'custom'>, string> = {
  ghproxy: 'https://ghproxy.com/',
  mirror: 'https://mirror.ghproxy.com/',
  api99988866: 'https://gh.api.99988866.xyz/',
  jsdelivr: 'https://cdn.jsdelivr.net/gh/',
};

export const DEFAULT_JAVDB_PRIMARY = 'https://javdb.com';
export const DEFAULT_JAVBUS_PRIMARY = 'https://www.javbus.com';

export const DEFAULT_ROUTES: RoutesConfig = {
  javdb: {
    primary: DEFAULT_JAVDB_PRIMARY,
    alternatives: [
      {
        url: 'https://javdb570.com',
        enabled: true,
        description: '备用线路1',
        addedAt: 0,
      },
      {
        url: 'https://javdb575.com',
        enabled: true,
        description: '备用线路2',
        addedAt: 0,
      },
      {
        url: 'https://javdb36.com',
        enabled: true,
        description: '备用线路3',
        addedAt: 0,
      },
    ],
  },
  javbus: {
    primary: DEFAULT_JAVBUS_PRIMARY,
    alternatives: [],
  },
};

/** 遗留「恢复默认」线路（与 NetworkTestSettings.handleResetDefaultRoutes 对齐） */
export const RESET_DEFAULT_ROUTES: RoutesConfig = {
  javdb: {
    primary: DEFAULT_JAVDB_PRIMARY,
    alternatives: [
      {
        url: 'https://javdb570.com',
        enabled: true,
        description: '备用线路',
        addedAt: 0,
      },
      {
        url: 'https://javdb575.com',
        enabled: true,
        description: '备用线路2',
        addedAt: 0,
      },
    ],
  },
  javbus: {
    primary: DEFAULT_JAVBUS_PRIMARY,
    alternatives: [],
  },
};

export const DEFAULT_NETWORK_TEST_FORM: NetworkTestSettingsFormState = {
  githubEnabled: true,
  proxyService: 'ghproxy',
  customProxyUrl: '',
  routes: structuredClone
    ? structuredClone(DEFAULT_ROUTES)
    : (JSON.parse(JSON.stringify(DEFAULT_ROUTES)) as RoutesConfig),
};

function cloneRoutes(routes: RoutesConfig): RoutesConfig {
  return JSON.parse(JSON.stringify(routes)) as RoutesConfig;
}

function normalizeAlternative(raw: any): RouteAlternative {
  return {
    url: String(raw?.url || ''),
    enabled: raw?.enabled !== false,
    description: String(raw?.description || ''),
    addedAt: typeof raw?.addedAt === 'number' ? raw.addedAt : 0,
  };
}

function normalizeServiceRoutes(
  raw: any,
  fallback: ServiceRoutesConfig,
): ServiceRoutesConfig {
  const primary = String(raw?.primary || fallback.primary);
  const alternatives = Array.isArray(raw?.alternatives)
    ? raw.alternatives.map(normalizeAlternative).filter((r: RouteAlternative) => !!r.url)
    : fallback.alternatives.map((r) => ({ ...r }));
  const preferredUrl =
    typeof raw?.preferredUrl === 'string' && raw.preferredUrl
      ? raw.preferredUrl
      : undefined;
  return {
    primary,
    ...(preferredUrl ? { preferredUrl } : {}),
    alternatives,
    ...(Number.isSafeInteger(raw?.updatedAt) && raw.updatedAt > 0 ? { updatedAt: raw.updatedAt } : {}),
  };
}

export function stampEditedJavdbRoutes(previous: RoutesConfig, next: RoutesConfig, now = Date.now()): RoutesConfig {
  return { ...next, javdb: stampJavdbRouteEdit(previous.javdb, next.javdb, now) };
}

/**
 * 解析代理基址（对齐遗留 getProxyUrl）
 */
export function getProxyBaseUrl(
  service: GithubProxyService | string,
  customUrl: string,
): string {
  if (service === 'custom') {
    return customUrl || PROXY_URL_MAP.ghproxy;
  }
  return (
    PROXY_URL_MAP[service as Exclude<GithubProxyService, 'custom'>] || PROXY_URL_MAP.ghproxy
  );
}

/**
 * 从 ExtensionSettings 映射表单
 */
export function mapSettingsToNetworkTestForm(
  settings: Partial<ExtensionSettings> | null | undefined,
): NetworkTestSettingsFormState {
  const github = (settings as any)?.networkAcceleration?.github;
  const routesRaw = (settings as any)?.routes;
  return {
    githubEnabled: github?.enabled !== false,
    proxyService: (github?.proxyService as GithubProxyService) || 'ghproxy',
    customProxyUrl: String(github?.customProxyUrl || ''),
    routes: {
      javdb: normalizeServiceRoutes(routesRaw?.javdb, DEFAULT_ROUTES.javdb),
      javbus: normalizeServiceRoutes(routesRaw?.javbus, DEFAULT_ROUTES.javbus),
    },
  };
}

/**
 * 将表单合并回 ExtensionSettings
 */
export function applyNetworkTestFormToSettings(
  current: ExtensionSettings,
  form: NetworkTestSettingsFormState,
): ExtensionSettings {
  return {
    ...current,
    networkAcceleration: {
      ...((current as any).networkAcceleration || {}),
      github: {
        enabled: form.githubEnabled,
        proxyService: form.proxyService,
        customProxyUrl: form.customProxyUrl,
      },
    },
    routes: (mergeJavdbRoutesForPull(current, { routes: cloneRoutes(form.routes) }) as { routes: RoutesConfig }).routes,
  };
}

/**
 * 合并主线路与备用线路，首选排前
 */
export function buildRouteListItems(
  serviceRoutes: ServiceRoutesConfig,
): RouteListItem[] {
  const preferred = serviceRoutes.preferredUrl || serviceRoutes.primary;
  const items: RouteListItem[] = [
    {
      url: serviceRoutes.primary,
      enabled: true,
      description: '主线路',
      isPrimary: true,
      addedAt: 0,
    },
    ...serviceRoutes.alternatives.map((r) => ({
      url: r.url,
      enabled: r.enabled,
      description: r.description,
      isPrimary: false,
      addedAt: r.addedAt,
    })),
  ];
  return items.sort((a, b) => {
    const aPref = a.url === preferred;
    const bPref = b.url === preferred;
    if (aPref && !bPref) return -1;
    if (!aPref && bPref) return 1;
    return 0;
  });
}

export function getPreferredUrl(serviceRoutes: ServiceRoutesConfig): string {
  return serviceRoutes.preferredUrl || serviceRoutes.primary;
}

export type AddRouteResult =
  | { ok: true; routes: RoutesConfig }
  | { ok: false; error: string };

/**
 * 添加 JavDB 备用线路
 */
export function addJavdbRoute(
  routes: RoutesConfig,
  urlRaw: string,
  description: string,
): AddRouteResult {
  const url = urlRaw.trim();
  if (!url) {
    return { ok: false, error: '请输入线路 URL' };
  }
  try {
    // eslint-disable-next-line no-new
    new URL(url);
  } catch {
    return { ok: false, error: 'URL 格式不正确' };
  }

  const next = cloneRoutes(routes);
  if (url === next.javdb.primary) {
    return { ok: false, error: '该线路已存在（主线路）' };
  }
  if (next.javdb.alternatives.some((r) => r.url === url)) {
    return { ok: false, error: '该线路已存在' };
  }

  next.javdb.alternatives.push({
    url,
    enabled: true,
    description: description.trim(),
    addedAt: Date.now(),
  });
  return { ok: true, routes: next };
}

/**
 * 切换备用线路启用状态
 */
export function toggleJavdbRoute(
  routes: RoutesConfig,
  url: string,
  enabled: boolean,
): RoutesConfig | null {
  const next = cloneRoutes(routes);
  const route = next.javdb.alternatives.find((r) => r.url === url);
  if (!route) return null;
  route.enabled = enabled;
  return next;
}

/**
 * 设为首选线路
 */
export function setPreferredJavdbRoute(routes: RoutesConfig, url: string): RoutesConfig {
  const next = cloneRoutes(routes);
  next.javdb.preferredUrl = url;
  return next;
}

/**
 * 删除备用线路
 */
export function deleteJavdbRoute(routes: RoutesConfig, url: string): RoutesConfig | null {
  const next = cloneRoutes(routes);
  const index = next.javdb.alternatives.findIndex((r) => r.url === url);
  if (index < 0) return null;
  next.javdb.alternatives.splice(index, 1);
  return next;
}

/**
 * 恢复默认线路
 */
export function resetDefaultRoutes(): RoutesConfig {
  const routes = cloneRoutes(RESET_DEFAULT_ROUTES);
  routes.javdb.alternatives = routes.javdb.alternatives.map((r) => ({
    ...r,
    addedAt: Date.now(),
  }));
  return routes;
}

/**
 * 延迟徽章等级
 */
export type LatencyLevel = 'excellent' | 'good' | 'medium' | 'poor' | 'error';

export function getLatencyLevel(latency: number): LatencyLevel {
  if (latency < 0) return 'error';
  if (latency < 200) return 'excellent';
  if (latency < 500) return 'good';
  if (latency < 1000) return 'medium';
  return 'poor';
}

export function formatLatencyLabel(latency: number): string {
  if (latency < 0) return '失败';
  return `${latency}ms`;
}

export function getPriorityText(priority: 'high' | 'medium' | 'low'): string {
  const map = { high: '高', medium: '中', low: '低' };
  return map[priority];
}

/**
 * 格式化上次测试时间（相对）
 */
export function formatLastTestTime(isoTime: string | null | undefined): string {
  if (!isoTime) return '从未';
  try {
    const testDate = new Date(isoTime);
    if (Number.isNaN(testDate.getTime())) return '从未';
    const now = new Date();
    const diffMs = now.getTime() - testDate.getTime();
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMinutes < 1) return '刚刚';
    if (diffMinutes < 60) return `${diffMinutes}分钟前`;
    if (diffHours < 24) return `${diffHours}小时前`;
    if (diffDays < 7) return `${diffDays}天前`;

    const year = testDate.getFullYear();
    const month = String(testDate.getMonth() + 1).padStart(2, '0');
    const day = String(testDate.getDate()).padStart(2, '0');
    const hours = String(testDate.getHours()).padStart(2, '0');
    const minutes = String(testDate.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  } catch {
    return '从未';
  }
}

export function validateNetworkTestForm(form: NetworkTestSettingsFormState): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (form.proxyService === 'custom' && form.githubEnabled) {
    const url = form.customProxyUrl.trim();
    if (!url) {
      errors.push('自定义代理地址不能为空');
    } else {
      try {
        // eslint-disable-next-line no-new
        new URL(url);
      } catch {
        errors.push('自定义代理地址格式不正确');
      }
    }
  }
  return { isValid: errors.length === 0, errors };
}
