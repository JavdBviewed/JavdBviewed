/**
 * @file tokenExpiry.ts
 * @description 115 token 过期时间字段归一化。
 * @module features/drive115/v2
 */

type TokenExpiryInput = {
  expires_at?: unknown;
  expires_in?: unknown;
};

/**
 * 115 不同授权/刷新入口可能返回绝对时间戳或相对秒数，统一为秒级时间戳。
 */
export function normalizeDrive115TokenExpiry(
  input: TokenExpiryInput,
  nowSec = Math.floor(Date.now() / 1000),
): number | null {
  const absolute = Number(input.expires_at);
  if (Number.isFinite(absolute) && absolute > 0) {
    return Math.floor(absolute > 1_000_000_000_000 ? absolute / 1000 : absolute);
  }

  const relative = Number(input.expires_in);
  if (Number.isFinite(relative) && relative > 0) {
    return nowSec + Math.floor(relative);
  }

  return null;
}
