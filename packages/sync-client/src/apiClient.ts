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
  HttpTransport,
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
  ): Promise<T> {
    const token = useAuth ? await tokens.getAccessToken() : null;
    return transport.request<T>({ method, path, body, token });
  }

  async function withAuthRetry<T>(fn: (token: string | null) => Promise<T>): Promise<T> {
    const failedAccessToken = await tokens.getAccessToken();
    try {
      return await fn(failedAccessToken);
    } catch (err) {
      if (!(err instanceof SyncHttpError) || err.status !== 401) throw err;
      const refreshToken = await tokens.getRefreshToken();
      if (!refreshToken) {
        config.onAuthFailure?.(err);
        throw err;
      }

      const currentAccessToken = await tokens.getAccessToken();
      if (currentAccessToken && currentAccessToken !== failedAccessToken) {
        return fn(currentAccessToken);
      }

      try {
        await refreshCoordinator.run(async () => {
          const latestAccessToken = await tokens.getAccessToken();
          const latestRefreshToken = await tokens.getRefreshToken();
          if (
            (latestAccessToken && latestAccessToken !== failedAccessToken) ||
            latestRefreshToken !== refreshToken
          ) {
            return;
          }
          try {
            const pair = await raw<AuthTokenPair>('POST', '/v1/auth/refresh', {
              refreshToken,
            } satisfies AuthRefreshRequest);
            await tokens.setTokens(pair);
          } catch (refreshErr) {
            if ((await tokens.getRefreshToken()) === refreshToken) {
              await tokens.clear();
              config.onAuthFailure?.(refreshErr);
            }
            throw refreshErr;
          }
        });
      } catch (refreshErr) {
        throw refreshErr;
      }
      return fn(await tokens.getAccessToken());
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

    session(body: SyncSessionRequest) {
      return withAuthRetry((token) =>
        transport.request<SyncSessionResponse>({
          method: 'POST',
          path: '/v1/sync/session',
          body,
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
