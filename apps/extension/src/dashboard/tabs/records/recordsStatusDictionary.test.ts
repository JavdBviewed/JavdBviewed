import { describe, expect, it } from 'vitest';
import { VIDEO_STATUS } from '../../../utils/config';
import { MEDIA_STATE_SELECT_VALUES } from './filterModel';
import type { MediaStateHit } from './mediaStateFilterModel';
import {
  ALL_STATUS_VALUES,
  RECORDS_STATUS_ENTRIES,
  STORED_STATUS_VALUES,
  isDerivedStatusValue,
  isStoredStatusValue,
  labelOf,
  resolveMediaStateChip,
} from './recordsStatusDictionary';

const storedLabels: Record<string, string> = {
  untracked: '未标记',
  viewed: '已观看',
  browsed: '已浏览',
  want: '想看',
};
const derivedLabels: Record<string, string> = {
  inLibrary: '已入库',
  realWatched: '真实已看',
};

describe('records status dictionary', () => {
  it('covers exactly the 4 stored states plus the 2 derived states', () => {
    expect(RECORDS_STATUS_ENTRIES).toHaveLength(6);
    expect(STORED_STATUS_VALUES).toHaveLength(4);
    expect(ALL_STATUS_VALUES).toHaveLength(6);
  });

  it('keeps stored values identical to VIDEO_STATUS original values (no new values)', () => {
    const storedValues = new Set(STORED_STATUS_VALUES);
    expect(storedValues).toEqual(new Set(Object.values(VIDEO_STATUS)));
  });

  it('keeps derived values aligned with MEDIA_STATE_SELECT_VALUES and non-overlapping with stored', () => {
    const derivedValues = ALL_STATUS_VALUES.filter((value) => !STORED_STATUS_VALUES.includes(value));
    expect(derivedValues.sort()).toEqual([...MEDIA_STATE_SELECT_VALUES].sort());
    for (const value of derivedValues) {
      expect(STORED_STATUS_VALUES).not.toContain(value);
    }
  });

  it('provides complete fields (value/label/kind/badgeClass/hint) with fixed label wording', () => {
    for (const entry of RECORDS_STATUS_ENTRIES) {
      expect(typeof entry.value).toBe('string');
      expect(entry.value.length).toBeGreaterThan(0);
      expect(typeof entry.label).toBe('string');
      expect(entry.label.length).toBeGreaterThan(0);
      expect(['stored', 'derived']).toContain(entry.kind);
      expect(typeof entry.badgeClass).toBe('string');
      expect(entry.badgeClass.length).toBeGreaterThan(0);
      expect(typeof entry.hint).toBe('string');
      expect(entry.hint.length).toBeGreaterThan(0);
      if (entry.kind === 'stored') {
        expect(storedLabels[entry.value]).toBe(entry.label);
      } else {
        expect(derivedLabels[entry.value]).toBe(entry.label);
      }
    }
  });

  it('labels stored/derived values via labelOf and passes unknown values through unchanged', () => {
    expect(labelOf('viewed')).toBe('已观看');
    expect(labelOf('untracked')).toBe('未标记');
    expect(labelOf('inLibrary')).toBe('已入库');
    expect(labelOf('realWatched')).toBe('真实已看');
    expect(labelOf('legacy-unknown')).toBe('legacy-unknown');
    expect(labelOf('')).toBe('');
  });

  it('classifies stored vs derived values', () => {
    for (const value of STORED_STATUS_VALUES) {
      expect(isStoredStatusValue(value)).toBe(true);
      expect(isDerivedStatusValue(value)).toBe(false);
    }
    expect(isStoredStatusValue('inLibrary')).toBe(false);
    expect(isStoredStatusValue('realWatched')).toBe(false);
    expect(isStoredStatusValue(undefined)).toBe(false);
    expect(isDerivedStatusValue('inLibrary')).toBe(true);
    expect(isDerivedStatusValue('realWatched')).toBe(true);
    expect(isDerivedStatusValue('viewed')).toBe(false);
    expect(isDerivedStatusValue(null)).toBe(false);
  });

  it('resolves the derived chip with realWatched priority and no-hit silence', () => {
    expect(resolveMediaStateChip(null)).toBeNull();
    expect(resolveMediaStateChip(undefined)).toBeNull();
    expect(resolveMediaStateChip({ inLibrary: false, realWatched: false })).toBeNull();
    expect(resolveMediaStateChip({ inLibrary: true, realWatched: false })).toMatchObject({
      value: 'inLibrary',
      label: '已入库',
      kind: 'derived',
    });
    const both: MediaStateHit = { inLibrary: true, realWatched: true };
    expect(resolveMediaStateChip(both)).toMatchObject({ value: 'realWatched', label: '真实已看' });
  });
});
