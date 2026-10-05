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

// ============ 10-20: jsDelivr 回退 tag 校验（2.1.0 draft 事件根因修复） ============
// 主路径（API releases 列表）mock 为 403 强制走 jsDelivr 回退，
// 断言 tag 逐个校验行为（tag 与 Release 发布状态无关，draft/未建 Release 的 tag 不得被报为可用更新）。

const TAG_PREFIX = REPO_RELEASE_TAG_URL_PREFIX;
const TAG_PAGE_FALLBACK = 'v2.0.5';

function makeFetchMock(opts: {
  tags?: string[];
  tagResults?: Record<string, 200 | 404 | 'throw'>;
  pageTag?: string;
}) {
  const calls: string[] = [];
  const mockFetch = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    if (url === REPO_API_RELEASES_URL) {
      return { ok: false, status: 403 } as Response; // API 不可用 → 强制 jsDelivr 回退
    }
    if (url === REPO_JSDELIVR_PACKAGE_URL) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ tags: opts.tags ?? [] }),
      } as unknown as Response;
    }
    if (url.startsWith(TAG_PREFIX)) {
      const tag = decodeURIComponent(url.slice(TAG_PREFIX.length));
      const result = opts.tagResults?.[tag];
      if (result === 'throw') throw new TypeError('network down');
      return { ok: result === 200, status: result ?? 404 } as Response;
    }
    if (url === REPO_RELEASES_LATEST_URL) {
      if (!opts.pageTag) throw new Error('unexpected GitHub page fallback in this test');
      return {
        ok: true,
        status: 200,
        url: `https://github.com/JavdBviewed/JavdBviewed/releases/tag/${opts.pageTag}`,
      } as unknown as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  const tagCalls = () => calls.filter((u) => u.startsWith(TAG_PREFIX));
  return { calls, mockFetch, tagCalls };
}

describe('fetchLatestRelease — jsDelivr 回退 tag 校验（2.1.0 draft 事件修复）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('无已发布 Release 的 tag（404）被跳过，选中下一个有已发布 Release 的 tag（恰 2 次校验请求）', async () => {
    const { mockFetch, tagCalls } = makeFetchMock({
      tags: ['v9.9.9-draft', 'v2.1.0'],
      tagResults: { 'v9.9.9-draft': 404, 'v2.1.0': 200 },
    });
    vi.stubGlobal('fetch', mockFetch);

    const release = await fetchLatestRelease();

    expect(release).toMatchObject({ tag_name: 'v2.1.0', prerelease: false });
    expect(tagCalls()).toEqual([`${TAG_PREFIX}v9.9.9-draft`, `${TAG_PREFIX}v2.1.0`]);
  });

  it('首个 tag 有已发布 Release 时直接选中（仅 1 次校验请求）', async () => {
    const { mockFetch, tagCalls } = makeFetchMock({
      tags: ['v2.1.0', 'v2.0.9'],
      tagResults: { 'v2.1.0': 200 },
    });
    vi.stubGlobal('fetch', mockFetch);

    const release = await fetchLatestRelease();

    expect(release?.tag_name).toBe('v2.1.0');
    expect(tagCalls()).toEqual([`${TAG_PREFIX}v2.1.0`]);
  });

  it('3 个候选 tag 均无已发布 Release（全 404）→ 落第三回退 GitHub 页面抓取', async () => {
    const { mockFetch, tagCalls } = makeFetchMock({
      tags: ['v2.1.0', 'v2.0.9', 'v2.0.8'],
      tagResults: { 'v2.1.0': 404, 'v2.0.9': 404, 'v2.0.8': 404 },
      pageTag: TAG_PAGE_FALLBACK,
    });
    vi.stubGlobal('fetch', mockFetch);

    const release = await fetchLatestRelease();

    expect(release?.tag_name).toBe(TAG_PAGE_FALLBACK);
    expect(tagCalls()).toHaveLength(3);
  });

  it('多于 3 个 tag 时只校验前 3 个（原序）', async () => {
    const { mockFetch, tagCalls } = makeFetchMock({
      tags: ['v5.0.0', 'v4.0.0', 'v3.0.0', 'v2.0.0', 'v1.0.0'],
      tagResults: { 'v5.0.0': 404, 'v4.0.0': 404, 'v3.0.0': 404 },
      pageTag: TAG_PAGE_FALLBACK,
    });
    vi.stubGlobal('fetch', mockFetch);

    const release = await fetchLatestRelease();

    expect(release?.tag_name).toBe(TAG_PAGE_FALLBACK);
    expect(tagCalls()).toEqual([
      `${TAG_PREFIX}v5.0.0`,
      `${TAG_PREFIX}v4.0.0`,
      `${TAG_PREFIX}v3.0.0`,
    ]);
  });

  it('校验请求异常（网络错）时不吞、不尝试后续 tag，直接落第三回退', async () => {
    const { mockFetch, tagCalls } = makeFetchMock({
      tags: ['v2.1.0', 'v2.0.9'],
      tagResults: { 'v2.1.0': 'throw' },
      pageTag: TAG_PAGE_FALLBACK,
    });
    vi.stubGlobal('fetch', mockFetch);

    const release = await fetchLatestRelease();

    expect(release?.tag_name).toBe(TAG_PAGE_FALLBACK);
    expect(tagCalls()).toEqual([`${TAG_PREFIX}v2.1.0`]);
  });

  it('校验命中时 html_url 指向真实 tag 页 URL（非写死的 latest URL）', async () => {
    const { mockFetch } = makeFetchMock({
      tags: ['v2.1.0'],
      tagResults: { 'v2.1.0': 200 },
    });
    vi.stubGlobal('fetch', mockFetch);

    const release = await fetchLatestRelease();

    expect(release?.html_url).toBe(`${TAG_PREFIX}v2.1.0`);
    expect(release?.html_url).not.toBe(REPO_RELEASES_LATEST_URL);
  });
});
