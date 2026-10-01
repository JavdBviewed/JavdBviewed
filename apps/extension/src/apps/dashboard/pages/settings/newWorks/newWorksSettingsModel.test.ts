/**
 * @file newWorksSettingsModel.test.ts
 * @description 新作品设置模型单测：类别计数（6 t 码 + 311 字典项）、规范排序、
 * 校验文案（与旧 configModal 逐字一致）、config↔表单映射形状零变化
 * @module apps/dashboard/pages/settings/newWorks
 */
import { BUILTIN_CATEGORY_DICTIONARY, entryKey } from '@javdb/video-category-dict';
import type { NewWorksGlobalConfig } from '../../../../../types';
import {
  ACTOR_SCAN_UNION_MAX_CATEGORIES,
  deriveActorScanInputs,
} from '../../../../../features/newWorks/categoryFilter';
import {
  DEFAULT_NEW_WORKS_SETTINGS_FORM,
  deriveWhitelistDegradation,
  getNewWorksCategoryDimGroups,
  getNewWorksWhitelistTags,
  mapConfigToFormState,
  mapFormStateToConfigPatch,
  normalizeCategoryOrder,
  validateNewWorksForm,
} from './newWorksSettingsModel';

const source = BUILTIN_CATEGORY_DICTIONARY.sources[BUILTIN_CATEGORY_DICTIONARY.activeSite];
const firstDimKey = source.dimensionOrder[0];
const sampleEntry = source.dimensions[firstDimKey].entries[0];
const sampleEntryKey = entryKey(firstDimKey, sampleEntry.id);

function makeConfig(overrides: Partial<NewWorksGlobalConfig> = {}): NewWorksGlobalConfig {
  return {
    checkInterval: 24,
    requestInterval: 3,
    autoCheckEnabled: false,
    concurrency: 1,
    showActorPageScanButton: false,
    filters: {
      excludeViewed: true,
      excludeBrowsed: true,
      excludeWant: false,
      dateRange: 3,
      categoryFilters: [],
      categoryBlackFilters: [],
      excludeAR: false,
      applyContentFilter: false,
    },
    maxWorksPerCheck: 100,
    autoCleanup: true,
    cleanupDays: 30,
    ...overrides,
  };
}

describe('newWorksSettingsModel 类别面板数据', () => {
  it('白名单基础过滤 = ACTOR_FILTER_TAGS basic/quality 6 项 t 码', () => {
    const tags = getNewWorksWhitelistTags();
    expect(tags).toHaveLength(6);
    expect(tags.map((t) => t.value).sort()).toEqual(['4k', 'c', 'd', 'p', 's', 'uncensored']);
  });

  it('字典维度合计 311 项（与 builtin 快照一致）', () => {
    const groups = getNewWorksCategoryDimGroups();
    const total = groups.reduce((n, g) => n + g.entries.length, 0);
    expect(total).toBe(311);
    expect(source.dimensionOrder.filter((k) => source.dimensions[k]?.entries?.length)).toHaveLength(
      groups.length,
    );
  });

  it('normalizeCategoryOrder 与旧 configModal DOM 收集顺序逐字节一致（t 码网格 → 维度序 → 条目序）', () => {
    // 乱序输入：字典项在前、t 码在后，含跨维度
    const secondDimKey = source.dimensionOrder[1];
    const secondEntry = source.dimensions[secondDimKey].entries[0];
    const secondKey = entryKey(secondDimKey, secondEntry.id);
    const shuffled = [secondKey, sampleEntryKey, 'd', '4k', 's'];
    const ordered = normalizeCategoryOrder(shuffled, true);
    expect(ordered).toEqual(['s', 'p', 'd', 'c', '4k', 'uncensored'].filter((t) => shuffled.includes(t)).concat([sampleEntryKey, secondKey]));
    // 黑名单口径：不含 t 码
    const black = normalizeCategoryOrder([secondKey, 's', sampleEntryKey], false);
    expect(black).toEqual([sampleEntryKey, secondKey]);
  });
});

