import { afterEach, expect, it, vi } from 'vitest';
import { withReadOnlyCrosslineProbe } from './crosslineReadOnlyProbe';
afterEach(() => vi.unstubAllGlobals());
it('limits cookie-response suppression to two exact nonce URLs and always removes it', async () => {
  const update = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', { declarativeNetRequest: { updateSessionRules: update } });
  await withReadOnlyCrosslineProbe('https://javdb575.com', async urls => {
    expect(urls.profile).toMatch(/^https:\/\/javdb575\.com\/users\/profile\?__javdb_session_probe=[a-f0-9-]+$/);
    expect(urls.login).toContain('https://javdb575.com/login?__javdb_session_probe=');
    const rules = update.mock.calls[0][0].addRules;
    expect(rules.map((r: chrome.declarativeNetRequest.Rule) => r.condition.urlFilter)).toEqual([`|${urls.profile}|`, `|${urls.login}|`]);
    expect(rules.every((r: chrome.declarativeNetRequest.Rule) => r.action.responseHeaders?.[0]?.header === 'set-cookie')).toBe(true);
  });
  expect(update).toHaveBeenCalledTimes(2);
  expect(update.mock.calls[1][0].addRules).toBeUndefined();
});
it('cleans up on network failure and never fetches if the read-only guard cannot be installed', async () => {
  const update = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', { declarativeNetRequest: { updateSessionRules: update } });
  await expect(withReadOnlyCrosslineProbe('https://javdb575.com', async () => { throw new Error('network'); })).rejects.toThrow('network');
  expect(update).toHaveBeenCalledTimes(2);
  update.mockRejectedValue(new Error('rule rejected'));
  const request = vi.fn();
  await expect(withReadOnlyCrosslineProbe('https://javdb575.com', request)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
it('serializes overlapping probes so one cannot remove the other response rule', async () => {
  const update = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', { declarativeNetRequest: { updateSessionRules: update } });
  let release: () => void = () => {};
  const hold = new Promise<void>(resolve => { release = resolve; });
  const first = withReadOnlyCrosslineProbe('https://javdb.com', () => hold);
  const secondRequest = vi.fn(async () => undefined);
  const second = withReadOnlyCrosslineProbe('https://javdb575.com', secondRequest);
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(secondRequest).not.toHaveBeenCalled();
  release(); await Promise.all([first, second]);
  expect(update).toHaveBeenCalledTimes(4); expect(secondRequest).toHaveBeenCalledTimes(1);
});
