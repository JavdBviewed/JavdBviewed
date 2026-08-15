/**
 * @file types.ts
 * @description Sync client runtime types (transport, tokens, engine options).
 * @module @javdb/sync-client
 */

import type {
  AuthLoginRequest,
  AuthLoginResponse,
  AuthRefreshRequest,
  AuthRegisterRequest,
  AuthTokenPair,
  DeviceInfo,
  ProtocolVersion,
  SyncCursorMap,
  SyncEntity,
  SyncPullRequest,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  SyncSessionRequest,
  SyncSessionResponse,
  VaultItem,
  VaultListResponse,
  VaultPutRequest,
} from '@javdb/sync-protocol';

export type { SyncCursorMap, SyncEntity, ProtocolVersion };

export interface TokenStore {
  getAccessToken(): Promise<string | null>;
  getRefreshToken(): Promise<string | null>;
  setTokens(tokens: AuthTokenPair): Promise<void>;
  clear(): Promise<void>;
}

/** 将同一会话的 token 刷新合并为一次；扩展可提供跨上下文实现。 */
export interface RefreshCoordinator {
  run<T>(work: () => Promise<T>): Promise<T>;
}

export interface RequestBodyMetrics {
  /** JSON UTF-8 bytes before optional gzip compression. */
  uncompressedBytes: number;
  /** Actual request body bytes after optional gzip compression. */
  transmittedBytes: number;
  contentEncoding?: 'gzip';
}

export interface HttpTransport {
  request<T>(opts: {
    method: string;
    path: string;
    body?: unknown;
    token?: string | null;
    signal?: AbortSignal;
    /** Reports the serialized HTTP request body that will be sent to Cloud. */
    onRequestBodyMetrics?: (metrics: RequestBodyMetrics) => void;
  }): Promise<T>;
}

export interface SyncClientConfig {
  baseUrl: string;
  protocolVersion?: ProtocolVersion;
  transport?: HttpTransport;
  tokens: TokenStore;
  refreshCoordinator?: RefreshCoordinator;
  /** Called when access token refresh fails permanently. */
  onAuthFailure?: (err: unknown) => void;
}

export interface CloudApi {
  register(body: AuthRegisterRequest): Promise<AuthLoginResponse | AuthTokenPair>;
  login(body: AuthLoginRequest): Promise<AuthLoginResponse>;
  refresh(body: AuthRefreshRequest): Promise<AuthTokenPair>;
  logout(): Promise<void>;
  listDevices(): Promise<DeviceInfo[]>;
  revokeDevice(deviceId: string): Promise<void>;
  pull(body: SyncPullRequest): Promise<SyncPullResponse>;
  push(body: SyncPushRequest): Promise<SyncPushResponse>;
  /** Server-authoritative one-shot sync (preferred). */
  session(
    body: SyncSessionRequest,
    options?: {
      signal?: AbortSignal;
      onRequestBodyMetrics?: (metrics: RequestBodyMetrics) => void;
    },
  ): Promise<SyncSessionResponse>;
  /** Permanently removes explicitly allowed non-business sync types for this account. */
  cleanupSyncData(types: readonly string[]): Promise<{ deleted: Record<string, number> }>;
  listVault(): Promise<VaultListResponse>;
  putVault(id: string, body: VaultPutRequest): Promise<VaultItem>;
  deleteVault(id: string): Promise<void>;
}
