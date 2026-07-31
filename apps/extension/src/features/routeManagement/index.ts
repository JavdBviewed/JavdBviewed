/**
 * 线路管理器
 * 负责管理和获取 JavDB/JavBus 的可用线路
 * 支持从远程 GitHub 仓库自动更新线路配置
 */

import { getRepoRawUrl } from '../../shared/repoIdentity';
import type { ExtensionSettings } from '../../types';
import { buildServerApiUrl, verifyJsonChecksum } from '../../platform/network/serverEndpointResolver';
import { createDefaultRouteSettings } from './defaultRoutes';

export type ServiceType = 'javdb' | 'javbus';

const DEFAULT_ROUTES = createDefaultRouteSettings();

/**
 * 远程线路配置接口
 */
interface RemoteRoutesConfig {
    version: string;
    lastUpdated: string;
    updateInterval: number;
    remoteUrl: string;
    services: {
        javdb: {
            name: string;
            primary: string;
            alternatives: Array<{
                url: string;
                region: string;
                status: string;
                addedAt: string;
                description: string;
            }>;
        };
        javbus: {
            name: string;
            primary: string;
            alternatives: Array<{
                url: string;
                region: string;
                status: string;
                addedAt: string;
                description: string;
            }>;
        };
    };
}

interface ServerRemoteConfig {
    schemaVersion: 1;
    updatedAt: string;
    routes: Record<string, {
        primary: string;
        alternatives: Array<{
            url: string;
            status: 'active' | 'degraded' | 'disabled' | string;
            description?: string;
        }>;
    }>;
    updatePolicy?: {
        latestVersion?: string;
        minimumVersion?: string;
        releaseUrl?: string;
    };
    featureFlags?: Record<string, boolean>;
    checksum?: string;
}

type ServerRemoteConfigFetchResult =
    | { status: 'ok'; config: ServerRemoteConfig }
    | { status: 'unavailable' }
    | { status: 'rejected' };

type ServerRemoteConfigParseResult =
    | { status: 'ok'; config: ServerRemoteConfig }
    | { status: 'invalid' };

type NavigatorWithUserAgentData = Navigator & {
    userAgentData?: {
        platform?: string;
    };
};

/**
 * 线路更新状态
 */
interface RoutesUpdateStatus {
    lastCheckTime: number;
    lastUpdateTime: number;
    currentVersion: string;
    remoteVersion?: string;
}

interface RouteAlternative {
    url: string;
    enabled: boolean;
    description?: string;
    addedAt?: number;
}

/**
 * 线路管理器类
 */
export class RouteManager {
    private static instance: RouteManager;
    private cache: Map<ServiceType, string> = new Map();
    private cacheExpiry: Map<ServiceType, number> = new Map();
    private readonly CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存

    private constructor() {}

    /**
     * 获取单例实例
     */
    static getInstance(): RouteManager {
        if (!this.instance) {
            this.instance = new RouteManager();
        }
        return this.instance;
    }

    /**
     * 获取指定服务的当前可用域名
     * @param service 服务类型 ('javdb' | 'javbus')
     * @returns 完整的 URL（如 https://javdb.com）
     */
    async getCurrentRoute(service: ServiceType): Promise<string> {
        // 检查缓存
        const cached = this.cache.get(service);
        const expiry = this.cacheExpiry.get(service);

        if (cached && expiry && Date.now() < expiry) {
            return cached;
        }

        // 从存储获取配置
        const settings = await this.getSettings();
        const routes = settings.routes || DEFAULT_ROUTES;
        const serviceRoutes = routes[service];

        // 优先使用用户设置的首选线路
        let currentRoute = serviceRoutes.preferredUrl || serviceRoutes.primary;

        // 验证首选线路是否有效（是否在主线路或备用线路中）
        const allRoutes = [
            serviceRoutes.primary,
            ...serviceRoutes.alternatives.filter((alt: RouteAlternative) => alt.enabled).map((alt: RouteAlternative) => alt.url)
        ];

        if (!allRoutes.includes(currentRoute)) {
            // 如果首选线路无效，回退到主线路
            currentRoute = serviceRoutes.primary;
        }

        // 更新缓存
        this.cache.set(service, currentRoute);
        this.cacheExpiry.set(service, Date.now() + this.CACHE_TTL);

        return currentRoute;
    }

