import { describe, expect, it } from 'vitest';

import { isSyncEligibleServer } from './serverEligibility';

const URL = 'http://127.0.0.1:38098';

describe('isSyncEligibleServer（同步参与资格单一事实源）', () => {
  it('apiKey / accessToken / 账号+密码 任一凭据即合格', () => {
    expect(isSyncEligibleServer({ url: URL, apiKey: 'key-1', enabled: true })).toBe(true);
    expect(isSyncEligibleServer({ url: URL, accessToken: 'tok-1', enabled: true })).toBe(true);
    expect(isSyncEligibleServer({ url: URL, username: 'user', password: 'pw', enabled: true })).toBe(true);
    expect(isSyncEligibleServer({ url: URL, apiKey: 'key-1', accessToken: 'tok-1', enabled: true })).toBe(true);
  });

  it('无凭据 / 凭据不完整 / 未启用 / 无地址 → 不合格', () => {
    expect(isSyncEligibleServer({ url: URL, enabled: true })).toBe(false);
    expect(isSyncEligibleServer({ url: URL, username: 'user', enabled: true })).toBe(false);
    expect(isSyncEligibleServer({ url: URL, password: 'pw', enabled: true })).toBe(false);
    expect(isSyncEligibleServer({ url: URL, apiKey: 'key-1', enabled: false })).toBe(false);
    expect(isSyncEligibleServer({ apiKey: 'key-1', enabled: true })).toBe(false);
    expect(isSyncEligibleServer({ url: '  ', apiKey: 'key-1', enabled: true })).toBe(false);
  });

  it('空白占位凭据视为缺失（trim 口径）', () => {
    expect(isSyncEligibleServer({ url: URL, apiKey: '   ', enabled: true })).toBe(false);
    expect(isSyncEligibleServer({ url: URL, accessToken: '', username: '  ', password: 'pw', enabled: true })).toBe(false);
    expect(isSyncEligibleServer(null)).toBe(false);
    expect(isSyncEligibleServer(undefined)).toBe(false);
  });

  it('enabled 缺省（未显式关闭）按启用处理', () => {
    expect(isSyncEligibleServer({ url: URL, apiKey: 'key-1' })).toBe(true);
  });
});
