/**
 * @file actorPenetrationRuntime.ts
 * @description 演员穿透运行时：按番号读取/请求详情 HTML，解析女性演员后渲染卡片演员行。
 * 依赖（缓存读写、快捷操作绑定、详情请求）均可注入，默认使用平台实现；
 * 任何失败都静默回退（卡片保持原状），不阻塞列表交互。
 * @module features/listEnhancement/actorPenetration
 */
import {
  readActorPenetrationCache,
  writeActorPenetrationFailure,
  writeActorPenetrationLoginRequired,
  writeActorPenetrationSuccess,
  type ActorPenetrationCacheResult,
  type ActorPenetrationCacheValue,
} from './actorPenetrationCache';
import { extractFemaleActors, parseDetailActors, type DetailActor } from './parseDetailActors';
import { BUILTIN_CATEGORY_DICTIONARY, parseDetailCategories } from '@javdb/video-category-dict';
import { removeActorRow, renderActorRow, type ActorLinkMark } from './renderActorRow';
import { bindActorQuickActionsToLink } from '../../actorEnhancement/actorQuickActionsManager';
import { countContentPerformanceEvent } from '../../../platform/tasks';

export interface ActorPenetrationDeps {
  logger?: (...args: unknown[]) => void;
  /** 快捷操作绑定（默认复用影片页的 actorQuickActionsManager）。 */
  bindQuickActions?: (link: HTMLAnchorElement) => void;
  /**
   * 演员名称标识查询（可选；仅当设置“演员名称标识”开启时由 manager 注入）。
   * 传入演员 id 与名称，同步返回应呈现的标识（着色/悬浮提示）；返回 undefined 表示无标识。
   * 必须为同步实现：渲染不等待网络/存储，异步预热与重放由 manager 负责。
   * 实现需自行保证幂等、可缓存，且不抛错。
   */
  getActorMark?: (actorId: string, actorName: string) => ActorLinkMark | undefined;
  /** 详情请求（默认同源 credentials:include fetch + 超时）。返回最终 URL 用于识别 302→登录页。 */
  fetchText?: (url: string) => Promise<ActorPenetrationFetchResult>;
  /** 读取缓存（默认 platform 缓存）。 */
  readCache?: (code: string) => Promise<ActorPenetrationCacheResult>;
  /** 写成功缓存（默认 7 天 TTL）。 */
  writeSuccess?: (code: string, value: ActorPenetrationCacheValue) => Promise<void>;
  /** 写失败缓存（默认 10 分钟 TTL，抑制重试）。 */
  writeFailure?: (code: string) => Promise<void>;
  /** 写「需登录」缓存（默认 1 小时 TTL，独立状态）。 */
  writeLoginRequired?: (code: string) => Promise<void>;
  /**
   * 演员行渲染完成回调（D-B4：穿透行出现真实演员 id 后，由 manager 触发该卡片的
   * 本地隐藏重决策；不传则无副作用）。
   */
  onActorsRendered?: (item: HTMLElement, actors: DetailActor[]) => void;
  /**
   * 类别解析结果回调（08-29-actor-passthrough-category-filter P1）：
   * 每次渲染（缓存命中或新鲜抓取）且缓存值携带 categories 时触发，
   * 由 manager 据此重放类别黑名单隐藏决策。categories 为 undefined（旧缓存）
   * 时不触发。实现需自行保证幂等（按 item 去重）。
   */
  onCategoriesResolved?: (item: HTMLElement, categories: string[]) => void;
  /** 详情请求超时（毫秒），默认 10s */
  timeoutMs?: number;
}

export interface ActorPenetrationTarget {
  item: HTMLElement;
  code: string;
  detailUrl: string;
}

/** 详情请求结果：html + 重定向后的最终 URL（识别 302→登录页）。 */
export interface ActorPenetrationFetchResult {
  html: string;
  finalUrl?: string;
}

/** fetch 成功后的解析四态（09-26-display-settings-audit B7：失败原因不再互相掩盖）。 */
type FetchParseOutcome =
  | { status: 'ok'; value: ActorPenetrationCacheValue }
  | { status: 'fetch-error' }     // 网络/超时/解析异常：写 10 分钟失败抑制（原行为）
  | { status: 'login-required' }  // 302→登录页：独立状态，1 小时抑制
  | { status: 'empty' };          // 详情页正常但 0 名女性演员：不写任何缓存（不抑制、不占重试预算）

/**
 * 识别「需登录」：优先看重定向后的最终 URL（真机口径：登录受限番 302 落 /login），
 * 兜底嗅探登录页 title（自定义 fetchText 未提供 finalUrl 时）。
 */
export function detectLoginRequired(finalUrl: string | undefined, html: string): boolean {
  if (finalUrl) {
    try {
      const pathname = new URL(finalUrl).pathname;
      if (/^\/(login|sign[-_]?in)(\/|$)/i.test(pathname)) return true;
    } catch {
      /* finalUrl 非绝对 URL 时走 html 兜底 */
    }
  }
  return /<title[^>]*>\s*(sign[\s-]?in|log\s?in)/i.test(html);
}

const MAX_ACTORS_RENDERED = 3;

export class ActorPenetrationRuntime {
  private readonly inFlight = new Set<string>();
  private readonly deps: ActorPenetrationDeps;
  private readonly timeoutMs: number;

  constructor(deps: ActorPenetrationDeps = {}) {
    this.deps = deps;
    this.timeoutMs = deps.timeoutMs ?? 10000;
  }

