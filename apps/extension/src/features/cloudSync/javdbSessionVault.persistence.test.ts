import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncHttpError } from '@javdb/sync-client';
import type { VaultItem, VaultPutRequest } from '@javdb/sync-protocol';

const state = vi.hoisted(() => ({
  settings: { baseUrl: 'https://cloud.test', deviceLabel: 'test', accountIdentifier: 'admin', accountPassword: 'test-only-password', deviceId: 'd1', updatedAt: 1 },
  session: { accessToken: 'test-token', refreshToken: 'test-refresh', userId: 'u1', deviceId: 'd1', savedAt: 1 },
  recover: vi.fn(),
}));
vi.mock('./cloudSettingsStorage', async importOriginal => ({
  ...await importOriginal<typeof import('./cloudSettingsStorage')>(),
  loadCloudSettings: async () => ({ ...state.settings }),
}));
vi.mock('./chromeTokenStore', async importOriginal => ({
  ...await importOriginal<typeof import('./chromeTokenStore')>(),
  loadCloudSession: async () => ({ ...state.session }),
}));
vi.mock('./cloudAuthRecovery', async importOriginal => ({
  ...await importOriginal<typeof import('./cloudAuthRecovery')>(),
  recoverCloudAuthSession: state.recover,
}));
vi.mock('./enqueueLocalChange', () => ({ scheduleEnqueue: vi.fn() }));
import { pushJavdbSessionVault } from './javdbSessionVault';

function api() {
  return {
    listVault: vi.fn(async () => ({ protocolVersion: 1, items: [] as VaultItem[] })),
    putVault: vi.fn(async (_id: string, request: VaultPutRequest) => ({ ...request.item, ciphertext: 'v2:stored-encrypted' })),
    deleteVault: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  state.settings = { baseUrl: 'https://cloud.test', deviceLabel: 'test', accountIdentifier: 'admin', accountPassword: 'test-only-password', deviceId: 'd1', updatedAt: 1 };
  state.session = { accessToken: 'test-token', refreshToken: 'test-refresh', userId: 'u1', deviceId: 'd1', savedAt: 1 };
  state.recover.mockReset().mockResolvedValue({ outcome: 'recovered' });
  vi.stubGlobal('chrome', { runtime: {}, cookies: { getAll: (_query: unknown, cb: (value: unknown[]) => void) => cb([{ name: '_jdb_session', value: 'test-session', domain: '.javdb575.com' }]) } });
});
afterEach(() => vi.unstubAllGlobals());

describe('JavDB session persistence', () => {
  it('accepts the transformed v2 response only when its write metadata matches', async () => {
    expect(await pushJavdbSessionVault('test', { vaultApi: api() })).toMatchObject({ ok: true });
  });

  it('unlocks once then re-reads revision and timestamps before retrying the same captured session', async () => {
    const vaultApi = api();
    vaultApi.listVault.mockResolvedValueOnce({ protocolVersion: 1, items: [{ id: 'javdb-session', kind: 'javdb-session', ciphertext: 'old', revision: 7, updatedAt: 20 }] })
      .mockResolvedValueOnce({ protocolVersion: 1, items: [{ id: 'javdb-session', kind: 'javdb-session', ciphertext: 'migrated', revision: 12, updatedAt: Date.now() + 1000 }] });
    vaultApi.putVault.mockRejectedValueOnce(new SyncHttpError(409, 'vault-session-locked'));
    const result = await pushJavdbSessionVault('test', { vaultApi });
    expect(result.ok).toBe(true);
    expect(state.recover).toHaveBeenCalledTimes(1);
    expect(vaultApi.listVault).toHaveBeenCalledTimes(2);
    expect(vaultApi.putVault).toHaveBeenCalledTimes(2);
    const first = vaultApi.putVault.mock.calls[0][1].item;
    const second = vaultApi.putVault.mock.calls[1][1].item;
    expect(first.revision).toBe(8);
    expect(second.revision).toBe(13);
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
    expect(second.ciphertext).toBe(first.ciphertext);
  });

  it.each([[422, 'vault-session-invalid', 'session-invalid'], [503, 'vault-session-unavailable', 'session-unavailable']] as const)('maps HTTP %s without retrying or logging secrets', async (status, code, reason) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const vaultApi = api();
    vaultApi.putVault.mockRejectedValue(new SyncHttpError(status, code, { secret: 'test-session' }));
    expect(await pushJavdbSessionVault('test', { vaultApi })).toEqual({ ok: false, reason });
    expect(vaultApi.putVault).toHaveBeenCalledTimes(1);
    expect(state.recover).not.toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('test-session');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('test-only-password');
  });

  it('stops after the second locked response', async () => {
    const vaultApi = api();
    vaultApi.putVault.mockRejectedValue(new SyncHttpError(409, 'vault-session-locked'));
    expect(await pushJavdbSessionVault('test', { vaultApi })).toEqual({ ok: false, reason: 'session-locked' });
    expect(vaultApi.putVault).toHaveBeenCalledTimes(2);
    expect(state.recover).toHaveBeenCalledTimes(1);
  });

  it('does not retry when reauthentication is suppressed or fails', async () => {
    const vaultApi = api();
    vaultApi.putVault.mockRejectedValue(new SyncHttpError(409, 'vault-session-locked'));
    state.recover.mockResolvedValue({ outcome: 'suppressed' });
    expect(await pushJavdbSessionVault('test', { vaultApi })).toEqual({ ok: false, reason: 'session-locked' });
    expect(vaultApi.putVault).toHaveBeenCalledTimes(1);
  });

  it('reports an LWW winner as a conflict even when the server returned HTTP 200', async () => {
    const vaultApi = api();
    vaultApi.putVault.mockImplementationOnce(async (_id, request) => ({ ...request.item, revision: request.item.revision + 1, ciphertext: 'v2:winner' }));
    expect(await pushJavdbSessionVault('test', { vaultApi })).toEqual({ ok: false, reason: 'session-conflict' });
    expect(vaultApi.putVault).toHaveBeenCalledTimes(1);
  });

  it('does not guess revision one after a failed list request', async () => {
    const vaultApi = api();
    vaultApi.listVault.mockRejectedValue(new Error('network'));
    expect(await pushJavdbSessionVault('test', { vaultApi })).toEqual({ ok: false, reason: 'push-failed' });
    expect(vaultApi.putVault).not.toHaveBeenCalled();
  });

  it.each(['baseUrl', 'accountIdentifier', 'accountPassword', 'deviceId'])('stops when %s changes during revision lookup', async field => {
    const vaultApi = api();
    vaultApi.listVault.mockImplementationOnce(async () => {
      state.settings = { ...state.settings, [field]: 'changed' };
      return { protocolVersion: 1, items: [] };
    });
    expect(await pushJavdbSessionVault('test', { vaultApi })).toEqual({ ok: false, reason: 'identity-changed' });
    expect(vaultApi.putVault).not.toHaveBeenCalled();
  });

  it('stops when the user logs into a different account during unlock', async () => {
    const vaultApi = api();
    vaultApi.putVault.mockRejectedValueOnce(new SyncHttpError(409, 'vault-session-locked'));
    state.recover.mockImplementationOnce(async () => { state.session.userId = 'other'; return { outcome: 'recovered' }; });
    expect(await pushJavdbSessionVault('test', { vaultApi })).toEqual({ ok: false, reason: 'identity-changed' });
    expect(vaultApi.putVault).toHaveBeenCalledTimes(1);
  });
});
