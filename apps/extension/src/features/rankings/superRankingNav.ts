/**
 * @file superRankingNav.ts
 * @description superRankingNav
 * @module features/rankings
 */
import { bgFetchJSON } from '../../platform/network/clientFetch';
import { ReviewBreakerService } from '../reviewUnlock';

type JavdbTheme = 'dark' | 'light';

const log = (...args: any[]) => {
  try {
    const verbose = typeof window !== 'undefined' && (window as any).__JDB_VERBOSE;
    if (verbose !== false) console.log('[JavDB Ext]', ...args);
  } catch {
    console.log('[JavDB Ext]', ...args);
  }
};

function getJavdbTheme(): JavdbTheme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export const SUPER_RANKING_PLAYBACK_URL = '/advanced_search?handlePlayback=1&period=daily';
export const SUPER_RANKING_TOP250_URL = '/advanced_search?handleTop=1&handleType=all&type_value=&page=1';
export const SUPER_RANKING_FC2_URL = '/advanced_search?type=3&score_min=0&d=1';

export const SUPER_RANKING_ITEMS: Array<{ text: string; href: string }> = [
  { text: '热播', href: SUPER_RANKING_PLAYBACK_URL },
  { text: 'TOP250', href: SUPER_RANKING_TOP250_URL },
  { text: '有碼', href: '/rankings/movies?p=daily&t=censored' },
  { text: '無碼', href: '/rankings/movies?p=daily&t=uncensored' },
  { text: '歐美', href: '/rankings/movies?p=daily&t=western' },
  { text: 'FC2', href: SUPER_RANKING_FC2_URL },
  { text: 'FANZA(DMM)成人獎', href: '/rankings/fanza_award' },
];

const STYLE_ID = 'jdb-super-ranking-nav-style';
const OBSERVER_KEY = '__jdb_super_ranking_nav_observer__';
const OUTSIDE_CLICK_KEY = '__jdb_super_ranking_nav_outside_click__';
const THEME_OBSERVER_KEY = '__jdb_super_ranking_theme_observer__';
const RESTORE_LISTENER_KEY = '__jdb_super_ranking_restore_listener__';
const BEFORE_UNLOAD_KEY = '__jdb_super_ranking_nav_before_unload__';
const TITLE_TEXT = '超级排行榜';
const DEFAULT_RANKING_HREF = '/rankings/movies?p=daily&t=censored';
const PAGE_ROOT_ID = 'jdb-super-ranking-page';
const API_BASE = 'https://jdforrepam.com/api';
const TOP_AUTH_KEY = 'jb_appAuthorization';
const TOP250_MAX_PAGE = 5;
const ACTIVE_ATTR = 'jdbSuperRankingActive';
const ORIGINAL_LINK_HREF_ATTR = 'jdbSuperRankingOriginalHref';
const ORIGINAL_LINK_HTML_ATTR = 'jdbSuperRankingOriginalHtml';
const ORIGINAL_DROPDOWN_HTML_ATTR = 'jdbSuperRankingOriginalHtml';
const ORIGINAL_FC2_HREF_ATTR = 'jdbSuperRankingOriginalFc2Href';
let activeSupportedHost = '';
// S1-2a：导航增强对 MPA 静态 navbar 只需完整跑一次；完成后 mutation 回调不再重复
// 全文档扫描 + 逐链接 textContent 读（列表增强爆发期每批 mutation 都会触发，是长帧放大器）。
let navApplied = false;
// S1-2a：上次 FC2 链接改写时的锚点数；数量不变即跳过全文档扫描。
// bfcache 恢复/开关重启用时置 null 强制重扫。
let lastFc2AnchorCount: number | null = null;

type SuperRankingMovie = {
  id?: string;
  number?: string;
  origin_title?: string;
  title?: string;
  cover_url?: string;
  release_date?: string;
  has_cnsub?: boolean;
  magnets_count?: number;
};

export type SuperRankingAppendResult = {
  handled: boolean;
  appended: number;
  page: number;
  maxPage: number;
  url?: string;
  /** 本次追加进 grid 的新卡片节点（缺陷1：超排页无 MutationObserver，manager 依赖该数组对新卡补跑增强）。 */
  items?: HTMLElement[];
};

function normalizeText(value: string | null | undefined): string {
  return String(value || '').replace(/\s+/g, '').trim();
}