  /**
   * 处理一个卡片。若同一番号已在执行则跳过（幂等，防重复请求）。
   */
  async process(target: ActorPenetrationTarget): Promise<void> {
    const { item, code, detailUrl } = target;
    if (!code) return;
    if (this.inFlight.has(code)) return;
    this.inFlight.add(code);
    countContentPerformanceEvent('actorPenetration.start');
    try {
      if (!item.isConnected) return;

      const readCache = this.deps.readCache ?? readActorPenetrationCache;
      const cached = await readCache(code);
      if (cached.status === 'hit') {
        this.render(item, cached.value);
        countContentPerformanceEvent('actorPenetration.cacheHit');
        return;
      }
      if (cached.status === 'failed') {
        // 失败短缓存有效期内：抑制重试
        countContentPerformanceEvent('actorPenetration.failureSuppressed');
        return;
      }

      const outcome = await this.fetchAndParse(detailUrl);
      if (outcome.status === 'fetch-error') {
        await (this.deps.writeFailure ?? writeActorPenetrationFailure)(code);
        countContentPerformanceEvent('actorPenetration.failure');
        return;
      }
      if (outcome.status === 'login-required') {
        await (this.deps.writeLoginRequired ?? writeActorPenetrationLoginRequired)(code);
        countContentPerformanceEvent('actorPenetration.loginRequired');
        return;
      }
      if (outcome.status === 'empty') {
        // 无女性演员是稳定事实：不写失败抑制（原实现把 parse 0 人当失败，
        // 误写 10 分钟 failed 缓存，见 B7）；也不写成功空缓存，避免站点改版
        // 导致全部作品被空缓存锁 7 天。代价：每次访问重新请求一次（受可见性门控+并发限制）。
        countContentPerformanceEvent('actorPenetration.empty');
        return;
      }

      await (this.deps.writeSuccess ?? writeActorPenetrationSuccess)(code, outcome.value);
      if (item.isConnected) {
        this.render(item, outcome.value);
      }
      countContentPerformanceEvent('actorPenetration.success');
    } catch (error) {
      this.deps.logger?.('actorPenetration error:', error);
      countContentPerformanceEvent('actorPenetration.error');
    } finally {
      this.inFlight.delete(code);
    }
  }

  /** 重置运行时状态（如配置切换、页面销毁）。 */
  reset(): void {
    this.inFlight.clear();
  }

  /** 移除卡片的演员行（开关关闭 / 重新处理时调用）。 */
  clear(item: HTMLElement): void {
    removeActorRow(item);
  }

  private render(item: HTMLElement, value: ActorPenetrationCacheValue): void {
    const bind = this.deps.bindQuickActions ?? bindActorQuickActionsToLink;
    renderActorRow({
      item,
      actors: value.actors,
      bindQuickActions: link => bind(link),
      getActorMark: (id, name) => {
        try {
          return this.deps.getActorMark?.(id, name);
        } catch {
          return undefined;
        }
      },
    });
    if (this.deps.onActorsRendered) {
      try {
        this.deps.onActorsRendered(item, value.actors);
      } catch {
        /* 重决策失败不影响渲染主流程 */
      }
    }
    if (this.deps.onCategoriesResolved && Array.isArray(value.categories)) {
      try {
        this.deps.onCategoriesResolved(item, value.categories);
      } catch {
        /* 类别重决策失败不影响渲染主流程 */
      }
    }
  }

  private async fetchAndParse(url: string): Promise<FetchParseOutcome> {
    const fetchText = this.deps.fetchText ?? (async u => {
      const res = await fetch(u, { credentials: 'include' });
      const html = await res.text();
      return { html, finalUrl: res.url };
    });
    let result: ActorPenetrationFetchResult;
    try {
      result = await withTimeout(fetchText(url), this.timeoutMs);
    } catch {
      return { status: 'fetch-error' };
    }
    const html = result.html;
    if (!html) return { status: 'fetch-error' };

    // 登录受限优先识别：302→登录页的 html 没有演员面板，若先走 parse 会把
    // 「需登录」误判为「无演员」
    if (detectLoginRequired(result.finalUrl, html)) {
      return { status: 'login-required' };
    }

    let doc: Document;
    try {
      doc = new DOMParser().parseFromString(html, 'text/html');
    } catch {
      return { status: 'fetch-error' };
    }

    const female = extractFemaleActors(parseDetailActors(doc));
    // 同一次详情请求顺带解析类别面板（字典内条目，未知丢弃）——
    // 一次 fetch 同时产出 actors + categories，写缓存合并（P1）。
    let categories: string[] | undefined;
    try {
      // 字典按站点分组；当前扩展站点固定为字典 activeSite（P5 后台刷新会替换存储字典，届时再注入）。
      categories = parseDetailCategories(doc, BUILTIN_CATEGORY_DICTIONARY.activeSite);
    } catch {
      categories = undefined; // 类别解析失败不影响演员主流程
    }
    // 缓存最多保存 MAX_ACTORS_RENDERED + 1 个以计算 hasMore；渲染层再截断
    const clean = female.filter(a => a.name).slice(0, MAX_ACTORS_RENDERED + 1);
    if (clean.length === 0) return { status: 'empty' };
    return {
      status: 'ok',
      value: {
        actors: clean,
        hasMore: clean.length > MAX_ACTORS_RENDERED,
        fetchedAt: Date.now(),
        categories,
      },
    };
  }
}

export function createActorPenetrationRuntime(deps: ActorPenetrationDeps = {}): ActorPenetrationRuntime {
  return new ActorPenetrationRuntime(deps);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      v => {
        clearTimeout(t);
        resolve(v);
      },
      e => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
