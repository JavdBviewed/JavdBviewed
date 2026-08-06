/**
 * @file userProfileMessageHandler.ts
 * @description 抓取 JavDB 用户资料 —— 从用户主页解析邮箱/用户名/会员类型
 * @module apps/background
 */
import type { UserProfile } from '../../types';
import { STORAGE_KEYS } from '../../utils/config';
import {
  getValue as defaultGetValue,
  setValue as defaultSetValue,
} from '../../utils/storage';
import { requestScheduler as defaultRequestScheduler } from '../../platform/network/requestScheduler';
import { DOCUMENT_ONLY_ACCEPT } from '../../platform/network/documentRequestHeaders';
import type { RequestSchedulerLike } from './networkMessageHandlers';
import { getJavDBRoute as defaultGetJavDBRoute } from '../../features/routeManagement';

const DEFAULT_JAVDB_ORIGIN = 'https://javdb.com';

type ProfileFetchResponse = {
  ok: boolean;
  html?: string;
  finalUrl?: string;
  status?: number;
};

export interface FetchUserProfileDependencies {
  getValue?: typeof defaultGetValue;              // chrome.storage 读取
  setValue?: typeof defaultSetValue;              // chrome.storage 写入
  requestScheduler?: RequestSchedulerLike;        // 网络请求调度器
  getJavDBRoute?: () => Promise<string>;           // 当前 JavDB 线路
  fetchFromJavDBTab?: (url: string) => Promise<ProfileFetchResponse | null>;
  now?: () => number;                             // 当前时间戳（可注入用于测试）
}

/**
 * 从 JavDB 抓取当前用户的完整资料（邮箱/用户名/会员类型/想看数/看过数）
 */

export async function fetchUserProfileFromJavDB(deps: FetchUserProfileDependencies = {}): Promise<any> {
  const getValue = deps.getValue ?? defaultGetValue;
  const setValue = deps.setValue ?? defaultSetValue;
  const requestScheduler = deps.requestScheduler ?? defaultRequestScheduler;
  const getJavDBRoute = deps.getJavDBRoute ?? defaultGetJavDBRoute;
  const fetchFromJavDBTab = deps.fetchFromJavDBTab ?? fetchFromJavDBTabInBrowser;
  const nowFn = deps.now ?? Date.now;

  try {
    const baseProfile = await getValue<UserProfile | null>(STORAGE_KEYS.USER_PROFILE, null).catch(() => null);

    const javdbOrigin = await resolveJavDBOrigin(getJavDBRoute);
    const fetchHtml = async (url: string): Promise<ProfileFetchResponse> => {
      try {
        const res = await requestScheduler.enqueue(url, {
          method: 'GET',
          credentials: 'include' as any,
          headers: {
            'Accept': DOCUMENT_ONLY_ACCEPT,
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'Referer': `${javdbOrigin}/`,
            'Cache-Control': 'no-cache',
          },
        } as RequestInit);
        const html = await res.text();
        return { ok: res.ok, html, finalUrl: (res as any).url, status: res.status };
      } catch {
        return { ok: false };
      }
    };

    const profileUrl = `${javdbOrigin}/users/profile`;
    let profileRes = await fetchHtml(profileUrl);
    if (!isLoggedInProfileResponse(profileRes)) {
      // JavDB 可能会拦截扩展后台请求，即使浏览器标签页仍然持有有效登录态。
      const tabProfileRes = await fetchFromJavDBTab(profileUrl).catch(() => null);
      if (tabProfileRes) profileRes = tabProfileRes;
    }

    const isLoggedIn = isLoggedInProfileResponse(profileRes);

    if (!isLoggedIn) {
      throw new Error('未登录 JavDB');
    }

    const html = profileRes.html || '';
    const wantCount = parseWantCountFromHtml(html) ?? 0;
    const watchedCount = parseWatchedCountFromHtml(html) ?? 0;
    const profileDetail = parseUserInfoDetail(html);
    const detail = await extractUserInfoDetail(fetchHtml, profileUrl).catch(() => null);

    const now = nowFn();
    const profile = {
      email: (profileDetail.email ?? detail?.email ?? baseProfile?.email) || '',
      username: (profileDetail.username ?? detail?.username ?? baseProfile?.username) || '',
      userType: (profileDetail.userType ?? detail?.userType ?? baseProfile?.userType) || '',
      isLoggedIn: true,
      lastUpdated: now,
      serverStats: {
        wantCount,
        watchedCount,
        lastSyncTime: now,
      },
    };

    try { await setValue(STORAGE_KEYS.USER_PROFILE, profile); } catch {}
    return profile;
  } catch (error) {
    throw error instanceof Error ? error : new Error('获取账号信息失败');
  }
}