describe('newWorksSettingsModel 校验', () => {
  it('合法表单通过', () => {
    expect(validateNewWorksForm(DEFAULT_NEW_WORKS_SETTINGS_FORM)).toEqual({ ok: true });
  });

  it('5 条越界文案与旧 configModal 逐字一致（顺序同旧实现）', () => {
    const cases: Array<[Partial<typeof DEFAULT_NEW_WORKS_SETTINGS_FORM>, string]> = [
      [{ checkInterval: 0 }, '检查间隔必须在1-168小时之间'],
      [{ checkInterval: 169 }, '检查间隔必须在1-168小时之间'],
      [{ requestInterval: 0 }, '请求间隔必须在1-60秒之间'],
      [{ concurrency: 6 }, '并发数量必须在1-5之间'],
      [{ dateRange: 25 }, '时间范围必须在0-24个月之间'],
      [{ cleanupDays: 6 }, '清理天数必须在7-365天之间'],
    ];
    for (const [patch, error] of cases) {
      const form = { ...DEFAULT_NEW_WORKS_SETTINGS_FORM, ...patch };
      expect(validateNewWorksForm(form)).toEqual({ ok: false, error });
    }
  });
});

describe('newWorksSettingsModel 映射', () => {
  it('白名单值归一：t 码 + entryKey，落盘顺序=规范渲染序（逐字节同构旧 configModal）', () => {
    // 模拟旧存储乱序值
    const config = makeConfig({
      filters: {
        excludeViewed: true,
        excludeBrowsed: true,
        excludeWant: false,
        dateRange: 3,
        categoryFilters: ['4k', sampleEntryKey, 's'],
        categoryBlackFilters: [sampleEntryKey],
        excludeAR: false,
        applyContentFilter: false,
      },
    });
    const form = mapConfigToFormState(config);
    expect(form.whitelistValues).toEqual(['s', '4k', sampleEntryKey]);
    expect(form.blacklistValues).toEqual([sampleEntryKey]);

    const patch = mapFormStateToConfigPatch(form);
    expect(patch.filters?.categoryFilters).toEqual(['s', '4k', sampleEntryKey]);
    expect(patch.filters?.categoryBlackFilters).toEqual([sampleEntryKey]);
  });

  it('落盘补丁不携带 maxWorksPerCheck/lastGlobalCheck（manager 合并保留既有值，形状零变化）', () => {
    const patch = mapFormStateToConfigPatch(DEFAULT_NEW_WORKS_SETTINGS_FORM);
    expect('maxWorksPerCheck' in patch).toBe(false);
    expect('lastGlobalCheck' in patch).toBe(false);
    expect(Object.keys(patch).sort()).toEqual(
      [
        'autoCheckEnabled',
        'autoCleanup',
        'checkInterval',
        'cleanupDays',
        'concurrency',
        'filters',
        'requestInterval',
        'showActorPageScanButton',
      ].sort(),
    );
  });

  it('降级判定与警示文案（>5 数字类别触发，与运行时 deriveActorScanInputs 同口径）', () => {
    const secondDimKey = source.dimensionOrder[1];
    const keys: string[] = [];
    for (const key of source.dimensionOrder) {
      for (const e of source.dimensions[key].entries) {
        keys.push(entryKey(key, e.id));
        if (keys.length >= 6) break;
      }
      if (keys.length >= 6) break;
    }
    const five = keys.slice(0, ACTOR_SCAN_UNION_MAX_CATEGORIES);
    expect(deriveWhitelistDegradation(five).degraded).toBe(false);
    const six = keys.slice(0, ACTOR_SCAN_UNION_MAX_CATEGORIES + 1);
    const d = deriveWhitelistDegradation(six);
    expect(d.degraded).toBe(true);
    expect(d.numsCount).toBe(deriveActorScanInputs(six).nums.length);
    expect(d.warnText).toBe(
      `已选 ${d.numsCount} 个类别，超过 ${ACTOR_SCAN_UNION_MAX_CATEGORIES} 个将降级为「同时满足全部（交集）」`,
    );
    void secondDimKey;
  });
});
