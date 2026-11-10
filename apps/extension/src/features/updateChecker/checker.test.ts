import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_UPDATE_CHECK_INTERVAL_HOURS,
  compareSemver,
  normalizeReleaseVersion,
  parseUpdateCheckIntervalHours,
  fetchLatestRelease,
  shouldRunUpdateCheck,
} from './checker';

import {
  REPO_API_RELEASES_URL,
  REPO_JSDELIVR_PACKAGE_URL,
  REPO_RELEASES_LATEST_URL,
  REPO_RELEASE_TAG_URL_PREFIX,
} from '../../shared/repoIdentity';

const NOW = Date.parse('2026-09-06T00:00:00Z');
const HOUR_MS = 60 * 60 * 1000;
const iso = (offsetHours: number) => new Date(NOW + offsetHours * HOUR_MS).toISOString();

describe('compareSemver', () => {
  it('compares main version segments numerically', () => {
    expect(compareSemver('1.2.3', '1.2.4')).toBe(-1);
    expect(compareSemver('1.2.4', '1.2.3')).toBe(1);
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
    // 数字比较而非字典序：10 > 9
    expect(compareSemver('1.10.0', '1.9.0')).toBe(1);
    expect(compareSemver('0.9.0', '1.0.0')).toBe(-1);
  });

  it('treats a leading v prefix as equivalent', () => {
    expect(compareSemver('v2.0.0', '2.0.0')).toBe(0);
    expect(compareSemver('v2.1.0', '2.0.9')).toBe(1);
  });

  it('pads missing segments with zero and supports 4-segment versions', () => {
    expect(compareSemver('1.2', '1.2.0')).toBe(0);
    expect(compareSemver('1.2.3.1', '1.2.3')).toBe(1);
    expect(compareSemver('1.2.3', '1.2.3.0')).toBe(0);
  });

  it('ranks a release above its prerelease and orders prerelease labels lexicographically', () => {
    expect(compareSemver('1.2.3-rc.1', '1.2.3')).toBe(-1);
    expect(compareSemver('1.2.3', '1.2.3-rc.1')).toBe(1);
    expect(compareSemver('1.2.3-alpha', '1.2.3-beta')).toBe(-1);
    expect(compareSemver('1.2.3-alpha', '1.2.3-alpha')).toBe(0);
  });
});

describe('normalizeReleaseVersion', () => {
  it('strips the v prefix and trims whitespace from semantic versions', () => {
    expect(normalizeReleaseVersion('v1.2.3')).toBe('1.2.3');
    expect(normalizeReleaseVersion('  v9.9.9  ')).toBe('9.9.9');
    expect(normalizeReleaseVersion('v2.0.1-beta.1')).toBe('2.0.1-beta.1');
    expect(normalizeReleaseVersion('1.2.3.4')).toBe('1.2.3.4');
  });

  it('falls back to the trimmed value with v removed for non-semantic tags', () => {
    expect(normalizeReleaseVersion('not-a-version')).toBe('not-a-version');
    expect(normalizeReleaseVersion('v-rc')).toBe('-rc');
  });

  it('returns an empty string for empty or missing input', () => {
    expect(normalizeReleaseVersion('')).toBe('');
    expect(normalizeReleaseVersion(undefined)).toBe('');
    expect(normalizeReleaseVersion(null)).toBe('');
  });
});

describe('parseUpdateCheckIntervalHours', () => {
  it('accepts finite positive numbers and numeric strings', () => {
    expect(parseUpdateCheckIntervalHours(48)).toBe(48);
    expect(parseUpdateCheckIntervalHours('12')).toBe(12);
    expect(parseUpdateCheckIntervalHours(1)).toBe(1);
  });

  it('falls back to the 24h default for zero, negative, non-numeric or missing values', () => {
    expect(parseUpdateCheckIntervalHours(0)).toBe(DEFAULT_UPDATE_CHECK_INTERVAL_HOURS);
    expect(parseUpdateCheckIntervalHours('-5')).toBe(DEFAULT_UPDATE_CHECK_INTERVAL_HOURS);
    expect(parseUpdateCheckIntervalHours('abc')).toBe(DEFAULT_UPDATE_CHECK_INTERVAL_HOURS);
    expect(parseUpdateCheckIntervalHours(undefined)).toBe(DEFAULT_UPDATE_CHECK_INTERVAL_HOURS);
  });
});

