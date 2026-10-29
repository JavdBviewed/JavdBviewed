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
  writeActorPenetrationRateLimited,
  writeActorPenetrationSuccess,
  type ActorPenetrationCacheResult,
  type ActorPenetrationCacheValue,
} from './actorPenetrationCache';
import { extractFemaleActors, parseDetailActors, type DetailActor } from './parseDetailActors';
import { BUILTIN_CATEGORY_DICTIONARY, parseDetailCategories } from '@javdb/video-category-dict';
import { ACTOR_ROW_MAX_VISIBLE, removeActorRow, renderActorRow, renderActorRowPending, ROW_CONTAINER_CLASS, type ActorLinkMark } from './renderActorRow';
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
   * 写「限流」缓存（默认 60 秒 TTL，F3）：429/503 是瞬态，短抑制 + 到期可重试。
   * 写入 failed 形态 → 既有 read 路径按 failed 自动抑制，零读侧改动。
   */
  writeRateLimited?: (code: string) => Promise<void>;
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
  /**
   * 详情请求并发上限（R2 降频，默认 2）：多页连滚时峰值 30+ 并发会触发源站 429 风暴
   * （真机实测 429 占比 25-32%）；上限 2 + pop 时刻视窗优先级排序。可注入便于测试。
   */
  maxConcurrency?: number;
  /** 视口高度（R2 pop 时刻视窗优先级用；默认 window.innerHeight）。 */
  getViewportHeight?: () => number;
}

export interface ActorPenetrationTarget {
  item: HTMLElement;
  code: string;
  detailUrl: string;
}

/** 详情请求结果：html + 重定向后的最终 URL（识别 302→登录页）+ 可选 HTTP 状态（F2 分类用）。 */
export interface ActorPenetrationFetchResult {
  html: string;
  finalUrl?: string;
  /** HTTP 状态码（可选）：默认实现返回 res.status；自定义 fetchText 未返回时走旧语义。 */
  status?: number;
}

/**
 * fetch 成功后的解析五态（09-26-display-settings-audit B7 三态分离基础上，
 * 10-30-ext-actor-penetration-paging RC-B 增补 rate-limited：429 body 不再被误判 empty）。
 */
type FetchParseOutcome =
  | { status: 'ok'; value: ActorPenetrationCacheValue }
  | { status: 'fetch-error' }     // 网络/超时/解析异常/非限流非 2xx：写 10 分钟失败抑制（原行为）
  | { status: 'login-required' }  // 302→登录页：独立状态，1 小时抑制
  | { status: 'rate-limited' }    // 429/503 限流：保留好行 + 60 秒回退抑制（F3）
  | { status: 'empty' };          // 详情页正常但 0 名女性演员：不写任何缓存（不抑制、不占重试预算）

/**
 * 视窗优先级（R2 纯函数，pop 时刻按实时 rect 计算）：
 * 0=严格在视口内（优先取队列），1=视窗外（含缓冲带/已划走）。小值优先，平手按入队序 FIFO。
 */
export function computeViewportPriority(rectTop: number, rectBottom: number, viewportHeight: number): 0 | 1 {
  return rectTop >= 0 && rectBottom <= viewportHeight ? 0 : 1;
}

interface QueuedFetchEntry {
  work: ActorPenetrationTarget;
  seq: number;
  resolve: () => void;
}

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


export class ActorPenetrationRuntime {
  private readonly inFlight = new Set<string>();
  private readonly deps: ActorPenetrationDeps;
  private readonly timeoutMs: number;
  // R2：有界 fetch 队列（并发上限 + pop 时刻视窗优先级）
  private readonly maxConcurrency: number;
  private readonly viewportHeightOf: () => number;
  private activeFetches = 0;
  private fetchSeq = 0;
  private fetchQueue: QueuedFetchEntry[] = [];

  constructor(deps: ActorPenetrationDeps = {}) {
    this.deps = deps;
    this.timeoutMs = deps.timeoutMs ?? 10000;
    this.maxConcurrency = Math.max(1, deps.maxConcurrency ?? 2);
    this.viewportHeightOf = deps.getViewportHeight ?? (() => (typeof window === 'undefined' ? 0 : window.innerHeight));
  }

  /**
   * 处理一个卡片。若同一番号已在执行则跳过（幂等，防重复请求）。
   */
  async process(target: ActorPenetrationTarget): Promise<void> {
    const { item, code } = target;
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
        // 失败短缓存有效期内：抑制重试（含 60s 限流抑制，read 路径统一按 failed 处理）
        countContentPerformanceEvent('actorPenetration.failureSuppressed');
        return;
      }