    /**
     * 获取指定服务的所有启用的线路
     * @param service 服务类型
     * @returns 线路 URL 数组
     */
    async getAllEnabledRoutes(service: ServiceType): Promise<string[]> {
        const settings = await this.getSettings();
        const routes = settings.routes || DEFAULT_ROUTES;
        const serviceRoutes = routes[service];

        const enabledRoutes = [serviceRoutes.primary];

        // 添加所有启用的备用线路
        serviceRoutes.alternatives
            .filter((alt: RouteAlternative) => alt.enabled)
            .forEach((alt: RouteAlternative) => enabledRoutes.push(alt.url));

        return enabledRoutes;
    }

    /**
     * 构建完整的 URL
     * @param service 服务类型
     * @param path 路径（如 /users/watched_videos）
     * @returns 完整的 URL
     */
    async buildUrl(service: ServiceType, path: string): Promise<string> {
        const baseUrl = await this.getCurrentRoute(service);

        // 确保路径以 / 开头
        const normalizedPath = path.startsWith('/') ? path : `/${path}`;

        return `${baseUrl}${normalizedPath}`;
    }

    /**
     * 替换 URL 中的域名为当前可用线路
     * @param url 原始 URL
     * @param service 服务类型
     * @returns 替换后的 URL
     */
    async replaceUrlDomain(url: string, service: ServiceType): Promise<string> {
        try {
            const urlObj = new URL(url);
            const currentRoute = await this.getCurrentRoute(service);
            const currentRouteObj = new URL(currentRoute);

            urlObj.protocol = currentRouteObj.protocol;
            urlObj.host = currentRouteObj.host;

            return urlObj.toString();
        } catch (error) {
            console.error('[RouteManager] 替换 URL 域名失败:', error);
            return url;
        }
    }

    /**
     * 清除缓存
     */
    clearCache(service?: ServiceType): void {
        if (service) {
            this.cache.delete(service);
            this.cacheExpiry.delete(service);
        } else {
            this.cache.clear();
            this.cacheExpiry.clear();
        }
    }

