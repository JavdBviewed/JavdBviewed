import type { ListRecord, VideoRecord, VideoStatus } from '../../../types';
import {
  matchesLabelRecord,
  matchesSeriesRecord,
} from '../../../shared/utils/listRecordHelpers';
import {
  evaluateRecordsAdvancedCondition,
  type RecordsAdvancedCondition,
} from './advancedConditionModel';

export interface FilterAndSortRecordsInput {
  records: VideoRecord[];
  searchTerm: string;
  status: 'all' | VideoStatus;
  selectedTags: Set<string>;
  selectedListIds: Set<string>;
  selectedSeriesIds: Set<string>;
  selectedLabelIds: Set<string>;
  seriesIdToRecord: Map<string, ListRecord>;
  labelIdToRecord: Map<string, ListRecord>;
  advancedConditions: RecordsAdvancedCondition[];
  favoritesFilterActive: boolean;
  sortValue: string;
}

function matchesSearch(record: VideoRecord, searchTerm: string, tagsLower: string[]): boolean {
  if (!searchTerm) return true;
  return Boolean(
    (record.id && record.id.toLowerCase().includes(searchTerm)) ||
    (record.title && record.title.toLowerCase().includes(searchTerm)) ||
    tagsLower.some(tag => tag.includes(searchTerm))
  );
}

function matchesSelectedTags(tagsLower: string[], selectedTags: Set<string>): boolean {
  if (selectedTags.size === 0) return true;
  const selectedTagsLower = Array.from(selectedTags).map(tag => String(tag).toLowerCase());
  return selectedTagsLower.every(token => tagsLower.some(tag => tag.includes(token)));
}

function matchesSelectedLists(record: VideoRecord, selectedListIds: Set<string>): boolean {
  if (selectedListIds.size === 0) return true;
  const recordListIds = Array.isArray(record.listIds) ? record.listIds : [];
  if (recordListIds.length === 0) return false;
  return Array.from(selectedListIds).some(id => recordListIds.includes(String(id)));
}

function matchesSelectedSeries(
  record: VideoRecord,
  selectedSeriesIds: Set<string>,
  seriesIdToRecord: Map<string, ListRecord>,
): boolean {
  if (selectedSeriesIds.size === 0) return true;
  return Array.from(selectedSeriesIds).some((seriesId) => {
    const series = seriesIdToRecord.get(String(seriesId));
    if (series) return matchesSeriesRecord(record, series);

    const url = String(record.seriesUrl || '');
    if (url.endsWith(`/series/${seriesId}`) || url.includes(`/series/${seriesId}?`)) return true;
    return String(record.series || '').trim().toLowerCase() === String(seriesId).trim().toLowerCase();
  });
}

function matchesSelectedLabels(
  record: VideoRecord,
  selectedLabelIds: Set<string>,
  labelIdToRecord: Map<string, ListRecord>,
): boolean {
  if (selectedLabelIds.size === 0) return true;
  return Array.from(selectedLabelIds).some((prefix) => {
    const label = labelIdToRecord.get(String(prefix).toUpperCase());
    if (label) return matchesLabelRecord(record, label);

    const id = String(record.id || '').toUpperCase();
    const normalizedPrefix = String(prefix || '').toUpperCase();
    return id === normalizedPrefix || id.startsWith(`${normalizedPrefix}-`);
  });
}

function sortRecords(records: VideoRecord[], sortValue: string): VideoRecord[] {
  return [...records].sort((a, b) => {
    try {
      switch (sortValue) {
        case 'createdAt_desc':
          return (b.createdAt || 0) - (a.createdAt || 0);
        case 'createdAt_asc':
          return (a.createdAt || 0) - (b.createdAt || 0);
        case 'updatedAt_asc':
          return (a.updatedAt || 0) - (b.updatedAt || 0);
        case 'id_asc':
          return (a.id || '').localeCompare(b.id || '');
        case 'id_desc':
          return (b.id || '').localeCompare(a.id || '');
        case 'updatedAt_desc':
        default:
          return (b.updatedAt || 0) - (a.updatedAt || 0);
      }
    } catch {
      return 0;
    }
  });
}

export function filterAndSortRecords(input: FilterAndSortRecordsInput): VideoRecord[] {
  const searchTerm = input.searchTerm.toLowerCase();
  const records = Array.isArray(input.records) ? input.records : [];

  const filtered = records.filter((record) => {
    if (!record || typeof record !== 'object') return false;

    const tags = Array.isArray(record.tags) ? record.tags : [];
    const userTags = Array.isArray(record.userTags) ? record.userTags : [];
    const tagsLower = [...tags, ...userTags].map(tag => String(tag).toLowerCase());
    const matchesStatus = input.status === 'all' || record.status === input.status;
    const matchesFavorite = !input.favoritesFilterActive || record.isFavorite === true;

    const basicMatch =
      matchesSearch(record, searchTerm, tagsLower) &&
      matchesStatus &&
      matchesSelectedTags(tagsLower, input.selectedTags) &&
      matchesSelectedLists(record, input.selectedListIds) &&
      matchesSelectedSeries(record, input.selectedSeriesIds, input.seriesIdToRecord) &&
      matchesSelectedLabels(record, input.selectedLabelIds, input.labelIdToRecord) &&
      matchesFavorite;

    if (!basicMatch) return false;
    return input.advancedConditions.length === 0 ||
      input.advancedConditions.every(condition => evaluateRecordsAdvancedCondition(record, condition));
  });

  return sortRecords(filtered, input.sortValue);
}
