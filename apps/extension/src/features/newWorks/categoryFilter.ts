/**
 * @file categoryFilter.ts
 * @description 新作品类别白名单（URL 侧）+ 黑名单（入库前剔除）纯函数
 * （08-29-actor-passthrough-category-filter P3）。
 *
 * 语义：
 * - 白名单：勾选=保留。t 码拼 ?t=，appliesToUrl 维度类别拼 ?cN=（多值逗号）；
 *   由 collector 在构建演员作品页 URL 时应用。
 * - 黑名单：入库前剔除。对候选作品解析详情页类别（先读演员穿透缓存，miss 才取详情页，
 *   计入请求限速），命中即丢弃；解析失败/未知一律保留（保守不丢片）。
 *   取详情页由调用方经 loadDetail 注入（collector 用隐藏标签页 + 页内采集：
 *   background SW 无 DOMParser，不能直接 fetch+解析）。
 *   缓存写回与列表侧穿透同口径（成功才写、有女演员才写、7 天 TTL），可互为预热。
 * @module features/newWorks
 */
import {
  BUILTIN_CATEGORY_DICTIONARY,
  CATEGORY_DIM_KEYS,
  categoriesFromRawPanels,
  findEntry,
  parseEntryKey,
  resolveEntryKey,
  type CategoryDictionary,
  type DimKey,
} from '@javdb/video-category-dict';
import {
  readActorPenetrationCache,
  writeActorPenetrationFailure,
  writeActorPenetrationLoginRequired,
  writeActorPenetrationSuccess,
  type ActorPenetrationCacheResult,
  type ActorPenetrationCacheValue,
} from '../listEnhancement/actorPenetration/actorPenetrationCache';
import {
  actorsFromRawPanels,
  extractFemaleActors,
  type DetailActor,
  type RawActorLink,
  type RawActorPanel,
} from '../listEnhancement/actorPenetration/parseDetailActors';

const DEFAULT_DICT = BUILTIN_CATEGORY_DICTIONARY;
const SITE = DEFAULT_DICT.activeSite;
const MAX_ACTORS_CACHED = 4; // 与列表侧穿透一致：最多存 3+1 以计算 hasMore

/** 详情页面板原始数据（页内采集器产出 = 类别面板 ∪ 演员面板所需字段）。 */
export interface RawDetailPanel extends RawActorPanel {
  /** 面板内所有 /tags?c 链接的 href 属性原文（保持页面顺序） */
  tagHrefs: string[];
}

/** 页内采集的详情页原始数据（SW 侧无 DOM，只能消费此形态）。 */
export interface RawDetailDocument {
  /** 页面最终 URL（302 后实际落点；登录墙判定用） */
  finalUrl?: string;
  panels: RawDetailPanel[];
}

/** 白名单值拆分结果（t 码 + 归一 entryKey）。 */
export interface NewWorksCategorySplit {
  t: string[];
  categoryKeys: string[];
  /** 字典外/无法识别的值（已丢弃，调用方告警） */
  dropped: string[];
}

/**
 * legacy「不限制(全选)」签名（批2 review-batch2 #1）：批2 改造前旧 UI 的
 * 「不限制（全选）」复选框会把 29 值（6 t 码 + 23 裸类别 id）整体写入
 * newWorksConfig.filters.categoryFilters；旧 collector 将其拼成单 ?t= OR 集合
 * （≈ 不限制）。批2 后 splitNewWorksFilterValues 会把该签名拆成 t 轴 +
 * c1/c4/c7 跨维度 AND，静默收窄扫描范围。
 *
 * 识别口径（精确 legacy 区分签名，新 UI 只会存 cN= 形 entryKey，不可能产生该签名）：
 * 恰含下列 6 t 码 + 23 裸 id 全集（顺序无关、无重复）且不含任何含 '=' 的 entryKey。
 * 仅白名单侧存在该 legacy 态——旧 UI 无黑名单（categoryBlackFilters 为批2 新增），
 * 故黑名单侧不做此判定。
 */
const LEGACY_UNLIMITED_T_CODES = ['s', 'p', 'd', 'c', '4k', 'uncensored'] as const;
const LEGACY_UNLIMITED_BARE_IDS = [
  '28', '17', '18', '37', '72', '14', '45', '68', '80', '110', '160', '190',
  '312', '330', '32', '26', '47', '48', '71', '135', '157', '200', '23',
] as const;

