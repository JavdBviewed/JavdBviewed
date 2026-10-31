/**
 * @file index.ts
 * @description 在线可用性检测（检查影片是否可在线观看）统一导出
 * @module features/onlineAvailability
 */
import { extractVideoIdFromPage } from '../../platform/browser';
import { defaultHttpClient } from '../../platform/network/httpClient';
import { getOrFetchSessionResult } from '../../platform/storage/sessionResultCache';
import { ensureDetailEnhancementPanel } from '../detailEnhancementPanel';
import { log } from '../contentState';

export type OnlineAvailabilityFetchType = 'get' | 'parser';

export interface OnlineAvailabilitySite {
  key: string;
  name: string;
  url: string;
  fetchType: OnlineAvailabilityFetchType;
  enabled: boolean;
  /** get 型直连详情页的轻量探测：只下载正文前 N 字节（head + 主体开头），命中信号后放弃剩余下载 */
  probePrefixBytes?: number;
  codeFormatter?: (code: string) => string;
  domQuery?: {
    linkQuery?: string;
    titleQuery?: string;
    subQuery?: string;
    leakQuery?: string;
  };
}

export interface OnlineAvailabilityResult {
  siteKey: string;
  siteName: string;
  available: boolean;
  url: string;
  tags: string[];
  /** 同站点多真页选项（仅 missav 双版本填：主链接=有码真页，alternative=无码真页）；无该字段的站点渲染零行为变化 */
  alternatives?: { url: string; label: string }[];
  error?: string;
}

export interface OnlineAvailabilityConfig {
  enabled: boolean;
  autoCheck: boolean;
  showUnavailable: boolean;
  timeoutMs: number;
  sites: OnlineAvailabilitySite[];
}

export type OnlineAvailabilitySitePreferences = Record<string, boolean>;

export interface OnlineAvailabilityInsertionTarget {
  parent: Element;
  before: ChildNode | null;
}

const SP_PREFIX = '300';

/**
 * get 型站点直连详情页的探测窗口（字节）。
 * 命中信号（canonical/og:url/title 在 head，详情主块在 body 开头）都落在该窗口内，
 * 相对整页（通常 100KB~500KB）可省 90% 以上下载与解析成本；parser 型站点不做截断。
 */
const GET_PROBE_PREFIX_BYTES = 32768;

/**
 * S1 B2 (cycle-14)：get 型探测的首字节快速失败窗口（ms）。
 * 正常站点 TLS 握手+响应头 <1s，3s 拿不到响应头即判本轮失败（按既有冷却链重试）；
 * 避免坏线路把 SW 的请求挂满 8s 全程超时。仅探测路径使用，115/Emby 线路数据不受影响。
 */
const PROBE_FIRST_BYTE_TIMEOUT_MS = 3000;

/**
 * parser 型站点在线可看检测结果的 TTL（整页抓取 + DOM 解析，探测成本远高于 get 型）。
 * get 型站点维持 SESSION_RESULT_TTL 表值 onlineAvailability（12min）。
 * 取值已由用户拍板 45min（2026-09-26），后续如需调整改这一行即可。
 */
export const PARSER_AVAILABILITY_TTL_MS = 45 * 60 * 1000;

