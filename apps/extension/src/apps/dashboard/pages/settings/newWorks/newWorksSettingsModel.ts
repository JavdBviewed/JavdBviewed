/**
 * @file newWorksSettingsModel.ts
 * @description 新作品设置纯数据模型：默认值、config↔表单映射、校验、类别面板数据
 *
 * 口径说明：
 * - 存储键 new_works_config 的对象形状零变化（读写经 newWorksManager，零迁移）；
 * - 白名单勾选值格式与旧 configModal 逐字节同构：字母 t 码（ACTOR_FILTER_TAGS
 *   basic/quality）+ 字典 entryKey（如 c2=48、c4=17），落盘顺序=规范渲染序；
 * - 运行时契约（splitNewWorksFilterValues/deriveActorScanInputs 等）零改动。
 * @module apps/dashboard/pages/settings/newWorks
 */
import { BUILTIN_CATEGORY_DICTIONARY, entryKey, type DimKey } from '@javdb/video-category-dict';
import type { NewWorksGlobalConfig } from '../../../../../types';
import { ACTOR_FILTER_TAGS, type ActorFilterTag } from '../../../../../dashboard/config/actorFilterTags';
import {
  ACTOR_SCAN_UNION_MAX_CATEGORIES,
  deriveActorScanInputs,
  normalizeCategoryBlackValues,
  splitNewWorksFilterValues,
} from '../../../../../features/newWorks/categoryFilter';

/** 新作品设置表单状态（数字字段恒为 number：空输入不回写，保留旧值） */
export type NewWorksSettingsFormState = {
  autoCheckEnabled: boolean;
  checkInterval: number;
  requestInterval: number;
  concurrency: number;
  showActorPageScanButton: boolean;
  excludeViewed: boolean;
  excludeBrowsed: boolean;
  excludeWant: boolean;
  excludeAR: boolean;
  dateRange: number;
  applyContentFilter: boolean;
  autoCleanup: boolean;
  cleanupDays: number;
  /** 类别白名单勾选集（t 码 + 字典 entryKey；空=不限制） */
  whitelistValues: string[];
  /** 类别黑名单勾选集（仅字典 entryKey；入库前剔除） */
  blacklistValues: string[];
};

/** 默认表单（与 utils/config.ts DEFAULT_NEW_WORKS_CONFIG 同值） */
export const DEFAULT_NEW_WORKS_SETTINGS_FORM: NewWorksSettingsFormState = {
  autoCheckEnabled: false,
  checkInterval: 24,
  requestInterval: 3,
  concurrency: 1,
  showActorPageScanButton: false,
  excludeViewed: true,
  excludeBrowsed: true,
  excludeWant: false,
  excludeAR: false,
  dateRange: 3,
  applyContentFilter: false,
  autoCleanup: true,
  cleanupDays: 30,
  whitelistValues: [],
  blacklistValues: [],
};

/** 白名单「基础过滤」t 码（与旧 configModal 同口径：basic + quality 6 项） */
export function getNewWorksWhitelistTags(): ActorFilterTag[] {
  return ACTOR_FILTER_TAGS.filter((tag) => tag.group === 'basic' || tag.group === 'quality');
}

/** 类别维度分组（与字典 dimensionOrder 一致；appliesToUrl=该维度全条目可拼 URL） */
export interface NewWorksCategoryDimGroup {
  key: DimKey;
  label: string;
  appliesToUrl: boolean;
  entries: { id: string; label: string }[];
}

export function getNewWorksCategoryDimGroups(): NewWorksCategoryDimGroup[] {
  const source = BUILTIN_CATEGORY_DICTIONARY.sources[BUILTIN_CATEGORY_DICTIONARY.activeSite];
  return source.dimensionOrder
    .map((key) => {
      const dim = source.dimensions[key];
      const entries = (dim?.entries ?? []).map((e) => ({ id: e.id, label: e.label }));
      return {
        key,
        label: dim?.label ?? key,
        appliesToUrl: entries.length > 0 && (dim?.entries ?? []).every((e) => e.appliesToUrl === true),
        entries,
      };
    })
    .filter((d) => d.entries.length > 0);
}

/**
 * 规范排序：t 码网格序 → 维度 dimensionOrder → 条目 id 序。
 * 与旧 configModal 保存时的 DOM 收集顺序逐字节一致。
 */
