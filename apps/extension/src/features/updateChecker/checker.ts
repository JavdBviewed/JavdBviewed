/**
 * @file checker.ts
 * @description checker
 * @module features/updateChecker
 */
// src/features/updateChecker/checker.ts
// 负责从 GitHub Releases 检查扩展更新，并进行版本比较

import {
  REPO_API_RELEASES_URL,
  REPO_JSDELIVR_PACKAGE_URL,
  REPO_RELEASES_LATEST_URL,
  REPO_RELEASE_TAG_URL_PREFIX,
} from '../../shared/repoIdentity';

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion?: string;
  hasUpdate: boolean;
  releaseUrl?: string;
  changelog?: string;
  error?: string;
  skipped?: boolean;
  reason?: UpdateCheckDecisionReason;
  checkedAt?: string;
}

export type UpdateCheckDecisionReason = 'force' | 'disabled' | 'never' | 'expired' | 'cached';

export interface UpdateCheckPolicyInput {
  autoUpdateCheck?: boolean;
  updateCheckInterval?: string | number;
  lastCheckedAt?: string | null;
  now?: number;
  force?: boolean;
}

export interface UpdateCheckDecision {
  shouldCheck: boolean;
  reason: UpdateCheckDecisionReason;
  intervalHours: number;
}

export const DEFAULT_UPDATE_CHECK_INTERVAL_HOURS = 24;
export const LAST_UPDATE_CHECK_KEY = 'lastUpdateCheck';
export const LAST_UPDATE_RESULT_KEY = 'lastUpdateResult';