    /**
     * 从远程 GitHub 仓库检查并更新线路配置
     * @param force 是否强制更新（忽略更新间隔）
     * @returns 是否成功更新
     */
    async checkAndUpdateRoutes(force: boolean = false): Promise<boolean> {
        try {
            const REMOTE_URL = getRepoRawUrl('public/routes.json');
            const UPDATE_INTERVAL = 24 * 60 * 60 * 1000; // 24小时

            // 获取更新状态
            const updateStatus = await this.getUpdateStatus();

            // 检查是否需要更新
            if (!force && updateStatus.lastCheckTime) {
                const timeSinceLastCheck = Date.now() - updateStatus.lastCheckTime;
                if (timeSinceLastCheck < UPDATE_INTERVAL) {
                    console.debug('[RouteManager] 距离上次检查不足24小时，跳过更新');
                    return false;
                }
            }

            // 更新检查时间
            await this.saveUpdateStatus({
                ...updateStatus,
                lastCheckTime: Date.now()
            });

            const serverConfigResult = await this.fetchServerRemoteConfig();
            if (serverConfigResult.status === 'ok') {
                const remoteConfig = this.convertServerConfigToRoutesConfig(serverConfigResult.config);
                if (updateStatus.currentVersion === remoteConfig.version) {
                    console.debug('[RouteManager] 已是最新版本:', remoteConfig.version);
                    return false;
                }

                console.info('[RouteManager] 发现服务端线路配置:', remoteConfig.version, '当前版本:', updateStatus.currentVersion);
                await this.mergeRemoteRoutes(remoteConfig);
                await this.saveUpdateStatus({
                    lastCheckTime: Date.now(),
                    lastUpdateTime: Date.now(),
                    currentVersion: remoteConfig.version,
                    remoteVersion: remoteConfig.version
                });
                this.clearCache();
                console.info('[RouteManager] 线路配置已从服务端更新到版本:', remoteConfig.version);
                return true;
            }

            if (serverConfigResult.status === 'rejected') {
                return false;
            }

            // 获取远程配置
            console.info('[RouteManager] 正在从 GitHub 获取最新线路配置...');
            const response = await fetch(REMOTE_URL, {
                cache: 'no-cache',
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                console.warn('[RouteManager] 获取远程配置失败:', response.status);
                return false;
            }

            const remoteConfig: RemoteRoutesConfig = await response.json();

            // 检查版本
            if (updateStatus.currentVersion === remoteConfig.version) {
                console.debug('[RouteManager] 已是最新版本:', remoteConfig.version);
                return false;
            }

            console.info('[RouteManager] 发现新版本:', remoteConfig.version, '当前版本:', updateStatus.currentVersion);

            // 合并远程配置到用户设置
            await this.mergeRemoteRoutes(remoteConfig);

            // 更新状态
            await this.saveUpdateStatus({
                lastCheckTime: Date.now(),
                lastUpdateTime: Date.now(),
                currentVersion: remoteConfig.version,
                remoteVersion: remoteConfig.version
            });

            // 清除缓存
            this.clearCache();

            console.info('[RouteManager] 线路配置已更新到版本:', remoteConfig.version);
            return true;

        } catch (error) {
            console.error('[RouteManager] 更新线路配置失败:', error);
            return false;
        }
    }

    private async fetchServerRemoteConfig(): Promise<ServerRemoteConfigFetchResult> {
        try {
            const url = await this.buildServerConfigUrl();
            const response = await fetch(url, {
                cache: 'no-cache',
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                console.warn('[RouteManager] 获取服务端远程配置失败:', response.status);
                return { status: 'unavailable' };
            }

            const parsed = await this.parseServerConfigResponse(response);
            if (parsed.status !== 'ok') {
                console.debug('[RouteManager] 服务端远程配置被拒绝');
                return { status: 'rejected' };
            }
            return { status: 'ok', config: parsed.config };
        } catch (error) {
            console.warn('[RouteManager] 获取服务端远程配置异常:', error);
            return { status: 'unavailable' };
        }
    }

    private async parseServerConfigResponse(response: Response): Promise<ServerRemoteConfigParseResult> {
        const config = await this.readResponseJson(response);
        if (!this.isServerRemoteConfig(config)) {
            console.debug('[RouteManager] 服务端远程配置格式无效');
            return { status: 'invalid' };
        }
        const checksum = this.getResponseHeader(response, 'x-config-checksum')
            || (typeof config.checksum === 'string' ? config.checksum : '');

        if (checksum && !await verifyJsonChecksum(config, checksum)) {
            console.debug('[RouteManager] 服务端远程配置 checksum 校验失败');
            return { status: 'invalid' };
        }

        return { status: 'ok', config };
    }

    private isServerRemoteConfig(value: unknown): value is ServerRemoteConfig {
        if (!value || typeof value !== 'object') return false;
        const config = value as Partial<ServerRemoteConfig>;
        return config.schemaVersion === 1
            && typeof config.updatedAt === 'string'
            && Boolean(config.routes)
            && typeof config.routes === 'object';
    }

    private async readResponseJson(response: Response): Promise<unknown> {
        const textReader = (response as Response & { text?: () => Promise<string> }).text;
        if (typeof textReader === 'function') {
            return JSON.parse(await textReader.call(response));
        }
        return response.json();
    }

    private getResponseHeader(response: Response, name: string): string {
        const headers = (response as Response & { headers?: { get: (headerName: string) => string | null } }).headers;
        return headers?.get(name) || '';
    }

    private async buildServerConfigUrl(): Promise<string> {
        const manifest = chrome.runtime.getManifest();
        return buildServerApiUrl('/v1/config', {
            channel: 'stable',
            version: String(manifest?.version || 'unknown'),
            platform: this.detectPlatform(),
            locale: this.getLocale(),
        });
    }

    private detectPlatform(): string {
        try {
            const nav = navigator as NavigatorWithUserAgentData;
            const platform = String(nav.userAgentData?.platform || nav.platform || '').toLowerCase();
            if (platform.includes('win')) return 'windows';
            if (platform.includes('mac')) return 'macos';
            if (platform.includes('linux')) return 'linux';
            if (platform.includes('android')) return 'android';
            if (platform.includes('iphone') || platform.includes('ipad') || platform.includes('ios')) return 'ios';
            return platform || 'unknown';
        } catch {
            return 'unknown';
        }
    }

    private getLocale(): string {
        try {
            return navigator.language || 'en-US';
        } catch {
            return 'en-US';
        }
    }

    private convertServerConfigToRoutesConfig(config: ServerRemoteConfig): RemoteRoutesConfig {
        const javdbRoutes = config.routes.javdb || {};
        const javbusRoutes = config.routes.javbus || {};
        return {
            version: config.updatedAt || String(config.updatePolicy?.latestVersion || Date.now()),
            lastUpdated: config.updatedAt || new Date().toISOString(),
            updateInterval: 24 * 60 * 60 * 1000,
            remoteUrl: '/v1/config',
            services: {
                javdb: this.convertServerRouteGroup('JavDB', javdbRoutes, DEFAULT_ROUTES.javdb.primary),
                javbus: this.convertServerRouteGroup('JavBus', javbusRoutes, DEFAULT_ROUTES.javbus.primary),
            },
        };
    }

    private convertServerRouteGroup(
        name: string,
        routeGroup: ServerRemoteConfig['routes'][string],
        fallbackPrimary: string,
    ): RemoteRoutesConfig['services']['javdb'] {
        return {
            name,
            primary: typeof routeGroup.primary === 'string' && routeGroup.primary ? routeGroup.primary : fallbackPrimary,
            alternatives: Array.isArray(routeGroup.alternatives)
                ? routeGroup.alternatives
                    .filter(route => route && typeof route.url === 'string' && route.url && route.status !== 'disabled')
                    .map(route => ({
                        url: route.url,
                        region: 'global',
                        status: route.status || 'active',
                        addedAt: new Date().toISOString(),
                        description: route.description || '服务端线路',
                    }))
                : [],
        };
    }

    /**
     * 合并远程线路配置到用户设置
     * 保留用户自定义的线路和首选设置
     */
    private async mergeRemoteRoutes(remoteConfig: RemoteRoutesConfig): Promise<void> {
        const settings = await this.getSettings();
        const currentRoutes = settings.routes || DEFAULT_ROUTES;

        // 处理 JavDB 线路
        const javdbRemote = remoteConfig.services.javdb;
        const javdbCurrent = currentRoutes.javdb;

        // 获取用户自定义的线路（不在远程配置中的）
        const javdbCustomRoutes = javdbCurrent.alternatives.filter((alt: RouteAlternative) =>
            !javdbRemote.alternatives.some(remote => remote.url === alt.url)
        );

        // 合并线路：远程线路 + 用户自定义线路
        const javdbMergedAlternatives = [
            ...javdbRemote.alternatives.map(remote => ({
                url: remote.url,
                enabled: true,
                description: remote.description,
                addedAt: Date.parse(remote.addedAt) || Date.now()
            })),
            ...javdbCustomRoutes
        ];

        // 处理 JavBus 线路
        const javbusRemote = remoteConfig.services.javbus;
        const javbusCurrent = currentRoutes.javbus;

        const javbusCustomRoutes = javbusCurrent.alternatives.filter((alt: RouteAlternative) =>
            !javbusRemote.alternatives.some(remote => remote.url === alt.url)
        );

        const javbusMergedAlternatives = [
            ...javbusRemote.alternatives.map(remote => ({
                url: remote.url,
                enabled: true,
                description: remote.description,
                addedAt: Date.parse(remote.addedAt) || Date.now()
            })),
            ...javbusCustomRoutes
        ];

        // 更新设置（保留用户的 preferredUrl）
        settings.routes = {
            javdb: {
                primary: javdbRemote.primary,
                preferredUrl: javdbCurrent.preferredUrl,
                alternatives: javdbMergedAlternatives
            },
            javbus: {
                primary: javbusRemote.primary,
                preferredUrl: javbusCurrent.preferredUrl,
                alternatives: javbusMergedAlternatives
            }
        };

        await this.saveSettings(settings);
        console.info('[RouteManager] 线路配置已合并，保留了用户自定义线路');
    }

    /**
     * 获取更新状态
     */
    private async getUpdateStatus(): Promise<RoutesUpdateStatus> {
        return new Promise((resolve) => {
            chrome.storage.local.get('routes_update_status', (result) => {
                resolve((result.routes_update_status as RoutesUpdateStatus | undefined) || {
                    lastCheckTime: 0,
                    lastUpdateTime: 0,
                    currentVersion: '1.0.0'
                });
            });
        });
    }

    /**
     * 保存更新状态
     */
    private async saveUpdateStatus(status: RoutesUpdateStatus): Promise<void> {
        return new Promise((resolve) => {
            chrome.storage.local.set({ routes_update_status: status }, () => {
                resolve();
            });
        });
    }

    /**
     * 保存设置
     */
    private async saveSettings(settings: ExtensionSettings): Promise<void> {
        return new Promise((resolve) => {
            chrome.storage.local.set({ settings }, () => {
                resolve();
            });
        });
    }

    /**
     * 获取设置
     */
    private async getSettings(): Promise<ExtensionSettings> {
        return new Promise((resolve) => {
            chrome.storage.local.get('settings', (result) => {
                resolve(result.settings || { routes: DEFAULT_ROUTES } as ExtensionSettings);
            });
        });
    }
}

/**
 * 获取线路管理器实例（便捷方法）
 */
export function getRouteManager(): RouteManager {
    return RouteManager.getInstance();
}

/**
 * 快捷方法：获取 JavDB 当前线路
 */
export async function getJavDBRoute(): Promise<string> {
    return getRouteManager().getCurrentRoute('javdb');
}

/**
 * 快捷方法：获取 JavBus 当前线路
 */
export async function getJavBusRoute(): Promise<string> {
    return getRouteManager().getCurrentRoute('javbus');
}

/**
 * 快捷方法：构建 JavDB URL
 */
export async function buildJavDBUrl(path: string): Promise<string> {
    return getRouteManager().buildUrl('javdb', path);
}

/**
 * 快捷方法：构建 JavBus URL
 */
export async function buildJavBusUrl(path: string): Promise<string> {
    return getRouteManager().buildUrl('javbus', path);
}

/**
 * 替换 URL 中的 javdb.com 域名为当前选择的线路
 * 用于显示时动态替换存储的 URL
 * @param url 原始 URL（包含 javdb.com）
 * @returns 替换后的 URL（使用当前线路）
 */
export async function replaceJavDBDomain(url: string): Promise<string> {
    if (!url) return url;

    try {
        const urlObj = new URL(url);

        // 只替换 javdb.com 域名
        if (urlObj.hostname === 'javdb.com' || urlObj.hostname.endsWith('.javdb.com')) {
            const currentRoute = await getJavDBRoute();
            const currentRouteObj = new URL(currentRoute);

            urlObj.protocol = currentRouteObj.protocol;
            urlObj.hostname = currentRouteObj.hostname;
            urlObj.port = currentRouteObj.port;

            return urlObj.toString();
        }

        // 不是 javdb.com 域名，直接返回
        return url;
    } catch (error) {
        console.error('[RouteManager] 替换域名失败:', error);
        return url;
    }
}

/**
 * 批量替换 URL 中的 javdb.com 域名
 * @param urls URL 数组
 * @returns 替换后的 URL 数组
 */
export async function replaceJavDBDomains(urls: string[]): Promise<string[]> {
    const currentRoute = await getJavDBRoute();
    const currentRouteObj = new URL(currentRoute);

    return urls.map(url => {
        if (!url) return url;

        try {
            const urlObj = new URL(url);

            // 只替换 javdb.com 域名
            if (urlObj.hostname === 'javdb.com' || urlObj.hostname.endsWith('.javdb.com')) {
                urlObj.protocol = currentRouteObj.protocol;
                urlObj.hostname = currentRouteObj.hostname;
                urlObj.port = currentRouteObj.port;

                return urlObj.toString();
            }

            return url;
        } catch (error) {
            return url;
        }
    });
}