export function isSuperRankingSupportedHost(hostname = window.location.hostname): boolean {
  const host = hostname.toLowerCase();
  return host === 'javdb.com'
    || host.endsWith('.javdb.com')
    || host === 'javdb570.com'
    || host.endsWith('.javdb570.com')
    || host === 'javdb575.com'
    || host.endsWith('.javdb575.com');
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeImageUrl(value: unknown): string {
  return String(value || '').replace(/https:\/\/.*?\/rhe951l4q/g, 'https://c0.jdbstatic.com');
}

function parsePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function getCurrentUrlParams(): URLSearchParams {
  return new URLSearchParams(window.location.search || '');
}

function getSpecialPageContainer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.section .container')
    || document.querySelector<HTMLElement>('main .container')
    || document.querySelector<HTMLElement>('.container')
    || document.body;
}

function clearNativeAdvancedSearchContent(container: HTMLElement): void {
  document.querySelectorAll('.empty-message, #sort-toggle-btn').forEach((el) => el.remove());
  Array.from(container.children).forEach((child) => {
    if (child.id === PAGE_ROOT_ID) return;
    if (child.classList.contains('box')) child.remove();
  });
}

function setSpecialPageTitle(title: string): void {
  const h2 = document.querySelector<HTMLElement>('h2.section-title, .section-title');
  if (!h2) return;

  const firstText = Array.from(h2.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
  if (firstText) {
    firstText.textContent = title;
  } else {
    h2.textContent = title;
  }
  h2.style.marginBottom = '0';
}

function applySpecialPageTheme(root: HTMLElement): JavdbTheme {
  const theme = getJavdbTheme();
  root.dataset.jdbTheme = theme;
  return theme;
}

function bindSpecialPageThemeObserver(root: HTMLElement): void {
  const oldObserver = (window as any)[THEME_OBSERVER_KEY] as MutationObserver | undefined;
  oldObserver?.disconnect();

  const observer = new MutationObserver(() => {
    applySpecialPageTheme(root);
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  (window as any)[THEME_OBSERVER_KEY] = observer;
}

function unbindSpecialPageThemeObserver(): void {
  const observer = (window as any)[THEME_OBSERVER_KEY] as MutationObserver | undefined;
  observer?.disconnect();
  delete (window as any)[THEME_OBSERVER_KEY];
}

function createSpecialPageRoot(container: HTMLElement, title: string): HTMLElement {
  clearNativeAdvancedSearchContent(container);
  setSpecialPageTitle(title);

  const oldRoot = document.getElementById(PAGE_ROOT_ID);
  oldRoot?.remove();

  const root = document.createElement('div');
  root.id = PAGE_ROOT_ID;
  root.className = 'jdb-super-ranking-page';
  applySpecialPageTheme(root);
  container.appendChild(root);
  bindSpecialPageThemeObserver(root);
  return root;
}

function renderPageMessage(root: HTMLElement, type: 'loading' | 'empty' | 'error' | 'info', message: string): void {
  root.innerHTML = `<div class="jdb-super-ranking-message jdb-super-ranking-message-${type}">${message}</div>`;
}

function renderMovieListHtml(movies: SuperRankingMovie[]): string {
  return movies.map((movie) => {
    const id = String(movie.id || '').trim();
    const number = String(movie.number || '').trim();
    const title = String(movie.origin_title || movie.title || '').trim();
    const coverUrl = normalizeImageUrl(movie.cover_url);
    const tagText = movie.has_cnsub ? '中字' : Number(movie.magnets_count || 0) > 0 ? '含磁链' : '无磁链';
    const tagClass = movie.has_cnsub ? 'is-warning' : Number(movie.magnets_count || 0) > 0 ? 'is-success' : 'is-info';
    const href = id ? `/v/${encodeURIComponent(id)}` : '#';

    return `
      <a href="${href}" class="box item jdb-super-ranking-movie" title="${escapeHtml(title || number)}">
        <div class="cover">
          ${coverUrl ? `<img loading="lazy" src="${escapeHtml(coverUrl)}">` : '<div class="jdb-super-ranking-cover-empty">No Cover</div>'}
        </div>
        <div class="video-title"><strong>${escapeHtml(number || id)}</strong> ${escapeHtml(title)}</div>
        <div class="meta">${escapeHtml(movie.release_date || '')}</div>
        <div class="tags has-addons"><span class="tag ${tagClass}">${tagText}</span></div>
      </a>
    `;
  }).join('');
}

function renderMovieGrid(root: HTMLElement, movies: SuperRankingMovie[], emptyText: string): void {
  const grid = root.querySelector<HTMLElement>('.jdb-super-ranking-grid');
  if (!grid) return;
  grid.innerHTML = movies.length > 0
    ? renderMovieListHtml(movies)
    : `<div class="jdb-super-ranking-message jdb-super-ranking-message-empty">${escapeHtml(emptyText)}</div>`;
}

async function fetchPlaybackMovies(period: string): Promise<SuperRankingMovie[]> {
  const signature = await ReviewBreakerService.generateSignature();
  const url = `${API_BASE}/v1/rankings/playback?period=${encodeURIComponent(period)}&filter_by=high_score`;
  const { success, status, data, error } = await bgFetchJSON<any>({
    url,
    method: 'GET',
    headers: { jdSignature: signature },
    timeoutMs: 15000,
  });

  if (!success) {
    throw new Error(error || `HTTP ${status}`);
  }

  return data?.data?.movies || data?.movies || [];
}

async function fetchTop250Movies(handleType: string, typeValue: string, page: number, token: string): Promise<any> {
  const signature = await ReviewBreakerService.generateSignature();
  const url = `${API_BASE}/v1/movies/top?start_rank=1&type=${encodeURIComponent(handleType)}&type_value=${encodeURIComponent(typeValue)}&ignore_watched=false&page=${page}&limit=50`;
  const { success, status, data, error } = await bgFetchJSON<any>({
    url,
    method: 'GET',
    headers: {
      'user-agent': 'Dart/3.5 (dart:io)',
      'accept-language': 'zh-TW',
      authorization: `Bearer ${token}`,
      jdsignature: signature,
    },
    timeoutMs: 15000,
  });

  if (!success) {
    throw new Error(error || `HTTP ${status}`);
  }
  return data;
}

async function loginTop250(username: string, password: string): Promise<string> {
  const signature = await ReviewBreakerService.generateSignature();
  const params = new URLSearchParams({
    username,
    password,
    device_uuid: '04b9534d-5118-53de-9f87-2ddded77111e',
    device_name: 'iPhone',
    device_model: 'iPhone',
    platform: 'ios',
    system_version: '17.4',
    app_version: 'official',
    app_version_number: '1.9.29',
    app_channel: 'official',
  });
  const { success, status, data, error } = await bgFetchJSON<any>({
    url: `${API_BASE}/v1/sessions?${params.toString()}`,
    method: 'POST',
    headers: {
      'Content-Type': 'multipart/form-data; boundary=--dio-boundary-2210433284',
      'user-agent': 'Dart/3.5 (dart:io)',
      'accept-language': 'zh-TW',
      jdSignature: signature,
    },
    timeoutMs: 15000,
  });

  if (!success) {
    throw new Error(error || `HTTP ${status}`);
  }

  const token = data?.data?.token;
  if (data?.success !== 1 || !token) {
    throw new Error(data?.message || '登录失败，未返回移动端 token');
  }
  return String(token);
}

function renderPlaybackControls(root: HTMLElement, period: string): void {
  const periodNames: Record<string, string> = { daily: '日榜', weekly: '周榜', monthly: '月榜' };
  const links = ['daily', 'weekly', 'monthly'].map((key) => {
    const active = key === period ? ' is-info' : '';
    return `<a class="button is-small${active}" href="/advanced_search?handlePlayback=1&period=${key}">${periodNames[key]}</a>`;
  }).join('');
  root.innerHTML = `
    <div class="buttons has-addons jdb-super-ranking-controls">${links}</div>
    <div class="movie-list h cols-4 vcols-8 jdb-super-ranking-grid">
      <div class="jdb-super-ranking-message jdb-super-ranking-message-loading">正在加载热播数据...</div>
    </div>
  `;
}

function buildTop250Url(handleType: string, typeValue: string, page: number): string {
  return `/advanced_search?handleTop=1&handleType=${encodeURIComponent(handleType)}&type_value=${encodeURIComponent(typeValue)}&page=${page}`;
}

function renderTop250PaginationHtml(handleType: string, typeValue: string, page: number): string {
  const paginationLinks = Array.from({ length: TOP250_MAX_PAGE }, (_, index) => index + 1).map((pageNumber) => {
    const active = pageNumber === page ? ' is-current' : '';
    return `<li><a class="pagination-link${active}" href="${buildTop250Url(handleType, typeValue, pageNumber)}">${pageNumber}</a></li>`;
  }).join('');
  const prev = page > 1 ? `<a class="pagination-previous" href="${buildTop250Url(handleType, typeValue, page - 1)}">上一页</a>` : '';
  const next = page < TOP250_MAX_PAGE ? `<a class="pagination-next" href="${buildTop250Url(handleType, typeValue, page + 1)}">下一页</a>` : '';
  return `${prev}<ul class="pagination-list">${paginationLinks}</ul>${next}`;
}

function renderTop250Controls(root: HTMLElement, handleType: string, typeValue: string, page: number): void {
  const typeButtons = [
    { type: 'all', value: '', label: '全部' },
    { type: 'video_type', value: '0', label: '有码' },
    { type: 'video_type', value: '1', label: '无码' },
    { type: 'video_type', value: '2', label: '欧美' },
    { type: 'video_type', value: '3', label: 'FC2' },
  ];
  const currentYear = new Date().getFullYear();
  for (let year = currentYear; year >= 2008; year--) {
    typeButtons.push({ type: 'year', value: String(year), label: String(year) });
  }

  const buttons = typeButtons.map((item) => {
    const active = item.type === handleType && item.value === typeValue ? ' is-info' : '';
    return `<a class="button is-small${active}" href="${buildTop250Url(item.type, item.value, 1)}">${item.label}</a>`;
  }).join('');

  root.innerHTML = `
    <div class="buttons has-addons jdb-super-ranking-controls jdb-super-ranking-controls-wrap">${buttons}</div>
    <div class="movie-list h cols-4 vcols-8 jdb-super-ranking-grid">
      <div class="jdb-super-ranking-message jdb-super-ranking-message-loading">正在加载 Top250 数据...</div>
    </div>
    <nav class="pagination jdb-super-ranking-pagination">${renderTop250PaginationHtml(handleType, typeValue, page)}</nav>
  `;
}

function renderTop250LoginPanel(root: HTMLElement, message = ''): void {
  root.innerHTML = `
    <div class="jdb-super-ranking-login">
      <h3>Top250 需要登录授权</h3>
      <p>Top250 数据来自 JavDB 移动端接口。这里会用账号密码换取移动端访问凭证，并仅保存在当前站点。</p>
      ${message ? `<div class="jdb-super-ranking-login-error">${escapeHtml(message)}</div>` : ''}
      <input id="jdb-super-ranking-login-user" class="input" type="text" autocomplete="username" placeholder="用户名或邮箱">
      <input id="jdb-super-ranking-login-pass" class="input" type="password" autocomplete="current-password" placeholder="密码">
      <button id="jdb-super-ranking-login-submit" class="button is-info">登录并加载 Top250</button>
      <div id="jdb-super-ranking-login-msg" class="jdb-super-ranking-login-error" hidden></div>
    </div>
  `;

  root.querySelector<HTMLButtonElement>('#jdb-super-ranking-login-submit')?.addEventListener('click', async () => {
    const userInput = root.querySelector<HTMLInputElement>('#jdb-super-ranking-login-user');
    const passInput = root.querySelector<HTMLInputElement>('#jdb-super-ranking-login-pass');
    const button = root.querySelector<HTMLButtonElement>('#jdb-super-ranking-login-submit');
    const msg = root.querySelector<HTMLElement>('#jdb-super-ranking-login-msg');
    const username = userInput?.value.trim() || '';
    const password = passInput?.value.trim() || '';

    if (!username || !password) {
      if (msg) {
        msg.textContent = '请输入用户名和密码';
        msg.hidden = false;
      }
      return;
    }

    if (button) {
      button.disabled = true;
      button.textContent = '登录中...';
    }

    try {
      const token = await loginTop250(username, password);
      localStorage.setItem(TOP_AUTH_KEY, token);
      await handleTop250Page();
    } catch (error) {
      if (msg) {
        msg.textContent = error instanceof Error ? error.message : String(error);
        msg.hidden = false;
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = '登录并加载 Top250';
      }
    }
  });
}

async function handlePlaybackPage(): Promise<boolean> {
  const params = getCurrentUrlParams();
  if (params.get('handlePlayback') !== '1') return false;

  const period = ['daily', 'weekly', 'monthly'].includes(params.get('period') || '')
    ? String(params.get('period'))
    : 'daily';
  const container = getSpecialPageContainer();
  if (!container) return false;

  const root = createSpecialPageRoot(container, '热播');
  renderPlaybackControls(root, period);

  try {
    const movies = await fetchPlaybackMovies(period);
    renderMovieGrid(root, movies, '暂无热播数据');
  } catch (error) {
    renderPageMessage(root, 'error', `加载热播失败：${escapeHtml(error instanceof Error ? error.message : String(error))}`);
  }
  return true;
}

async function handleTop250Page(): Promise<boolean> {
  const params = getCurrentUrlParams();
  if (params.get('handleTop') !== '1') return false;

  const handleType = params.get('handleType') || 'all';
  const typeValue = params.get('type_value') || '';
  const page = parsePositiveInteger(params.get('page'), 1);
  const container = getSpecialPageContainer();
  if (!container) return false;

  const root = createSpecialPageRoot(container, 'Top250');
  const token = localStorage.getItem(TOP_AUTH_KEY) || '';
  if (!token) {
    renderTop250LoginPanel(root);
    return true;
  }

  renderTop250Controls(root, handleType, typeValue, page);

  try {
    const response = await fetchTop250Movies(handleType, typeValue, page, token);
    if (response?.success === 1 && Array.isArray(response?.data?.movies)) {
      renderMovieGrid(root, response.data.movies, '暂无 Top250 数据');
      return true;
    }

    if (response?.action === 'JWTVerificationError') {
      localStorage.removeItem(TOP_AUTH_KEY);
      renderTop250LoginPanel(root, response?.message || '登录已过期，请重新登录');
      return true;
    }

    renderMovieGrid(root, [], response?.message || '暂无 Top250 数据');
  } catch (error) {
    renderPageMessage(root, 'error', `加载 Top250 失败：${escapeHtml(error instanceof Error ? error.message : String(error))}`);
  }
  return true;
}

export function isSuperRankingTop250Page(): boolean {
  const params = getCurrentUrlParams();
  return isSuperRankingSupportedHost()
    && window.location.pathname.includes('/advanced_search')
    && params.get('handleTop') === '1';
}

export function getSuperRankingTop250PageInfo(): { page: number; maxPage: number } | null {
  if (!isSuperRankingTop250Page()) return null;
  if (!document.getElementById(PAGE_ROOT_ID)) return null;
  return {
    page: parsePositiveInteger(getCurrentUrlParams().get('page'), 1),
    maxPage: TOP250_MAX_PAGE,
  };
}

export async function appendSuperRankingTop250Page(page: number): Promise<SuperRankingAppendResult> {
  if (!isSuperRankingTop250Page()) {
    return { handled: false, appended: 0, page, maxPage: TOP250_MAX_PAGE };
  }

  const params = getCurrentUrlParams();
  const handleType = params.get('handleType') || 'all';
  const typeValue = params.get('type_value') || '';
  if (page > TOP250_MAX_PAGE) {
    return {
      handled: true,
      appended: 0,
      page: TOP250_MAX_PAGE,
      maxPage: TOP250_MAX_PAGE,
      url: buildTop250Url(handleType, typeValue, TOP250_MAX_PAGE),
    };
  }

  const targetPage = Math.max(1, page);
  const url = buildTop250Url(handleType, typeValue, targetPage);
  const root = document.getElementById(PAGE_ROOT_ID);
  if (!root) {
    return { handled: false, appended: 0, page: targetPage, maxPage: TOP250_MAX_PAGE, url };
  }
  const grid = root.querySelector<HTMLElement>('.jdb-super-ranking-grid');
  const token = localStorage.getItem(TOP_AUTH_KEY) || '';

  if (!token) {
    renderTop250LoginPanel(root);
    return { handled: true, appended: 0, page: targetPage, maxPage: TOP250_MAX_PAGE, url };
  }

  const response = await fetchTop250Movies(handleType, typeValue, targetPage, token);
  if (response?.action === 'JWTVerificationError') {
    localStorage.removeItem(TOP_AUTH_KEY);
    renderTop250LoginPanel(root, response?.message || '登录已过期，请重新登录');
    return { handled: true, appended: 0, page: targetPage, maxPage: TOP250_MAX_PAGE, url };
  }

  const movies = response?.success === 1 && Array.isArray(response?.data?.movies) ? response.data.movies : [];
  if (!grid || movies.length === 0) {
    return { handled: true, appended: 0, page: targetPage, maxPage: TOP250_MAX_PAGE, url };
  }

  const template = document.createElement('template');
  template.innerHTML = renderMovieListHtml(movies).trim();
  const appendedItems: HTMLElement[] = [];
  Array.from(template.content.children).forEach((child) => {
    grid.appendChild(child);
    appendedItems.push(child as HTMLElement);
  });

  const pagination = root.querySelector<HTMLElement>('.jdb-super-ranking-pagination');
  if (pagination) {
    pagination.innerHTML = renderTop250PaginationHtml(handleType, typeValue, targetPage);
  }

  return { handled: true, appended: movies.length, page: targetPage, maxPage: TOP250_MAX_PAGE, url, items: appendedItems };
}

export async function handleSuperRankingPage(): Promise<boolean> {
  if (!window.location.pathname.includes('/advanced_search')) return false;
  if (await handlePlaybackPage()) return true;
  if (await handleTop250Page()) return true;
  return false;
}

function refreshSuperRankingNav(hostname = activeSupportedHost || window.location.hostname): void {
  if (!isSuperRankingSupportedHost(hostname)) return;
  injectStyles();
  lastFc2AnchorCount = null;
  applySuperRankingNav();
  rewriteNativeFc2Links();
  void handleSuperRankingPage().catch((error) => {
    log('[SuperRankingNav] restore refresh failed:', error);
  });
}

function isRankingDropdown(parent: HTMLElement): boolean {
  const dropdown = parent.querySelector<HTMLElement>('.navbar-dropdown');
  if (!dropdown) return false;

  const hrefs = Array.from(dropdown.querySelectorAll<HTMLAnchorElement>('a[href]')).map((a) => a.getAttribute('href') || '');
  return hrefs.some((href) => href.includes('/rankings/'));
}

function isExpectedDropdown(dropdown: HTMLElement): boolean {
  const anchors = Array.from(dropdown.querySelectorAll<HTMLAnchorElement>(':scope > a.navbar-item'));
  if (anchors.length !== SUPER_RANKING_ITEMS.length) return false;

  return anchors.every((anchor, index) => {
    const item = SUPER_RANKING_ITEMS[index];
    return anchor.textContent?.trim() === item.text && anchor.getAttribute('href') === item.href;
  });
}

function findRankingNavItems(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.navbar-item.has-dropdown')).filter((parent) => {
    const link = parent.querySelector<HTMLAnchorElement>(':scope > a.navbar-link, a.navbar-link');
    if (!link) return false;

    const text = normalizeText(link.textContent);
    const href = link.getAttribute('href') || '';
    return text === '排行榜'
      || text === TITLE_TEXT
      || (href.includes('/rankings/') && isRankingDropdown(parent));
  });
}

function renderRankingDropdown(dropdown: HTMLElement): void {
  if (dropdown.dataset.jdbSuperRankingItems === '1' && isExpectedDropdown(dropdown)) return;

  dropdown.innerHTML = '';
  SUPER_RANKING_ITEMS.forEach((item) => {
    const anchor = document.createElement('a');
    anchor.className = 'navbar-item jdb-super-ranking-item';
    anchor.setAttribute('href', item.href);
    anchor.textContent = item.text;
    dropdown.appendChild(anchor);
  });
  dropdown.dataset.jdbSuperRankingItems = '1';
}

function rewriteNativeFc2Links(): void {
  const anchors = document.querySelectorAll<HTMLAnchorElement>('.tabs a[href], .navbar-item[href]');
  if (lastFc2AnchorCount === anchors.length) return;
  lastFc2AnchorCount = anchors.length;
  anchors.forEach((anchor) => {
    if (normalizeText(anchor.textContent) !== 'FC2') return;
    if (anchor.dataset[ORIGINAL_FC2_HREF_ATTR] === undefined) {
      anchor.dataset[ORIGINAL_FC2_HREF_ATTR] = anchor.getAttribute('href') || '';
    }
    anchor.setAttribute('href', SUPER_RANKING_FC2_URL);
  });
}

function preserveOriginalMarkup(link: HTMLAnchorElement, dropdown: HTMLElement): void {
  if (link.dataset[ORIGINAL_LINK_HREF_ATTR] === undefined) {
    link.dataset[ORIGINAL_LINK_HREF_ATTR] = link.getAttribute('href') || '';
  }
  if (link.dataset[ORIGINAL_LINK_HTML_ATTR] === undefined) {
    link.dataset[ORIGINAL_LINK_HTML_ATTR] = link.innerHTML;
  }
  if (dropdown.dataset[ORIGINAL_DROPDOWN_HTML_ATTR] === undefined) {
    dropdown.dataset[ORIGINAL_DROPDOWN_HTML_ATTR] = dropdown.innerHTML;
  }
}

function bindNavbarClick(parent: HTMLElement, link: HTMLAnchorElement): void {
  if (link.dataset.jdbSuperRankingClickBound === '1') return;

  link.dataset.jdbSuperRankingClickBound = '1';
  link.addEventListener('click', (event) => {
    if (parent.dataset[ACTIVE_ATTR] !== '1') return;

    const touchLike = window.matchMedia?.('(hover: none), (max-width: 1023px)').matches === true;
    if (!touchLike) return;

    event.preventDefault();
    event.stopPropagation();
    parent.classList.toggle('is-active');
  });
}

function bindOutsideClick(): void {
  if ((window as any)[OUTSIDE_CLICK_KEY]) return;

  const handler = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    document.querySelectorAll<HTMLElement>('.jdb-super-ranking-nav.is-active').forEach((nav) => {
      if (!target || !nav.contains(target)) {
        nav.classList.remove('is-active');
      }
    });
  };
  document.addEventListener('click', handler, true);
  (window as any)[OUTSIDE_CLICK_KEY] = handler;
}

