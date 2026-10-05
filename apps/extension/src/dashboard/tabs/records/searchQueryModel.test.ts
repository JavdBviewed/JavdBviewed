import { describe, expect, it } from 'vitest';
import {
  parseRecordsSearchTokens,
  removeDirectorTokenFromSearchInput,
  removeLabelTokenFromSearchInput,
  removeListIdTokenFromSearchInput,
  removeMakerTokenFromSearchInput,
  removeSeriesTokenFromSearchInput,
} from './searchQueryModel';

describe('records search query model', () => {
  it('parses free text and scoped tokens', () => {
    expect(parseRecordsSearchTokens('护士 tag:无码,字幕 #高清 listid:abc;def list:收藏 series:SER-1 label:fc2 maker:AEO director:dekM')).toEqual({
      text: '护士',
      tags: ['无码', '字幕', '高清'],
      listIds: ['abc', 'def'],
      listNames: ['收藏'],
      seriesIds: ['SER-1'],
      labelPrefixes: ['FC2'],
      makerIds: ['AEO'],
      directorIds: ['dekM'],
    });
  });

  it('removes one list id from multi-value list tokens and preserves other terms', () => {
    expect(removeListIdTokenFromSearchInput('abc listid:A,b;c other', 'b')).toBe('abc listid:A,c other');
    expect(removeListIdTokenFromSearchInput('listid:A', 'a')).toBe('');
  });

  it('removes series and label tokens case-insensitively', () => {
    expect(removeSeriesTokenFromSearchInput('series:s1,S2 title', 'S1')).toBe('series:S2 title');
    expect(removeLabelTokenFromSearchInput('label:fc2,abp title', 'FC2')).toBe('label:abp title');
  });

  it('parses maker/director tokens preserving original case (series-style, label not uppercased)', () => {
    expect(parseRecordsSearchTokens('maker:aeo DIRECTOR:DEKM x')).toEqual({
      text: 'x',
      tags: [],
      listIds: [],
      listNames: [],
      seriesIds: [],
      labelPrefixes: [],
      makerIds: ['aeo'],
      directorIds: ['DEKM'],
    });
  });

  it('removes maker and director tokens case-insensitively', () => {
    expect(removeMakerTokenFromSearchInput('maker:AEO,BEO t', 'AEO')).toBe('maker:BEO t');
    expect(removeDirectorTokenFromSearchInput('director:dekM,x t', 'dekM')).toBe('director:x t');
  });
});
