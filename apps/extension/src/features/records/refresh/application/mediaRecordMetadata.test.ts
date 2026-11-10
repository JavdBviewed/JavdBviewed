import { describe, expect, it } from 'vitest';
import { findMediaMetadataMatch, parseMediaMetadata } from './mediaRecordMetadata';
const searchItem = (url: string, code = 'ABC-123') => `<div class="item"><a href="${url}" title="合成标题"><div class="video-title"><strong>${code}</strong> 合成标题</div></a></div>`;
const block = (label: string, value: string) => `<div class="panel-block"><strong>${label}:</strong><span class="value">${value}</span></div>`;
const detail = (code = 'ABC-123') => `<div class="video-detail"><h2 class="title"><strong>${code}</strong> <span>合成标题 &amp; 更多</span></h2><img class="video-cover" src="https://img.invalid/cover.jpg">${block('番號', code)}${block('日期','2024-02-29')}${block('時長','123 分鍾')}${block('演員','<a href="/actors/a">甲</a><a href="/actors/b">乙</a>')}${block('導演','<a href="/directors/a">导演甲</a>')}${block('片商','<a href="/makers/a">片商甲</a>')}${block('發行','<a href="/publishers/a">发行甲</a>')}${block('系列','<a href="/series/a">系列甲</a>')}${block('類別','<a href="/tags/a">剧情</a>')}${block('評分','4.25 分, 123 人評價')}</div>`;
describe('media record site metadata', () => {
 it('requires a unique exact code match and rejects ambiguous or external destinations', () => {
   expect(findMediaMetadataMatch(searchItem('/v/aaa'), 'ABC-123')).toMatchObject({ href: 'https://javdb.com/v/aaa' });
   expect(findMediaMetadataMatch(searchItem('/v/aaa', 'ABC-1234'), 'ABC-123')).toBeNull();
   expect(() => findMediaMetadataMatch(searchItem('/v/aaa') + searchItem('/v/bbb'), 'ABC-123')).toThrow(/多个/);
   expect(findMediaMetadataMatch(searchItem('https://evil.invalid/v/a'), 'ABC-123')).toBeNull();
   expect(findMediaMetadataMatch(searchItem('/v/aaa') + searchItem('/v/aaa'), 'ABC-123')).not.toBeNull();
 });
 it('extracts descriptive fields with units without creating personal status or playback fields', () => {
   expect(parseMediaMetadata(detail(), 'ABC-123', 'https://javdb.com/v/aaa')).toMatchObject({
     title: '合成标题 & 更多', releaseDate: '2024-02-29', duration: 123, actors: ['甲','乙'], director: '导演甲', maker: '片商甲', publisher: '发行甲', series: '系列甲', tags: ['剧情'], rating: 4.25, ratingCount: 123, javdbImage: 'https://img.invalid/cover.jpg', javdbUrl: 'https://javdb.com/v/aaa',
   });
   const result = parseMediaMetadata(detail(), 'ABC-123', 'https://javdb.com/v/aaa');
   for (const key of ['id', 'status', 'isFavorite', 'completed', 'sourceType', 'durationMs']) expect(result).not.toHaveProperty(key);
 });
 it('rejects non-detail, mismatched code, and empty metadata; invalid optional values stay absent', () => {
   expect(() => parseMediaMetadata('<title>Sign in</title>', 'ABC-123', 'https://javdb.com/v/a')).toThrow();
   expect(() => parseMediaMetadata(detail('ABC-999'), 'ABC-123', 'https://javdb.com/v/a')).toThrow(/番号/);
   const result = parseMediaMetadata(detail().replace('2024-02-29', '2023-02-29').replace('123 分鍾', 'unknown').replace('4.25 分', '99 分'), 'ABC-123', 'https://javdb.com/v/a');
   expect(result.releaseDate).toBeUndefined(); expect(result.duration).toBeUndefined(); expect(result.rating).toBeUndefined();
 });
});
