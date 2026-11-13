/**
 * @file drive115SessionSync.test.ts
 * @description 115 会话 pull 侧逐键方向性保护纯函数矩阵（10-13 线裁决 G3-ii）：
 * - local 非空 + incoming 空/缺 → 保 local；否则 incoming 原样胜（现状语义）
 * - 键族=7 个 v2* 会话键；族外键（v2ClientId 等）不保护，随整 blob LWW
 * - 无时间戳比较；纯函数不改输入
 */
import { describe, expect, it } from 'vitest';
import { DRIVE115_SESSION_KEYS, mergeDrive115SessionForPull } from './drive115SessionSync';

function session(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v2AuthMode: 'openlist_manual',
    v2AccessToken: 'AT-x',
    v2RefreshToken: 'RT-x',
    v2TokenExpiresAt: 1893456000,
    v2RefreshTokenStatus: 'valid',
    v2AccessTokenStatus: 'valid',
    v2LastTokenRefreshAtSec: 1760000000,
    ...over,
  };
}

describe('mergeDrive115SessionForPull', () => {
  it('local 有 + 远端无 drive115 → 保 local（全会话键族）', () => {
    const local = { theme: 'light', drive115: session({ v2AccessToken: 'AT-local' }) };
    const incoming = { theme: 'dark' };
    const out = mergeDrive115SessionForPull(local, incoming) as Record<string, any>;
    for (const k of DRIVE115_SESSION_KEYS) {
      expect(out.drive115[k]).toBe(local.drive115[k]);
    }
    // 其余键仍随 incoming 整 blob LWW
    expect(out.theme).toBe('dark');
  });

  it('local 有 + 远端 drive115 空对象 → 保 local', () => {
    const local = { drive115: session() };
    const out = mergeDrive115SessionForPull(local, { drive115: {} }) as Record<string, any>;
    for (const k of DRIVE115_SESSION_KEYS) {
      expect(out.drive115[k]).toBe(local.drive115[k]);
    }
  });

  it('local 空 + 远端有 → 取远端', () => {
    const local = { drive115: { v2ClientId: 'cid-local' } };
    const incoming = { drive115: session({ v2AccessToken: 'AT-remote' }) };
    const out = mergeDrive115SessionForPull(local, incoming) as Record<string, any>;
    for (const k of DRIVE115_SESSION_KEYS) {
      expect(out.drive115[k]).toBe(incoming.drive115[k]);
    }
  });

  it('双非空 → 远端胜（现状整 blob LWW 语义锁，无时间戳比较）', () => {
    const local = { drive115: session({ v2AccessToken: 'AT-local' }) };
    const incoming = { drive115: session({ v2AccessToken: 'AT-remote' }) };
    const out = mergeDrive115SessionForPull(local, incoming) as Record<string, any>;
    for (const k of DRIVE115_SESSION_KEYS) {
      expect(out.drive115[k]).toBe(incoming.drive115[k]);
    }
  });

  it('非会话配置键不受保护：v2ClientId 随 incoming LWW（键族边界）', () => {
    const local = { drive115: { v2ClientId: 'cid-local', ...session() } };
    const incoming = { drive115: { v2ClientId: 'cid-remote' } };
    const out = mergeDrive115SessionForPull(local, incoming) as Record<string, any>;
    expect(out.drive115.v2ClientId).toBe('cid-remote');
    // 会话键族仍保 local
    for (const k of DRIVE115_SESSION_KEYS) {
      expect(out.drive115[k]).toBe(local.drive115[k]);
    }
  });

  it('数值会话键（组外）：local 0（finite）+ 远端缺 → 保 local 0；local null + 远端缺 → 不保', () => {
    const local = { drive115: { v2AccessToken: 'AT-x', v2LastTokenRefreshAtSec: 0 } };
    const out = mergeDrive115SessionForPull(local, {}) as Record<string, any>;
    // 组非空（AT-x）→ 组整体保留；组外 v2LastTokenRefreshAtSec=0（finite）非空 → 保 local 0
    expect(out.drive115.v2AccessToken).toBe('AT-x');
    expect(out.drive115.v2LastTokenRefreshAtSec).toBe(0);
    // 组内键 local 缺 → 不得凭空出现
    expect(out.drive115.v2TokenExpiresAt).toBeUndefined();

    const localNull = { drive115: { v2AccessToken: 'AT-x', v2LastTokenRefreshAtSec: null } };
    const outNull = mergeDrive115SessionForPull(localNull, {}) as Record<string, any>;
    expect(outNull.drive115.v2LastTokenRefreshAtSec).toBeUndefined();
  });

  it('字符串空串=空：local "" + 远端缺 → 不保（trim 语义）', () => {
    const local = { drive115: { v2AccessToken: '   ' } };
    const out = mergeDrive115SessionForPull(local, {}) as Record<string, any>;
    expect(out.drive115).toBeUndefined();
  });

  it('未触发保护 → 原样返回 incoming（同引用零漂移快路径）', () => {
    const local = { drive115: { v2ClientId: 'cid' } };
    const incoming = { drive115: session() };
    expect(mergeDrive115SessionForPull(local, incoming)).toBe(incoming);
    const noLocal: Record<string, unknown> = { theme: 'dark' };
    expect(mergeDrive115SessionForPull(noLocal, incoming)).toBe(incoming);
    // 远端非对象 → 原样返回
    expect(mergeDrive115SessionForPull(local, null)).toBe(null);
  });

  it('纯函数：不改 local/incoming 输入', () => {
    const local = { drive115: session() };
    const incoming = { theme: 'dark' };
    const localBefore = structuredClone(local);
    const incomingBefore = structuredClone(incoming);
    mergeDrive115SessionForPull(local, incoming);
    expect(local).toEqual(localBefore);
    expect(incoming).toEqual(incomingBefore);
  });
});