export function normalizeCategoryOrder(values: readonly string[], includeTags: boolean): string[] {
  const set = new Set(values);
  const out: string[] = [];
  if (includeTags) {
    for (const tag of getNewWorksWhitelistTags()) {
      if (set.has(tag.value)) out.push(tag.value);
    }
  }
  for (const dim of getNewWorksCategoryDimGroups()) {
    for (const e of dim.entries) {
      const k = entryKey(dim.key, e.id);
      if (set.has(k)) out.push(k);
    }
  }
  return out;
}

/** config → 表单（白名单/黑名单归一口径与旧 configModal createModal 一致） */
export function mapConfigToFormState(config: NewWorksGlobalConfig): NewWorksSettingsFormState {
  const split = splitNewWorksFilterValues(config.filters.categoryFilters ?? []);
  const whitelistSet = new Set<string>([...split.t, ...split.categoryKeys]);
  const blacklist = normalizeCategoryBlackValues(config.filters.categoryBlackFilters ?? []);

  const whitelistValues = normalizeCategoryOrder([...whitelistSet], true);
  const blacklistValues = normalizeCategoryOrder([...blacklist.keys], false);

  return {
    autoCheckEnabled: config.autoCheckEnabled ?? false,
    checkInterval: config.checkInterval,
    requestInterval: config.requestInterval,
    concurrency: config.concurrency ?? 1,
    showActorPageScanButton: config.showActorPageScanButton ?? false,
    excludeViewed: config.filters.excludeViewed,
    excludeBrowsed: config.filters.excludeBrowsed,
    excludeWant: config.filters.excludeWant,
    excludeAR: config.filters.excludeAR ?? false,
    dateRange: config.filters.dateRange,
    applyContentFilter: config.filters.applyContentFilter ?? false,
    autoCleanup: config.autoCleanup,
    cleanupDays: config.cleanupDays,
    whitelistValues,
    blacklistValues,
  };
}

/** 表单 → 落盘补丁（manager 与既有 config 合并；不碰 maxWorksPerCheck/lastGlobalCheck） */
export function mapFormStateToConfigPatch(form: NewWorksSettingsFormState): Partial<NewWorksGlobalConfig> {
  return {
    checkInterval: form.checkInterval,
    requestInterval: form.requestInterval,
    autoCheckEnabled: form.autoCheckEnabled,
    concurrency: form.concurrency,
    showActorPageScanButton: form.showActorPageScanButton,
    filters: {
      excludeViewed: form.excludeViewed,
      excludeBrowsed: form.excludeBrowsed,
      excludeWant: form.excludeWant,
      dateRange: form.dateRange,
      categoryFilters: normalizeCategoryOrder(form.whitelistValues, true),
      categoryBlackFilters: normalizeCategoryOrder(form.blacklistValues, false),
      excludeAR: form.excludeAR,
      applyContentFilter: form.applyContentFilter,
    },
    autoCleanup: form.autoCleanup,
    cleanupDays: form.cleanupDays,
  };
}

/** 校验（5 条文案与旧 configModal 逐字一致；顺序同旧实现） */
export function validateNewWorksForm(form: NewWorksSettingsFormState): { ok: true } | { ok: false; error: string } {
  if (form.checkInterval < 1 || form.checkInterval > 168) {
    return { ok: false, error: '检查间隔必须在1-168小时之间' };
  }
  if (form.requestInterval < 1 || form.requestInterval > 60) {
    return { ok: false, error: '请求间隔必须在1-60秒之间' };
  }
  if (form.concurrency < 1 || form.concurrency > 5) {
    return { ok: false, error: '并发数量必须在1-5之间' };
  }
  if (form.dateRange < 0 || form.dateRange > 24) {
    return { ok: false, error: '时间范围必须在0-24个月之间' };
  }
  if (form.cleanupDays < 7 || form.cleanupDays > 365) {
    return { ok: false, error: '清理天数必须在7-365天之间' };
  }
  return { ok: true };
}

/** 白名单数字类别降级判定与警示文案（与旧 configModal 同源：deriveActorScanInputs） */
export function deriveWhitelistDegradation(whitelistValues: readonly string[]): {
  degraded: boolean;
  numsCount: number;
  warnText: string;
} {
  const numsCount = deriveActorScanInputs([...whitelistValues]).nums.length;
  const degraded = numsCount > ACTOR_SCAN_UNION_MAX_CATEGORIES;
  return {
    degraded,
    numsCount,
    warnText: `已选 ${numsCount} 个类别，超过 ${ACTOR_SCAN_UNION_MAX_CATEGORIES} 个将降级为「同时满足全部（交集）」`,
  };
}
