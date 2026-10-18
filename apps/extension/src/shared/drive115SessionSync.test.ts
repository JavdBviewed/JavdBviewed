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

  it('数值会话键：local 0（finite）+ 远端缺 → 保 local 0；local null + 远端缺 → 不保', () => {
    const local = { drive115: { v2TokenExpiresAt: 0, v2LastTokenRefreshAtSec: null } };
    const out = mergeDrive115SessionForPull(local, {}) as Record<string, any>;
    expect(out.drive115.v2TokenExpiresAt).toBe(0);
    expect(out.drive115.v2LastTokenRefreshAtSec).toBeUndefined();
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
