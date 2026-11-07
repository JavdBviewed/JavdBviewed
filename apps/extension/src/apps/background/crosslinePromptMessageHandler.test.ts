import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleCrosslinePromptMessage, resolveCrosslinePageContext } from './crosslinePromptMessageHandler';
const sender = { id: 'ext', frameId: 0, documentId: 'doc', origin: 'https://javdb575.com', url: 'https://javdb575.com/v/TEST', tab: { id: 8 } } as chrome.runtime.MessageSender;
function setup() {
  vi.stubGlobal('chrome', {
    runtime: { id: 'ext', lastError: undefined },
    storage: { local: { get: (_key: unknown, cb: (data: unknown) => void) => cb({}) } },
    tabs: { get: vi.fn(async () => ({ id: 8, url: sender.url, incognito: false })) },
    cookies: { getAllCookieStores: (cb: (stores: unknown[]) => void) => cb([{ id: '0', tabIds: [8] }, { id: '1', tabIds: [9] }]) },
  });
}
afterEach(() => vi.unstubAllGlobals());
describe('page session boundary', () => {
  it('derives the enabled target and cookie store from the sender', async () => {
    setup();
    expect(await resolveCrosslinePageContext(sender)).toEqual({ tabId: 8, documentId: 'doc', targetHost: 'javdb575.com', origin: sender.origin, storeId: '0', incognito: false });
  });
  it('rejects external, iframe, unsupported, navigated and opaque senders', async () => {
    setup();
    for (const change of [{ id: 'other' }, { frameId: 1 }, { origin: 'null' }, { url: 'https://evil.example/' }, { documentId: undefined }]) {
      expect(await resolveCrosslinePageContext({ ...sender, ...change })).toBeNull();
    }
    vi.mocked(chrome.tabs.get).mockResolvedValue({ id: 8, url: 'https://javdb.com/', incognito: false } as chrome.tabs.Tab);
    expect(await resolveCrosslinePageContext(sender)).toBeNull();
  });
  it('rejects caller-supplied target/store and unknown message actions before accessing the service', async () => {
    setup();
    expect((await handleCrosslinePromptMessage({ type: 'JAVDB_CROSSLINE_PAGE:COPY', targetHost: 'javdb.com', sourceHost: 'javdb.com', offerId: 'x' }, sender)).success).toBe(false);
    expect((await handleCrosslinePromptMessage({ type: 'JAVDB_CROSSLINE_PAGE:UNRECOGNIZED' }, sender)).success).toBe(false);
    expect((await handleCrosslinePromptMessage({ type: 'JAVDB_CROSSLINE_PAGE:COPY', sourceHost: 7, offerId: 'x' }, sender)).success).toBe(false);
  });
});

it('accepts an enabled 580 document and rejects the same host when unconfigured or disabled', async () => {
  setup();
  const page = { ...sender, origin: 'https://javdb580.com', url: 'https://javdb580.com/' };
  vi.mocked(chrome.tabs.get).mockResolvedValue({ id: 8, url: page.url, incognito: false } as chrome.tabs.Tab);
  expect(await resolveCrosslinePageContext(page)).toBeNull();
  for (const enabled of [true, false]) {
    chrome.storage.local.get = vi.fn((_key, cb) => cb({ settings: { routes: { javdb: {
      primary: 'https://javdb575.com', alternatives: [{ url: page.origin, enabled }],
    } } } })) as typeof chrome.storage.local.get;
    const context = await resolveCrosslinePageContext(page);
    if (enabled) expect(context).toMatchObject({ targetHost: 'javdb580.com', storeId: '0', documentId: 'doc' });
    else expect(context).toBeNull();
  }
});
