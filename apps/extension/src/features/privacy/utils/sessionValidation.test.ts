/** @description 明确失效和未来时间戳不能恢复隐私认证 */
import { expect, it } from 'vitest';
import { SessionValidator } from './validation';
it.each([
  { startTime: Date.now(), isValid: false },
  { startTime: Date.now() + 60_000, isValid: true },
  { startTime: Infinity, isValid: true },
])('rejects invalid local session %j', session => {
  expect(SessionValidator.isSessionValid(session, 30)).toBe(false);
});
it('accepts an unexpired explicitly valid session', () => {
  expect(SessionValidator.isSessionValid({ startTime: Date.now() - 1000, isValid: true }, 30)).toBe(true);
});
