/** @description 隐私运行态解码、坏数据恢复与本机密钥初始化 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptData } from './crypto';
import type { PrivacyState } from '../../../types/privacy';
const state: PrivacyState = { isBlurred: false, isLocked: false, isAuthenticated: true, sessionStartTime: 10, lastActivity: 20, temporaryViewActive: false, temporaryViewEndTime: 0 };
let data: Record<string, unknown>;
let runtime: { lastError?: { message: string } };
let failRead: boolean;
let failWrite: boolean;
let failRemove: boolean;
let warnings: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.resetModules(); failRead = failWrite = failRemove = false; runtime = {};
  data = { privacy_encryption_key: 'device-local-key', settings: { privacy: { privateMode: { passwordHash: 'unchanged' } } }, privacy_config_security_questions: 'retain' };
  warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('chrome', { runtime, storage: { local: {
    get(keys: string[], callback: (value: unknown) => void) {
      if (failRead) runtime.lastError = { message: 'storage unavailable' };
      callback(Object.fromEntries(keys.filter(key => key in data).map(key => [key, data[key]])));
      delete runtime.lastError;
    },
    set(values: Record<string, unknown>, callback: () => void) {
      if (failWrite) runtime.lastError = { message: 'storage unavailable' };
      else Object.assign(data, values);
      callback(); delete runtime.lastError;
    },
    remove(keys: string | string[], callback: () => void) {
      if (failRemove) runtime.lastError = { message: 'storage unavailable' };
      else (Array.isArray(keys) ? keys : [keys]).forEach(key => delete data[key]);
      callback(); delete runtime.lastError;
    },
  } } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function storage() { return (await import('./storage')).getPrivacyStorage(); }
describe('privacy runtime data', () => {
  it('round-trips valid state and session; logout removes session', async () => {
    const target = await storage(); await target.savePrivacyState(state); expect(await target.loadPrivacyState()).toEqual(state);
    const session = { startTime: 10, lastActivity: 20, timeoutDuration: 30, remainingTime: 20, isValid: true };
    await target.saveSessionInfo(session); expect(await target.loadSessionInfo()).toEqual(session);
    await target.saveSessionInfo(null); expect(await target.loadSessionInfo()).toBeNull(); expect(data.privacy_session).toBeUndefined();
  });
  it.each(['wrong-device', 'control-character', 'invalid-shape', 'non-string'])('invalid %s state clears only runtime data and reports no secret content', async kind => {
    data.privacy_state = kind === 'wrong-device' ? encryptData(JSON.stringify(state), 'foreign-key')
      : kind === 'control-character' ? encryptData('{"x":"secret-raw\nvalue"}', 'device-local-key')
      : kind === 'invalid-shape' ? encryptData('{"isAuthenticated":true}', 'device-local-key') : { isAuthenticated: true };
    data.privacy_session = encryptData(JSON.stringify({ startTime: 10, lastActivity: 20, timeoutDuration: 30, remainingTime: 20, isValid: true }), 'device-local-key');
    const originalSettings = data.settings; const target = await storage();
    expect(await target.loadPrivacyState()).toBeNull();
    expect(data.privacy_state).toBeUndefined(); expect(data.privacy_session).toBeUndefined();
    expect(data.settings).toBe(originalSettings); expect(data.privacy_config_security_questions).toBe('retain');
    expect(data.privacy_encryption_key).toBe('device-local-key');
    expect(await target.loadPrivacyState()).toBeNull(); expect(warnings).toHaveBeenCalledOnce();
    expect(JSON.stringify(warnings.mock.calls)).not.toMatch(/secret-raw|device-local-key|foreign-key/);
  });
  it('invalid session cannot restore authentication and leaves valid state untouched', async () => {
    const target = await storage(); await target.savePrivacyState(state);
    data.privacy_session = encryptData('{"isValid":true,"startTime":"bad"}', 'device-local-key');
    expect(await target.loadSessionInfo()).toBeNull(); expect(data.privacy_session).toBeUndefined(); expect(await target.loadPrivacyState()).toEqual(state);
  });
  it('transient storage read error does not delete data or manufacture a fallback key', async () => {
    data.privacy_state = encryptData(JSON.stringify(state), 'device-local-key'); const original = { ...data };
    failRead = true; const target = await storage(); expect(await target.loadPrivacyState()).toBeNull(); expect(data).toEqual(original);
    failRead = false; expect(await target.loadPrivacyState()).toEqual(state);
  });
  it('key persistence failure never saves ciphertext encrypted with a non-persisted key', async () => {
    delete data.privacy_encryption_key; failWrite = true; const target = await storage();
    await expect(target.savePrivacyState(state)).rejects.toThrow();
    failWrite = false; await target.savePrivacyState(state);
    vi.resetModules(); expect(await (await storage()).loadPrivacyState()).toEqual(state);
  });
  it('cleanup failure still cannot return an authenticated state', async () => {
    data.privacy_state = 'bad-base64'; failRemove = true;
    data.privacy_session = encryptData(JSON.stringify({ startTime: 10, lastActivity: 20, timeoutDuration: 30, remainingTime: 20, isValid: true }), 'device-local-key');
    expect(await (await storage()).loadPrivacyState()).toBeNull(); expect(data.privacy_state).toBe('bad-base64');
    expect(await (await storage()).loadSessionInfo()).toBeNull();
  });
  it('serializes first-key creation across two page instances', async () => {
    delete data.privacy_encryption_key;
    let tail = Promise.resolve();
    vi.stubGlobal('navigator', { locks: { request: (_name: string, action: () => Promise<void>) => {
      const next = tail.then(action); tail = next.catch(() => {}); return next;
    } } });
    const First = (await import('./storage')).PrivacyStorage;
    vi.resetModules(); const Second = (await import('./storage')).PrivacyStorage;
    const originalGet = chrome.storage.local.get;
    chrome.storage.local.get = ((keys: string[], callback: (value: unknown) => void) => {
      originalGet(keys, result => queueMicrotask(() => callback(result)));
    }) as typeof originalGet;
    const first = First.getInstance(); const second = Second.getInstance();
    await Promise.all([first.savePrivacyState(state), second.saveSessionInfo({ startTime: 10, lastActivity: 20, timeoutDuration: 30, remainingTime: 20, isValid: true })]);
    vi.resetModules(); const reader = await storage();
    expect(await reader.loadPrivacyState()).toEqual(state);
    expect(await reader.loadSessionInfo()).toMatchObject({ startTime: 10, isValid: true });
  });

});
