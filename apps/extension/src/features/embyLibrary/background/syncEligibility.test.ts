import { describe, expect, it } from 'vitest';

import { getEnabledServers } from './handlers';
import { hasEnabledMediaServer } from './scheduler';

const URL = 'http://127.0.0.1:38098';

/** 五组凭据形态：注册谓词与执行谓词必须同判（判别口径，锁「注册/执行凭据分叉」机制） */
const CASES: Array<{ name: string; server: Record<string, unknown>; expected: boolean }> = [
  {
    name: 'UI 登录 accessToken、无 apiKey',
    server: { id: 's1', type: 'emby', name: 'S1', url: URL, accessToken: 'tok-1', enabled: true },
    expected: true,
  },
  {
    name: '仅 账号+密码、无 apiKey、未登录',
    server: { id: 's2', type: 'emby', name: 'S2', url: URL, username: 'user', password: 'pw', enabled: true },
    expected: true,
  },
  {
    name: 'apiKey 正常',
    server: { id: 's3', type: 'emby', name: 'S3', url: URL, apiKey: 'key-1', enabled: true },
    expected: true,
  },
  {
    name: '无凭据',
    server: { id: 's4', type: 'emby', name: 'S4', url: URL, enabled: true },
    expected: false,
  },
  {
    name: 'disabled（带 apiKey）',
    server: { id: 's5', type: 'emby', name: 'S5', url: URL, apiKey: 'key-1', enabled: false },
    expected: false,
  },
];

describe('alarm 注册谓词与同步执行谓词的凭据口径一致性', () => {
  it.each(CASES)('$name：注册/执行同判且符预期（$expected）', ({ server, expected }) => {
    const settings = { emby: { libraryEnabled: true, mediaServers: [server] } };
    const registrationSide = hasEnabledMediaServer(settings);
    const executionSide = getEnabledServers(settings).length > 0;
    expect(registrationSide).toBe(expected);
    expect(executionSide).toBe(expected);
    expect(registrationSide).toBe(executionSide);
  });
});
