import { describe, expect, it } from 'vitest';
import { selectListItemsByCodes, selectListItemsForProcessing } from './listProcessingPolicy';

type Marker = {
  processed: boolean;
  filterProcessed: boolean;
  hasAttribute: (name: string) => boolean;
};

function marker(processed: boolean, filterProcessed = false): Marker {
  return {
    processed,
    filterProcessed,
    hasAttribute(name) {
      if (name === 'data-processed') return this.processed;
      if (name === 'data-filter-processed') return this.filterProcessed;
      return false;
    },
  };
}

describe('list processing policy', () => {
  it('only selects unprocessed items during incremental list updates', () => {
    const existing = marker(true);
    const appended = marker(false);

    expect(selectListItemsForProcessing([existing, appended])).toEqual([appended]);
  });

  it('selects every item for an explicit refresh without changing filter markers', () => {
    const first = marker(true, true);
    const second = marker(false, true);

    expect(selectListItemsForProcessing([first, second], { force: true })).toEqual([first, second]);
    expect(first.filterProcessed).toBe(true);
    expect(second.filterProcessed).toBe(true);
  });

  it('scopes a refresh to the completed realtime-check codes', () => {
    const first = { code: 'ABC-001' };
    const second = { code: 'ABC-002' };
    const selected = selectListItemsByCodes(
      [first, second],
      new Set(['ABC-002']),
      item => item.code,
    );

    expect(selected).toEqual([second]);
  });
});