function bindRestoreListeners(): void {
  if ((window as any)[RESTORE_LISTENER_KEY]) return;

  let refreshTimer = 0;
  const scheduleRefresh = () => {
    if (refreshTimer) window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      refreshTimer = 0;
      refreshSuperRankingNav();
    }, 0);
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) scheduleRefresh();
  };
  const onPopState = () => scheduleRefresh();
  const onFocus = () => scheduleRefresh();

  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('popstate', onPopState);
  window.addEventListener('focus', onFocus);
  (window as any)[RESTORE_LISTENER_KEY] = () => {
    if (refreshTimer) window.clearTimeout(refreshTimer);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('popstate', onPopState);
    window.removeEventListener('focus', onFocus);
  };
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .jdb-super-ranking-nav:hover > .navbar-dropdown,
    .jdb-super-ranking-nav.is-active > .navbar-dropdown {
      display: block !important;
    }
    .jdb-super-ranking-title {
      color: #e5484d;
      font-weight: 800;
      letter-spacing: 0.02em;
      text-shadow: 0 0 10px rgba(229, 72, 77, 0.24);
    }
    html[data-theme="dark"] .jdb-super-ranking-title {
      color: #ff8a8a;
      text-shadow: 0 0 12px rgba(255, 138, 138, 0.28);
    }
    .jdb-super-ranking-item {
      font-weight: 600;
    }
    #jdb-super-ranking-page {
      --jdb-sr-muted: #67707c;
      --jdb-sr-surface: rgba(15, 23, 42, 0.04);
      --jdb-sr-login-bg: #ffffff;
      --jdb-sr-login-text: #1f2937;
      --jdb-sr-login-muted: #5f6b7a;
      --jdb-sr-border: rgba(15, 23, 42, 0.10);
      --jdb-sr-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
      --jdb-sr-error: #d92d20;
      margin-top: 18px;
    }
    #jdb-super-ranking-page[data-jdb-theme="dark"] {
      --jdb-sr-muted: #c7c7c7;
      --jdb-sr-surface: rgba(255, 255, 255, 0.06);
      --jdb-sr-login-bg: #1f1f1f;
      --jdb-sr-login-text: #e5e7eb;
      --jdb-sr-login-muted: #aaa;
      --jdb-sr-border: rgba(255, 255, 255, 0.12);
      --jdb-sr-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
      --jdb-sr-error: #ff8a8a;
    }
    #jdb-super-ranking-page .jdb-super-ranking-controls {
      margin-top: 18px;
      margin-bottom: 12px;
    }
    #jdb-super-ranking-page .jdb-super-ranking-controls-wrap {
      flex-wrap: wrap;
      gap: 6px;
    }
    #jdb-super-ranking-page .jdb-super-ranking-grid {
      margin-top: 10px;
    }
    #jdb-super-ranking-page .jdb-super-ranking-message {
      grid-column: 1 / -1;
      text-align: center;
      padding: 42px 18px;
      color: var(--jdb-sr-muted);
      background: var(--jdb-sr-surface);
      border-radius: 8px;
    }
    #jdb-super-ranking-page .jdb-super-ranking-message-error,
    #jdb-super-ranking-page .jdb-super-ranking-login-error {
      color: var(--jdb-sr-error);
    }
    #jdb-super-ranking-page .jdb-super-ranking-login {
      max-width: 440px;
      margin: 40px auto;
      padding: 26px;
      border-radius: 12px;
      color: var(--jdb-sr-login-text);
      background: var(--jdb-sr-login-bg);
      border: 1px solid var(--jdb-sr-border);
      box-shadow: var(--jdb-sr-shadow);
    }
    #jdb-super-ranking-page .jdb-super-ranking-login h3 {
      margin: 0 0 12px;
      font-size: 18px;
      font-weight: 800;
    }
    #jdb-super-ranking-page .jdb-super-ranking-login p {
      margin: 0 0 16px;
      color: var(--jdb-sr-login-muted);
      font-size: 13px;
      line-height: 1.6;
    }
    #jdb-super-ranking-page .jdb-super-ranking-login .input,
    #jdb-super-ranking-page .jdb-super-ranking-login .button,
    #jdb-super-ranking-page .jdb-super-ranking-login-error {
      width: 100%;
      margin-top: 10px;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

