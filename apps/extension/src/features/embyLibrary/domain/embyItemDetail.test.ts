/**
 * @file embyItemDetail.test.ts
 */
import { describe, expect, it, vi } from 'vitest';
import { EMBY_FETCH_TIMEOUT_MESSAGE } from './fetchWithTimeout';
import {
  buildChapterImageUrl,
  fetchEmbyItemDetail,
  formatBytes,
  formatChapterTime,
  formatRuntime,
  mapChapters,
  mapEmbyItemToDetailView,
  mapMediaStreams,
} from './embyItemDetail';

const server = {
  url: 'http://emby.local:8096/',
  apiKey: 'k',
  accessToken: 't',
  type: 'emby' as const,
  userId: 'user-1',
};

describe('embyItemDetail mapping', () => {
  it('maps overview people genres and media streams', () => {
    const detail = mapEmbyItemToDetailView(
      server,
      {
        Id: '3960',
        Name: 'GANA-3370 Title',
        Overview: '简介文字',
        Taglines: ['发行日期: 2026-04-09'],
        ProductionYear: 2026,
        CommunityRating: 9.4,
        Genres: ['业余', '美乳'],
        Studios: [{ Name: 'ナンパTV' }],
        People: [
          { Id: '1', Name: '导演A', Type: 'Director' },
          { Id: '2', Name: '演员B', Type: 'Actor', Role: '主演', PrimaryImageTag: 'p' },
        ],
        ImageTags: { Primary: 'prim' },
        BackdropImageTags: ['bd'],
        RunTimeTicks: 59 * 60 * 10_000_000,
        MediaSources: [
          {
            Id: 'ms',
            Container: 'mp4',
            Size: 2.5 * 1024 * 1024 * 1024,
            MediaStreams: [
              { Type: 'Video', Codec: 'h264', Width: 1920, Height: 1080, DisplayTitle: '1080p H264' },
              { Type: 'Audio', Codec: 'aac', Channels: 2, Language: 'eng' },
              { Type: 'Subtitle', Codec: 'srt', Language: 'chi', DisplayTitle: '中文' },
            ],
          },
        ],
        Chapters: [
          { Name: '开场', StartPositionTicks: 0, ImageTag: 'ch0', ChapterIndex: 0 },
          { Name: '高潮', StartPositionTicks: 600 * 10_000_000, ImageTag: 'ch1', ChapterIndex: 1 },
        ],
      },
      {
        similar: [{ itemId: 's1', name: '相似片' }],
        collections: [{ itemId: 'c1', name: '合集A', type: 'BoxSet' }],
      },
    );

    expect(detail.itemId).toBe('3960');
    expect(detail.overview).toContain('简介');
    expect(detail.genres).toContain('业余');
    expect(detail.studios).toEqual(['ナンパTV']);
    expect(detail.people.some((p) => p.type === 'Director')).toBe(true);
    expect(detail.primaryImageUrl).toContain('/Images/Primary');
    expect(detail.videoSummary).toMatch(/1080|h264/i);
    expect(detail.mediaStreams.length).toBe(3);
    expect(detail.mediaStreams.some((s) => /subtitle/i.test(s.type))).toBe(true);
    expect(detail.chapters).toHaveLength(2);
    expect(detail.chapters[1].startTimeSeconds).toBe(600);
    expect(detail.chapters[0].imageUrl).toContain('/Images/Chapter/0');
    expect(detail.chapters[0].imageUrl).toContain('tag=ch0');
    expect(detail.similar[0].name).toBe('相似片');
    expect(detail.collections[0].name).toBe('合集A');
    expect(formatRuntime(detail.runtimeTicks)).toContain('分钟');
    expect(formatBytes(detail.sizeBytes)).toMatch(/GB/);
    expect(formatChapterTime(detail.chapters[1].startPositionTicks)).toBe('10:00');
  });

  it('builds person image URLs when Emby omits PrimaryImageTag', () => {
    const detail = mapEmbyItemToDetailView(server, {
      Id: 'movie-1',
      Name: 'Title',
      People: [
        { Id: 'person-without-tag', Name: '演员A', Type: 'Actor' },
        { Id: 'person-with-tag', Name: '演员B', Type: 'Actor', PrimaryImageTag: 'person-tag' },
      ],
    });

    expect(detail.people[0].imageUrl).toContain('/Items/person-without-tag/Images/Primary');
    expect(detail.people[0].imageUrl).toContain('api_key=k');
    expect(detail.people[1].imageUrl).toContain('tag=person-tag');
  });

  it('buildChapterImageUrl includes mediaSourceId and api_key', () => {
    const url = buildChapterImageUrl(
      { url: 'http://emby.local:8096', apiKey: 'k', accessToken: 'tok' },
      '3960',
      2,
      'tagX',
      'ms1',
      300,
    );
    expect(url).toContain('/Items/3960/Images/Chapter/2');
    expect(url).toContain('tag=tagX');
    expect(url).toContain('mediaSourceId=ms1');
    expect(url).toContain('api_key=tok');
  });

  it('mapChapters falls back names and seconds', () => {
    const chapters = mapChapters(server, {
      Id: '1',
      Chapters: [{ StartPositionTicks: 30_000_000 }],
      MediaSources: [{ Id: 'ms' }],
    });
    expect(chapters[0].name).toMatch(/章节/);
    expect(chapters[0].startTimeSeconds).toBe(3);
    expect(chapters[0].imageUrl).toBeUndefined();
  });

  it('mapMediaStreams empty when no sources', () => {
    expect(mapMediaStreams({ Id: '1' })).toEqual([]);
  });
});

