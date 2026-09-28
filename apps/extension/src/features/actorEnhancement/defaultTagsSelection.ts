/**
 * @file defaultTagsSelection.ts
 * @description 演员页「默认过滤条件」归一/拆分/标签名/URL 参数纯函数
 * （08-29-actor-passthrough-category-filter P2）。
 *
 * 存储形迁移：
 * - 旧：string[]（t 码 + 裸数字类别 id 混排，来自 2024 旧字典）
 * - 新：{ t: string[]; categories: string[] }（categories 为字典 entryKey `cN=ID`）
 * 所有消费方（bootstrap 注入 / 设置模型 / 遗留读路径）统一走 normalizeActorDefaultTags，
 * 保证三处读路径与 content 行为不漂移。
 * @module features/actorEnhancement
 */
import {
  BUILTIN_CATEGORY_DICTIONARY,
  findEntry,
  getDimension,
  parseEntryKey,
  resolveEntryKey,
  type CategoryDictionary,
  type DimKey,
} from '@javdb/video-category-dict';
import { ACTOR_FILTER_TAGS, getDefaultTags } from '../../dashboard/config/actorFilterTags';

/** 演员默认过滤条件规范形（新存储形）。 */
export interface ActorDefaultTags {
  /** t 码白名单（s/p/d/c/4k/uncensored） */
  t: string[];
  /** 类别白名单（字典 entryKey `cN=ID`） */
  categories: string[];
}

/** 归一结果（附带被丢弃的未知值，供 UI/日志提示一次）。 */
export interface ActorDefaultTagsResult extends ActorDefaultTags {
  /** 无法识别的旧值（已从结果中剔除） */
  dropped: string[];
}

const DEFAULT_DICT = BUILTIN_CATEGORY_DICTIONARY;
const SITE = BUILTIN_CATEGORY_DICTIONARY.activeSite;

/** t 码全集：basic + quality 两组（不是类别维度，不走 ?cN=）。 */
export const ACTOR_T_TAG_CODES: readonly string[] = ACTOR_FILTER_TAGS.filter(
  (tag) => tag.group === 'basic' || tag.group === 'quality',
).map((tag) => tag.value);

const T_CODE_SET: ReadonlySet<string> = new Set(ACTOR_T_TAG_CODES);

function isKnownTCode(value: string, dict: CategoryDictionary): boolean {
  void dict;
  return T_CODE_SET.has(value);
}

/**
 * 归一存储值 → { t, categories, dropped }。
 * - 数组（旧形）：逐项分类——t 码 → t；entryKey/裸数字 id 且字典内 → categories；其余丢弃
 * - 对象（新形）：净化 t/categories 两数组（同规则）
 * - 缺失/非法：默认 { t: getDefaultTags(), categories: [] }（对齐旧 bootstrap `|| ['s','d']`）
 */
export function normalizeActorDefaultTags(
  raw: unknown,
  dict: CategoryDictionary = DEFAULT_DICT,
): ActorDefaultTagsResult {
  const result: ActorDefaultTagsResult = { t: [], categories: [], dropped: [] };
  const seenT = new Set<string>();
  const seenC = new Set<string>();

  const push = (value: unknown): void => {
    const v = typeof value === 'string' ? value.trim() : '';
    if (!v) return;
    if (isKnownTCode(v, dict)) {
      if (!seenT.has(v)) {
        seenT.add(v);
        result.t.push(v);
      }
      return;
    }
    const key = resolveEntryKey(dict, SITE, v);
    if (key && !seenC.has(key)) {
      seenC.add(key);
      result.categories.push(key);
      return;
    }
    if (!result.dropped.includes(v)) result.dropped.push(v);
  };

  if (Array.isArray(raw)) {
    raw.forEach(push);
    return result;
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.t)) obj.t.forEach(push);
    if (Array.isArray(obj.categories)) obj.categories.forEach(push);
    return result;
  }
  // 缺失/非法 → 默认值
  return { t: [...getDefaultTags()], categories: [], dropped: [] };
}

/**
 * 拆分 UI 勾选值（遗留写路径用）：输入勾选的 value 列表，输出 t 码与类别 entryKey 两组。
 * 与 normalizeActorDefaultTags 数组分支同规则，单列函数以便语义清晰。
 */
export function splitTagValues(
  values: readonly unknown[],
  dict: CategoryDictionary = DEFAULT_DICT,
): ActorDefaultTagsResult {
  return normalizeActorDefaultTags(values, dict);
}

/** 取 t 码/类别 entryKey/裸数字 id 的显示名（未知原样返回）。 */
export function actorTagOptionLabel(
  value: string,
  dict: CategoryDictionary = DEFAULT_DICT,
): string {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) return v;
  const fromTags = ACTOR_FILTER_TAGS.find((tag) => tag.value === v);
  if (fromTags) return fromTags.label;
  const parsed = parseEntryKey(v);
  if (parsed) {
    const entry = findEntry(dict, SITE, parsed.dim, parsed.id);
    if (entry) return entry.label;
    const dim = getDimension(dict, SITE, parsed.dim);
    return dim ? `${dim.label}·${parsed.id}` : v;
  }
  const key = resolveEntryKey(dict, SITE, v);
  if (key) {
    const p = parseEntryKey(key)!;
    return findEntry(dict, SITE, p.dim, p.id)?.label ?? v;
  }
  return v;
}

/**
 * 组装演员页 URL 过滤参数（纯函数，供 manager 导航与单测）。
 * - t 码过 T_CODE_SET 校验后拼 ?t=（多值逗号）
 * - 类别仅 appliesToUrl===true 维度拼 ?cN=（多值逗号）；未验证维度进 excluded（只记录不拼 URL）
 */
export interface ActorCategoryUrlParams {
  t: string[];
  /** 按维度分组的 id 列表（仅 appliesToUrl 维度） */
  byDim: Partial<Record<DimKey, string[]>>;
  /** 未拼入 URL 的类别值（未验证维度或字典外） */
  excluded: string[];
}

export function buildActorCategoryUrlParams(
  tCodes: readonly string[],
  categoryKeys: readonly string[],
  dict: CategoryDictionary = DEFAULT_DICT,
): ActorCategoryUrlParams {
  const t: string[] = [];
  const seenT = new Set<string>();
  for (const raw of tCodes) {
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (v && T_CODE_SET.has(v) && !seenT.has(v)) {
      seenT.add(v);
      t.push(v);
    }
  }

  const byDim: Partial<Record<DimKey, string[]>> = {};
  const excluded: string[] = [];
  const seenKey = new Set<string>();
  for (const raw of categoryKeys) {
    const key = resolveEntryKey(dict, SITE, String(raw ?? ''));
    if (!key) {
      if (raw && !excluded.includes(String(raw))) excluded.push(String(raw));
      continue;
    }
    if (seenKey.has(key)) continue;
    seenKey.add(key);
    const parsed = parseEntryKey(key)!;
    const entry = findEntry(dict, SITE, parsed.dim, parsed.id);
    if (!entry || entry.appliesToUrl !== true) {
      excluded.push(key);
      continue;
    }
    (byDim[parsed.dim] ??= []).push(parsed.id);
  }
  return { t, byDim, excluded };
}
