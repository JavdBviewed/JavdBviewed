import { buildRecordsSearchResultSummary } from './searchResultSummaryModel';

export interface CreateRecordsSearchResultCountControllerOptions {
  container?: HTMLElement | null;
  searchInput: HTMLInputElement;
  filterSelect: HTMLSelectElement;
  getTotalCount: () => number;
  getDurationMs: () => number | null;
  getSelectedTagsCount: () => number;
  getSelectedListIdsCount: () => number;
  getSelectedSeriesIdsCount: () => number;
  getSelectedLabelIdsCount: () => number;
  getSelectedMakerIdsCount: () => number;
  getSelectedDirectorIdsCount: () => number;
  getAdvancedConditionsCount: () => number;
}

export interface RecordsSearchResultCountController {
  update: () => void;
}

export function createRecordsSearchResultCountController(
  options: CreateRecordsSearchResultCountControllerOptions,
): RecordsSearchResultCountController {
  const update = () => {
    if (!options.container) return;

    const hasFilter = options.filterSelect?.value !== 'all';
    const summary = buildRecordsSearchResultSummary({
      totalCount: options.getTotalCount(),
      durationMs: options.getDurationMs(),
      searchTerm: options.searchInput?.value?.trim() || '',
      filterText: hasFilter ? (options.filterSelect.options[options.filterSelect.selectedIndex]?.text || '') : '',
      selectedTagsCount: options.getSelectedTagsCount(),
      selectedListIdsCount: options.getSelectedListIdsCount(),
      selectedSeriesIdsCount: options.getSelectedSeriesIdsCount(),
      selectedLabelIdsCount: options.getSelectedLabelIdsCount(),
      selectedMakerIdsCount: options.getSelectedMakerIdsCount(),
      selectedDirectorIdsCount: options.getSelectedDirectorIdsCount(),
      advancedConditionsCount: options.getAdvancedConditionsCount(),
    });

    if (summary.visible) {
      options.container.innerHTML = summary.html;
      options.container.style.display = 'flex';
      return;
    }

    options.container.style.display = 'none';
  };

  return { update };
}