describe('fetchEmbyItemDetail parallel', () => {
  it('loads Jellyfin collections with an API key even without a user id', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/Items/movie-1') return new Response(JSON.stringify({ Id: 'movie-1', Name: 'Movie' }), { status: 200 });
      if (path === '/Items/movie-1/Collections') return new Response(JSON.stringify({ Items: [{ Id: 'box-1', Name: 'Box', Type: 'BoxSet' }] }), { status: 200 });
      return new Response(JSON.stringify({ Items: [] }), { status: 200 });
    });
    const result = await fetchEmbyItemDetail({ server: { ...server, type: 'jellyfin', accessToken: '', userId: '' }, itemId: 'movie-1', fetchImpl });
    expect(result.detail?.collections.map(({ itemId }) => itemId)).toEqual(['box-1']);
    expect(fetchImpl.mock.calls.map(([url]) => new URL(String(url)).pathname)).toContain('/Items/movie-1/Collections');
  });

  it('uses Jellyfin 12 item and collections routes without legacy user paths', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/Items/movie-1') return new Response(JSON.stringify({ Id: 'movie-1', Name: 'Movie' }), { status: 200 });
      if (path === '/Items/movie-1/Collections') return new Response(JSON.stringify({ Items: [{ Id: 'box-1', Name: 'Box', Type: 'BoxSet' }] }), { status: 200 });
      return new Response(JSON.stringify({ Items: [] }), { status: 200 });
    });
    const result = await fetchEmbyItemDetail({ server: { ...server, type: 'jellyfin' }, itemId: 'movie-1', fetchImpl });
    expect(result.success).toBe(true);
    expect(result.detail?.collections.map(({ itemId }) => itemId)).toEqual(['box-1']);
    const paths = fetchImpl.mock.calls.map(([url]) => new URL(String(url)).pathname);
    expect(paths).toContain('/Items/movie-1');
    expect(paths).toContain('/Items/movie-1/Collections');
    expect(paths.some((path) => path.startsWith('/Users/'))).toBe(false);
    for (const [request] of fetchImpl.mock.calls) {
      const fields = new URL(String(request)).searchParams.get('Fields')?.split(',') || [];
      expect(fields).not.toContain('ImageTags');
      expect(fields).not.toContain('UserData');
      expect(fields).not.toContain('PrimaryImageTag');
    }
  });

  it('fetches item + similar + collections when userId present', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/Similar')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            Items: [{ Id: 'sim1', Name: 'Sim', ProductionYear: 2024, ImageTags: { Primary: 'p' } }],
          }),
        } as Response;
      }
      if (u.includes('/Users/') && u.includes('BoxSet')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            Items: [{ Id: 'box1', Name: 'Box', Type: 'BoxSet', ImageTags: { Primary: 'b' } }],
          }),
        } as Response;
      }
      if (u.includes('/Items/3960?')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            Id: '3960',
            Name: 'Title',
            Chapters: [{ Name: 'C1', StartPositionTicks: 0, ImageTag: 't' }],
            MediaSources: [{ Id: 'ms', Container: 'mp4', MediaStreams: [] }],
          }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });

    const ret = await fetchEmbyItemDetail({
      server,
      itemId: '3960',
      fetchImpl: fetchImpl as any,
    });

    expect(ret.success).toBe(true);
    expect(ret.detail?.name).toBe('Title');
    expect(ret.detail?.chapters).toHaveLength(1);
    expect(ret.detail?.similar.some((s) => s.itemId === 'sim1')).toBe(true);
    expect(ret.detail?.collections.some((c) => c.itemId === 'box1')).toBe(true);
    expect(fetchImpl).toHaveBeenCalled();
    const urls = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/Similar'))).toBe(true);
    expect(urls.some((u) => u.includes('IncludeItemTypes=BoxSet'))).toBe(true);
    expect(urls.some((u) => u.includes('Fields=') && u.includes('Chapters'))).toBe(true);
  });

  it('guards against missing credentials without sending any request', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }) as Response);

    const ret = await fetchEmbyItemDetail({
      server: { url: 'http://emby.local:8096/', type: 'emby' as const, apiKey: '', accessToken: '' },
      itemId: '1',
      fetchImpl: fetchImpl as any,
    });

    expect(ret.success).toBe(false);
    expect(ret.error).toContain('未配置凭据');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('401 with apiKey only suggests checking the key or logging in (not "re-login")', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    }) as Response);

    const ret = await fetchEmbyItemDetail({
      server: { url: 'http://emby.local:8096/', type: 'emby' as const, apiKey: 'k' },
      itemId: '1',
      fetchImpl: fetchImpl as any,
    });

    expect(ret.success).toBe(false);
    expect(ret.error).toContain('请检查 API Key 是否有效');
  });

  it('401 with a user session suggests re-login', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    }) as Response);

    const ret = await fetchEmbyItemDetail({
      server: {
        url: 'http://emby.local:8096/',
        type: 'emby' as const,
        accessToken: 't',
        userId: 'u1',
      },
      itemId: '1',
      fetchImpl: fetchImpl as any,
    });

    expect(ret.success).toBe(false);
    expect(ret.error).toContain('用户令牌无效');
  });

  it('skips collections when no userId', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/Similar')) {
        return { ok: true, status: 200, json: async () => ({ Items: [] }) } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ Id: '9', Name: 'X', MediaSources: [] }),
      } as Response;
    });

    const ret = await fetchEmbyItemDetail({
      server: { ...server, userId: undefined },
      itemId: '9',
      fetchImpl: fetchImpl as any,
    });
    expect(ret.success).toBe(true);
    expect(ret.detail?.collections).toEqual([]);
    const urls = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('BoxSet'))).toBe(false);
  });
});

