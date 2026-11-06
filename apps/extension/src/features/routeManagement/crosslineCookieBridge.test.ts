import { afterEach, describe, expect, it, vi } from 'vitest';
import { bridgeJavdbSessionCookie, initJavdbCrosslineCookieBridge } from './crosslineCookieBridge';

type Cookie = chrome.cookies.Cookie;

function session(domain: string, value = 'private-session', extra: Partial<Cookie> = {}): Cookie {
  return {
    domain, name: '_jdb_session', value, path: '/', secure: true, httpOnly: true,
    hostOnly: !domain.startsWith('.'), session: true, sameSite: 'lax', storeId: '0', ...extra,
  };
}

function setup(initial: Cookie[] = []) {
  const jar = [...initial];
  let listener: ((change: chrome.cookies.CookieChangeInfo) => void) | undefined;
  const addListener = vi.fn((callback) => { listener = callback; });
  const set = vi.fn((details: chrome.cookies.SetDetails, callback: (cookie: Cookie | null) => void) => {
    const cookie = session(details.domain || new URL(details.url).hostname, details.value, {
      name: details.name, storeId: details.storeId || '0',
    });
    jar.push(cookie);
    callback(cookie);
  });
  const remove = vi.fn((details: chrome.cookies.Details, callback: (details: chrome.cookies.CookieDetails | null) => void) => {
    const host = new URL(details.url).hostname;
    const index = jar.findIndex(cookie => cookie.name === details.name &&
      cookie.storeId === (details.storeId || '0') &&
      (host === cookie.domain.replace(/^\./, '') ||
        (cookie.domain.startsWith('.') && host.endsWith(cookie.domain))));
    if (index === -1) callback(null);
    else {
      jar.splice(index, 1);
      callback({ name: details.name, url: details.url, storeId: details.storeId || '0' });
    }
  });
  vi.stubGlobal('chrome', { cookies: {
    getAll: vi.fn((filter: chrome.cookies.GetAllDetails, callback: (cookies: Cookie[]) => void) => {
      const host = new URL(filter.url || '').hostname;
      callback(jar.filter(cookie => cookie.storeId === (filter.storeId || '0') &&
        (host === cookie.domain.replace(/^\./, '') || (cookie.domain.startsWith('.') && host.endsWith(cookie.domain)))));
    }),
    set,
    remove,
    onChanged: { addListener, removeListener: vi.fn() },
  }, runtime: { lastError: undefined } });
  return { jar, set, remove, addListener, emit: (cookie: Cookie, removed = false, cause: chrome.cookies.OnChangedCause = 'explicit') => listener?.({ cookie, removed, cause }) };
}

afterEach(() => vi.unstubAllGlobals());

