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

  it('builds pagination window with disabled edges and active page', () => {
    expect(buildNewWorksPaginationHtml({ total: 20, currentPage: 1, pageSize: 20 })).toBe('');

    const html = buildNewWorksPaginationHtml({ total: 100, currentPage: 3, pageSize: 10 });

    expect(html).toContain('<button class="page-button" data-page="2">上一页</button>');
    expect(html).toContain('<button class="page-button active" data-page="3">3</button>');
    expect(html).toContain('<button class="page-button" data-page="4">下一页</button>');
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