// 获取当前扩展版本（从 manifest 读取，适用于 background/service worker）
export function getCurrentVersion(): string {
  try {
    const manifest = chrome.runtime.getManifest();
    return manifest.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function normalizeReleaseVersion(value: string | undefined | null): string {
  if (!value) return '';
  const match = value.trim().match(/v?(\d+\.\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)/);
  return match ? match[1] : value.trim().replace(/^v/i, '');
}

export function parseUpdateCheckIntervalHours(value: string | number | undefined): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_UPDATE_CHECK_INTERVAL_HOURS;
}

export function shouldRunUpdateCheck(input: UpdateCheckPolicyInput): UpdateCheckDecision {
  const intervalHours = parseUpdateCheckIntervalHours(input.updateCheckInterval);

  if (input.force) {
    return { shouldCheck: true, reason: 'force', intervalHours };
  }

  if (input.autoUpdateCheck === false) {
    return { shouldCheck: false, reason: 'disabled', intervalHours };
  }

  if (!input.lastCheckedAt) {
    return { shouldCheck: true, reason: 'never', intervalHours };
  }

  const lastCheckedTime = Date.parse(input.lastCheckedAt);
  if (!Number.isFinite(lastCheckedTime)) {
    return { shouldCheck: true, reason: 'never', intervalHours };
  }

  const now = input.now ?? Date.now();
  const elapsedMs = now - lastCheckedTime;
  const intervalMs = intervalHours * 60 * 60 * 1000;
  const shouldCheck = elapsedMs >= intervalMs || elapsedMs < 0;

  return {
    shouldCheck,
    reason: shouldCheck ? 'expired' : 'cached',
    intervalHours,
  };
}

function readCachedUpdateResult(currentVersion: string): UpdateCheckResult | null {
  try {
    const raw = localStorage.getItem(LAST_UPDATE_RESULT_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as Partial<UpdateCheckResult>;
    if (!cached || typeof cached !== 'object') return null;

    return {
      currentVersion,
      latestVersion: cached.latestVersion,
      hasUpdate: cached.latestVersion ? compareSemver(cached.latestVersion, currentVersion) > 0 : Boolean(cached.hasUpdate),
      releaseUrl: cached.releaseUrl,
      changelog: cached.changelog,
      checkedAt: cached.checkedAt,
    };
  } catch {
    return null;
  }
}

function writeCachedUpdateResult(result: UpdateCheckResult): void {
  try {
    localStorage.setItem(
      LAST_UPDATE_RESULT_KEY,
      JSON.stringify({
        latestVersion: result.latestVersion,
        hasUpdate: result.hasUpdate,
        releaseUrl: result.releaseUrl,
        changelog: result.changelog,
        checkedAt: result.checkedAt,
      }),
    );
  } catch {}
}

// 语义化版本比较：a > b 返回 1，a < b 返回 -1，相等返回 0
export function compareSemver(a: string, b: string): number {
  const norm = (v: string) => v.replace(/^v/i, '');
  const [aMain, aPre = ''] = norm(a).split('-', 2);
  const [bMain, bPre = ''] = norm(b).split('-', 2);

  const aNums = aMain.split('.').map(n => parseInt(n || '0', 10));
  const bNums = bMain.split('.').map(n => parseInt(n || '0', 10));

  for (let i = 0; i < Math.max(aNums.length, bNums.length); i++) {
    const ai = aNums[i] || 0;
    const bi = bNums[i] || 0;
    if (ai > bi) return 1;
    if (ai < bi) return -1;
  }

  // 主版本相等时，处理预发布标签：无预发布 > 有预发布
  if (aPre && !bPre) return -1;
  if (!aPre && bPre) return 1;
  if (aPre === bPre) return 0;
  return aPre > bPre ? 1 : -1;
}

interface GitHubRelease {
  html_url: string;
  tag_name?: string;
  name?: string;
  prerelease?: boolean;
  body?: string;
}

// 从 GitHub 获取最新 release（默认不包含 pre-release）
export async function fetchLatestRelease(includePrerelease = false): Promise<GitHubRelease | null> {
  try {
    // 方案1: 尝试通过 GitHub API 获取 releases 列表
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8秒超时
    
    const resp = await fetch(
      REPO_API_RELEASES_URL,
      { 
        headers: { 
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        cache: 'no-cache',
        signal: controller.signal
      }
    );
    
    clearTimeout(timeoutId);
    
    if (!resp.ok) {
      // 如果 API 失败（403 通常是速率限制），尝试备用方案
      console.warn(`[UpdateChecker] GitHub API ${resp.status}, trying fallback methods...`);
      return await fetchLatestReleaseFromJsDelivr();
    }
    
    const releases = (await resp.json()) as GitHubRelease[];
    
    if (!releases || releases.length === 0) {
      console.warn('[UpdateChecker] No releases found, trying fallback...');
      return await fetchLatestReleaseFromJsDelivr();
    }
    
    // 过滤预发布版本
    const filteredReleases = includePrerelease 
      ? releases 
      : releases.filter(r => !r.prerelease);
    
    if (filteredReleases.length === 0) {
      console.warn('[UpdateChecker] No stable releases found');
      return null;
    }
    
    // 返回第一个（最新的）release
    console.log('[UpdateChecker] Successfully fetched from GitHub API');
    return filteredReleases[0];
    
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.warn('[UpdateChecker] GitHub API timeout, trying fallback...');
    } else {
      console.warn('[UpdateChecker] GitHub API error, trying fallback:', err.message);
    }
    // 尝试备用方案
    return await fetchLatestReleaseFromJsDelivr();
  }
}

// jsDelivr tag 列表与 Release 发布状态无关：匿名访问不存在或 draft 的 Release 的 tag 页统一 404，
// 已发布 Release 的 tag 页 200。回退路径上据此把「tag 存在」收紧为「已发布 Release 存在」。
// 已知限制（登记不修）：/releases/tag 对已发布的 prerelease 也 200；本仓库当前发布流不用
// prerelease，且 API 可达时主路径为准。
const RELEASE_TAG_VERIFY_MAX = 3;
const RELEASE_TAG_VERIFY_TIMEOUT_MS = 5000;

async function verifyPublishedReleaseTag(tag: string): Promise<GitHubRelease | null> {
  const encodedTag = encodeURIComponent(tag);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RELEASE_TAG_VERIFY_TIMEOUT_MS);
  try {
    const resp = await fetch(`${REPO_RELEASE_TAG_URL_PREFIX}${encodedTag}`, {
      signal: controller.signal,
      redirect: 'follow',
      cache: 'no-cache'
    });
    
    if (!resp.ok) return null; // 404（或其它非 2xx）= 无已发布 Release，尝试下一个 tag
    
    return {
      html_url: `${REPO_RELEASE_TAG_URL_PREFIX}${encodedTag}`,
      tag_name: tag,
      name: tag,
      prerelease: false,
      body: ''
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

// 按原序最多校验 RELEASE_TAG_VERIFY_MAX 个 tag，命中即返回。
// 校验请求异常（网络错/超时）不吞：向上传播到 jsDelivr 回退的 catch → 落第三回退。
async function fetchFirstVerifiedReleaseFromTags(tags: string[]): Promise<GitHubRelease | null> {
  for (const tag of tags.slice(0, RELEASE_TAG_VERIFY_MAX)) {
    const release = await verifyPublishedReleaseTag(tag);
    if (release) return release;
  }
  return null;
}

// 备用方案：从 jsdelivr 获取版本信息
async function fetchLatestReleaseFromJsDelivr(): Promise<GitHubRelease | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    // 使用 jsdelivr 的 API 获取所有版本
    const resp = await fetch(
      REPO_JSDELIVR_PACKAGE_URL,
      {
        signal: controller.signal,
        cache: 'no-cache'
      }
    );
    
    clearTimeout(timeoutId);
    
    if (!resp.ok) throw new Error(`jsdelivr API ${resp.status}`);
    
    const data = await resp.json();
    
    // jsdelivr 返回的数据可能包含 tags 或 versions 数组
    const tags = data?.tags || data?.versions || [];
    
    if (tags && tags.length > 0) {
      // tag 与 Release 发布状态无关（tag 可能先于 Release 建成 draft 的窗口内推送），
      // 直接取 tags[0] 会把 draft 报成可用更新（2.1.0 draft 事件根因）。
      // 按原序逐个校验（最多 3 个）该 tag 是否有已发布 Release，命中即返回。
      const release = await fetchFirstVerifiedReleaseFromTags(tags);
      if (release) return release;
      
      // 候选 tag 均无已发布 Release，尝试直接从 GitHub 页面抓取
      console.warn('jsdelivr tags have no published release, trying GitHub page scraping...');
      return await fetchLatestReleaseFromGitHubPage();
    }
    
    // 如果 jsdelivr 也失败，尝试直接从 GitHub 页面抓取
    console.warn('jsdelivr no tags, trying GitHub page scraping...');
    return await fetchLatestReleaseFromGitHubPage();
  } catch (err: any) {
    // 最后尝试从 GitHub 页面抓取
    console.warn('jsdelivr failed, trying GitHub page scraping...');
    return await fetchLatestReleaseFromGitHubPage();
  }
}

// 最后的备用方案：从 GitHub releases 页面抓取版本号
async function fetchLatestReleaseFromGitHubPage(): Promise<GitHubRelease | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    // 直接访问 latest release 页面，GitHub 会重定向到最新版本
    const resp = await fetch(
      REPO_RELEASES_LATEST_URL,
      {
        signal: controller.signal,
        redirect: 'follow'
      }
    );
    
    clearTimeout(timeoutId);
    
    if (!resp.ok) throw new Error(`GitHub page ${resp.status}`);
    
    // 从 URL 中提取版本号（重定向后的 URL 包含版本号）
    const url = resp.url;
    const match = url.match(/\/releases\/tag\/(v?[\d.]+(?:-[\w.]+)?)/);
    
    if (match && match[1]) {
      const version = match[1];
      return {
        html_url: url,
        tag_name: version,
        name: version,
        prerelease: false,
        body: ''
      };
    }
    
    throw new Error('Could not extract version from GitHub page');
  } catch (err: any) {
    throw new Error(`All methods failed: ${err?.message || String(err)}`);
  }
}

