/**
 * @file checker.ts
 * @description checker
 * @module features/updateChecker
 */
// src/features/updateChecker/checker.ts
// 负责从 GitHub Releases 检查扩展更新，并进行版本比较

import {
  REPO_API_RELEASES_URL,
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
  draft?: boolean;
  body?: string;
}

// 从 GitHub 获取最新 release（默认不包含 pre-release）
export async function fetchLatestRelease(includePrerelease = false): Promise<GitHubRelease | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(REPO_API_RELEASES_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-cache', signal: controller.signal,
    });
    if (resp.ok) {
      const releases = (await resp.json()) as GitHubRelease[];
      if (Array.isArray(releases) && releases.length > 0) {
        return releases.find(r => !r.draft && (includePrerelease || !r.prerelease)) ?? null;
      }
    }
  } catch {
    console.warn('[UpdateChecker] GitHub API unavailable, checking the stable release page.');
  } finally {
    clearTimeout(timeoutId);
  }
  // The page fallback can establish only the stable release, even when previews were requested.
  return fetchLatestReleaseFromGitHubPage();
}

// API不可用时只接受稳定版latest重定向；公开tag页200不能证明不是预发布。
async function fetchLatestReleaseFromGitHubPage(): Promise<GitHubRelease | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    
    // 直接访问 latest release 页面，GitHub 会重定向到最新版本
    const resp = await fetch(
      REPO_RELEASES_LATEST_URL,
      {
        signal: controller.signal,
        redirect: 'follow',
        cache: 'no-cache'
      }
    );
    
    if (!resp.ok) throw new Error(`GitHub page ${resp.status}`);
    
    // 从 URL 中提取版本号（重定向后的 URL 包含版本号）
    const url = resp.url;
    const version = url.startsWith(REPO_RELEASE_TAG_URL_PREFIX) ? url.slice(REPO_RELEASE_TAG_URL_PREFIX.length) : '';
    if (/^v?\d+\.\d+\.\d+$/.test(version)) {
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
  } finally {
    clearTimeout(timeoutId);
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
