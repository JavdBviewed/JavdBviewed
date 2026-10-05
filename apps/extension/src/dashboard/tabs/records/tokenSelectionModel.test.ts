import { describe, expect, it } from 'vitest';
import { syncRecordsTokenSelections } from './tokenSelectionModel';
import type { RecordsSearchTokens } from './searchQueryModel';

function tokens(partial: Partial<RecordsSearchTokens>): RecordsSearchTokens {
  return {
    text: '',
    tags: [],
    listIds: [],
    listNames: [],
    seriesIds: [],
    labelPrefixes: [],
    makerIds: [],
    directorIds: [],
    ...partial,
  };
}

describe('records token selection model', () => {
  it('replaces previous search-driven selections and preserves manual selections', () => {
    const selectedTags = new Set(['手动标签', '旧标签']);
    const selectedListIds = new Set(['manual-list', 'old-list']);
    const selectedSeriesIds = new Set(['manual-series', 'old-series']);
    const selectedLabelIds = new Set(['manual-label', 'OLD']);
    const selectedMakerIds = new Set(['manual-maker', 'old-maker']);
    const selectedDirectorIds = new Set(['manual-dir', 'old-dir']);

    const result = syncRecordsTokenSelections({
      parsedTokens: tokens({
        tags: ['新标签'],
        listIds: ['list-2'],
        listNames: ['收藏'],
        seriesIds: ['series-2'],
        labelPrefixes: ['NEW'],
        makerIds: ['maker-2'],
        directorIds: ['dir-2'],
      }),
      selectedTags,
      tokenSelectedTags: new Set(['旧标签']),
      selectedListIds,
      tokenSelectedListIds: new Set(['old-list']),
      selectedSeriesIds,
      tokenSelectedSeriesIds: new Set(['old-series']),
      selectedLabelIds,
      tokenSelectedLabelIds: new Set(['OLD']),
      selectedMakerIds,
      tokenSelectedMakerIds: new Set(['old-maker']),
      selectedDirectorIds,
      tokenSelectedDirectorIds: new Set(['old-dir']),
      listNameById: new Map([
        ['list-1', '我的收藏'],
        ['list-2', '待看清单'],
      ]),
    });

    expect([...selectedTags].sort()).toEqual(['手动标签', '新标签']);
    expect([...selectedListIds].sort()).toEqual(['list-1', 'list-2', 'manual-list']);
    expect([...selectedSeriesIds].sort()).toEqual(['manual-series', 'series-2']);
    expect([...selectedLabelIds].sort()).toEqual(['NEW', 'manual-label']);
    expect([...selectedMakerIds].sort()).toEqual(['maker-2', 'manual-maker']);
    expect([...selectedDirectorIds].sort()).toEqual(['dir-2', 'manual-dir']);
    expect([...result.tokenSelectedListIds].sort()).toEqual(['list-1', 'list-2']);
    expect([...result.tokenSelectedMakerIds].sort()).toEqual(['maker-2']);
    expect([...result.tokenSelectedDirectorIds].sort()).toEqual(['dir-2']);
  });

  it('clears previous search-driven selections when parsed tokens are empty', () => {
    const selectedTags = new Set(['手动标签', '旧标签']);
    const selectedListIds = new Set(['manual-list', 'old-list']);
    const selectedMakerIds = new Set(['manual-maker', 'old-maker']);
    const selectedDirectorIds = new Set(['manual-dir', 'old-dir']);

    const result = syncRecordsTokenSelections({
      parsedTokens: tokens({}),
      selectedTags,
      tokenSelectedTags: new Set(['旧标签']),
      selectedListIds,
      tokenSelectedListIds: new Set(['old-list']),
      selectedSeriesIds: new Set(),
      tokenSelectedSeriesIds: new Set(['old-series']),
      selectedLabelIds: new Set(),
      tokenSelectedLabelIds: new Set(['OLD']),
      selectedMakerIds,
      tokenSelectedMakerIds: new Set(['old-maker']),
      selectedDirectorIds,
      tokenSelectedDirectorIds: new Set(['old-dir']),
      listNameById: new Map(),
    });

    expect([...selectedTags]).toEqual(['手动标签']);
    expect([...selectedListIds]).toEqual(['manual-list']);
    expect([...selectedMakerIds]).toEqual(['manual-maker']);
    expect([...selectedDirectorIds]).toEqual(['manual-dir']);
    expect([...result.tokenSelectedTags]).toEqual([]);
    expect([...result.tokenSelectedListIds]).toEqual([]);
    expect([...result.tokenSelectedSeriesIds]).toEqual([]);
    expect([...result.tokenSelectedLabelIds]).toEqual([]);
    expect([...result.tokenSelectedMakerIds]).toEqual([]);
    expect([...result.tokenSelectedDirectorIds]).toEqual([]);
  });
});