describe('mergeDrive115SessionForPull · issue #58 token 组级时间戳 LWW', () => {
  const STAMP = 'v2RefreshTokenIssuedAtSec';

  it('local 戳新 + incoming 组旧 → local 整组胜（Issue #58 核心：陈旧 blob 翻不回新 token）', () => {
    const local = { drive115: { v2AccessToken: 'AT-new', v2RefreshToken: 'RT-new', v2TokenExpiresAt: 9999999999, [STAMP]: 200 } };
    const incoming = { drive115: { v2AccessToken: 'AT-stale', v2RefreshToken: 'RT-stale', v2TokenExpiresAt: 1111111111, [STAMP]: 100, downloadDir: '/stale/dir' } };
    const out = mergeDrive115SessionForPull(local, incoming) as Record<string, any>;
    expect(out.drive115.v2AccessToken).toBe('AT-new');
    expect(out.drive115.v2RefreshToken).toBe('RT-new');
    expect(out.drive115.v2TokenExpiresAt).toBe(9999999999);
    expect(out.drive115[STAMP]).toBe(200);
    // 组外配置键仍随 incoming LWW（G3-ii 键族边界不变）
    expect(out.drive115.downloadDir).toBe('/stale/dir');
  });

  it('incoming 戳新 → incoming 整组胜（跨设备送达新 token 不受影响）', () => {
    const local = { drive115: { v2AccessToken: 'AT-stale', v2RefreshToken: 'RT-stale', [STAMP]: 100 } };
    const incoming = { drive115: { v2AccessToken: 'AT-new', v2RefreshToken: 'RT-new', v2TokenExpiresAt: 9999999999, [STAMP]: 200 } };
    const out = mergeDrive115SessionForPull(local, incoming) as Record<string, any>;
    expect(out.drive115.v2AccessToken).toBe('AT-new');
    expect(out.drive115.v2RefreshToken).toBe('RT-new');
    expect(out.drive115[STAMP]).toBe(200);
  });

  it('双无戳 → incoming 组胜（legacy 语义不变：无时间戳比较时 incoming 原样胜）', () => {
    const local = { drive115: session({ v2AccessToken: 'AT-local' }) };
    const incoming = { drive115: session({ v2AccessToken: 'AT-remote' }) };
    const out = mergeDrive115SessionForPull(local, incoming) as Record<string, any>;
    expect(out.drive115.v2AccessToken).toBe('AT-remote');
    expect(out.drive115.v2RefreshToken).toBe('RT-x');
  });

  it('戳平手 → incoming 组胜（与 emby 条目级 LWW 平手口径一致）', () => {
    const local = { drive115: { v2AccessToken: 'AT-base', v2RefreshToken: 'RT-base', [STAMP]: 100 } };
    const incoming = { drive115: { v2AccessToken: 'AT-in', v2RefreshToken: 'RT-in', [STAMP]: 100 } };
    const out = mergeDrive115SessionForPull(local, incoming) as Record<string, any>;
    expect(out.drive115.v2AccessToken).toBe('AT-in');
  });

  it('local 有戳 + incoming 组无戳但非空 → local 整组胜（无戳=0=最旧，与 emby 条目 LWW 同口径；组内不混杂）', () => {
    const local = { drive115: { v2AccessToken: 'AT-new', v2RefreshToken: 'RT-new', v2TokenExpiresAt: 9999999999, [STAMP]: 200 } };
    const incoming = { drive115: { v2AccessToken: 'AT-stale', v2RefreshToken: 'RT-stale', v2TokenExpiresAt: 1111111111 } };
    const out = mergeDrive115SessionForPull(local, incoming) as Record<string, any>;
    expect(out.drive115.v2AccessToken).toBe('AT-new');
    expect(out.drive115.v2RefreshToken).toBe('RT-new');
    expect(out.drive115.v2TokenExpiresAt).toBe(9999999999); // incoming 的过期时间不得残留
    expect(out.drive115[STAMP]).toBe(200);
  });

  it('incoming 组全空 + local 组非空 → 清除不传播，local 整组保留（10-13 known-limitation 不变）', () => {
    const local = { drive115: { v2AccessToken: 'AT-stored', v2RefreshToken: 'RT-stored', [STAMP]: 200 } };
    const incoming = { drive115: { v2AccessToken: '   ', v2RefreshToken: '', enabled: true } };
    const out = mergeDrive115SessionForPull(local, incoming) as Record<string, any>;
    expect(out.drive115.v2AccessToken).toBe('AT-stored');
    expect(out.drive115.v2RefreshToken).toBe('RT-stored');
    expect(out.drive115[STAMP]).toBe(200);
    // 配置键仍 incoming 胜
    expect(out.drive115.enabled).toBe(true);
  });

  it('incoming 组全空（即使带更新戳）→ 清除不传播，local 组保留（10-13 known-limitation 不变）', () => {
    const local = { drive115: { v2AccessToken: 'AT-old', v2RefreshToken: 'RT-old', [STAMP]: 100 } };
    const incoming = { drive115: { v2AccessToken: '', v2RefreshToken: '', [STAMP]: 200 } };
    const out = mergeDrive115SessionForPull(local, incoming) as Record<string, any>;
    expect(out.drive115.v2AccessToken).toBe('AT-old');
    expect(out.drive115.v2RefreshToken).toBe('RT-old');
    expect(out.drive115[STAMP]).toBe(100);
  });

  it('incoming 无 drive115 + local 组非空 → local 整组保留（组版 G3-ii）', () => {
    const local = { drive115: { v2AccessToken: 'AT-stored', v2RefreshToken: 'RT-stored', [STAMP]: 200 } };
    const out = mergeDrive115SessionForPull(local, { theme: 'dark' }) as Record<string, any>;
    expect(out.drive115.v2AccessToken).toBe('AT-stored');
    expect(out.drive115.v2RefreshToken).toBe('RT-stored');
    expect(out.theme).toBe('dark');
  });

  it('local 组非空 + incoming 组非空且戳新 → 组外会话键（v2AuthMode 等）仍走键级保护', () => {
    const local = { drive115: { v2AccessToken: 'AT-a', v2RefreshToken: 'RT-a', v2AuthMode: 'openlist_scan', v2AccessTokenStatus: 'expired', [STAMP]: 100 } };
    const incoming = { drive115: { v2AccessToken: 'AT-b', v2RefreshToken: 'RT-b', v2AuthMode: 'self_app', [STAMP]: 200 } };
    const out = mergeDrive115SessionForPull(local, incoming) as Record<string, any>;
    expect(out.drive115.v2AuthMode).toBe('self_app');
    expect(out.drive115.v2AccessTokenStatus).toBe('expired'); // 键级保护：local 非空 + incoming 缺 → 保 local
  });

  it('戳为非 number（脏数据）→ 按无戳处理，走 incoming 组', () => {
    const local = { drive115: { v2AccessToken: 'AT-a', [STAMP]: 'not-a-number' } };
    const incoming = { drive115: { v2AccessToken: 'AT-b', v2RefreshToken: 'RT-b' } };
    const out = mergeDrive115SessionForPull(local, incoming) as Record<string, any>;
    expect(out.drive115.v2AccessToken).toBe('AT-b');
  });
});
