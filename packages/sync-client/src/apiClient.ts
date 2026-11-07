/**
 * @file apiClient.ts
 * @description Cloud HTTP API client with optional access-token refresh on 401.
 * @module @javdb/sync-client
 */

import {
  PROTOCOL_VERSION,
  type AuthLoginRequest,
  type AuthLoginResponse,
  type AuthRefreshRequest,
  type AuthRegisterRequest,
  type AuthTokenPair,
  type DeviceInfo,
  type ProtocolVersion,
  type SyncPullRequest,
  type SyncPullResponse,
  type SyncPushRequest,
  type SyncPushResponse,
  type SyncSessionRequest,
  type SyncSessionResponse,
  type VaultItem,
  type VaultListResponse,
  type VaultPutRequest,
} from '@javdb/sync-protocol';
import { SyncHttpError, createFetchTransport } from './fetchTransport';
import type {
  CloudApi,
  CloudScanConfigReadback,
  HttpTransport,
  IndexReportCapabilities,
  IndexReportPage,
  IndexReportResult,
  IndexReportRequestOptions,
  IndexReportSource,
  RequestBodyMetrics,
  RefreshCoordinator,
  SyncClientConfig,
  TokenStore,
} from './types';

export interface ApiClient extends CloudApi {
  readonly protocolVersion: ProtocolVersion;
  readonly tokens: TokenStore;
}

const tokenStoreRefreshes = new WeakMap<TokenStore, Promise<unknown>>();

function createTokenStoreRefreshCoordinator(tokens: TokenStore): RefreshCoordinator {
  return {
    async run<T>(work: () => Promise<T>): Promise<T> {
      const existing = tokenStoreRefreshes.get(tokens);
      if (existing) return existing as Promise<T>;
      const current = work();
      tokenStoreRefreshes.set(tokens, current);
      try {
        return await current;
      } finally {
        if (tokenStoreRefreshes.get(tokens) === current) {
          tokenStoreRefreshes.delete(tokens);
        }
      }
    },
  };
}