export const DEFAULT_ONLINE_AVAILABILITY_SITES: OnlineAvailabilitySite[] = [
  {
    key: 'fanza',
    name: 'FANZA 動画',
    url: 'https://www.dmm.co.jp/digital/videoa/-/detail/=/cid={{code}}/',
    fetchType: 'get',
    enabled: true,
    probePrefixBytes: GET_PROBE_PREFIX_BYTES,
    codeFormatter: formatFanzaCode,
  },
  {
    key: 'jable',
    name: 'Jable',
    url: 'https://jable.tv/videos/{{code}}/',
    fetchType: 'get',
    enabled: true,
    probePrefixBytes: GET_PROBE_PREFIX_BYTES,
    domQuery: {
      subQuery: '.info-header',
      leakQuery: '.info-header',
    },
  },
  {
    key: 'missav',
    name: 'MISSAV',
    url: 'https://missav.ws/{{code}}/',
    fetchType: 'get',
    enabled: true,
    probePrefixBytes: GET_PROBE_PREFIX_BYTES,
    domQuery: {
      subQuery: '.space-y-2 a.text-nord13[href*="chinese-subtitle"], a[href*="chinese-subtitle"]',
      leakQuery: '.order-first div.rounded-md a[href]:last-child',
    },
  },
  {
    key: '123av',
    name: '123AV',
    url: 'https://123av.com/zh/search?keyword={{code}}',
    fetchType: 'parser',
    enabled: true,
    domQuery: {
      linkQuery: '.detail>a[href*="v/"]',
      titleQuery: '.detail>a[href*="v/"]',
    },
  },
  {
    key: 'supjav',
    name: 'Supjav',
    url: 'https://supjav.com/zh/?s={{code}}',
    fetchType: 'parser',
    enabled: true,
    domQuery: {
      linkQuery: '.posts.clearfix>.post>a.img[title]',
      titleQuery: 'h3>a[rel="bookmark"][itemprop="url"]',
    },
  },
  {
    key: 'netflav',
    name: 'NETFLAV',
    url: 'https://netflav5.com/search?type=title&keyword={{code}}',
    fetchType: 'parser',
    enabled: true,
    domQuery: {
      linkQuery: '.grid_0_cell>a[href^="/video?"]',
      titleQuery: '.grid_0_cell>a[href^="/video?"] .grid_0_title',
    },
  },
  {
    key: 'avgle',
    name: 'Avgle',
    url: 'https://avgle.com/search/videos?search_query={{code}}&search_type=videos',
    fetchType: 'parser',
    enabled: true,
    domQuery: {
      linkQuery: '.container>.row .row .well>a[href]',
      titleQuery: '.container>.row .row .well .video-title',
    },
  },
  {
    key: 'javhhh',
    name: 'JAVHHH',
    url: 'https://javhhh.com/v/?wd={{code}}',
    fetchType: 'parser',
    enabled: true,
    domQuery: {
      linkQuery: '.typelist>.i-container>a[href]',
      titleQuery: '.typelist>.i-container>a[href]',
    },
  },
  {
    key: 'javguru',
    name: 'Jav.Guru',
    url: 'https://jav.guru/?s={{code}}',
    fetchType: 'parser',
    enabled: true,
    domQuery: {
      linkQuery: '.imgg>a[href]',
      titleQuery: '.inside-article>.grid1 a[title]',
    },
  },
  {
    key: 'javbus',
    name: 'JavBus',
    url: 'https://javbus.com/{{code}}',
    fetchType: 'get',
    enabled: true,
    probePrefixBytes: GET_PROBE_PREFIX_BYTES,
    codeFormatter: code => code.startsWith('MIUM') ? `${SP_PREFIX}${code}` : code,
  },
];

const DEFAULT_CONFIG: OnlineAvailabilityConfig = {
  enabled: true,
  // 10-31-ext-onlineavail-lazy-click G1：绝对点击触发，fallback 态不得自探
  autoCheck: false,
  // G2：检测失败站点默认显示
  showUnavailable: true,
  timeoutMs: 8000,
  sites: DEFAULT_ONLINE_AVAILABILITY_SITES,
};

export function applyOnlineAvailabilitySitePreferences(
  sites: OnlineAvailabilitySite[],
  preferences: unknown,
): OnlineAvailabilitySite[] {
  const sitePreferences = preferences && typeof preferences === 'object'
    ? preferences as Record<string, unknown>
    : {};

  return sites.map(site => ({
    ...site,
    enabled: typeof sitePreferences[site.key] === 'boolean'
      ? sitePreferences[site.key] as boolean
      : site.enabled,
  }));
}