/** 判定白名单值是否为 legacy「不限制(全选)」全集签名 → 视为空（不限制）。 */
export function isLegacyUnlimitedCategoryValues(
  values: readonly string[] | null | undefined,
): boolean {
  if (!Array.isArray(values)) return false;
  if (values.length !== LEGACY_UNLIMITED_T_CODES.length + LEGACY_UNLIMITED_BARE_IDS.length) return false;
  const seen = new Set<string>();
  for (const raw of values) {
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (!v || v.includes('=')) return false; // 空值或 cN= 形 entryKey → 非 legacy 签名
    seen.add(v);
  }
  if (seen.size !== values.length) return false; // 重复值 → 非全集签名
  for (const code of LEGACY_UNLIMITED_T_CODES) if (!seen.has(code)) return false;
  for (const id of LEGACY_UNLIMITED_BARE_IDS) if (!seen.has(id)) return false;
  return true;
}

/**
 * 拆分新作品类别白名单勾选值：t 码（s/p/d/c/4k/uncensored）+ 类别 entryKey
 * （entryKey/裸数字 id 经字典归一，未知丢弃）。
 * legacy「不限制(全选)」29 值全集签名 → 视为空（不限制），collector 扫描与
 * UI 计数/展示共用该判定（见 isLegacyUnlimitedCategoryValues）。
 */
export function splitNewWorksFilterValues(
  values: readonly string[],
  dict: CategoryDictionary = DEFAULT_DICT,
): NewWorksCategorySplit {
  if (isLegacyUnlimitedCategoryValues(values)) {
    return { t: [], categoryKeys: [], dropped: [] };
  }
  const t: string[] = [];
  const seenT = new Set<string>();
  const categoryKeys: string[] = [];
  const seenC = new Set<string>();
  const dropped: string[] = [];
  for (const raw of values ?? []) {
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (!v) continue;
    if (v.length <= 8 && !v.includes('=') && /^[a-z0-9]+$/i.test(v) && isTCodeValue(v)) {
      if (!seenT.has(v)) {
        seenT.add(v);
        t.push(v);
      }
      continue;
    }
    const key = resolveEntryKey(dict, SITE, v);
    if (key) {
      if (!seenC.has(key)) {
        seenC.add(key);
        categoryKeys.push(key);
      }
    } else if (!dropped.includes(v)) {
      dropped.push(v);
    }
  }
  return { t, categoryKeys, dropped };
}

function isTCodeValue(v: string): boolean {
  // t 码固定集合（与 actorFilterTags basic/quality 组一致；此处不反向 import
  // dashboard 配置，避免 newWorks → dashboard 依赖方向）
  return ['s', 'p', 'd', 'c', '4k', 'uncensored'].includes(v);
}

/**
 * 组装演员作品页 URL 过滤参数：?t= + 仅 appliesToUrl 维度的 ?cN=（多值逗号）。
 */
export interface CategoryUrlParams {
  t: string[];
  /** 维度 → id 列表（仅 appliesToUrl 维度，按 CATEGORY_DIM_KEYS 序） */
  byDim: Partial<Record<DimKey, string[]>>;
  /** 字典外值（丢弃） */
  dropped: string[];
  /** 字典内但 appliesToUrl=false（不拼 URL，仅供黑名单/展示） */
  notUrlAppliable: string[];
}

export function buildCategoryUrlParams(
  values: readonly string[],
  dict: CategoryDictionary = DEFAULT_DICT,
): CategoryUrlParams {
  const { t, categoryKeys, dropped } = splitNewWorksFilterValues(values, dict);
  const byDim: Partial<Record<DimKey, string[]>> = {};
  const notUrlAppliable: string[] = [];
  for (const key of categoryKeys) {
    const parsed = parseEntryKey(key)!;
    const entry = findEntry(dict, SITE, parsed.dim, parsed.id);
    if (!entry) continue; // 理论上不会（split 已校验）
    if (entry.appliesToUrl !== true) {
      notUrlAppliable.push(key);
      continue;
    }
    (byDim[parsed.dim] ??= []).push(parsed.id);
  }
  return { t, byDim, dropped, notUrlAppliable };
}

/**
 * 归一黑名单值 → entryKey 集合（仅字典类别；t 码/未知丢弃并列出，调用方告警）。
 */
