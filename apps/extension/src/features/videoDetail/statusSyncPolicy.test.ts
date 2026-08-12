import { describe, expect, it } from 'vitest';
import { VIDEO_STATUS } from '../../utils/config';
import {
  isRelevantStatusMutation,
  resolveLibraryStatusFromPageStatus,
} from './statusSyncPolicy';

describe('video detail status sync policy', () => {
  it('does not downgrade a locally viewed record when the page status is temporarily unknown', () => {
    expect(resolveLibraryStatusFromPageStatus(VIDEO_STATUS.VIEWED, null)).toBeNull();
    expect(resolveLibraryStatusFromPageStatus(VIDEO_STATUS.WANT, null)).toBeNull();
  });

  it('allows an explicit user status removal to return the record to browsed', () => {
    expect(resolveLibraryStatusFromPageStatus(VIDEO_STATUS.VIEWED, null, true))
      .toBe(VIDEO_STATUS.BROWSED);
    expect(resolveLibraryStatusFromPageStatus(VIDEO_STATUS.WANT, null, true))
      .toBe(VIDEO_STATUS.BROWSED);
  });

  it('recognizes mutations inside the status controls without reading the whole page', () => {
    const statusText = {} as Node;
    const unrelatedText = {} as Node;
    const controls = {
      contains: (node: Node) => node === statusText,
    } as unknown as Element;

    expect(isRelevantStatusMutation(statusText, controls)).toBe(true);
    expect(isRelevantStatusMutation(unrelatedText, controls)).toBe(false);
  });
});