describe('fetchEmbyItemDetail timeout', () => {
  /** 黑洞 fetch：永不响应，signal abort 时按真实 fetch 语义 reject */
  function hangingFetchImpl() {
    return vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (signal?.aborted) { abort(); return; }
        signal?.addEventListener('abort', abort, { once: true });
      }));
  }

  it('服务器黑洞时在超时预算内返回「连接超时」，不再逐条挂满候选路径', async () => {
    const fetchImpl = hangingFetchImpl();
    const started = Date.now();
    const ret = await fetchEmbyItemDetail({
      server,
      itemId: 'blackhole-1',
      fetchImpl: fetchImpl as any,
      timeoutMs: 80,
    });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(2000);
    expect(ret.success).toBe(false);
    expect(ret.error).toBe(EMBY_FETCH_TIMEOUT_MESSAGE);
    // item 只应尝试了 1 条候选路径（后续候选被 abort 拦截），similar/collections 各 1 次
    expect(fetchImpl.mock.calls.length).toBe(3);
  });

  it('正常响应不受超时守卫影响（200 原样成功）', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/Similar')) return { ok: true, status: 200, json: async () => ({ Items: [] }) } as Response;
      return {
        ok: true,
        status: 200,
        json: async () => ({ Id: '42', Name: 'T', MediaSources: [] }),
      } as Response;
    });
    const ret = await fetchEmbyItemDetail({
      server,
      itemId: '42',
      fetchImpl: fetchImpl as any,
      timeoutMs: 5000,
    });
    expect(ret.success).toBe(true);
    expect(ret.detail?.name).toBe('T');
  });
});
