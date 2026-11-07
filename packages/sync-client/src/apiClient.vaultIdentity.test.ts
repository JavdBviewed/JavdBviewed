import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './apiClient';
import { createMemoryTokenStore } from './memoryTokenStore';
import { SyncHttpError } from './fetchTransport';
import type { HttpTransport } from './types';

const item = { id: 'javdb-session', kind: 'javdb-session', ciphertext: 'encrypted', revision: 1, updatedAt: 1 };

describe('vault requests keep their caller identity across authentication retries', () => {
  it.each(['list', 'put'] as const)('stops %s after an identity change instead of refreshing the new session', async operation => {
    let current = true;
    const requests: string[] = [];
    const transport: HttpTransport = { async request<T>(request: Parameters<HttpTransport['request']>[0]): Promise<T> {
      requests.push(request.path);
      if (request.path.startsWith('/v1/vault/')) {
        current = false;
        throw new SyncHttpError(401, 'expired');
      }
      return {} as T;
    } };
    const tokens = createMemoryTokenStore();
    await tokens.setTokens({ accessToken: 'old', refreshToken: 'refresh', userId: 'u1', deviceId: 'd1' });
    const setTokens = vi.spyOn(tokens, 'setTokens');
    const client = createApiClient({ baseUrl: 'https://cloud.test', transport, tokens });
    const options = { auth: { baseUrl: 'https://cloud.test', assertCurrent: async () => { if (!current) throw new Error('identity-changed'); } } };
    const action = operation === 'list' ? client.listVault(options) : client.putVault(item.id, { protocolVersion: 1, item }, options);
    await expect(action).rejects.toThrow('identity-changed');
    expect(requests).toHaveLength(1);
    expect(setTokens).not.toHaveBeenCalled();
  });
});