export async function checkForUpdates(includePrerelease = false): Promise<UpdateCheckResult> {
  const current = getCurrentVersion();
  try {
    console.log(`[UpdateChecker] Checking for updates... Current version: ${current}`);
    
    const release = await fetchLatestRelease(includePrerelease);
    
    if (!release) {
      console.warn('[UpdateChecker] No release information available');
      return { 
        currentVersion: current, 
        hasUpdate: false,
        error: '无法获取版本信息，请稍后重试'
      };
    }
    
    const latest = normalizeReleaseVersion(release.tag_name || release.name || current);
    const hasUpdate = compareSemver(latest, current) > 0;
    
    console.log(`[UpdateChecker] Latest version: ${latest}, Has update: ${hasUpdate}`);
    
    return {
      currentVersion: current,
      latestVersion: latest,
      hasUpdate,
      releaseUrl: release.html_url,
      changelog: release.body,
      checkedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    console.error('[UpdateChecker] Check failed:', err);
    return { 
      currentVersion: current, 
      hasUpdate: false, 
      error: err?.message || '检查更新失败，请检查网络连接'
    };
  }
}

export async function checkForUpdatesWithPolicy(
  policy: UpdateCheckPolicyInput,
  includePrerelease = false,
): Promise<UpdateCheckResult> {
  const current = getCurrentVersion();
  const decision = shouldRunUpdateCheck({
    ...policy,
    lastCheckedAt: policy.lastCheckedAt ?? localStorage.getItem(LAST_UPDATE_CHECK_KEY),
  });

  if (!decision.shouldCheck) {
    const cached = readCachedUpdateResult(current);
    return {
      ...(cached || { currentVersion: current, hasUpdate: false }),
      skipped: true,
      reason: decision.reason,
    };
  }

  const result = await checkForUpdates(includePrerelease);
  if (!result.error) {
    localStorage.setItem(LAST_UPDATE_CHECK_KEY, result.checkedAt || new Date().toISOString());
    writeCachedUpdateResult(result);
  }

  return {
    ...result,
    reason: decision.reason,
  };
}