describe('shouldRunUpdateCheck', () => {
  it('force wins over disabled and any other state', () => {
    const decision = shouldRunUpdateCheck({ force: true, autoUpdateCheck: false, lastCheckedAt: null, now: NOW });
    expect(decision).toMatchObject({ shouldCheck: true, reason: 'force' });
  });

  it('disabled auto check short-circuits to cached skip', () => {
    const decision = shouldRunUpdateCheck({ autoUpdateCheck: false, lastCheckedAt: null, now: NOW });
    expect(decision).toMatchObject({ shouldCheck: false, reason: 'disabled' });
  });

  it('never-checked or unparseable last-checked timestamps trigger an immediate check', () => {
    expect(shouldRunUpdateCheck({ lastCheckedAt: null, now: NOW })).toMatchObject({ shouldCheck: true, reason: 'never' });
    expect(shouldRunUpdateCheck({ lastCheckedAt: undefined, now: NOW })).toMatchObject({ shouldCheck: true, reason: 'never' });
    expect(shouldRunUpdateCheck({ lastCheckedAt: 'garbage', now: NOW })).toMatchObject({ shouldCheck: true, reason: 'never' });
  });

  it('expires when the elapsed time reaches the configured interval', () => {
    // 默认 24h：25h 前检查过 → expired
    expect(shouldRunUpdateCheck({ lastCheckedAt: iso(-25), now: NOW })).toMatchObject({ shouldCheck: true, reason: 'expired' });
    // 自定义 6h：7h 前检查过 → expired，且 intervalHours 反映配置
    expect(shouldRunUpdateCheck({ updateCheckInterval: '6', lastCheckedAt: iso(-7), now: NOW })).toMatchObject({
      shouldCheck: true,
      reason: 'expired',
      intervalHours: 6,
    });
  });

  it('stays cached while inside the interval', () => {
    expect(shouldRunUpdateCheck({ lastCheckedAt: iso(-1), now: NOW })).toMatchObject({ shouldCheck: false, reason: 'cached', intervalHours: 24 });
  });

  it('treats a clock going backwards (negative elapsed) as expired', () => {
    expect(shouldRunUpdateCheck({ lastCheckedAt: iso(1), now: NOW })).toMatchObject({ shouldCheck: true, reason: 'expired' });
  });
});

// The stable fallback must not infer publication channel from a public tag page.
describe('fetchLatestRelease publication channels', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('excludes prereleases and drafts unless prereleases were explicitly requested', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [
      { tag_name: 'v2.1.6', draft: true, prerelease: false },
      { tag_name: 'v2.1.5', draft: false, prerelease: true },
      { tag_name: 'v2.1.4', draft: false, prerelease: false },
    ] })));
    expect((await fetchLatestRelease())?.tag_name).toBe('v2.1.4');
    expect((await fetchLatestRelease(true))?.tag_name).toBe('v2.1.5');
  });
  it.each(['rate-limit', 'network', 'empty'])('uses the stable latest destination after %s, never a tag inventory', async failure => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === REPO_API_RELEASES_URL) {
        if (failure === 'network') throw new TypeError('offline');
        return failure === 'empty' ? { ok: true, json: async () => [] } : { ok: false, status: 403 };
      }
      if (url === REPO_RELEASES_LATEST_URL) return { ok: true, url: TAG_PREFIX + 'v2.1.4' };
      if (url === REPO_JSDELIVR_PACKAGE_URL) return { ok: true, json: async () => ({ tags: ['v2.1.5'] }) };
      if (url === TAG_PREFIX + 'v2.1.5') return { ok: true, status: 200 };
      throw new Error('unexpected URL');
    });
    vi.stubGlobal('fetch', fetcher);
    expect(await fetchLatestRelease()).toMatchObject({ tag_name: 'v2.1.4', prerelease: false, html_url: TAG_PREFIX + 'v2.1.4' });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([REPO_API_RELEASES_URL, REPO_RELEASES_LATEST_URL]);
  });
  it.each(['https://example.invalid/releases/tag/v9.9.9', TAG_PREFIX + 'v2.1.5-preview.1', TAG_PREFIX + 'v2.1.4/extra', REPO_RELEASES_LATEST_URL])('rejects an unverified fallback destination: %s', async url => {
    vi.stubGlobal('fetch', vi.fn(async input => String(input) === REPO_API_RELEASES_URL ? { ok: false, status: 403 } : { ok: true, url }));
    await expect(fetchLatestRelease()).rejects.toThrow();
  });
});
const TAG_PREFIX = REPO_RELEASE_TAG_URL_PREFIX;
