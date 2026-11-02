import { describe, expect, it } from 'vitest';
import { createNewWorksTabState } from './newWorksTabState';

describe('new works tab state', () => {
  it('defaults the page size to ten and the page to one', () => {
    const state = createNewWorksTabState();

    expect(state.getPageSize()).toBe(10);
    expect(state.getPage()).toBe(1);
  });

  it('clamps setPageSize to the option set', () => {
    const state = createNewWorksTabState();

    state.setPageSize(50);
    expect(state.getPageSize()).toBe(50);
    state.setPageSize(1000);
    expect(state.getPageSize()).toBe(10);
    state.setPageSize(NaN);
    expect(state.getPageSize()).toBe(10);
  });

  it('keeps the existing page get/set behavior', () => {
    const state = createNewWorksTabState();

    state.setPage(3);
    expect(state.getPage()).toBe(3);
  });
});
