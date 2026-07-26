/**
 * @file types.ts
 * @description Sync protocol DTOs: entity envelope, auth, devices, pull/push, vault.
 * @module @javdb/sync-protocol
 */

import type { ClientProductId, ProtocolVersion } from './version';

// ---------------------------------------------------------------------------
// 实体信封：所有账号级业务记录共用
// ---------------------------------------------------------------------------

/**
 * Common envelope for every syncable entity.
 * `revision` is server-monotonic per (user, type, id).
 */
export interface SyncEntity<T = unknown> {
  id: string;
  type: string;
  revision: number;
  updatedAt: number;
  deletedAt?: number | null;
  updatedByDeviceId?: string;
  payload: T;
}

/** @deprecated Prefer SyncEntity; kept for Day-1 skeleton imports. */
export type SyncEntityEnvelope<T = unknown> = SyncEntity<T>;

/** Opaque cursor map: entity type → last seen server revision. */
export type SyncCursorMap = Record<string, number>;

// ---------------------------------------------------------------------------
// 实体类型 id：必须与 assetMatrix 的 ACCOUNT_ENTITY_TYPES 保持一致
// ---------------------------------------------------------------------------

export const SYNC_ENTITY_TYPES = [
  'video',
  'actor',
  'list',
  'new_work',
  'new_work_subscription',
  'user_profile',
  'preference',
  'search_preset',
  'magnet',
  'insights_view',
  'insights_report',
  'new_work_daily_stat',
  'storage_item',
  'log',
  'magnet_push_log',
] as const;

export type SyncEntityType = (typeof SYNC_ENTITY_TYPES)[number];

// ---------------------------------------------------------------------------
// 认证与设备
// ---------------------------------------------------------------------------

export interface DeviceRegistration {
  id: string;
  label: string;
  platform?: string;
  clientType: ClientProductId;
  clientVersion?: string;
}

export interface AuthRegisterRequest {
  identifier: string;
  password: string;
}

export interface AuthLoginRequest {
  identifier: string;
  password: string;
  device: DeviceRegistration;
}

export interface AuthTokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  userId: string;
  deviceId: string;
}

export interface AuthLoginResponse extends AuthTokenPair {
  protocolVersion: ProtocolVersion;
}

export interface AuthRefreshRequest {
  refreshToken: string;
}

export interface DeviceInfo {
  id: string;
  label: string;
  platform?: string;
  clientType: ClientProductId;
  clientVersion?: string;
  createdAt?: number;
  lastSeenAt?: number;
  revokedAt?: number | null;
}

// ---------------------------------------------------------------------------
// 同步拉取 / 推送
// ---------------------------------------------------------------------------

export interface SyncPullRequest {
  protocolVersion: ProtocolVersion;
  cursors: SyncCursorMap;
  /** Optional limit per type; server may clamp. */
  limit?: number;
}

export interface SyncPullResponse {
  protocolVersion: ProtocolVersion;
  changes: SyncEntity[];
  cursors: SyncCursorMap;
  hasMore?: boolean;
}

export interface SyncPushRequest {
  protocolVersion: ProtocolVersion;
  changes: SyncEntity[];
}

export type SyncPushItemResult =
  | { id: string; type: string; status: 'accepted'; revision: number }
  | { id: string; type: string; status: 'rejected'; reason: string; server?: SyncEntity }
  | { id: string; type: string; status: 'merged'; entity: SyncEntity };

export interface SyncPushResponse {
  protocolVersion: ProtocolVersion;
  results: SyncPushItemResult[];
  cursors?: SyncCursorMap;
}

// ---------------------------------------------------------------------------
// 同步会话：服务端权威，优先于单独 pull / push
// ---------------------------------------------------------------------------

/**
 * One-shot authoritative sync: client sends pending changes + cursors;
 * server merges, returns entities to apply and user-facing stats/message.
 */
export interface SyncSessionRequest {
  protocolVersion: ProtocolVersion;
  deviceId: string;
  cursors: SyncCursorMap;
  /** Local pending changes; may be empty. */
  changes: SyncEntity[];
}

export type SyncSessionItemResult =
  | { id: string; type: string; status: 'accepted'; revision: number }
  | { id: string; type: string; status: 'merged'; entity: SyncEntity; reason?: string }
  | { id: string; type: string; status: 'rejected'; reason: string; server?: SyncEntity };

/** Server-authoritative counters for UI and tests. */
export interface SyncSessionStats {
  /** accepted + merged count from client changes. */
  uploaded: number;
  /** apply.length */
  downloaded: number;
  merged: number;
  rejected: number;
  /** Counts of apply/download entities by type; kept for existing clients. */
  byType: Record<string, number>;
  /** Counts of accepted + merged upload results by entity type. */
  uploadedByType?: Record<string, number>;
  /** Counts of apply/download entities by type; mirrors byType in current Cloud. */
  downloadedByType?: Record<string, number>;
  /** Counts of rejected upload results by entity type. */
  rejectedByType?: Record<string, number>;
}

/** Stable machine codes; `message` is server Chinese summary for UI. */
export type SyncSessionCode =
  | 'SYNC_OK'
  | 'SYNC_EMPTY'
  | 'SYNC_PARTIAL'
  | 'SYNC_PROTOCOL'
  | string;

export interface SyncSessionResponse {
  protocolVersion: ProtocolVersion;
  /** Authoritative entities the client must upsert (incremental, not full replace). */
  apply: SyncEntity[];
  results: SyncSessionItemResult[];
  stats: SyncSessionStats;
  code: SyncSessionCode;
  /** Server Chinese summary, e.g. 同步完成：上传 12，下载 3 */
  message: string;
  cursors: SyncCursorMap;
  hasMore?: boolean;
}

// ---------------------------------------------------------------------------
// 密钥库：账号密钥，整项 LWW
// ---------------------------------------------------------------------------

export type VaultItemKind = 'webdav' | 'drive115' | string;

export interface VaultItem {
  id: string;
  kind: VaultItemKind;
  label?: string;
  ciphertext: string;
  revision: number;
  updatedAt: number;
  deletedAt?: number | null;
  updatedByDeviceId?: string;
}

export interface VaultPutRequest {
  protocolVersion: ProtocolVersion;
  item: VaultItem;
}

export interface VaultListResponse {
  protocolVersion: ProtocolVersion;
  items: VaultItem[];
}