export function normalizeCategoryBlackValues(
  values: readonly string[],
  dict: CategoryDictionary = DEFAULT_DICT,
): { keys: Set<string>; dropped: string[] } {
  const keys = new Set<string>();
  const dropped: string[] = [];
  for (const raw of values ?? []) {
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (!v) continue;
    const key = resolveEntryKey(dict, SITE, v);
    if (key) {
      keys.add(key);
    } else if (!dropped.includes(v)) {
      dropped.push(v);
    }
  }
  return { keys, dropped };
}

/** 登录页嗅探（与列表侧 detectLoginRequired 同口径；独立实现避免拖入 content 侧模块）。 */
export function looksLikeLoginPage(finalUrl: string | undefined, html: string = ''): boolean {
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

export interface CategoryBlackFilterDeps {
  /** 读演员穿透缓存（默认平台实现） */
  readCache?: (code: string) => Promise<ActorPenetrationCacheResult>;
  /** 写穿透成功缓存（预热/回填；默认平台实现） */
  writeSuccess?: (code: string, value: ActorPenetrationCacheValue) => Promise<void>;
  /** 写失败抑制缓存（加载失败；默认平台实现，与列表侧同口径 10 分钟） */
  writeFailure?: (code: string) => Promise<void>;
  /** 写「需登录」缓存（详情 302 登录页；默认平台实现，与列表侧同口径 1 小时） */
  writeLoginRequired?: (code: string) => Promise<void>;
  /**
   * 取详情页原始面板数据（collector 注入隐藏标签页 + 页内采集实现）。
   * null = 加载失败（超时/脚本错误/非登录跳转）。
   * 默认无实现（SW 不能直接取页）→ 保守保留。
   */
  loadDetail?: (url: string) => Promise<RawDetailDocument | null>;
  /** 每次详情请求前的限速延迟（默认 3s；collector 传自身 delay 统一节拍） */
  delay?: (ms: number) => Promise<void>;
  /** 由 javdbId 构建详情 URL（默认 https://javdb.com/v/<id>；collector 注入 buildJavDBUrl 走当前线路） */
  buildDetailUrl?: (javdbId: string) => string | Promise<string>;
  logger?: (...args: unknown[]) => void;
  /** 单片解析结果（供测试/排障） */
  onDecision?: (work: any, categories: string[] | null, removed: boolean) => void;
}

export interface CategoryBlackFilterResult {
  kept: any[];
  removed: number;
  removedIds: string[];
}

const defaultDelay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 入库前类别黑名单剔除。
 * 保守原则：缓存命中带 categories → 直接判；缓存无 categories（旧值）或 miss → fetch 详情；
 * fetch/解析失败、登录受限、缓存失败抑制期内 → 保留不丢。
 */
export async function applyCategoryBlackFilter(
  works: any[],
  blackValues: readonly string[],
  deps: CategoryBlackFilterDeps = {},
  dict: CategoryDictionary = DEFAULT_DICT,
): Promise<CategoryBlackFilterResult> {
  const logger = deps.logger;
  const { keys, dropped } = normalizeCategoryBlackValues(blackValues, dict);
  if (dropped.length > 0) {
    logger?.('[CS] 类别黑名单含不可识别值（忽略）:', dropped);
  }
  if (keys.size === 0) {
    return { kept: works, removed: 0, removedIds: [] };
  }

  const kept: any[] = [];
  const removedIds: string[] = [];
  for (const work of works) {
    const code = String(work?.id ?? '').trim();
    const javdbId = String(work?.javdbId ?? '').trim();
    if (!code) {
      kept.push(work);
      continue;
    }
    const categories = await resolveWorkCategories(code, javdbId, deps, dict, logger);
    if (categories === null) {
      // 无法确定类别 → 保守保留
      deps.onDecision?.(work, null, false);
      kept.push(work);
      continue;
    }
    const hit = categories.some((c) => keys.has(c));
    deps.onDecision?.(work, categories, hit);
    if (hit) {
      removedIds.push(String(work.id));
      logger?.(`[CS] 作品 ${work.id} (${work?.title ?? ''}) -> 类别黑名单剔除`);
    } else {
      kept.push(work);
    }
  }
  return { kept, removed: removedIds.length, removedIds };
}

/**
 * 解析单片类别（null = 无法确定，保守保留）。
 * 命中缓存直接返回；旧缓存无 categories 或 miss → fetch 详情并解析；
 * 成功时写回穿透缓存（有女演员才写，与列表侧同口径；旧缓存回填合并保留原 actors）。
 */
async function resolveWorkCategories(
  code: string,
  javdbId: string,
  deps: CategoryBlackFilterDeps,
  dict: CategoryDictionary,
  logger?: (...args: unknown[]) => void,
): Promise<string[] | null> {
  const readCache = deps.readCache ?? readActorPenetrationCache;
  let cached: ActorPenetrationCacheResult;
  try {
    cached = await readCache(code);
  } catch {
    cached = { status: 'miss' };
  }
  if (cached.status === 'hit' && Array.isArray(cached.value.categories)) {
    return cached.value.categories;
  }
  if (cached.status === 'failed') {
    // 失败抑制期（含登录受限）内不再重试，保守保留
    logger?.(`[CS] 作品 ${code} 穿透缓存处于失败抑制期，类别黑名单跳过（保留）`);
    return null;
  }
  if (!javdbId) return null;

  const buildDetailUrl = deps.buildDetailUrl ?? ((id: string) => `https://javdb.com/v/${id}`);
  let url: string;
  try {
    url = await Promise.resolve(buildDetailUrl(javdbId));
  } catch {
    return null;
  }

  const delay = deps.delay ?? defaultDelay;
  await delay(3000).catch(() => undefined); // 限速：每次详情请求前等待

  const loadDetail = deps.loadDetail;
  if (!loadDetail) {
    // SW 无 DOM：未注入页内采集实现时无法取详情 → 保守保留
    logger?.(`[CS] 作品 ${code} 无 loadDetail 实现（SW 上下文无法直接取详情），类别黑名单跳过（保留）`);
    return null;
  }
  let raw: RawDetailDocument | null;
  try {
    raw = await loadDetail(url);
  } catch {
    raw = null;
  }
  if (!raw) {
    // 加载失败（超时/脚本错误/非登录跳转）：写 10 分钟失败抑制（与列表侧同口径），
    // 避免每次检查重复开标签页；本作品保守保留
    await (deps.writeFailure ?? writeActorPenetrationFailure)(code).catch(() => undefined);
    logger?.(`[CS] 作品 ${code} 详情页加载失败，类别黑名单跳过（保留）`);
    return null;
  }
  if (looksLikeLoginPage(raw.finalUrl)) {
    // 302 到登录页：独立「需登录」状态（1 小时），与列表侧共享缓存口径
    await (deps.writeLoginRequired ?? writeActorPenetrationLoginRequired)(code).catch(() => undefined);
    logger?.(`[CS] 作品 ${code} 详情 302 到登录页，类别黑名单跳过（保留）`);
    return null;
  }

  // href 解析基址：finalUrl 实际落点 origin（详情页 href 为站点相对 /tags?cN=ID）
  let base = dict.sources[SITE]?.base || 'https://javdb.com';
  if (raw.finalUrl) {
    try {
      const u = new URL(raw.finalUrl);
      if (u.protocol === 'http:' || u.protocol === 'https:') base = u.origin;
    } catch {
      /* 保留字典基址 */
    }
  }

  let categories: string[];
  try {
    categories = categoriesFromRawPanels(raw.panels, dict.activeSite, dict, base);
  } catch {
    return null;
  }

  // 缓存预热/回填：与列表侧穿透同口径（有女演员才写成功缓存，避免 7 天空锁）
  let female: DetailActor[] = [];
  try {
    female = extractFemaleActors(actorsFromRawPanels(raw.panels, base)).filter((a) => a?.name);
  } catch {
    female = [];
  }
  const writeSuccess = deps.writeSuccess ?? writeActorPenetrationSuccess;
  if (female.length > 0) {
    if (cached.status === 'hit') {
      // 旧缓存回填：合并写回（保留原 actors，仅补 categories）
      await writeSuccess(code, { ...cached.value, fetchedAt: Date.now(), categories }).catch(() => undefined);
    } else {
      const clean = female.slice(0, MAX_ACTORS_CACHED);
      await writeSuccess(code, {
        actors: clean,
        hasMore: female.length > MAX_ACTORS_CACHED - 1,
        fetchedAt: Date.now(),
        categories,
      }).catch(() => undefined);
    }
  }
  return categories;
}

/** 供 collector/单测：维度键有序列表（拼 URL 用）。 */
export const CATEGORY_URL_DIM_KEYS: readonly DimKey[] = CATEGORY_DIM_KEYS;
