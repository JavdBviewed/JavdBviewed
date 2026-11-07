import { afterEach, describe, expect, it, vi } from 'vitest';
import { bridgeJavdbSessionCookie, getJavdbCrosslineStatus, initJavdbCrosslineCookieBridge, refreshJavdbCrosslineSessions, setJavdbCrosslineEnabled, readEnabledHosts, mirrorHost, copyVerifiedCrosslineSession } from './crosslineCookieBridge';

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
  let settingsListener: ((changes: { [key: string]: chrome.storage.StorageChange }, area: string) => void) | undefined;
  const addListener = vi.fn((callback) => { listener = callback; });
  const set = vi.fn((details: chrome.cookies.SetDetails, callback: (cookie: Cookie | null) => void) => {
    const cookie = session(details.domain || new URL(details.url).hostname, details.value, {
      name: details.name, storeId: details.storeId || '0',
    });
    const index = jar.findIndex(existing => existing.name === cookie.name &&
      existing.storeId === cookie.storeId && existing.domain === cookie.domain && existing.path === cookie.path);
    if (index !== -1) jar.splice(index, 1);
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
  // Existing bridge scenarios explicitly use the original three configured routes.
  const values: Record<string, unknown> = { settings: { routes: { javdb: {
    primary: 'https://javdb.com', alternatives: [
      { url: 'https://javdb570.com', enabled: true }, { url: 'https://javdb575.com', enabled: true },
    ],
  } } } };
  vi.stubGlobal('chrome', { cookies: {
    getAll: vi.fn((filter: chrome.cookies.GetAllDetails, callback: (cookies: Cookie[]) => void) => {
      if (!filter.url) {
        callback(jar.filter(cookie => !filter.name || cookie.name === filter.name));
        return;
      }
      const host = new URL(filter.url || '').hostname;
      callback(jar.filter(cookie => cookie.storeId === (filter.storeId || '0') &&
        (host === cookie.domain.replace(/^\./, '') || (cookie.domain.startsWith('.') && host.endsWith(cookie.domain)))));
    }),
    set,
    remove,
    onChanged: { addListener, removeListener: vi.fn() },
  }, storage: { local: {
    get: vi.fn((_key, callback) => callback(values)),
    set: vi.fn((change, callback) => { Object.assign(values, change); callback?.(); }),
  },
    onChanged: { addListener: vi.fn(callback => { settingsListener = callback; }), removeListener: vi.fn() } },
    runtime: { lastError: undefined } });
  return { jar, set, remove, addListener,
    emit: (cookie: Cookie, removed = false, cause: chrome.cookies.OnChangedCause = 'explicit') => listener?.({ cookie, removed, cause }),
    settingsChanged: () => settingsListener?.({ settings: { oldValue: {}, newValue: {} } }, 'local'),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('JavDB crossline session bridge', () => {
  it('reports and fills an existing source session on demand without returning cookie values', async () => {
    const stub = setup([session('javdb.com', 'secret-session')]);
    const before = await getJavdbCrosslineStatus();
    expect(before.routes.find(route => route.host === 'javdb575.com')?.status).toBe('missing');
    const after = await refreshJavdbCrosslineSessions();
    expect(after.routes.find(route => route.host === 'javdb575.com')?.status).toBe('synced');
    expect(stub.set).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(after)).not.toContain('secret-session');
  });

  it('keeps auto and manual writes disabled while still showing read-only diagnostics', async () => {
    const stub = setup([session('javdb.com')]);
    await setJavdbCrosslineEnabled(false);
    initJavdbCrosslineCookieBridge();
    const result = await refreshJavdbCrosslineSessions();
    expect(result.enabled).toBe(false);
    expect(result.routes.find(route => route.host === 'javdb575.com')?.status).toBe('missing');
    expect(stub.set).not.toHaveBeenCalled();
  });

  it('exposes a conflicting mirror without overwriting it or any other route', async () => {
    const stub = setup([session('javdb.com', 'secret-session'), session('javdb575.com', 'other-session')]);
    const result = await refreshJavdbCrosslineSessions();
    expect(result.routes.find(route => route.host === 'javdb575.com')?.status).toBe('conflict');
    expect(stub.set).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('other-session');
  });

  it('marks disabled routes and does not fill them', async () => {
    const stub = setup([session('javdb.com')]);
    vi.mocked(chrome.storage.local.get).mockImplementation((_key, callback) => {
      (callback as (result: unknown) => void)({ settings: { routes: { javdb: {
        primary: 'https://javdb.com', alternatives: [{ url: 'https://javdb575.com', enabled: false }],
      } } } });
    });
    const result = await refreshJavdbCrosslineSessions();
    expect(result.routes.find(route => route.host === 'javdb575.com')?.status).toBe('disabled');
    expect(stub.set).not.toHaveBeenCalled();
  });

  it('lists configured unsupported routes without treating them as sync targets', async () => {
    const stub = setup([session('javdb.com')]);
    vi.mocked(chrome.storage.local.get).mockImplementation((_key, callback) => {
      (callback as (result: unknown) => void)({ settings: { routes: { javdb: {
        primary: 'https://javdb.com', alternatives: [
          { url: 'https://unrelated.example', enabled: true },
          { url: 'https://www.javdb575.com', enabled: true },
        ],
      } } } });
    });
    const result = await refreshJavdbCrosslineSessions();
    expect(result.routes).toContainEqual({ host: 'unrelated.example', status: 'unsupported' });
    expect(result.routes.some(route => route.host === 'javdb570.com')).toBe(false);
    expect(stub.set).toHaveBeenCalledTimes(1);
    expect(result.checkedAt).toBeGreaterThan(0);
  });

  it('does not combine an enabled HTTP entry with a disabled HTTPS entry', async () => {
    const stub = setup([session('javdb.com')]);
    vi.mocked(chrome.storage.local.get).mockImplementation((_key, callback) => {
      (callback as (result: unknown) => void)({ settings: { routes: { javdb: {
        primary: 'https://javdb.com', alternatives: [
          { url: 'https://javdb575.com', enabled: false },
          { url: 'http://javdb575.com', enabled: true },
        ],
      } } } });
    });
    const result = await refreshJavdbCrosslineSessions();
    expect(result.routes.find(route => route.host === 'javdb575.com')?.status).toBe('unsupported');
    expect(stub.set).not.toHaveBeenCalled();
  });

  it('shows partial writes and the failing route without exposing raw API errors', async () => {
    const stub = setup([session('javdb.com')]);
    const write = stub.set.getMockImplementation();
    stub.set.mockImplementation((details, callback) => {
      if (details.url.includes('575')) {
        chrome.runtime.lastError = { message: 'sensitive browser error' };
        callback(null);
        chrome.runtime.lastError = undefined;
      } else write?.(details, callback);
    });
    const result = await refreshJavdbCrosslineSessions();
    expect(result.routes.find(route => route.host === 'javdb570.com')?.status).toBe('synced');
    expect(result.routes.find(route => route.host === 'javdb575.com')?.status).toBe('error');
    expect(result.error?.stage).toBe('cookie-write');
    expect(JSON.stringify(result)).not.toContain('sensitive browser error');
  });

  it('reports cookie-read failures and permits a later retry', async () => {
    setup();
    vi.mocked(chrome.cookies.getAll).mockImplementationOnce((_filter, callback) => {
      chrome.runtime.lastError = { message: 'secret browser error' };
      callback([]);
      chrome.runtime.lastError = undefined;
    });
    await expect(refreshJavdbCrosslineSessions()).rejects.toMatchObject({ stage: 'cookie-read' });
    await expect(refreshJavdbCrosslineSessions()).resolves.toMatchObject({ reason: 'no-session' });
  });

  it('does not clear matching mirror sessions while the switch is off', async () => {
    const source = session('javdb.com');
    const stub = setup([source, session('javdb575.com')]);
    await setJavdbCrosslineEnabled(false);
    initJavdbCrosslineCookieBridge();
    stub.jar.splice(stub.jar.indexOf(source), 1);
    stub.emit(source, true);
    await getJavdbCrosslineStatus();
    expect(stub.remove).not.toHaveBeenCalled();
  });
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

  it('rotates only mirror sessions still matching an overwritten anonymous source session', async () => {
    const anonymous = session('javdb.com', 'anonymous-session');
    const signedIn = session('javdb.com', 'signed-in-session');
    const stub = setup([anonymous]);
    initJavdbCrosslineCookieBridge();
    stub.emit(anonymous);
    await vi.waitFor(() => expect(stub.set).toHaveBeenCalledTimes(2));

    stub.jar.splice(stub.jar.indexOf(anonymous), 1, signedIn);
    stub.emit(anonymous, true, 'overwrite');
    stub.emit(signedIn);

    await vi.waitFor(() => expect(stub.jar.filter(cookie => cookie.name === '_jdb_session' &&
      cookie.domain.startsWith('.')).map(cookie => cookie.value)).toEqual([
      'signed-in-session', 'signed-in-session',
    ]));
    expect(stub.jar.filter(cookie => cookie.name === '_jdb_session')).toHaveLength(3);
  });

  it('does not replace an independently signed-in mirror after the source rotates', async () => {
    const anonymous = session('javdb.com', 'anonymous-session');
    const signedIn = session('javdb.com', 'signed-in-session');
    const independent = session('javdb575.com', 'other-account');
    const stub = setup([anonymous, independent]);
    initJavdbCrosslineCookieBridge();
    stub.jar.splice(0, 1, signedIn);
    stub.emit(anonymous, true, 'overwrite');
    stub.emit(signedIn);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(stub.set).not.toHaveBeenCalled();
    expect(stub.jar).toContain(independent);
  });

  it('onChanged bridges only new session cookies from allowlisted hosts', async () => {
    const source = session('javdb.com');
    const stub = setup();
    initJavdbCrosslineCookieBridge();
    expect(stub.addListener).toHaveBeenCalledTimes(1);
    stub.emit(session('evil.com'));
    stub.emit(session('javbus.com'));
    stub.emit(session('javdb.com', 'removed'), true);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(stub.set).not.toHaveBeenCalled();
    stub.jar.push(source);
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

  it('reconciles a stored main session to enabled mirrors on startup without another login', async () => {
    const stub = setup([session('javdb.com')]);
    initJavdbCrosslineCookieBridge();
    await vi.waitFor(() => expect(stub.set.mock.calls.map(([details]) => new URL(details.url).hostname))
      .toEqual(['javdb570.com', 'javdb575.com']));
  });

  it('fills a newly enabled mirror after settings change without another login', async () => {
    const stub = setup([session('javdb.com')]);
    let enabled = false;
    vi.mocked(chrome.storage.local.get).mockImplementation((_key, callback) => {
      (callback as (result: unknown) => void)({ settings: { routes: { javdb: {
        primary: 'https://javdb.com', alternatives: [{ url: 'https://javdb575.com', enabled }],
      } } } });
    });
    initJavdbCrosslineCookieBridge();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(stub.set).not.toHaveBeenCalled();
    enabled = true;
    stub.settingsChanged();
    await vi.waitFor(() => expect(stub.set).toHaveBeenCalledTimes(1));
  });

  it('does not fill disabled routes from an existing session', async () => {
    const stub = setup([session('javdb.com')]);
    vi.mocked(chrome.storage.local.get).mockImplementation((_key, callback) => {
      (callback as (result: unknown) => void)({ settings: { routes: { javdb: {
        primary: 'https://javdb.com', alternatives: [
          { url: 'https://javdb570.com', enabled: false },
          { url: 'https://javdb575.com', enabled: true },
        ],
      } } } });
    });
    initJavdbCrosslineCookieBridge();
    await vi.waitFor(() => expect(stub.set).toHaveBeenCalledTimes(1));
    expect(new URL(stub.set.mock.calls[0][0].url).hostname).toBe('javdb575.com');
  });

  it('does not replace an independently signed-in mirror on startup', async () => {
    const stub = setup([session('javdb.com'), session('javdb575.com', 'another-account')]);
    initJavdbCrosslineCookieBridge();
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


describe('explicit crossline session selection', () => {
  it('replaces only the chosen target while automatic sync is off, without exposing secrets', async () => {
    const { copyJavdbCrosslineSession } = await import('./crosslineCookieBridge');
    const stub = setup([session('javdb.com', 'source-secret'), session('.javdb575.com', 'anonymous'),
      session('www.javdb575.com', 'old-www'), session('javdb570.com', 'leave-alone')]);
    await setJavdbCrosslineEnabled(false);
    const result = await copyJavdbCrosslineSession('javdb.com', 'javdb575.com');
    const target = stub.jar.filter(cookie => cookie.domain.includes('575'));
    expect(target).toHaveLength(1);
    expect(target[0].value).toBe('source-secret');
    expect(stub.jar.find(cookie => cookie.domain === 'javdb570.com')?.value).toBe('leave-alone');
    expect(result.routes.find(route => route.host === 'javdb575.com')?.status).toBe('synced');
    expect(result.enabled).toBe(false);
    expect(JSON.stringify(result)).not.toContain('source-secret');
  });

  it.each(['javdb580.com', 'evil.example', 'www.javdb575.com'])('rejects unsupported or noncanonical target %s', async target => {
    const { copyJavdbCrosslineSession } = await import('./crosslineCookieBridge');
    const stub = setup([session('javdb.com')]);
    await expect(copyJavdbCrosslineSession('javdb.com', target)).rejects.toThrow();
    expect(stub.set).not.toHaveBeenCalled();
    expect(stub.remove).not.toHaveBeenCalled();
  });

  it('rejects an ambiguous source or multiple stores before changing any cookie', async () => {
    const { copyJavdbCrosslineSession } = await import('./crosslineCookieBridge');
    const stub = setup([session('javdb.com', 'one'), session('www.javdb.com', 'two')]);
    await expect(copyJavdbCrosslineSession('javdb.com', 'javdb575.com')).rejects.toThrow();
    expect(stub.set).not.toHaveBeenCalled();
    expect(stub.remove).not.toHaveBeenCalled();
  });

  it('does not treat removing the selected target as logout from unselected sites', async () => {
    const { copyJavdbCrosslineSession } = await import('./crosslineCookieBridge');
    const oldTarget = session('javdb575.com', 'same-old');
    const stub = setup([session('javdb.com', 'source'), oldTarget, session('javdb570.com', 'same-old')]);
    initJavdbCrosslineCookieBridge();
    await getJavdbCrosslineStatus();
    await copyJavdbCrosslineSession('javdb.com', 'javdb575.com');
    stub.emit(oldTarget, true, 'explicit');
    await getJavdbCrosslineStatus();
    expect(stub.jar.find(cookie => cookie.domain === 'javdb570.com')?.value).toBe('same-old');
  });
});

it('does not refill a target after an explicit user logout cooldown', async () => {
  const stub = setup([session('javdb.com')]);
  await new Promise<void>(resolve => chrome.storage.local.set({ javdbCrosslinePromptSuppression: {
    '0:javdb575.com': { until: Date.now() + 86400000, reason: 'logout' },
  } }, resolve));
  await bridgeJavdbSessionCookie(stub.jar[0]);
  expect(stub.jar.some(cookie => cookie.domain.includes('javdb575'))).toBe(false);
  expect(stub.jar.some(cookie => cookie.domain.includes('javdb570'))).toBe(true);
});

it('verifies the target website and restores a rejected copy without touching another store', async () => {
  const { copyVerifiedCrosslineSession } = await import('./crosslineCookieBridge');
  const stub = setup([session('javdb.com', 'login'), session('javdb575.com', 'guest'), session('javdb575.com', 'other-profile', { storeId: '1' })]);
  const result = await copyVerifiedCrosslineSession('javdb.com', 'javdb575.com', '0', async () => undefined, async () => 'anonymous');
  expect(result).toBe('not-accepted');
  expect(stub.jar.filter(cookie => cookie.domain.includes('javdb575')).map(cookie => cookie.value).sort()).toEqual(['guest', 'other-profile']);
});

it('does not restore an anonymous snapshot over a concurrent target session change', async () => {
  const { copyVerifiedCrosslineSession } = await import('./crosslineCookieBridge');
  const stub = setup([session('javdb.com', 'login'), session('javdb575.com', 'guest')]);
  const result = await copyVerifiedCrosslineSession('javdb.com', 'javdb575.com', '0', async () => undefined, async () => {
    for (const cookie of stub.jar) if (cookie.domain.includes('javdb575')) cookie.value = 'new-target-session';
    return 'anonymous';
  });
  expect(result).toBe('not-accepted');
  expect(stub.jar.find(cookie => cookie.domain.includes('javdb575'))?.value).toBe('new-target-session');
});

it('treats a challenge after writing as unconfirmed, not a successful login', async () => {
  const { copyVerifiedCrosslineSession } = await import('./crosslineCookieBridge');
  setup([session('javdb.com', 'login'), session('javdb575.com', 'guest')]);
  expect(await copyVerifiedCrosslineSession('javdb.com', 'javdb575.com', '0', async () => undefined, async () => 'unknown')).toBe('unconfirmed');
});

describe('configured numeric JavDB routes', () => {
  function configure(alternatives: { url: string; enabled: boolean }[]) {
    vi.mocked(chrome.storage.local.get).mockImplementation((_key, callback) => {
      (callback as (result: unknown) => void)({ settings: { routes: { javdb: {
        primary: 'https://javdb575.com', alternatives,
      } } } });
    });
  }

  it('reads enabled configured mirrors without a fixed rollout list', async () => {
    setup();
    configure([
      { url: 'https://javdb580.com', enabled: true },
      { url: 'https://www.javdb580.com', enabled: true },
      { url: 'https://javdb585.com', enabled: true },
      { url: 'https://javdb36.com', enabled: true },
      { url: 'https://javdb590.com', enabled: false },
    ]);
    expect(await readEnabledHosts()).toEqual(['javdb575.com', 'javdb580.com', 'javdb585.com', 'javdb36.com']);
  });

  it('copies a verified 575 session to a configured 580 without touching other stores', async () => {
    const stub = setup([session('javdb575.com', 'login'), session('javdb580.com', 'guest'),
      session('javdb580.com', 'private-profile', { storeId: '1' })]);
    configure([{ url: 'https://javdb580.com', enabled: true }]);
    const before = await getJavdbCrosslineStatus();
    expect(before.routes.find(route => route.host === 'javdb580.com')?.status).toBe('conflict');
    const result = await copyVerifiedCrosslineSession('javdb575.com', 'javdb580.com', '0', async () => undefined, async () => 'authenticated');
    expect(result).toBe('authenticated');
    expect(stub.jar.filter(cookie => cookie.domain.includes('javdb580')).map(cookie => [cookie.storeId, cookie.value])).toEqual([
      ['1', 'private-profile'], ['0', 'login'],
    ]);
  });

  it('does not authorize disabled, HTTP, nonstandard ports, userinfo or lookalike hosts', async () => {
    const stub = setup([session('javdb575.com')]);
    configure([
      { url: 'https://javdb580.com', enabled: false },
      { url: 'http://javdb580.com', enabled: true },
      { url: 'https://javdb585.com:8443', enabled: true },
      { url: 'https://name@javdb590.com', enabled: true },
      { url: 'https://javdb580.com.evil.example', enabled: true },
      { url: 'https://evil.javdb580.com', enabled: true },
    ]);
    expect(await readEnabledHosts()).toEqual(['javdb575.com']);
    await refreshJavdbCrosslineSessions();
    expect(stub.set).not.toHaveBeenCalled();
  });

  it.each(['.javdb580.com', 'www.javdb580.com', 'JAVDB580.COM'])('canonicalizes cookie and page host %s', host => {
    expect(mirrorHost(host)).toBe('javdb580.com');
  });
});
