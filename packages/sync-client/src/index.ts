/**
 * @file index.ts
 * @description @javdb/sync-client — HTTP API client, sync engine, mock transport (no chrome/DOM).
 * @module @javdb/sync-client
 */

import {
  PROTOCOL_VERSION,
  type ProtocolVersion,
  type SyncCursorMap,
  type SyncEntity,
} from '@javdb/sync-protocol';

export { PROTOCOL_VERSION };
export type { ProtocolVersion, SyncCursorMap, SyncEntity };

export {
  entityKey,
  mergeEntityBatches,
  mergeVaultBatches,
  advanceCursors,
} from './conflictPolicy';

export { createApiClient, type ApiClient } from './apiClient';
export { createFetchTransport, SyncHttpError } from './fetchTransport';
export { createMemoryTokenStore } from './memoryTokenStore';
export { createMockCloudTransport } from './mockTransport';
export {
  createSyncEngine,
  createMemoryLocalStore,
  createMemoryCursorStore,
  type SyncEngine,
  type SyncSessionEngineResult,
  type SyncSessionProgress,
  type SyncSessionOptions,
  type LocalEntityStore,
  type CursorStore,
} from './syncEngine';
export type {
  TokenStore,
  HttpTransport,
  RefreshCoordinator,
  SyncClientConfig,
  CloudApi,
} from './types';

/** @deprecated Prefer createApiClient + createSyncEngine. */
export function createSyncClientStub(opts?: { protocolVersion?: ProtocolVersion }) {
  const protocolVersion = opts?.protocolVersion ?? PROTOCOL_VERSION;
  return {
    protocolVersion,
    async pull(_cursors: SyncCursorMap = {}): Promise<{ changes: SyncEntity[]; cursors: SyncCursorMap }> {
      return { changes: [], cursors: { ..._cursors } };
    },
  };
}

export type SyncClientStub = ReturnType<typeof createSyncClientStub>;