export function createApiClient(config: SyncClientConfig): ApiClient {
  const protocolVersion = config.protocolVersion ?? PROTOCOL_VERSION;
  const transport: HttpTransport =
    config.transport ?? createFetchTransport(config.baseUrl);
  const tokens = config.tokens;
  const refreshCoordinator = config.refreshCoordinator ?? createTokenStoreRefreshCoordinator(tokens);

  async function raw<T>(
    method: string,
    path: string,
    body?: unknown,
    useAuth = false,
    signal?: AbortSignal,
  ): Promise<T> {
    const token = useAuth ? await tokens.getAccessToken() : null;
    return transport.request<T>({ method, path, body, token, ...(signal ? { signal } : {}) });
  }

  async function withAuthRetry<T>(
    fn: (token: string | null) => Promise<T>,
    options: IndexReportRequestOptions = {},
  ): Promise<T> {
    const checkCancelled = () => {
      if (options.signal?.aborted) throw new DOMException('同步已取消', 'AbortError');
    };
    const check = async () => {
      checkCancelled();
      if (!options.auth) return;
      const normalize = (raw: string) => {
        const url = new URL(raw);
        return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
      };
      if (normalize(config.baseUrl) !== normalize(options.auth.baseUrl)) throw new Error('Cloud 连接已变更');
      await options.auth.assertCurrent();
      checkCancelled();
    };
    const readAccess = async () => {
      await check();
      const token = await tokens.getAccessToken();
      await check();
      return token;
    };
    const readRefresh = async () => {
      await check();
      const token = await tokens.getRefreshToken();
      await check();
      return token;
    };
    const send = async (token: string | null) => {
      await check();
      const result = await fn(token);
      await check();
      return result;
    };
    const failedAccessToken = await readAccess();
    try {
      return await send(failedAccessToken);
    } catch (err) {
      await check();
      if (!(err instanceof SyncHttpError) || err.status !== 401) throw err;
      const refreshToken = await readRefresh();
      if (!refreshToken) {
        config.onAuthFailure?.(err);
        throw err;
      }
      const currentAccessToken = await readAccess();
      if (currentAccessToken && currentAccessToken !== failedAccessToken) return send(currentAccessToken);

      await refreshCoordinator.run(async () => {
        const latestAccessToken = await readAccess();
        const latestRefreshToken = await readRefresh();
        if ((latestAccessToken && latestAccessToken !== failedAccessToken) || latestRefreshToken !== refreshToken) return;
        try {
          await check();
          const pair = await raw<AuthTokenPair>('POST', '/v1/auth/refresh', {
            refreshToken,
          } satisfies AuthRefreshRequest, false, options.signal);
          // A response from the previous account must never overwrite a newly logged-in session.
          await check();
          await tokens.setTokens(pair);
          await check();
        } catch (refreshErr) {
          await check();
          if ((await readRefresh()) === refreshToken) {
            await check();
            await tokens.clear();
            config.onAuthFailure?.(refreshErr);
          }
          throw refreshErr;
        }
      });
      return send(await readAccess());
    }
  }

  return {
    protocolVersion,
    tokens,

    register(body: AuthRegisterRequest) {
      return raw('POST', '/v1/auth/register', body);
    },

    async login(body: AuthLoginRequest) {
      const res = await raw<AuthLoginResponse>('POST', '/v1/auth/login', body);
      await tokens.setTokens(res);
      return res;
    },

    async refresh(body: AuthRefreshRequest) {
      const res = await raw<AuthTokenPair>('POST', '/v1/auth/refresh', body);
      await tokens.setTokens(res);
      return res;
    },

    async logout() {
      try {
        await withAuthRetry((token) =>
          transport.request<void>({ method: 'POST', path: '/v1/auth/logout', token }),
        );
      } finally {
        await tokens.clear();
      }
    },

    listDevices() {
      return withAuthRetry((token) =>
        transport.request<DeviceInfo[]>({ method: 'GET', path: '/v1/devices', token }),
      );
    },

    revokeDevice(deviceId: string) {
      return withAuthRetry((token) =>
        transport.request<void>({
          method: 'DELETE',
          path: `/v1/devices/${encodeURIComponent(deviceId)}`,
          token,
        }),
      );
    },

    getScanConfig() {
      return withAuthRetry((token) =>
        transport.request<CloudScanConfigReadback>({ method: 'GET', path: '/v1/scan/config', token }),
      );
    },

    getIndexReportCapabilities(options?: IndexReportRequestOptions) {
      return withAuthRetry((token) =>
        transport.request<IndexReportCapabilities>({ method: 'GET', path: '/v1/index-reports/capabilities', token, ...(options?.signal ? { signal: options.signal } : {}) }),
        options,
      );
    },

    startIndexReport(body: IndexReportSource & { requestId: string }, options?: IndexReportRequestOptions) {
      return withAuthRetry((token) =>
        transport.request<IndexReportResult>({ method: 'POST', path: '/v1/index-reports', body, token, ...(options?.signal ? { signal: options.signal } : {}) }),
        options,
      );
    },

    putIndexReport(runId: string, body: IndexReportPage, options?: IndexReportRequestOptions) {
      return withAuthRetry((token) =>
        transport.request<IndexReportResult>({
          method: 'PUT', path: `/v1/index-reports/${encodeURIComponent(runId)}`, body, token,
          ...(options?.signal ? { signal: options.signal } : {}),
        }),
        options,
      );
    },

    retireIndexSource(body: IndexReportSource, options?: IndexReportRequestOptions) {
      return withAuthRetry((token) =>
        transport.request<{ retired: boolean }>({ method: 'DELETE', path: '/v1/index-sources', body, token, ...(options?.signal ? { signal: options.signal } : {}) }),
        options,
      );
    },

    pull(body: SyncPullRequest) {
      return withAuthRetry((token) =>
        transport.request<SyncPullResponse>({ method: 'POST', path: '/v1/sync/pull', body, token }),
      );
    },

    push(body: SyncPushRequest) {
      return withAuthRetry((token) =>
        transport.request<SyncPushResponse>({ method: 'POST', path: '/v1/sync/push', body, token }),
      );
    },

    session(
      body: SyncSessionRequest,
      options?: {
        signal?: AbortSignal;
        onRequestBodyMetrics?: (metrics: RequestBodyMetrics) => void;
      },
    ) {
      return withAuthRetry((token) =>
        transport.request<SyncSessionResponse>({
          method: 'POST',
          path: '/v1/sync/session',
          body,
          token,
          signal: options?.signal,
          onRequestBodyMetrics: options?.onRequestBodyMetrics,
        }),
      );
    },

    cleanupSyncData(types: readonly string[]) {
      return withAuthRetry((token) =>
        transport.request<{ deleted: Record<string, number> }>({
          method: 'POST',
          path: '/v1/sync/cleanup',
          body: { types },
          token,
        }),
      );
    },

    listVault() {
      return withAuthRetry((token) =>
        transport.request<VaultListResponse>({ method: 'GET', path: '/v1/vault/items', token }),
      );
    },

    putVault(id: string, body: VaultPutRequest) {
      return withAuthRetry((token) =>
        transport.request<VaultItem>({
          method: 'PUT',
          path: `/v1/vault/items/${encodeURIComponent(id)}`,
          body,
          token,
        }),
      );
    },

    deleteVault(id: string) {
      return withAuthRetry((token) =>
        transport.request<void>({
          method: 'DELETE',
          path: `/v1/vault/items/${encodeURIComponent(id)}`,
          token,
        }),
      );
    },
  };
}
