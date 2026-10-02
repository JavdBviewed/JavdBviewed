/**
 * @file newWorksSettingsModel.test.ts
 * @description 新作品设置模型单测：属性组 + 311 字典项面板数据、规范排序、
 * 校验文案（与旧 configModal 逐字一致）、config↔表单映射（legacy 值读时归一）
 * @module apps/dashboard/pages/settings/newWorks
 */
import { BUILTIN_CATEGORY_DICTIONARY, entryKey, type DimKey } from '@javdb/video-category-dict';
import type { NewWorksGlobalConfig } from '../../../../../types';
import {
  splitNewWorksFilterValues,
} from '../../../../../features/newWorks/categoryFilter';
import {
  DEFAULT_NEW_WORKS_SETTINGS_FORM,
  filterCategoryDimGroups,
  getNewWorksCategoryDimGroups,
  mapConfigToFormState,
  mapFormStateToConfigPatch,
  NEW_WORKS_ATTR_ITEMS,
  normalizeCategoryOrder,
  validateNewWorksForm,
  type NewWorksCategoryDimGroup,
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
  it('白名单属性组 = 3 项（p 可播放 / d 含磁鏈 / c 含字幕，D3 真机验证；站点自报 label 用繁体「鏈」）', () => {
    expect(NEW_WORKS_ATTR_ITEMS.map((a) => a.value)).toEqual(['p', 'd', 'c']);
    expect(NEW_WORKS_ATTR_ITEMS.map((a) => a.label)).toEqual(['可播放', '含磁鏈', '含字幕']);
  });

  it('字典维度合计 311 项（与 builtin 快照一致）', () => {
    const groups = getNewWorksCategoryDimGroups();
    const total = groups.reduce((n, g) => n + g.entries.length, 0);
    expect(total).toBe(311);
    expect(source.dimensionOrder.filter((k) => source.dimensions[k]?.entries?.length)).toHaveLength(
      groups.length,
    );
  });

  it('normalizeCategoryOrder 与旧 configModal DOM 收集顺序逐字节一致（属性组 → 维度序 → 条目序）', () => {
    // 乱序输入：字典项在前、属性字母在后，含跨维度
    const secondDimKey = source.dimensionOrder[1];
    const secondEntry = source.dimensions[secondDimKey].entries[0];
    const secondKey = entryKey(secondDimKey, secondEntry.id);
    const shuffled = [secondKey, sampleEntryKey, 'd', 'p', 's'];
    const ordered = normalizeCategoryOrder(shuffled, true);
    // 属性组仅 p/d/c（s 已随 legacy 归一走字典 c7=28，不再产出字母形态）
    expect(ordered).toEqual(['p', 'd', sampleEntryKey, secondKey]);
    // 黑名单口径：不含属性字母
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
  it('白名单值归一（10-08 线）：legacy s/4k/uncensored → c7 同名字典项，落盘顺序=规范渲染序', () => {
    // 模拟旧存储乱序值（legacy 字母形态 + entryKey）
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
    // c7 条目序：28 先于 345/347（字典内 id 序）
    expect(form.whitelistValues).toEqual([sampleEntryKey, 'c7=28', 'c7=347']);
    expect(form.blacklistValues).toEqual([sampleEntryKey]);

    const patch = mapFormStateToConfigPatch(form);
    expect(patch.filters?.categoryFilters).toEqual([sampleEntryKey, 'c7=28', 'c7=347']);
    expect(patch.filters?.categoryBlackFilters).toEqual([sampleEntryKey]);
  });

  it('属性字母 + entryKey 混合：落盘顺序=属性组（p,d,c 序）→ 维度序 → 条目序', () => {
    const form = mapConfigToFormState(
      makeConfig({
        filters: {
          excludeViewed: true,
          excludeBrowsed: true,
          excludeWant: false,
          dateRange: 3,
          categoryFilters: ['c7=28', 'c', 'p', sampleEntryKey],
          categoryBlackFilters: [],
          excludeAR: false,
          applyContentFilter: false,
        },
      }),
    );
    expect(form.whitelistValues).toEqual(['p', 'c', sampleEntryKey, 'c7=28']);
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


});

describe('newWorksSettingsModel splitNewWorksFilterValues 拆分口径（运行时不变）', () => {
  it('2 个 t 码 + 3 个数字类别 → t 轴 2 / 类别轴 3', () => {
    const dim1 = source.dimensionOrder[0];
    const dim2 = source.dimensionOrder[1];
    const dim3 = source.dimensionOrder[2];
    const k1 = entryKey(dim1, source.dimensions[dim1].entries[0].id);
    const k2 = entryKey(dim2, source.dimensions[dim2].entries[0].id);
    const k3 = entryKey(dim3, source.dimensions[dim3].entries[0].id);
    const split = splitNewWorksFilterValues(['s', '4k', k1, k2, k3]);
    expect(split.t).toEqual(['s', '4k']);
    expect(split.categoryKeys.length).toBe(3);
  });

  it('全 t 码 → 类别轴 0；全字典项 → 类别轴 = 字典项数', () => {
    expect(splitNewWorksFilterValues(['s', 'p', 'd', 'c', '4k', 'uncensored']).categoryKeys.length).toBe(0);
    const groups = getNewWorksCategoryDimGroups();
    const allKeys = groups.flatMap((g) => g.entries.map((e) => entryKey(g.key, e.id)));
    expect(splitNewWorksFilterValues(allKeys).categoryKeys.length).toBe(311);
  });
});

describe('newWorksSettingsModel 类别面板搜索过滤（10-06 线纯函数）', () => {
  const mkGroups = (): NewWorksCategoryDimGroup[] => [
    {
      key: 'c2' as DimKey,
      label: '番号前缀',
      appliesToUrl: false,
      entries: [
        { id: '1', label: 'JUL' },
        { id: '2', label: 'SSIS' },
        { id: '3', label: 'Blue' },
      ],
    },
    {
      key: 'c4' as DimKey,
      label: '系列',
      appliesToUrl: true,
      entries: [
        { id: '10', label: '初体验' },
        { id: '11', label: 'NTR' },
        { id: '12', label: 'Club' },
      ],
    },
  ];

  it('空 query（含纯空白）= 全组全条目、顺序不变（默认渲染态）', () => {
    for (const q of ['', '   ']) {
      const out = filterCategoryDimGroups(mkGroups(), q);
      expect(out.map((g) => g.key)).toEqual(['c2', 'c4']);
      expect(out[0].entries.map((e) => e.label)).toEqual(['JUL', 'SSIS', 'Blue']);
      expect(out[1].entries.map((e) => e.label)).toEqual(['初体验', 'NTR', 'Club']);
    }
  });

  it('命中仅对应维度：0 命中组整组不渲染', () => {
    const out = filterCategoryDimGroups(mkGroups(), 'JUL');
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe('c2');
    expect(out[0].entries.map((e) => e.label)).toEqual(['JUL']);
  });

  it('组内条目集 = 命中子集（未命中条目不保留、顺序不变；跨维度同时命中）', () => {
    const out = filterCategoryDimGroups(mkGroups(), 'u');
    expect(out.map((g) => g.key)).toEqual(['c2', 'c4']);
    expect(out[0].entries.map((e) => e.label)).toEqual(['JUL', 'Blue']);
    expect(out[1].entries.map((e) => e.label)).toEqual(['Club']);
  });

  it('全部 0 命中 → 空数组（页面据此渲染「没有匹配的类别」）', () => {
    expect(filterCategoryDimGroups(mkGroups(), '不存在的类别xyz')).toEqual([]);
  });

  it('大小写不敏感（lowercase query 命中 uppercase label，反之亦然）', () => {
    expect(filterCategoryDimGroups(mkGroups(), 'ssis')[0].entries.map((e) => e.label)).toEqual(['SSIS']);
    expect(filterCategoryDimGroups(mkGroups(), 'jUl')[0].entries.map((e) => e.label)).toEqual(['JUL']);
  });

  it('中文包含匹配', () => {
    const out = filterCategoryDimGroups(mkGroups(), '体验');
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe('c4');
    expect(out[0].entries.map((e) => e.label)).toEqual(['初体验']);
  });
});
