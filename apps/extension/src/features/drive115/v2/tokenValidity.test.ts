/**
 * @file tokenValidity.test.ts
 * @description 115 token 有效期与刷新入口回归
 * @module features/drive115/v2
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  addLogV2: vi.fn(),
  emitRefreshEvent: vi.fn(),
}));

vi.mock('../../../utils/storage', () => ({
  getSettings: mocks.getSettings,
  saveSettings: mocks.saveSettings,
}));
vi.mock('./logs', () => ({ addLogV2: mocks.addLogV2 }));
vi.mock('./tokenRefreshEvents', () => ({ emitDrive115TokenRefreshEvent: mocks.emitRefreshEvent }));

import { getDrive115V2Service, normalizeDrive115TokenExpiry } from './index';

describe('Drive115V2Service token validity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.saveSettings.mockResolvedValue(undefined);
    mocks.getSettings.mockResolvedValue({
      drive115: {
        v2AccessToken: 'valid-access-token',
        v2RefreshToken: 'refresh-token',
        v2TokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
        v2AutoRefresh: true,
        v2AutoRefreshSkewSec: 60,
        v2RefreshTokenStatus: 'valid',
      },
    });
  });

  it('reuses an access token that is still valid without calling refresh or persisting new credentials', async () => {
    const service = getDrive115V2Service();
    const refreshSpy = vi.spyOn(service, 'refreshToken');

    const result = await service.getValidAccessToken({ forceAutoRefresh: true });

    expect(result).toEqual({ success: true, accessToken: 'valid-access-token' });
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });

  it('force refreshes the token when a long-running task reports the current token as invalid', async () => {
    const service = getDrive115V2Service();
    const refreshSpy = vi.spyOn(service, 'refreshToken').mockResolvedValue({
      success: true,
      token: {
        access_token: 'refreshed-access-token',
        refresh_token: 'refreshed-refresh-token',
        expires_at: Math.floor(Date.now() / 1000) + 7200,
      },
    });

    const result = await service.getValidAccessToken({
      forceAutoRefresh: true,
      forceRefresh: true,
    });

    expect(result).toEqual({ success: true, accessToken: 'refreshed-access-token' });
    expect(refreshSpy).toHaveBeenCalledWith('refresh-token', { source: 'auto' });
    expect(mocks.saveSettings).toHaveBeenCalled();
  });

  it('reuses a token persisted by another context moments ago instead of issuing a duplicate refresh', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const staleRead = {
      drive115: {
        v2AccessToken: 'old-access-token',
        v2RefreshToken: 'refresh-token',
        v2TokenExpiresAt: nowSec - 120,
        v2AutoRefresh: true,
        v2AutoRefreshSkewSec: 60,
        v2RefreshTokenStatus: 'valid',
        v2LastTokenRefreshAtSec: nowSec - 3600,
      },
    };
    const freshRead = {
      drive115: {
        ...staleRead.drive115,
        v2AccessToken: 'fresh-access-token',
        v2TokenExpiresAt: nowSec + 7200,
        v2LastTokenRefreshAtSec: nowSec - 5,
      },
    };
    let readCount = 0;
    mocks.getSettings.mockImplementation(async () => {
      readCount += 1;
      return readCount === 1 ? staleRead : freshRead;
    });

    const service = getDrive115V2Service();
    const refreshSpy = vi.spyOn(service, 'refreshToken');

    const result = await service.getValidAccessToken({ forceAutoRefresh: true });

    expect(result).toEqual({ success: true, accessToken: 'fresh-access-token' });
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });

  it('normalizes absolute and relative expiry values to a seconds timestamp', () => {
    const nowSec = 1_800_000_000;

    expect(normalizeDrive115TokenExpiry({ expires_at: nowSec + 3600 }, nowSec)).toBe(nowSec + 3600);
    expect(normalizeDrive115TokenExpiry({ expires_in: '3600' }, nowSec)).toBe(nowSec + 3600);
    expect(normalizeDrive115TokenExpiry({ expires_at: (nowSec + 3600) * 1000 }, nowSec)).toBe(nowSec + 3600);
  });
});