      // R2：fetch 阶段进有界队列（并发上限 + pop 时刻视窗优先级）；
      // pending 行在真正取到槽位执行时再插（排队中的卡片不显示转圈）。
      await this.enqueueOrRunFetch(target);
    } catch (error) {
      this.deps.logger?.('actorPenetration error:', error);
      if (item.isConnected) removeActorRow(item);
      countContentPerformanceEvent('actorPenetration.error');
    } finally {
      this.inFlight.delete(code);
    }
  }

  /** 队列入口：有空位直接执行，否则排队（等待 resolve = 工作完成或 reset 作废）。 */
  private enqueueOrRunFetch(target: ActorPenetrationTarget): Promise<void> {
    const seq = this.fetchSeq;
    this.fetchSeq += 1;
    return new Promise<void>(resolve => {
      const entry: QueuedFetchEntry = { work: target, seq, resolve };
      if (this.activeFetches < this.maxConcurrency) {
        this.runFetchWork(entry);
      } else {
        this.fetchQueue.push(entry);
      }
    });
  }

  private runFetchWork(entry: QueuedFetchEntry): void {
    this.activeFetches += 1;
    void (async () => {
      try {
        await this.performFetchPhase(entry.work);
      } catch (error) {
        this.deps.logger?.('actorPenetration error:', error);
        if (entry.work.item.isConnected) removeActorRow(entry.work.item);
        countContentPerformanceEvent('actorPenetration.error');
      } finally {
        this.activeFetches = Math.max(0, this.activeFetches - 1);
        entry.resolve();
        this.pumpFetchQueue();
      }
    })();
  }

  /** 空位腾出时补队列：按（pop 时刻实时视窗优先级，入队序 FIFO 平手）选下一个。 */
  private pumpFetchQueue(): void {
    while (this.activeFetches < this.maxConcurrency && this.fetchQueue.length > 0) {
      const viewportHeight = this.viewportHeightOf();
      const priorityOf = (work: ActorPenetrationTarget): 0 | 1 => {
        const rect = work.item.getBoundingClientRect();
        return computeViewportPriority(rect.top, rect.bottom, viewportHeight);
      };
      let bestIndex = 0;
      for (let i = 1; i < this.fetchQueue.length; i += 1) {
        const pCandidate = priorityOf(this.fetchQueue[i].work);
        const pCurrent = priorityOf(this.fetchQueue[bestIndex].work);
        if (pCandidate < pCurrent || (pCandidate === pCurrent && this.fetchQueue[i].seq < this.fetchQueue[bestIndex].seq)) {
          bestIndex = i;
        }
      }
      const [next] = this.fetchQueue.splice(bestIndex, 1);
      this.runFetchWork(next);
    }
  }

  /**
   * fetch 阶段（原 process 内联逻辑抽出，语义不变 + F2/F3）：
   * 获取期视觉反馈：fetch 路径先插「女演员：」转圈占位行（缓存命中/失败抑制已提前
   * return，不会闪烁）；成功后 render() 内部先 removeActorRow 再重建正式行覆盖，
   * 失败/需登录/空/异常分支统一清理，避免占位残留。
   */
  private async performFetchPhase(target: ActorPenetrationTarget): Promise<void> {
    const { item, code, detailUrl } = target;

    if (item.isConnected) {
      renderActorRowPending(item);
    }

    const outcome = await this.fetchAndParse(detailUrl);
    if (outcome.status === 'fetch-error') {
      if (item.isConnected) removeActorRow(item);
      await (this.deps.writeFailure ?? writeActorPenetrationFailure)(code);
      countContentPerformanceEvent('actorPenetration.failure');
      return;
    }
    if (outcome.status === 'login-required') {
      if (item.isConnected) removeActorRow(item);
      await (this.deps.writeLoginRequired ?? writeActorPenetrationLoginRequired)(code);
      countContentPerformanceEvent('actorPenetration.loginRequired');
      return;
    }
    if (outcome.status === 'rate-limited') {
      // F3：429/503 是瞬态而非「无数据」——保留已有正式行（好行），
      // 仅清本次获取插入的 pending 行（带 spinner）；写 60s 回退抑制防风暴。
      if (item.isConnected) {
        const row = item.querySelector(`.${ROW_CONTAINER_CLASS}`);
        if (row && row.querySelector('.x-ap-actor-row-spinner')) removeActorRow(item);
      }
      await (this.deps.writeRateLimited ?? writeActorPenetrationRateLimited)(code);
      countContentPerformanceEvent('actorPenetration.rateLimited');
      return;
    }
    if (outcome.status === 'empty') {
      if (item.isConnected) removeActorRow(item);
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
  }

  /** 重置运行时状态（如配置切换、页面销毁）。 */
  reset(): void {
    this.inFlight.clear();
    // R2：排队中的 fetch 任务作废（不发起请求）；release 对应 process() promise 防悬挂。
    // 在途任务不取消（与既有 inFlight 语义一致），其 finally 正常回收计数。
    const queued = this.fetchQueue;
    this.fetchQueue = [];
    queued.forEach(entry => entry.resolve());
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
      return { html, finalUrl: res.url, status: res.status };
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

    // F2：HTTP 状态分类（login 判定之后、parse 之前）。429 body 没有演员面板，
    // 旧实现解析 0 人误判 'empty'（删已有行 + 不写缓存 → 重试风暴）；
    // 自定义 fetchText 未提供 status 时跳过本步（旧语义兼容）。
    const httpStatus = result.status;
    if (httpStatus !== undefined) {
      if (httpStatus === 429 || httpStatus === 503) return { status: 'rate-limited' };
      if (httpStatus < 200 || httpStatus >= 300) return { status: 'fetch-error' };
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
    // 保存全量有姓名女演员：行支持「点击展开全部」（09-29-actor-penetration-expand），
    // 且演员过滤判定（onActorsRendered→rehide）消费同一列表——截断会让第 4 位之后
    // 的演员既不可见也不可命中。hasMore 保留「超过 3」原语义（缓存值字段不变，兼容旧缓存）。
    const clean = female.filter(a => a.name);
    if (clean.length === 0) return { status: 'empty' };
    return {
      status: 'ok',
      value: {
        actors: clean,
        hasMore: clean.length > ACTOR_ROW_MAX_VISIBLE,
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
