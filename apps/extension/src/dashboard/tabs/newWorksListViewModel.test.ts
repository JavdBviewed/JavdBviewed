import { describe, expect, it } from 'vitest';
import type { NewWorkRecord } from '../../types';
import {
  buildNewWorkItemHtml,
  buildNewWorksEmptyHtml,
  buildNewWorksErrorHtml,
  buildNewWorksLoadingHtml,
  buildNewWorksPaginationHtml,
} from './newWorksListViewModel';

function work(overrides: Partial<NewWorkRecord> = {}): NewWorkRecord {
  return {
    id: 'work-1',
    actorId: 'actor-1',
    actorName: 'Alice',
    title: 'New Work',
    javdbUrl: 'https://javdb.com/v/abc',
    coverImage: 'https://img.example.com/cover.jpg',
    tags: ['高清', '中文字幕', '新人', '企画'],
    discoveredAt: new Date('2026-05-02T00:00:00+08:00').getTime(),
    releaseDate: '2026-05-01',
    isRead: false,
    ...overrides,
  };
}

describe('new works list view model', () => {
  it('renders unread selected work item with cover, tags and mark-read action', () => {
    const html = buildNewWorkItemHtml(work(), { selected: true });

    expect(html).toContain('new-work-item unread selected');
    expect(html).toContain('data-work-id="work-1"');
    expect(html).toContain('data-javdb-url="https://javdb.com/v/abc"');
    expect(html).toContain('checked');
    expect(html).toContain('src="https://img.example.com/cover.jpg"');
    expect(html).toContain('New Work');
    expect(html).toContain('Alice');
    expect(html).toContain('发行于 2026-05-01');
    expect(html).toContain('<span class="new-work-tag">高清</span>');
    expect(html).toContain('<span class="new-work-tag">+1</span>');
    expect(html).toContain('data-action="mark-read"');
  });

  it('renders read work item without mark-read action and uses cover placeholder', () => {
    const html = buildNewWorkItemHtml(work({
      isRead: true,
      coverImage: undefined,
      tags: [],
      releaseDate: undefined,
    }), { selected: false });

    expect(html).toContain('new-work-item read ');
    expect(html).not.toContain('checked');
    expect(html).toContain('<div class="new-work-cover"></div>');
    expect(html).not.toContain('data-action="mark-read"');
    expect(html).not.toContain('new-work-tags');
  });

  it('builds loading, empty and error states', () => {
    expect(buildNewWorksLoadingHtml()).toContain('加载中');
    expect(buildNewWorksEmptyHtml()).toContain('暂无新作品');
    expect(buildNewWorksErrorHtml()).toContain('加载新作品列表失败');
  });

  it('renders no pagination buttons when there is at most one page', () => {
    expect(buildNewWorksPaginationHtml({ total: 0, currentPage: 1, pageSize: 10 })).toBe('');
    expect(buildNewWorksPaginationHtml({ total: 10, currentPage: 1, pageSize: 10 })).toBe('');
    expect(buildNewWorksPaginationHtml({ total: 20, currentPage: 1, pageSize: 20 })).toBe('');
  });

  it('first page: first/previous disabled, pages 1-3, ellipsis, last page, next enabled', () => {
    const html = buildNewWorksPaginationHtml({ total: 100, currentPage: 1, pageSize: 10 });

    expect(html).toContain('<button class="page-button" data-page="1" title="首页" disabled><i class="fas fa-angles-left"></i></button>');
    expect(html).toContain('<button class="page-button" data-page="1" title="上一页" disabled><i class="fas fa-angle-left"></i></button>');
    expect(html).toContain('<button class="page-button active" data-page="1">1</button>');
    expect(html).toContain('<button class="page-button" data-page="2">2</button>');
    expect(html).toContain('<button class="page-button" data-page="3">3</button>');
    expect(html).toContain('<button class="page-button ellipsis" disabled>...</button>');
    expect(html).toContain('<button class="page-button" data-page="10">10</button>');
    expect(html).toContain('<button class="page-button" data-page="2" title="下一页"><i class="fas fa-angle-right"></i></button>');
    expect(html).toContain('<button class="page-button" data-page="10" title="末页"><i class="fas fa-angles-right"></i></button>');
    expect(html).not.toContain('data-page="4"');
    expect(html).not.toContain('data-page="9"');
  });

  it('middle page: first enabled, window around current, ellipses on both gaps', () => {
    const html = buildNewWorksPaginationHtml({ total: 100, currentPage: 6, pageSize: 10 });

    expect(html).toContain('<button class="page-button" data-page="1" title="首页"><i class="fas fa-angles-left"></i></button>');
    expect(html).toContain('<button class="page-button" data-page="5" title="上一页"><i class="fas fa-angle-left"></i></button>');
    expect(html).toContain('<button class="page-button" data-page="1">1</button>');
    expect(html).toContain('<button class="page-button" data-page="4">4</button>');
    expect(html).toContain('<button class="page-button active" data-page="6">6</button>');
    expect(html).toContain('<button class="page-button" data-page="8">8</button>');
    expect(html).toContain('<button class="page-button" data-page="10">10</button>');
    expect(html).toContain('<button class="page-button" data-page="7" title="下一页"><i class="fas fa-angle-right"></i></button>');
    expect(html).toContain('<button class="page-button" data-page="10" title="末页"><i class="fas fa-angles-right"></i></button>');
    expect((html.match(/page-button ellipsis/g) || []).length).toBe(2);
    expect(html).not.toContain('data-page="3"');
  });

  it('last page: last active, next/last arrows disabled', () => {
    const html = buildNewWorksPaginationHtml({ total: 100, currentPage: 10, pageSize: 10 });

    expect(html).toContain('<button class="page-button" data-page="1" title="首页"><i class="fas fa-angles-left"></i></button>');
    expect(html).toContain('<button class="page-button" data-page="9" title="上一页"><i class="fas fa-angle-left"></i></button>');
    expect(html).toContain('<button class="page-button active" data-page="10">10</button>');
    expect(html).toContain('<button class="page-button" data-page="10" title="下一页" disabled><i class="fas fa-angle-right"></i></button>');
    expect(html).toContain('<button class="page-button" data-page="10" title="末页" disabled><i class="fas fa-angles-right"></i></button>');
  });

  it('adjacent pages only: no ellipsis', () => {
    expect(buildNewWorksPaginationHtml({ total: 20, currentPage: 1, pageSize: 10 })).not.toContain('ellipsis');
    expect(buildNewWorksPaginationHtml({ total: 30, currentPage: 2, pageSize: 10 })).not.toContain('ellipsis');
    expect(buildNewWorksPaginationHtml({ total: 50, currentPage: 3, pageSize: 10 })).not.toContain('ellipsis');
  });
});

describe('new works list 云扫描来源徽章（10-19 线 2：A.4）', () => {
  it('sourceType=cloud-scan → 行内出现「云扫描」徽章', () => {
    const html = buildNewWorkItemHtml(work({ sourceType: 'cloud-scan' }));
    expect(html).toContain('<span class="new-work-source-badge">云扫描</span>');
  });

  it('无 sourceType / 其它 sourceType → 无徽章（本地扫描零漂移）', () => {
    expect(buildNewWorkItemHtml(work())).not.toContain('new-work-source-badge');
    expect(buildNewWorkItemHtml(work({ sourceType: 'javdb' }))).not.toContain('new-work-source-badge');
  });
});