export function applySuperRankingNav(): boolean {
  const items = findRankingNavItems();
  if (items.length === 0) {
    rewriteNativeFc2Links();
    return false;
  }

  items.forEach((parent) => {
    const link = parent.querySelector<HTMLAnchorElement>(':scope > a.navbar-link, a.navbar-link');
    const dropdown = parent.querySelector<HTMLElement>('.navbar-dropdown');
    if (!link || !dropdown) return;

    parent.classList.add('jdb-super-ranking-nav');
    parent.dataset[ACTIVE_ATTR] = '1';
    preserveOriginalMarkup(link, dropdown);

    link.setAttribute('href', DEFAULT_RANKING_HREF);
    if (normalizeText(link.textContent) !== TITLE_TEXT) {
      link.innerHTML = `<span class="jdb-super-ranking-title">${TITLE_TEXT}</span>`;
    }
    link.dataset.jdbSuperRankingDone = '1';

    renderRankingDropdown(dropdown);
    bindNavbarClick(parent, link);
  });

  rewriteNativeFc2Links();
  return true;
}

export function initializeSuperRankingNav(hostname = window.location.hostname): void {
  if (!isSuperRankingSupportedHost(hostname)) return;
  activeSupportedHost = hostname;

  try {
    injectStyles();
    navApplied = applySuperRankingNav();
    lastFc2AnchorCount = null;
    rewriteNativeFc2Links();
    bindOutsideClick();
    bindRestoreListeners();

    // MPA 整页重载/关闭时断开 Observer 与监听，避免卸载期回调风暴（幂等挂接）
    if (!(window as any)[BEFORE_UNLOAD_KEY]) {
      const onBeforeUnload = () => {
        destroySuperRankingNav();
      };
      (window as any)[BEFORE_UNLOAD_KEY] = onBeforeUnload;
      window.addEventListener('beforeunload', onBeforeUnload);
    }
    void handleSuperRankingPage().catch((error) => {
      log('[SuperRankingNav] handle special page failed:', error);
    });

    const oldObserver = (window as any)[OBSERVER_KEY] as MutationObserver | undefined;
    oldObserver?.disconnect();

    const observer = new MutationObserver(() => {
      // 导航增强只跑一次（MPA 页内 navbar 静态）；未完成时继续等 DOM 就绪。
      if (!navApplied) {
        navApplied = applySuperRankingNav();
      }
      rewriteNativeFc2Links();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    (window as any)[OBSERVER_KEY] = observer;
  } catch (error) {
    log('[SuperRankingNav] initialize failed:', error);
  }
}

export function destroySuperRankingNav(): void {
  navApplied = false;
  lastFc2AnchorCount = null;
  const observer = (window as any)[OBSERVER_KEY] as MutationObserver | undefined;
  observer?.disconnect();
  delete (window as any)[OBSERVER_KEY];

  const outsideClick = (window as any)[OUTSIDE_CLICK_KEY] as ((event: MouseEvent) => void) | undefined;
  if (outsideClick) {
    document.removeEventListener('click', outsideClick, true);
    delete (window as any)[OUTSIDE_CLICK_KEY];
  }

  const restoreListener = (window as any)[RESTORE_LISTENER_KEY] as (() => void) | undefined;
  if (restoreListener) {
    restoreListener();
    delete (window as any)[RESTORE_LISTENER_KEY];
  }

  const beforeUnload = (window as any)[BEFORE_UNLOAD_KEY] as (() => void) | undefined;
  if (beforeUnload) {
    window.removeEventListener('beforeunload', beforeUnload);
    delete (window as any)[BEFORE_UNLOAD_KEY];
  }
  activeSupportedHost = '';

  document.getElementById(STYLE_ID)?.remove();
  unbindSpecialPageThemeObserver();
  document.getElementById(PAGE_ROOT_ID)?.remove();
  document.querySelectorAll<HTMLAnchorElement>('[data-jdb-super-ranking-original-fc2-href]').forEach((anchor) => {
    const originalHref = anchor.dataset[ORIGINAL_FC2_HREF_ATTR];
    if (originalHref) anchor.setAttribute('href', originalHref);
    else anchor.removeAttribute('href');
    delete anchor.dataset[ORIGINAL_FC2_HREF_ATTR];
  });
  document.querySelectorAll<HTMLElement>('.jdb-super-ranking-nav.is-active').forEach((nav) => {
    nav.classList.remove('is-active');
  });
  document.querySelectorAll<HTMLElement>('.jdb-super-ranking-nav').forEach((nav) => {
    const link = nav.querySelector<HTMLAnchorElement>(':scope > a.navbar-link, a.navbar-link');
    const dropdown = nav.querySelector<HTMLElement>('.navbar-dropdown');

    if (link) {
      const originalHref = link.dataset[ORIGINAL_LINK_HREF_ATTR];
      if (originalHref !== undefined) {
        if (originalHref) link.setAttribute('href', originalHref);
        else link.removeAttribute('href');
      }
      const originalHtml = link.dataset[ORIGINAL_LINK_HTML_ATTR];
      if (originalHtml !== undefined) {
        link.innerHTML = originalHtml;
      }
      delete link.dataset[ORIGINAL_LINK_HREF_ATTR];
      delete link.dataset[ORIGINAL_LINK_HTML_ATTR];
      delete link.dataset.jdbSuperRankingDone;
    }

    if (dropdown) {
      const originalDropdownHtml = dropdown.dataset[ORIGINAL_DROPDOWN_HTML_ATTR];
      if (originalDropdownHtml !== undefined) {
        dropdown.innerHTML = originalDropdownHtml;
      }
      delete dropdown.dataset[ORIGINAL_DROPDOWN_HTML_ATTR];
      delete dropdown.dataset.jdbSuperRankingItems;
    }

    delete nav.dataset[ACTIVE_ATTR];
    nav.classList.remove('jdb-super-ranking-nav');
  });
}
