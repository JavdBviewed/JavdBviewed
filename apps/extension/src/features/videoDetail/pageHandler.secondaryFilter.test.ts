// @vitest-environment jsdom

/**
 * @file pageHandler.secondaryFilter.test.ts
 * @description isJavFormVideoId 二次过滤门禁谓词矩阵（10-22-western-view-record）
 *
 * 语义：JAV 形态 ID（strict 代码命中且 kind ≠ western-dot）= true → 二次过滤
 * （genre 标签与描述双空 → 拒存）照常生效；western-dot 与 strict 未命中
 * （URL code 兜底）= false → 跳过过滤，按已得字段入库。
 */
import { describe, expect, it } from 'vitest';
import { isJavFormVideoId } from './pageHandler';

describe('isJavFormVideoId (10-22 二次过滤门禁)', () => {
    it('jav 形态 → true', () => {
        expect(isJavFormVideoId('SSIS-123')).toBe(true);
    });
    it('fc2 形态 → true', () => {
        expect(isJavFormVideoId('FC2-PPV-4903984')).toBe(true);
    });
    it('numeric-dash 形态 → true', () => {
        expect(isJavFormVideoId('011015-780')).toBe(true);
    });
    it('uncensored 形态 → true', () => {
        expect(isJavFormVideoId('072625_01')).toBe(true);
    });
    it('western-dot（欧美）→ false（跳过二次过滤）', () => {
        expect(isJavFormVideoId('MILFY.2026.09.30')).toBe(false);
    });
    it('URL code（strict 未命中）→ false（跳过二次过滤）', () => {
        expect(isJavFormVideoId('BzQa5G')).toBe(false);
    });
    it('空串 → false', () => {
        expect(isJavFormVideoId('')).toBe(false);
    });
});