export class OnlineAvailabilityManager {
  private config: OnlineAvailabilityConfig = DEFAULT_CONFIG;
  private initialized = false;
  private currentVideoId: string | null = null;
  /** 手动重检进行中：防重复并发探测 */
  private rechecking = false;
  /** 当前番号是否已完成过至少一次检测（首次完成后置位：按钮「开始检测」回落「重检」） */
  private hasChecked = false;

  updateConfig(config: Partial<OnlineAvailabilityConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      sites: config.sites || this.config.sites,
    };
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled || this.initialized) return;
    this.currentVideoId = extractVideoIdFromPage();
    if (!this.currentVideoId) return;

    // G1：点击触发=首帧「未检测」态；autoCheck=true 既有路径保持「检测中」首帧
    this.injectPanel(this.config.autoCheck ? 'checking' : 'idle');
    this.initialized = true;

    if (this.config.autoCheck) {
      await this.checkAvailability(this.currentVideoId);
      this.refreshPanelButton();
    }
  }

  async checkAvailability(videoId: string, force = false): Promise<void> {
    const sites = this.config.sites.filter(site => site.enabled);
    if (sites.length === 0) {
      this.renderResults([], 0);
      this.hasChecked = true;
      return;
    }

    const results: OnlineAvailabilityResult[] = [];
    await Promise.all(sites.map(async site => {
      const result = await this.checkSite(site, videoId, force);
      results.push(result);
      this.renderResults([...results], sites.length);
    }));
    this.hasChecked = true;
  }

  /**
   * 面板按钮统一入口（G1 两态并入同一 handler）：
   * 首次=「开始检测」（正常缓存读），完成过=「重检」（force 跳过缓存读，结果回写缓存）。
   * 检测进行中拒绝重入（按钮 disabled+「检测中…」），避免同 key 并发双发。
   */
  handlePanelButtonClick(): Promise<void> {
    return this.beginCheck(this.hasChecked);
  }

  /**
   * 面板"重检此番号"按钮入口（保留既有公共 API）：绕过缓存重探当前番号（force 恒 true）。
   */
  recheckCurrentVideo(): Promise<void> {
    return this.beginCheck(true);
  }

  private beginCheck(force: boolean): Promise<void> {
    if (!this.currentVideoId || this.rechecking) return Promise.resolve();
    this.rechecking = true;
    this.refreshPanelButton();
    return this.checkAvailability(this.currentVideoId, force).finally(() => {
      this.rechecking = false;
      this.hasChecked = true;
      this.refreshPanelButton();
    });
  }

  /**
   * 面板尾部追加检测按钮（复用宿主页 Bulma 样式，不引新 CSS）；
   * 文案三态：检测中「检测中…」/ 完成过「重检」/ 首次「开始检测」（G1）
   */
  private attachRecheckButton(panel: HTMLElement): void {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button is-light is-small jdb-online-recheck';
    this.applyPanelButtonState(button);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      void this.handlePanelButtonClick();
    });
    panel.appendChild(button);
  }

  private applyPanelButtonState(button: HTMLButtonElement): void {
    if (this.rechecking) {
      button.disabled = true;
      button.textContent = '检测中…';
      button.title = '检测进行中';
    } else if (this.hasChecked) {
      button.disabled = false;
      button.textContent = '重检';
      button.title = '重新检测此番号（绕过缓存）';
    } else {
      button.disabled = false;
      button.textContent = '开始检测';
      button.title = '检测此番号的在线可看站点';
    }
  }

  private refreshPanelButton(): void {
    const button = document.querySelector<HTMLButtonElement>('#jdb-online-availability-panel .jdb-online-recheck');
    if (button) this.applyPanelButtonState(button);
  }

  destroy(): void {
    this.initialized = false;
    document.getElementById('jdb-online-availability-panel')?.remove();
  }

  private async checkSite(site: OnlineAvailabilitySite, videoId: string, force = false): Promise<OnlineAvailabilityResult> {
    const url = buildOnlineAvailabilityUrl(site, videoId);
    const result = await this.checkSiteUrl(site, videoId, url, force);
    // 双版本（有码/无码）探测：base 页 available 时二次探无码镜像（同 checkSiteUrl 通路/32KB 窗口/force 透传，
    // cacheId 随 url 天然不同=各自 12min 缓存）；双 available → 主链接=有码真页 + alternatives=无码真页（用户二选一）；
    // 二次探不可用返回主结果原样（单版本行为零变化）；主探不可用不触发（成本守卫）
    if (result.available && site.key === 'missav') {
      const variantUrl = buildMissavVariantUrl(site, videoId);
      const variantResult = await this.checkSiteUrl(site, videoId, variantUrl, force);
      if (variantResult.available) {
        return {
          ...result,
          tags: [...result.tags, '有码'],
          alternatives: [{ url: variantUrl, label: '无码' }],
        };
      }
      return result;
    }
    if (result.available || site.key !== 'jable') {
      return result;
    }

    const fallbackUrl = buildJableChineseSubtitleUrl(url);
    if (!fallbackUrl || fallbackUrl === url) {
      return result;
    }

    const fallbackResult = await this.checkSiteUrl(site, videoId, fallbackUrl, force);
    return fallbackResult.available ? fallbackResult : result;
  }

  private async checkSiteUrl(site: OnlineAvailabilitySite, videoId: string, url: string, force = false): Promise<OnlineAvailabilityResult> {
    const cacheId = `${String(videoId || '').trim()}|${site.key}|${url}`;
    try {
      const { data, fromCache } = await getOrFetchSessionResult(
        'onlineAvailability',
        cacheId,
        async () => {
          const doc = await withOnlineAvailabilityTimeout(defaultHttpClient.getDocument(url, {
            timeout: this.config.timeoutMs,
            retries: 0,
            headers: {
              Referer: 'https://javdb.com/',
            },
            // get 型站点只探测正文前缀 + 首字节快速失败，parser 型保持整页抓取
            ...(typeof site.probePrefixBytes === 'number' && site.probePrefixBytes > 0
              ? { maxBodyBytes: site.probePrefixBytes, firstByteTimeoutMs: PROBE_FIRST_BYTE_TIMEOUT_MS }
              : {}),
          }), this.config.timeoutMs, `${site.name} availability check`);
          return parseOnlineAvailabilityDocument(site, doc, videoId, url, 200);
        },
        // force=手动重检：跳过缓存读、结果回写缓存；parser 型整页 + DOM 解析成本高，延长缓存窗口减少重复探测；get 型传 undefined 走表值（12min）
        { force, ttlMs: site.fetchType === 'parser' ? PARSER_AVAILABILITY_TTL_MS : undefined },
      );
      if (fromCache) {
        // 跨页复用探测结果，避免重复外网请求
        return data;
      }
      return data;
    } catch (error) {
      return {
        siteKey: site.key,
        siteName: site.name,
        available: false,
        url,
        tags: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private injectPanel(status: 'checking' | 'ready' | 'idle'): void {
    if (document.getElementById('jdb-online-availability-panel')) return;

    const target = findOnlineAvailabilityInsertionTarget();
    if (!target) return;

    const panel = document.createElement('div');
    panel.id = 'jdb-online-availability-panel';
    panel.className = 'panel-block jdb-online-availability';
    panel.innerHTML = `
      <strong>在线可看:</strong>
      &nbsp;<span class="value jdb-online-availability-links">
        <span class="jdb-online-status">${status === 'checking' ? '检测中...' : status === 'idle' ? '未检测' : ''}</span>
      </span>
    `;
    this.attachRecheckButton(panel);

    target.parent.insertBefore(panel, target.before);
    placeSearchPanelsBelowOnlineAvailability(panel);
  }

  private renderResults(results: OnlineAvailabilityResult[], totalCount = results.length): void {
    this.injectPanel('ready');
    const panel = document.getElementById('jdb-online-availability-panel');
    if (!panel) return;

    panel.innerHTML = '<strong>在线可看:</strong>&nbsp;';
    const value = document.createElement('span');
    value.className = 'value jdb-online-availability-links';
    panel.appendChild(value);
    this.attachRecheckButton(panel);

    const shown = results.filter(result => result.available);
    const unavailable = this.config.showUnavailable ? results.filter(result => !result.available) : [];
    const pendingCount = Math.max(0, totalCount - results.length);

    shown.forEach(result => {
      const link = document.createElement('a');
      link.href = result.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'tag is-success is-light is-small';
      link.textContent = result.tags.length ? `${result.siteName} ${result.tags.join(' ')}` : result.siteName;
      value.appendChild(link);
      // G3：同站点多真页选项（有码/无码），主链接后逐条绿 tag 链接，各开对应真页
      (result.alternatives ?? []).forEach(alt => {
        const altLink = document.createElement('a');
        altLink.href = alt.url;
        altLink.target = '_blank';
        altLink.rel = 'noopener noreferrer';
        altLink.className = 'tag is-success is-light is-small';
        altLink.textContent = `${result.siteName} ${alt.label}`;
        value.appendChild(altLink);
      });
    });

    unavailable.forEach(result => {
      const tag = document.createElement('span');
      tag.className = 'tag is-danger is-light is-small jdb-online-unavailable';
      tag.title = result.error || result.url;
      tag.textContent = `${result.siteName} 失败`;
      value.appendChild(tag);
    });

    if (pendingCount > 0) {
      const pending = document.createElement('span');
      pending.className = 'tag is-light is-small jdb-online-checking';
      pending.textContent = `检测中 ${pendingCount}`;
      value.appendChild(pending);
    }

    if (shown.length === 0 && unavailable.length === 0 && pendingCount === 0) {
      const empty = document.createElement('span');
      empty.textContent = '暂无命中';
      empty.className = 'is-size-7 has-text-grey';
      value.appendChild(empty);
    }

    log(`Online availability checked: ${shown.length}/${results.length}/${totalCount} sites available`);
  }
}

function placeSearchPanelsBelowOnlineAvailability(onlinePanel: HTMLElement): void {
  if (!onlinePanel.parentElement) return;

  let before = onlinePanel.nextSibling;
  ['jdb-external-search-panel', 'jdb-subtitle-search-panel'].forEach((id) => {
    const panel = document.getElementById(id);
    if (!panel || !onlinePanel.parentElement) return;
    onlinePanel.parentElement.insertBefore(panel, before);
    before = panel.nextSibling;
  });
}

export function findOnlineAvailabilityInsertionTarget(): OnlineAvailabilityInsertionTarget | null {
  const enhancementPanel = ensureDetailEnhancementPanel();
  if (enhancementPanel) {
    const firstSearchPanel = ['jdb-external-search-panel', 'jdb-subtitle-search-panel']
      .map(id => document.getElementById(id))
      .find(panel => panel?.parentElement === enhancementPanel) ?? null;
    return { parent: enhancementPanel, before: firstSearchPanel };
  }

  const moviePanel = document.querySelector('.movie-panel-info');
  const directReviewButtons = moviePanel
    ? Array.from(moviePanel.children).find(child => child.classList.contains('review-buttons'))
    : null;
  if (directReviewButtons?.parentElement) {
    return { parent: directReviewButtons.parentElement, before: directReviewButtons.nextSibling };
  }

  const reviewButtons = document.querySelector('.review-buttons');
  if (reviewButtons?.parentElement) {
    return { parent: reviewButtons.parentElement, before: reviewButtons.nextSibling };
  }

  const host = document.querySelector('.top-meta') || document.querySelector('.video-meta-panel') || moviePanel;
  if (!host) return null;
  return { parent: host, before: null };
}

export function buildOnlineAvailabilityUrl(site: OnlineAvailabilitySite, videoId: string): string {
  const formatted = site.codeFormatter ? site.codeFormatter(videoId) : videoId.toLowerCase();
  return site.url.replace('{{code}}', encodeURIComponent(formatted));
}

/** missav 无码镜像页 URL（路径 code 小写，同 buildOnlineAvailabilityUrl 归一化口径；模板后缀 -uncensored-leak） */
export function buildMissavVariantUrl(site: OnlineAvailabilitySite, videoId: string): string {
  const code = String(videoId || '').trim().toLowerCase();
  if (!code) return '';
  return site.url.replace('{{code}}', `${encodeURIComponent(code)}-uncensored-leak`);
}

export function parseOnlineAvailabilityDocument(
  site: OnlineAvailabilitySite,
  doc: Document,
  videoId: string,
  requestUrl: string,
  status: number,
): OnlineAvailabilityResult {
  if (status >= 400) {
    return unavailable(site, requestUrl);
  }

  if (site.fetchType === 'get') {
    if (!isDirectDetailPageMatch(site, doc, videoId, requestUrl)) {
      return unavailable(site, requestUrl);
    }

    return {
      siteKey: site.key,
      siteName: site.name,
      available: true,
      url: requestUrl,
      tags: extractTags(doc, site.domQuery),
    };
  }

  const match = findParserMatch(site, doc, videoId, requestUrl);
  if (!match) return unavailable(site, requestUrl);

  return {
    siteKey: site.key,
    siteName: site.name,
    available: true,
    url: match.url,
    tags: extractTags(doc, site.domQuery, match.text),
  };
}

function unavailable(site: OnlineAvailabilitySite, url: string): OnlineAvailabilityResult {
  return {
    siteKey: site.key,
    siteName: site.name,
    available: false,
    url,
    tags: [],
  };
}

function findParserMatch(site: OnlineAvailabilitySite, doc: Document, videoId: string, requestUrl: string): { url: string; text: string } | null {
  const linkQuery = site.domQuery?.linkQuery;
  if (!linkQuery) return null;

  const links = Array.from(doc.querySelectorAll<HTMLAnchorElement>(linkQuery));
  for (const link of links) {
    const text = getParserCandidateText(link);
    if (!containsExactVideoCode(text, videoId)) continue;
    const href = link.getAttribute('href') || requestUrl;
    return {
      url: new URL(href, requestUrl).toString(),
      text,
    };
  }

  const titleQuery = site.domQuery?.titleQuery;
  if (titleQuery) {
    const title = Array.from(doc.querySelectorAll<HTMLElement>(titleQuery))
      .find(item => containsExactVideoCode(getParserCandidateText(item), videoId));
    if (title) {
      const anchor = title.matches('a[href]')
        ? title as HTMLAnchorElement
        : title.closest<HTMLAnchorElement>('a[href]');
      const href = anchor?.getAttribute('href');
      return {
        url: href ? new URL(href, requestUrl).toString() : requestUrl,
        text: getParserCandidateText(title),
      };
    }
  }

  return null;
}

function getParserCandidateText(element: HTMLElement): string {
  const imageText = Array.from(element.querySelectorAll<HTMLImageElement>('img[alt], img[title]'))
    .map(img => `${img.getAttribute('alt') || ''} ${img.getAttribute('title') || ''}`)
    .join(' ');
  return [
    element.textContent || '',
    element.getAttribute('title') || '',
    element.getAttribute('aria-label') || '',
    imageText,
  ].join(' ');
}

function extractTags(doc: Document, query?: OnlineAvailabilitySite['domQuery'], extraText = ''): string[] {
  const text = [
    extraText,
    query?.subQuery ? Array.from(doc.querySelectorAll(query.subQuery)).map(item => item.textContent || '').join(' ') : '',
    query?.leakQuery ? Array.from(doc.querySelectorAll(query.leakQuery)).map(item => item.textContent || '').join(' ') : '',
  ].join(' ');
  const tags: string[] = [];
  if (/中文|字幕|subtitle|chinese/i.test(text)) tags.push('字幕');
  if (/无码|無碼|泄漏|泄露|uncensored|leak/i.test(text)) tags.push('无码');
  return tags;
}

function normalizeCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function containsExactVideoCode(text: string, videoId: string): boolean {
  const target = normalizeCode(videoId);
  if (!target) return false;

  const tokens = String(text || '').match(/[A-Z]{2,12}[-_\s]?\d{2,7}/gi) || [];
  if (tokens.length > 0) {
    return tokens.some(token => normalizeCode(token) === target);
  }

  return normalizeCode(text) === target;
}

function isDirectDetailPageMatch(site: OnlineAvailabilitySite, doc: Document, videoId: string, requestUrl: string): boolean {
  const normalizedVideoId = normalizeCode(videoId);
  const titleText = doc.title || '';
  const bodyText = doc.body?.textContent || '';
  const searchableText = `${titleText} ${bodyText}`;
  const normalizedText = normalizeCode(searchableText);

  if (site.key === 'fanza') {
    const expectedCid = normalizeCode(site.codeFormatter ? site.codeFormatter(videoId) : formatFanzaCode(videoId));
    if (/年齢認証|age[_ -]?check/i.test(titleText) || /\/age_check\//i.test(requestUrl)) return false;
    if (Array.from(doc.querySelectorAll('script[src]')).some(script => /not-found/i.test(script.getAttribute('src') || ''))) return false;
    if (/お探しの商品は見つかりません|not\s*found|404/i.test(searchableText)) return false;
    return hasFanzaDetailSignal(doc, expectedCid, normalizedVideoId);
  }

  if (site.key === 'jable') {
    if (!doc.querySelector('.info-header')) return false;
    if (/not\s*found|404|no\s+videos?\s+found/i.test(searchableText)) return false;
    return normalizedText.includes(normalizedVideoId) && hasJableDetailSignal(doc, normalizedVideoId);
  }

  if (site.key === 'missav') {
    if (isSoftMissingPage(searchableText)) return false;
    const hasDetailSignal = hasMissavDetailSignal(doc, normalizedVideoId);
    if (!hasDetailSignal && isMissavSearchShell(doc, requestUrl)) return false;
    return normalizedText.includes(normalizedVideoId) && hasDetailSignal;
  }

  if (site.key === 'javbus') {
    if (isSoftMissingPage(searchableText)) return false;
    return normalizedText.includes(normalizedVideoId) && hasJavBusDetailSignal(doc, normalizedVideoId);
  }

  return true;
}

function isSoftMissingPage(text: string): boolean {
  return /not\s*found|404|no\s+videos?\s+found|access\s+denied|forbidden|captcha|cloudflare|error/i.test(text || '');
}

function hasFanzaDetailSignal(doc: Document, expectedCid: string, normalizedVideoId: string): boolean {
  const urlSelectors = [
    'link[rel="canonical"][href*="/digital/videoa/-/detail/=/cid="]',
    'meta[property="og:url"][content*="/digital/videoa/-/detail/=/cid="]',
  ];
  const productDataSelectors = [
    '#mu',
    '[data-pid]',
  ];

  const urlText = urlSelectors
    .flatMap(selector => Array.from(doc.querySelectorAll(selector)))
    .map(element => [
      element.getAttribute('href') || '',
      element.getAttribute('content') || '',
    ].join(' '))
    .join(' ');
  const productDataText = productDataSelectors
    .flatMap(selector => Array.from(doc.querySelectorAll(selector)))
    .map(element => [
      element.textContent || '',
      element.getAttribute('data-pid') || '',
    ].join(' '))
    .join(' ');
  const scripts = Array.from(doc.querySelectorAll('script:not([src])'))
    .map(script => script.textContent || '')
    .join(' ');
  const normalizedUrlText = normalizeCode(urlText);
  const normalizedProductDataText = normalizeCode(`${productDataText} ${scripts}`);

  return normalizedUrlText.includes(expectedCid)
    || normalizedUrlText.includes(normalizedVideoId)
    || normalizedProductDataText.includes(expectedCid)
    || normalizedProductDataText.includes(normalizedVideoId);
}

function hasJableDetailSignal(doc: Document, normalizedVideoId: string): boolean {
  const canonical = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || '';
  const ogUrl = doc.querySelector<HTMLMetaElement>('meta[property="og:url"]')?.content || '';
  const urlSignals = normalizeCode(`${canonical} ${ogUrl}`);
  const hasDetailUrl = urlSignals.includes(normalizedVideoId) && /\/videos\//i.test(`${canonical} ${ogUrl}`);

  return hasDetailUrl
    || Boolean(doc.querySelector('.video-info, .plyr, video, script[type="application/ld+json"]'));
}

function hasMissavDetailSignal(doc: Document, normalizedVideoId: string): boolean {
  const canonical = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || '';
  const ogUrl = doc.querySelector<HTMLMetaElement>('meta[property="og:url"]')?.content || '';
  const titleText = [
    doc.title || '',
    doc.querySelector('h1')?.textContent || '',
    doc.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content || '',
  ].join(' ');
  const urlSignals = normalizeCode(`${canonical} ${ogUrl}`);
  const hasDetailUrl = urlSignals.includes(normalizedVideoId) && !/\/search/i.test(`${canonical} ${ogUrl}`);
  const hasExactTitle = containsExactVideoCode(titleText, normalizedVideoId);
  const hasDetailMetadata = /發行日期|发行日期|release\s*date|番號|番号|品番|導演|导演|類別|类别|maker|studio/i
    .test(doc.body?.textContent || '');

  return hasDetailUrl || (hasExactTitle && hasDetailMetadata) || Boolean(doc.querySelector('video, [data-plyr-provider], .plyr'));
}

function isMissavSearchShell(doc: Document, requestUrl: string): boolean {
  const title = doc.title || '';
  const canonical = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || '';
  const ogUrl = doc.querySelector<HTMLMetaElement>('meta[property="og:url"]')?.content || '';
  const combinedUrl = `${requestUrl} ${canonical} ${ogUrl}`;

  if (/\/search(?:\/|\?|$)/i.test(combinedUrl)) return true;
  if (/搜尋|搜索|\bsearch\b/i.test(title)) return true;
  return Boolean(doc.querySelector('input[type="search"], form[action*="/search"], [href*="/search/"]'));
}

function hasJavBusDetailSignal(doc: Document, normalizedVideoId: string): boolean {
  const canonical = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || '';
  const ogUrl = doc.querySelector<HTMLMetaElement>('meta[property="og:url"]')?.content || '';
  const headingText = Array.from(doc.querySelectorAll('h3, .movie h3, .container h3'))
    .map(item => item.textContent || '')
    .join(' ');
  const urlSignals = normalizeCode(`${canonical} ${ogUrl}`);
  const hasDetailUrl = urlSignals.includes(normalizedVideoId);
  const hasExactHeading = containsExactVideoCode(headingText, normalizedVideoId);
  const hasDetailNode = Boolean(doc.querySelector('a.bigImage, #sample-waterfall, .movie, .movie-box, [class*="movie"]'));

  return hasDetailUrl || (hasExactHeading && hasDetailNode);
}

function buildJableChineseSubtitleUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!/^(?:www\.)?jable\.tv$/i.test(parsed.hostname)) return null;
    const pathname = parsed.pathname.endsWith('/') ? parsed.pathname.slice(0, -1) : parsed.pathname;
    if (pathname.endsWith('-c')) return url;
    parsed.pathname = `${pathname}-c/`;
    return parsed.toString();
  } catch {
    return null;
  }
}

function formatFanzaCode(preCode: string): string {
  const [pre, num = ''] = preCode.split('-');
  const padNum = num.padStart(5, '0');
  if (pre.toLowerCase().startsWith('start')) {
    return `1${pre.toLowerCase()}${padNum}`;
  }
  return `${pre}${padNum}`;
}

function withOnlineAvailabilityTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : 8000;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`${label} timeout after ${ms}ms`));
    }, ms);

    promise.then(
      value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export const onlineAvailabilityManager = new OnlineAvailabilityManager();
