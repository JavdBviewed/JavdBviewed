import { describe, expect, it } from 'vitest';
import { buildRecordsSearchResultSummary, formatRecordsQueryDuration } from './searchResultSummaryModel';

describe('records search result summary model', () => {
  it('formats query duration compactly', () => {
    expect(formatRecordsQueryDuration(null)).toBe('');
    expect(formatRecordsQueryDuration(42.4)).toBe('42ms');
    expect(formatRecordsQueryDuration(1500)).toBe('1.5s');
    expect(formatRecordsQueryDuration(12000)).toBe('12s');
  });

  it('builds full count summary without active filters', () => {
    expect(buildRecordsSearchResultSummary({
      totalCount: 12,
      durationMs: 20,
      searchTerm: '',
      filterText: '',
      selectedTagsCount: 0,
      selectedListIdsCount: 0,
      selectedSeriesIdsCount: 0,
      selectedLabelIdsCount: 0,
      selectedMakerIdsCount: 0,
      selectedDirectorIdsCount: 0,
      advancedConditionsCount: 0,
    })).toEqual({
      visible: true,
      html: '共 <span class="count-number">12</span> 条记录 · 查询耗时 <span class="count-number">20ms</span>',
    });
  });

  it('builds filtered count summary from active conditions', () => {
    expect(buildRecordsSearchResultSummary({
      totalCount: 3,
      durationMs: null,
      searchTerm: '护士',
      filterText: '已观看',
      selectedTagsCount: 2,
      selectedListIdsCount: 1,
      selectedSeriesIdsCount: 0,
      selectedLabelIdsCount: 1,
      selectedMakerIdsCount: 0,
      selectedDirectorIdsCount: 0,
      advancedConditionsCount: 2,
    })).toEqual({
      visible: true,
      html: '搜索 "护士" + 已观看 + 2个标签 + 1个清单 + 1个番号 + 2个高级条件，找到 <span class="count-number">3</span> 个结果',
    });
  });

  it('hides summary when no records match', () => {
    expect(buildRecordsSearchResultSummary({
      totalCount: 0,
      durationMs: null,
      searchTerm: 'none',
      filterText: '',
      selectedTagsCount: 0,
      selectedListIdsCount: 0,
      selectedSeriesIdsCount: 0,
      selectedLabelIdsCount: 0,
      selectedMakerIdsCount: 0,
      selectedDirectorIdsCount: 0,
      advancedConditionsCount: 0,
    })).toEqual({ visible: false, html: '' });
  });

  it('includes maker and director counts in the active conditions summary', () => {
    expect(buildRecordsSearchResultSummary({
      totalCount: 5,
      durationMs: null,
      searchTerm: '',
      filterText: '',
      selectedTagsCount: 0,
      selectedListIdsCount: 0,
      selectedSeriesIdsCount: 0,
      selectedLabelIdsCount: 0,
      selectedMakerIdsCount: 2,
      selectedDirectorIdsCount: 1,
      advancedConditionsCount: 0,
    })).toEqual({
      visible: true,
      html: '搜索 2个片商 + 1个導演，找到 <span class="count-number">5</span> 个结果',
    });
  });
});