function parseWantCountFromHtml(html: string): number | undefined {
  try {
    const match = html.match(/href=["']\/users\/want_watch_videos["'][\s\S]*?想看[\s\S]*?\(([0-9][0-9,\.]*)\)/i);
    return normalizeCount(match?.[1]);
  } catch {
    return undefined;
  }
}

function parseWatchedCountFromHtml(html: string): number | undefined {
  try {
    const match = html.match(/href=["']\/users\/watched_videos["'][\s\S]*?(?:看過|看过)[\s\S]*?\(([0-9][0-9,\.]*)\)/i);
    return normalizeCount(match?.[1]);
  } catch {
    return undefined;
  }
}

async function extractUserInfoDetail(
  fetchHtml: (url: string) => Promise<ProfileFetchResponse>,
  profileUrl: string,
): Promise<{ email?: string; username?: string; userType?: string } | null> {
  try {
    const ret = await fetchHtml(profileUrl);
    if (ret.ok && ret.html && !isLoginPageUrl(ret.finalUrl)) {
      const detail = parseUserInfoDetail(ret.html);
      if (detail.email || detail.username || detail.userType) return detail;
    }
  } catch {
    // 账号统计已成功获取时，详情字段失败不应让整个刷新失败。
  }
  return null;
}

function isLoggedInProfileResponse(response: ProfileFetchResponse): boolean {
  return !!(
    response.ok &&
    response.html &&
    !isLoginPageUrl(response.finalUrl)
  );
}

function isLoginPageUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const pathname = new URL(url).pathname.replace(/\/+$/, '');
    return /^\/(?:login|sign_in|users\/sign_in)$/i.test(pathname);
  } catch {
    return /\/(?:login|sign_in)(?:[/?#]|$)/i.test(url);
  }
}

async function fetchFromJavDBTabInBrowser(url: string): Promise<ProfileFetchResponse | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query || !chrome.scripting?.executeScript) {
    return null;
  }

  try {
    const origin = new URL(url).origin;
    const tabs = await chrome.tabs.query({ url: `${origin}/*` });
    const tab = tabs.find(candidate => typeof candidate.id === 'number');
    if (typeof tab?.id !== 'number') return null;

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      args: [url],
      func: async (profileUrl: string) => {
        const response = await fetch(profileUrl, {
          method: 'GET',
          credentials: 'include',
          headers: {
            Accept: 'text/html,application/xhtml+xml',
            'Cache-Control': 'no-cache',
          },
        });
        return {
          ok: response.ok,
          status: response.status,
          finalUrl: response.url,
          html: await response.text(),
        };
      },
    });

    const result = results?.[0]?.result as ProfileFetchResponse | undefined;
    return result && typeof result.html === 'string' ? result : null;
  } catch {
    return null;
  }
}

async function resolveJavDBOrigin(getJavDBRoute: () => Promise<string>): Promise<string> {
  try {
    const route = await getJavDBRoute();
    const parsed = new URL(route);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin;
    }
  } catch {
    // 线路配置读取失败时回退到主域名，仍允许账号信息请求继续执行。
  }
  return DEFAULT_JAVDB_ORIGIN;
}

function parseUserInfoDetail(html: string): { email?: string; username?: string; userType?: string } {
  const emailFromProfile = (html.match(/<span[^>]*class=["']label["'][^>]*>\s*(?:电邮地址|電郵地址|邮箱|電子郵件|电子邮件)\s*:<\/span>\s*([^<\n]+)/i) || [])[1]?.trim();
  const usernameFromProfile = (html.match(/<span[^>]*class=["']label["'][^>]*>\s*(?:用戶名|用户名|使用者名稱|使用者名称)\s*:<\/span>\s*([^<\n]+)/i) || [])[1]?.trim();
  const userTypeFromProfile = (html.match(/<span[^>]*class=["']label["'][^>]*>\s*(?:用戶類型|用户类型|使用者類型|使用者类型)\s*:<\/span>\s*([^<\n]+)/i) || [])[1]?.trim();
  const usernameFromAnchor = (html.match(/<a[^>]*href=["']\/users\/profile["'][^>]*>\s*([^<]{1,40})\s*<\/a>/i) || [])[1]?.trim();

  const emailMatch = html.match(/name="user\[email\]"[^>]*value="([^"]*)"/i) || html.match(/id="user_email"[^>]*value="([^"]*)"/i);
  const usernameMatch = html.match(/name="user\[username\]"[^>]*value="([^"]*)"/i) || html.match(/id="user_username"[^>]*value="([^"]*)"/i);
  const email = (emailMatch?.[1]?.trim()) || emailFromProfile;
  const username = (usernameMatch?.[1]?.trim()) || usernameFromProfile || usernameFromAnchor;

  const userTypeRaw = (userTypeFromProfile || '').replace(/[，,]/g, '').trim();
  let userType: string | undefined;
  if (userTypeRaw) {
    if (/vip|premium/i.test(userTypeRaw)) userType = 'VIP';
    else if (/(普通用戶|普通用户|normal|regular)/i.test(userTypeRaw)) userType = '普通用户';
    else if (/(會員|会员)/.test(userTypeRaw)) userType = '会员';
    else userType = userTypeRaw;
  }

  return { email, username, userType };
}

function normalizeCount(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const count = Number(String(value).replace(/[\s,\.]/g, ''));
  return Number.isFinite(count) ? count : undefined;
}
