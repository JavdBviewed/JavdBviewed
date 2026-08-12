import { describe, expect, it } from 'vitest';
import type { MediaBrowseItem, MediaViewSettings } from './mediaBrowseModel';
import {
  areMediaCardPropsEqual,
  areMediaHeroCardPropsEqual,
  areResumeMediaCardPropsEqual,
} from './mediaCardRenderPolicy';

const item: MediaBrowseItem = {
  code: 'PERF-0001',
  title: '测试影片',
  source: 'emby',
  year: '',
  hue: 1,
  itemId: 'item-1',
  serverUrl: 'http://media.local:8096',
  watchState: 'in_library',
};

const viewSettings: MediaViewSettings = {
  coverView: 'thumb',
  cardSize: 'normal',
  visibleFields: {
    rating: true,
    year: true,
    source: true,
    watchState: true,
    runtime: true,
    genres: true,
    studios: true,
    tags: true,
  },
};

const callbacks = {
  onWatchChanged: () => undefined,
  onEnqueuedCleanup: () => undefined,
  onPlayItem: () => undefined,
  onOpenDetail: () => undefined,
};

function props(overrides: Partial<typeof callbacks & {
  item: MediaBrowseItem;
  usingPreview: boolean;
  coverView: MediaViewSettings['coverView'];
  viewSettings: MediaViewSettings;
}> = {}) {
  return {
    item,
    usingPreview: false,
    coverView: viewSettings.coverView,
    viewSettings,
    ...callbacks,
    ...overrides,
  };
}

describe('media card render policy', () => {
  it('skips parent-only rerenders when the card inputs and callbacks are stable', () => {
    expect(areMediaCardPropsEqual(props(), props())).toBe(true);
  });

  it('rerenders when the catalog item changes', () => {
    expect(areMediaCardPropsEqual(
      props(),
      props({ item: { ...item, userData: { percent: 20, positionTicks: 1 } } }),
    )).toBe(false);
  });

  it('rerenders when a card behavior callback changes', () => {
    expect(areMediaCardPropsEqual(
      props(),
      props({ onPlayItem: () => undefined }),
    )).toBe(false);
  });
});

describe('resume and hero card render policies', () => {
  const resumeCallbacks = {
    onPlay: () => undefined,
  };
  const heroCallbacks = {
    onSetHeroStep: () => undefined,
    onRequestPlayback: () => undefined,
    onOpenDetail: () => undefined,
  };

  it('skips unrelated parent rerenders for a resume card', () => {
    const previous = { item, ...resumeCallbacks };
    const next = { item, ...resumeCallbacks };

    expect(areResumeMediaCardPropsEqual(previous, next)).toBe(true);
    expect(areResumeMediaCardPropsEqual(
      previous,
      { ...next, item: { ...item, userData: { percent: 40 } } },
    )).toBe(false);
  });

  it('rerenders a hero card when its carousel position or item changes', () => {
    const previous = {
      item,
      virtualIndex: 0,
      itemIndex: 0,
      position: 0,
      coverView: 'thumb' as const,
      usingPreview: false,
      ...heroCallbacks,
    };

    expect(areMediaHeroCardPropsEqual(previous, { ...previous })).toBe(true);
    expect(areMediaHeroCardPropsEqual(
      previous,
      { ...previous, position: 1 },
    )).toBe(false);
    expect(areMediaHeroCardPropsEqual(
      previous,
      { ...previous, item: { ...item, title: '更新标题' } },
    )).toBe(false);
  });
});