describe('JavDB crossline session bridge', () => {
  it('copies a new session to missing JavDB mirror domains without leaking to JavBus or copying CF clearance', async () => {
    const source = session('.javdb.com');
    const stub = setup([source, { ...source, name: 'over18', value: '1' }, { ...source, name: 'cf_clearance', value: 'cf-secret' }]);
    await bridgeJavdbSessionCookie(source);
    expect(stub.set.mock.calls.map(([details]) => [new URL(details.url).hostname, details.name])).toEqual([
      ['javdb570.com', '_jdb_session'], ['javdb570.com', 'over18'],
      ['javdb575.com', '_jdb_session'], ['javdb575.com', 'over18'],
    ]);
    expect(stub.set.mock.calls[0][0]).toMatchObject({ secure: true, httpOnly: true, sameSite: 'lax', storeId: '0' });
    expect(JSON.stringify(stub.set.mock.calls).includes('cf-secret')).toBe(false);
  });

  it('does not mix different sessions across mirror domains or bridge expired or partitioned sessions', async () => {
    const stub = setup([session('javdb.com'), session('javdb575.com', 'different-account')]);
    await bridgeJavdbSessionCookie(session('javdb.com'));
    expect(stub.set).not.toHaveBeenCalled();
    await bridgeJavdbSessionCookie(session('javdb.com', 'expired', { expirationDate: 1 }));
    await bridgeJavdbSessionCookie(session('javdb.com', 'partitioned', { partitionKey: { topLevelSite: 'https://javdb.com' } }));
    expect(stub.set.mock.calls.every(([details]) => details.value !== 'expired' && details.value !== 'partitioned')).toBe(true);
  });

  it('onChanged bridges only new session cookies from allowlisted hosts', async () => {
    const source = session('javdb.com');
    const stub = setup([source]);
    initJavdbCrosslineCookieBridge();
    expect(stub.addListener).toHaveBeenCalledTimes(1);
    stub.emit(session('evil.com'));
    stub.emit(session('javbus.com'));
    stub.emit(session('javdb.com', 'removed'), true);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(stub.set).not.toHaveBeenCalled();
    stub.emit(source);
    await vi.waitFor(() => expect(stub.set).toHaveBeenCalledTimes(2));
  });

  it('does not copy a removed or superseded session from a queued event', async () => {
    const source = session('javdb.com', 'old-session');
    const stub = setup([session('javdb.com', 'new-session')]);
    await bridgeJavdbSessionCookie(source);
    expect(stub.set).not.toHaveBeenCalled();
  });

  it('does not copy any session when a www-only target belongs to a different account', async () => {
    const source = session('www.javdb.com');
    const stub = setup([source, { ...source, name: 'over18', value: '1' }, session('www.javdb575.com', 'other-account')]);
    await bridgeJavdbSessionCookie(source);
    expect(stub.set).not.toHaveBeenCalled();
  });

  it('copies age gate from a www-only source into a missing mirror', async () => {
    const source = session('www.javdb.com');
    const stub = setup([source, { ...source, name: 'over18', value: '1' }]);
    await bridgeJavdbSessionCookie(source);
    expect(stub.set.mock.calls.map(([details]) => [new URL(details.url).hostname, details.name])).toEqual([
      ['javdb570.com', '_jdb_session'], ['javdb570.com', 'over18'],
      ['javdb575.com', '_jdb_session'], ['javdb575.com', 'over18'],
    ]);
  });

  it('ignores sessions issued to arbitrary subdomains', async () => {
    const stub = setup([session('untrusted.javdb.com')]);
    await bridgeJavdbSessionCookie(stub.jar[0]);
    expect(stub.set).not.toHaveBeenCalled();
  });

  it('does not refill a mirror session removed by logout during service worker startup', async () => {
    const stub = setup([session('javdb.com')]);
    initJavdbCrosslineCookieBridge();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(stub.set).not.toHaveBeenCalled();
    stub.emit(session('javdb575.com', 'logged-out'), true);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(stub.set).not.toHaveBeenCalled();
  });

  it('fills the age gate if it arrives after the session and keeps an existing matching session', async () => {
    const source = session('javdb.com');
    const stub = setup([source, session('.javdb570.com')]);
    initJavdbCrosslineCookieBridge();
    const ageGate = { ...source, name: 'over18', value: '1' };
    stub.jar.push(ageGate);
    stub.emit(ageGate);
    await vi.waitFor(() => expect(stub.set.mock.calls.some(([details]) =>
      details.name === 'over18' && new URL(details.url).hostname === 'javdb570.com')).toBe(true));
    expect(stub.set.mock.calls.some(([details]) =>
      details.name === '_jdb_session' && new URL(details.url).hostname === 'javdb570.com')).toBe(false);
  });

  it('clears only matching mirror sessions after an explicit logout', async () => {
    const source = session('javdb.com');
    const target = session('.javdb570.com');
    const different = session('javdb575.com', 'another-account');
    const stub = setup([target, different]);
    initJavdbCrosslineCookieBridge();
    stub.emit(source, true);
    await vi.waitFor(() => expect(stub.remove).toHaveBeenCalledTimes(1));
    expect(stub.jar.some(cookie => cookie.name === '_jdb_session' && cookie.domain === '.javdb570.com')).toBe(false);
    expect(stub.jar).toContain(different);
  });

  it('does not clear other lines after an overwrite or when the source still has its session', async () => {
    const source = session('javdb.com');
    const stub = setup([source, session('javdb570.com')]);
    initJavdbCrosslineCookieBridge();
    stub.emit(source, true, 'overwrite');
    stub.emit(source, true);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(stub.remove).not.toHaveBeenCalled();
  });
});
