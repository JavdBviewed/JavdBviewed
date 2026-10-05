export interface RecordsSearchResultSummaryInput {
  totalCount: number;
  durationMs: number | null;
  searchTerm: string;
  filterText: string;
  selectedTagsCount: number;
  selectedListIdsCount: number;
  selectedSeriesIdsCount: number;
  selectedLabelIdsCount: number;
  selectedMakerIdsCount: number;
  selectedDirectorIdsCount: number;
  advancedConditionsCount: number;
}

export interface RecordsSearchResultSummary {
  visible: boolean;
  html: string;
}

export function formatRecordsQueryDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`;
}

export function buildRecordsSearchResultSummary(input: RecordsSearchResultSummaryInput): RecordsSearchResultSummary {
  const durationText = formatRecordsQueryDuration(input.durationMs);
  const hasAnyCondition = Boolean(
    input.searchTerm ||
    input.filterText ||
    input.selectedTagsCount > 0 ||
    input.selectedListIdsCount > 0 ||
    input.selectedSeriesIdsCount > 0 ||
    input.selectedLabelIdsCount > 0 ||
    input.selectedMakerIdsCount > 0 ||
    input.selectedDirectorIdsCount > 0 ||
    input.advancedConditionsCount > 0,
  );

  if (hasAnyCondition && input.totalCount > 0) {
    const conditions: string[] = [];
    if (input.searchTerm) conditions.push(`"${input.searchTerm}"`);
    if (input.filterText) conditions.push(input.filterText);
    if (input.selectedTagsCount > 0) conditions.push(`${input.selectedTagsCount}个标签`);
    if (input.selectedListIdsCount > 0) conditions.push(`${input.selectedListIdsCount}个清单`);
    if (input.selectedSeriesIdsCount > 0) conditions.push(`${input.selectedSeriesIdsCount}个系列`);
    if (input.selectedLabelIdsCount > 0) conditions.push(`${input.selectedLabelIdsCount}个番号`);
    if (input.selectedMakerIdsCount > 0) conditions.push(`${input.selectedMakerIdsCount}个片商`);
    if (input.selectedDirectorIdsCount > 0) conditions.push(`${input.selectedDirectorIdsCount}个導演`);
    if (input.advancedConditionsCount > 0) conditions.push(`${input.advancedConditionsCount}个高级条件`);

    return {
      visible: true,
      html: `搜索 ${conditions.join(' + ')}，找到 <span class="count-number">${input.totalCount}</span> 个结果${durationText ? ` · 查询耗时 <span class="count-number">${durationText}</span>` : ''}`,
    };
  }

  if (input.totalCount > 0) {
    return {
      visible: true,
      html: `共 <span class="count-number">${input.totalCount}</span> 条记录${durationText ? ` · 查询耗时 <span class="count-number">${durationText}</span>` : ''}`,
    };
  }

  return { visible: false, html: '' };
}
