import { describe, expect, it } from 'vitest';
import type { VideoRecord } from '../../../types';
import {
  buildRecordsItemBaseHtml,
  buildRecordsItemListBadgesHtml,
  buildRecordsItemStarsHtml,
  buildRecordsItemTagsHtml,
  buildRecordsItemUserTagsHtml,
  buildRecordsItemTimeDisplay,
  buildRecordsItemVideoIdHtml,
} from './recordItemViewModel';

const record: VideoRecord = {
  id: 'MKMP-577',
  title: '测试标题',
  status: 'viewed',
  tags: ['中文字幕', '高清'],
  userTags: ['精选', '待整理'],
  createdAt: new Date(2026, 4, 27, 1, 2).getTime(),
  updatedAt: new Date(2026, 4, 28, 3, 4).getTime(),
  javdbUrl: 'https://javdb.com/v/test',
  rating: 4.5,
  userRating: 3.5,
  listIds: ['list-a', 'list-b', 'list-c', 'list-d'],
};

describe('records item view model', () => {
  it('formats created and updated time display', () => {
    expect(buildRecordsItemTimeDisplay(record)).toEqual({
      createdDateText: '2026-05-27 01:02',
      updatedDateText: '2026-05-28 03:04',
      titleText: '创建: 2026-05-27 01:02 | 更新: 2026-05-28 03:04',
      visibleDateText: '2026-05-28 03:04',
    });
  });

  it('builds video id link or plain text html', () => {
    expect(buildRecordsItemVideoIdHtml(record)).toBe('<a href="https://javdb.com/v/test" target="_blank" class="video-id-link">MKMP-577</a>');
    expect(buildRecordsItemVideoIdHtml({ ...record, javdbUrl: '#' })).toBe('<span class="video-id-text">MKMP-577</span>');
  });

  it('builds official and user star html', () => {
    const html = buildRecordsItemStarsHtml(record);
    expect(html).toContain('rating-stars official');
    expect(html).toContain('官方评分: 4.50');
    expect(html).toContain('rating-stars user');
    expect(html).toContain('我的评分: 3.5');
    expect(html).toContain('fa-star-half-alt');
  });

  it('builds selected tag and list badge html', () => {
    expect(buildRecordsItemTagsHtml(record, new Set(['中文']))).toContain('video-tag selected');
    const listsHtml = buildRecordsItemListBadgesHtml(record, {
      selectedListIds: new Set(['list-b']),
      listNameById: new Map([
        ['list-a', '清单 A'],
        ['list-b', '清单 B'],
        ['list-c', '清单 C'],
        ['list-d', '清单 D'],
      ]),
    });
    expect(listsHtml).toContain('video-list-tag selected');
    expect(listsHtml).toContain('另有 1 个清单');
  });

  it('renders local user tags separately from scraped tags', () => {
    const html = buildRecordsItemUserTagsHtml(record, new Set(['精选']));
    expect(html).toContain('video-user-tag selected');
    expect(html).toContain('待整理');
    expect(html).not.toContain('中文字幕');
  });

  it('builds card and list base html', () => {
    const cardHtml = buildRecordsItemBaseHtml(record, {
      viewMode: 'card',
      selectedTags: new Set(['高清']),
      selectedListIds: new Set(),
      listNameById: new Map(),
    });
    expect(cardHtml).toContain('video-content-wrapper');
    expect(cardHtml).toContain('<span class="video-title">测试标题</span>');
    expect(cardHtml).not.toContain('video-date');

    const listHtml = buildRecordsItemBaseHtml(record, {
      viewMode: 'list',
      selectedTags: new Set(),
      selectedListIds: new Set(),
      listNameById: new Map(),
    });
    expect(listHtml).toContain('video-date');
    expect(listHtml).toContain('status-viewed');
  });
});

describe('records item status badge chinese label + derived chip (10-24 state-dict)', () => {
  const baseOptions = {
    selectedTags: new Set() as Set<string>,
    selectedListIds: new Set() as Set<string>,
    listNameById: new Map() as Map<string, string>,
  };

  it('renders stored status badge with chinese label while keeping the status-* class', () => {
    const listHtml = buildRecordsItemBaseHtml(record, { viewMode: 'list', ...baseOptions });
    expect(listHtml).toContain('status-viewed');
    expect(listHtml).toContain('>已观看</span>');
    expect(listHtml).not.toContain('>viewed</span>');

    const wantHtml = buildRecordsItemBaseHtml({ ...record, status: 'want' } as VideoRecord, {
      viewMode: 'list',
      ...baseOptions,
    });
    expect(wantHtml).toContain('status-want');
    expect(wantHtml).toContain('>想看</span>');
  });

  it('renders realWatched chip with priority over inLibrary on double hit', () => {
    const html = buildRecordsItemBaseHtml(record, {
      viewMode: 'list',
      ...baseOptions,
      mediaStateHit: { inLibrary: true, realWatched: true },
    });
    expect(html).toContain('media-state-chip-realwatched');
    expect(html).toContain('真实已看');
    expect(html).not.toContain('media-state-chip-inlibrary');
  });

  it('renders inLibrary chip when only inLibrary is hit', () => {
    const html = buildRecordsItemBaseHtml(record, {
      viewMode: 'list',
      ...baseOptions,
      mediaStateHit: { inLibrary: true, realWatched: false },
    });
    expect(html).toContain('media-state-chip-inlibrary');
    expect(html).toContain('>已入库</span>');
    expect(html).not.toContain('media-state-chip-realwatched');
  });

  it('renders no chip on miss or absent hit', () => {
    expect(buildRecordsItemBaseHtml(record, { viewMode: 'list', ...baseOptions })).not.toContain('media-state-chip');
    expect(buildRecordsItemBaseHtml(record, {
      viewMode: 'list',
      ...baseOptions,
      mediaStateHit: { inLibrary: false, realWatched: false },
    })).not.toContain('media-state-chip');
  });

  it('does not render chip inside card base html (card chip is DOM-side)', () => {
    const cardHtml = buildRecordsItemBaseHtml(record, {
      viewMode: 'card',
      ...baseOptions,
      mediaStateHit: { inLibrary: true, realWatched: true },
    });
    expect(cardHtml).not.toContain('media-state-chip');
    expect(cardHtml).not.toContain('video-status');
  });
});
