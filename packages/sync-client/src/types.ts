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

/**
 * 云端扫描配置回读（GET /v1/scan/config）。
 * 冻结契约（10-27-ext-scan-config-readback）：字段名与取值集合不得变更；
 * source 语义（最后写入方，10-29-cloud-scan-latest-wins 去接管化）：admin=最后写入方是管理台 / extension=最后写入方是拓展设备 / default=无实体。
 */
export interface CloudScanConfigReadback {
  enabled: boolean;
  batchSize: number;
  intervalMinutes: number;
  source: 'admin' | 'extension' | 'default';
}

export type IndexReportKind = 'emby' | 'drive115';

export interface IndexReportSource {
  kind: IndexReportKind;
  sourceId: string;
}

export interface IndexReportEntry {
  code: string;
  data: unknown;
}

export interface LocalIndexReport extends IndexReportSource {
  entries: IndexReportEntry[];
  complete: boolean;
  requestId?: string;
}

export interface IndexReportCapabilities {
  version: 1;
  kinds: IndexReportKind[];
  maxPageEntries: number;
  maxPageBytes: number;
}

export interface IndexReportPage extends IndexReportSource {
  page: number;
  final: boolean;
  complete?: boolean;
  entries: IndexReportEntry[];
}

export interface IndexReportResult {
  runId: string;
  generation: number;
  published: boolean;
  superseded?: boolean;
  revision: number;
}

/** Bound to the caller's connection/account/user/device for the entire request, including refresh. */
export interface AuthenticatedRequestOptions {
  signal?: AbortSignal;
  auth?: {
    baseUrl: string;
    assertCurrent(): Promise<void>;
  };
}

export type IndexReportRequestOptions = AuthenticatedRequestOptions;

/** Additive API: old servers and transports need not implement these methods. */
export interface IndexReportApi {
  getIndexReportCapabilities?(options?: IndexReportRequestOptions): Promise<IndexReportCapabilities>;
  startIndexReport?(body: IndexReportSource & { requestId: string }, options?: IndexReportRequestOptions): Promise<IndexReportResult>;
  putIndexReport?(runId: string, body: IndexReportPage, options?: IndexReportRequestOptions): Promise<IndexReportResult>;
  retireIndexSource?(body: IndexReportSource, options?: IndexReportRequestOptions): Promise<{ retired: boolean }>;
}

export interface CloudApi extends IndexReportApi {
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
  listVault(options?: AuthenticatedRequestOptions): Promise<VaultListResponse>;
  putVault(id: string, body: VaultPutRequest, options?: AuthenticatedRequestOptions): Promise<VaultItem>;
  deleteVault(id: string): Promise<void>;
  /** 读云端扫描配置（冻结契约；非 2xx 由 transport 抛 SyncHttpError，本层不吞）。 */
  getScanConfig(): Promise<CloudScanConfigReadback>;
}
