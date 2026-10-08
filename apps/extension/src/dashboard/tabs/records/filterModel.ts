import type { ListRecord, VideoRecord, VideoStatus } from '../../../types';
import { getMediaStateRecordKey, type MediaStateHit } from './mediaStateFilterModel';
import {
  getDirectorExternalIdFromUrl,
  getMakerExternalIdFromUrl,
  matchesDirectorRecord,
  matchesLabelRecord,
  matchesMakerRecord,
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
  selectedMakerIds: Set<string>;
  selectedDirectorIds: Set<string>;
  seriesIdToRecord: Map<string, ListRecord>;
  labelIdToRecord: Map<string, ListRecord>;
  makerIdToRecord: Map<string, ListRecord>;
  directorIdToRecord: Map<string, ListRecord>;
  advancedConditions: RecordsAdvancedCondition[];
  favoritesFilterActive: boolean;
  sortValue: string;
  /**
   * 媒体库状态筛选（10-24，可选）：缺省（未传或两开关皆 false）= 零行为变化。
   * mediaStateHits 以记录主键（getMediaStateRecordKey）为键；缺记录的维度视为不命中。
   */
  mediaStateHits?: ReadonlyMap<string, MediaStateHit>;
  inLibraryFilterActive?: boolean;
  realWatchedFilterActive?: boolean;
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

function matchesSelectedMaker(
  record: VideoRecord,
  selectedMakerIds: Set<string>,
  makerIdToRecord: Map<string, ListRecord>,
): boolean {
  if (selectedMakerIds.size === 0) return true;
  return Array.from(selectedMakerIds).some((makerId) => {
    const maker = makerIdToRecord.get(String(makerId));
    if (maker) return matchesMakerRecord(record, maker);

    const urlId = getMakerExternalIdFromUrl(record.makerUrl);
    if (urlId && urlId === String(makerId)) return true;
    return String(record.maker || '').trim().toLowerCase() === String(makerId).trim().toLowerCase();
  });
}

function matchesSelectedDirector(
  record: VideoRecord,
  selectedDirectorIds: Set<string>,
  directorIdToRecord: Map<string, ListRecord>,
): boolean {
  if (selectedDirectorIds.size === 0) return true;
  return Array.from(selectedDirectorIds).some((directorId) => {
    const director = directorIdToRecord.get(String(directorId));
    if (director) return matchesDirectorRecord(record, director);

    const urlId = getDirectorExternalIdFromUrl(record.directorUrl);
    if (urlId && urlId === String(directorId)) return true;
    return String(record.director || '').trim().toLowerCase() === String(directorId).trim().toLowerCase();
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

/**
 * #filterSelect 媒体库状态项值域（10-08：chip 按钮 → 下拉 optgroup「媒体库」）。
 * 单一事实源：records.html 的 option value、映射、自保判定、disabled 面均从此取。
 */
export const MEDIA_STATE_SELECT_VALUES = ['inLibrary', 'realWatched'] as const;
export type MediaStateSelectValue = (typeof MEDIA_STATE_SELECT_VALUES)[number];

export function isMediaStateSelectValue(value: string | null | undefined): value is MediaStateSelectValue {
  return value === 'inLibrary' || value === 'realWatched';
}

export interface ParsedMediaStateSelectValue {
  /** 媒体项 → 'all'（媒体维度不吞状态谓词，谓词口径零改）；其余值原样透传。 */
  status: 'all' | VideoStatus;
  inLibraryFilterActive: boolean;
  realWatchedFilterActive: boolean;
}

/**
 * #filterSelect 值 → (status, 媒体库双开关) 映射（10-08）。
 * 单选互斥由 select 结构天然保证（同时只有一个值）；「所有状态」=复位项。
 */
export function parseMediaStateSelectValue(value: string | null | undefined): ParsedMediaStateSelectValue {
  if (value === 'inLibrary') {
    return { status: 'all', inLibraryFilterActive: true, realWatchedFilterActive: false };
  }
  if (value === 'realWatched') {
    return { status: 'all', inLibraryFilterActive: false, realWatchedFilterActive: true };
  }
  return { status: (value || 'all') as 'all' | VideoStatus, inLibraryFilterActive: false, realWatchedFilterActive: false };
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
    const mediaStateKey = getMediaStateRecordKey(record);
    const mediaHit = mediaStateKey ? input.mediaStateHits?.get(mediaStateKey) : undefined;
    const matchesInLibrary = !input.inLibraryFilterActive || Boolean(mediaHit?.inLibrary);
    const matchesRealWatched = !input.realWatchedFilterActive || Boolean(mediaHit?.realWatched);

    const basicMatch =
      matchesSearch(record, searchTerm, tagsLower) &&
      matchesStatus &&
      matchesSelectedTags(tagsLower, input.selectedTags) &&
      matchesSelectedLists(record, input.selectedListIds) &&
      matchesSelectedSeries(record, input.selectedSeriesIds, input.seriesIdToRecord) &&
      matchesSelectedLabels(record, input.selectedLabelIds, input.labelIdToRecord) &&
      matchesSelectedMaker(record, input.selectedMakerIds, input.makerIdToRecord) &&
      matchesSelectedDirector(record, input.selectedDirectorIds, input.directorIdToRecord) &&
      matchesFavorite &&
      matchesInLibrary &&
      matchesRealWatched;

    if (!basicMatch) return false;
    return input.advancedConditions.length === 0 ||
      input.advancedConditions.every(condition => evaluateRecordsAdvancedCondition(record, condition));
  });

  return sortRecords(filtered, input.sortValue);
}
