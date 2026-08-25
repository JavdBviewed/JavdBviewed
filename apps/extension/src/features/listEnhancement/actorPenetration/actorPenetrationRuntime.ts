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
  writeActorPenetrationSuccess,
  type ActorPenetrationCacheResult,
  type ActorPenetrationCacheValue,
} from './actorPenetrationCache';
import { extractFemaleActors, parseDetailActors } from './parseDetailActors';
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
  /** 详情 HTML 请求（默认同源 credentials:include fetch + 超时）。 */
  fetchText?: (url: string) => Promise<string>;
  /** 读取缓存（默认 platform 缓存）。 */
  readCache?: (code: string) => Promise<ActorPenetrationCacheResult>;
  /** 写成功缓存（默认 7 天 TTL）。 */
  writeSuccess?: (code: string, value: ActorPenetrationCacheValue) => Promise<void>;
  /** 写失败缓存（默认 10 分钟 TTL，抑制重试）。 */
  writeFailure?: (code: string) => Promise<void>;
  /** 详情请求超时（毫秒），默认 10s */
  timeoutMs?: number;
}

export interface ActorPenetrationTarget {
  item: HTMLElement;
  code: string;
  detailUrl: string;
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

      const value = await this.fetchAndParse(detailUrl);
      if (value === null) {
        await (this.deps.writeFailure ?? writeActorPenetrationFailure)(code);
        countContentPerformanceEvent('actorPenetration.failure');
        return;
      }

      await (this.deps.writeSuccess ?? writeActorPenetrationSuccess)(code, value);
      if (item.isConnected) {
        this.render(item, value);
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
  }

  private async fetchAndParse(url: string): Promise<ActorPenetrationCacheValue | null> {
    const fetchText = this.deps.fetchText ?? (async u => (await fetch(u, { credentials: 'include' })).text());
    let html: string;
    try {
      html = await withTimeout(fetchText(url), this.timeoutMs);
    } catch {
      return null;
    }
    if (!html) return null;

    let doc: Document;
    try {
      doc = new DOMParser().parseFromString(html, 'text/html');
    } catch {
      return null;
    }

    const female = extractFemaleActors(parseDetailActors(doc));
    // 缓存最多保存 MAX_ACTORS_RENDERED + 1 个以计算 hasMore；渲染层再截断
    const clean = female.filter(a => a.name).slice(0, MAX_ACTORS_RENDERED + 1);
    if (clean.length === 0) return null;
    return {
      actors: clean,
      hasMore: clean.length > MAX_ACTORS_RENDERED,
      fetchedAt: Date.now(),
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
