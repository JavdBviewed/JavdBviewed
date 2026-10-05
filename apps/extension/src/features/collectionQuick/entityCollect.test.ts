import { describe, expect, it } from 'vitest';
import { buildCollectUrl, parseEntityLink } from './entityCollect';

const PAGE = 'https://javdb570.com/v/82JB8K';

describe('parseEntityLink（影片页 .movie-panel-info 实体链接识别）', () => {
  it('四实体路径识别（相对/绝对/query/hash 全形态）', () => {
    expect(parseEntityLink('/video_codes/SORA', PAGE)).toEqual({ entity: 'code', id: 'SORA' });
    expect(parseEntityLink('https://javdb570.com/video_codes/SORA', PAGE)).toEqual({ entity: 'code', id: 'SORA' });
    expect(parseEntityLink('/directors/dekM?page=2', PAGE)).toEqual({ entity: 'director', id: 'dekM' });
    expect(parseEntityLink('https://javdb570.com/makers/AEO#videos', PAGE)).toEqual({ entity: 'maker', id: 'AEO' });
    expect(parseEntityLink('/series/gr8A', PAGE)).toEqual({ entity: 'series', id: 'gr8A' });
  });

  it('ID 解码后返回（百分号编码）', () => {
    expect(parseEntityLink('/makers/%E7%89%87%E5%95%86', PAGE)).toEqual({ entity: 'maker', id: '片商' });
  });

  it('非实体路径返回 null（零误伤面）', () => {
    expect(parseEntityLink('/actors/abc123', PAGE)).toBeNull();
    expect(parseEntityLink('/v/ABC-123', PAGE)).toBeNull();
    expect(parseEntityLink('/users/collection_makers', PAGE)).toBeNull();
    expect(parseEntityLink('/search?q=sora', PAGE)).toBeNull();
    expect(parseEntityLink('/video_codes/', PAGE)).toBeNull();
    expect(parseEntityLink('', PAGE)).toBeNull();
    expect(parseEntityLink('/makers/AEO/videos', PAGE)).toBeNull();
  });
});

describe('buildCollectUrl（收藏端点构造）', () => {
  it('四实体端点形态', () => {
    const origin = 'https://javdb570.com';
    expect(buildCollectUrl('code', 'SORA', origin)).toBe('https://javdb570.com/video_codes/SORA/collect');
    expect(buildCollectUrl('director', 'dekM', origin)).toBe('https://javdb570.com/directors/dekM/collect');
    expect(buildCollectUrl('maker', 'AEO', origin)).toBe('https://javdb570.com/makers/AEO/collect');
    expect(buildCollectUrl('series', 'gr8A', origin)).toBe('https://javdb570.com/series/gr8A/collect');
  });

  it('特殊字符 ID 走 encodeURIComponent', () => {
    expect(buildCollectUrl('maker', 'a b', 'https://javdb570.com')).toBe('https://javdb570.com/makers/a%20b/collect');
  });
});
