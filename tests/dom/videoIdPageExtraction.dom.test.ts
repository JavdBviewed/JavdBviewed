/**
 * @file videoIdPageExtraction.dom.test.ts
 * @description extractVideoIdFromPage 三法提取回归（10-22-western-view-record）
 * @module tests/dom
 *
 * 新语义（2.1.1 build 270）：
 * - 方法1（标题）/方法2（旧 panel）仅采纳严格番号命中（含 western-dot）；
 *   严格未命中不再取首词兜底，落方法3。
 * - 方法3 URL code 用原始大小写（现状经共享层会再大写）。
 * - JAV 正常页标题 strict 必中 → 方法3 不可达 → JAV 主链零漂移（本文件绿色锁）。
 */
import { describe, expect, it } from 'vitest';
import { extractVideoIdFromPage } from '../../apps/extension/src/platform/browser/videoId';

function setPageDom(pathname: string, titleText: string | null, panelText: string | null): void {
    window.history.pushState({}, '', pathname);
    const titleBlock = titleText === null
        ? ''
        : `<h2 class="title is-4"><strong>${titleText}</strong></h2>`;
    const panelBlock = panelText === null
        ? ''
        : `<nav class="panel"><div class="panel-block first-block"><span class="title is-4">${panelText}</span></div></nav>`;
    document.body.innerHTML = `<main>${titleBlock}${panelBlock}</main>`;
}

describe('extractVideoIdFromPage (10-22 三法提取)', () => {
    it('方法1：JAV 标题 strict 命中 → 零漂移', () => {
        setPageDom('/v/ssis-123', 'SSIS-123 测试影片', null);
        expect(extractVideoIdFromPage()).toBe('SSIS-123');
    });

    it('方法1：欧美标题 western-dot strict 命中 → 采纳大写标题码（10-13 身份，零漂移）', () => {
        setPageDom('/v/BzQa5G', 'Milfy.2026.09.30', null);
        expect(extractVideoIdFromPage()).toBe('MILFY.2026.09.30');
    });

    it('方法1：标题 strict 全不中 → 落方法3，URL code 原始大小写（RED：现状首词垃圾 ID）', () => {
        setPageDom('/v/BzQa5G', 'Some Random Movie 2026', null);
        expect(extractVideoIdFromPage()).toBe('BzQa5G');
    });

    it('方法2：旧 panel strict 命中 → 零漂移', () => {
        setPageDom('/v/ssis-456', null, 'SSIS-456');
        expect(extractVideoIdFromPage()).toBe('SSIS-456');
    });

    it('方法2：panel strict 全不中 → 落方法3，原始大小写（RED：现状首词垃圾 ID）', () => {
        setPageDom('/v/yxYQA0', null, 'Another Random Words');
        expect(extractVideoIdFromPage()).toBe('yxYQA0');
    });

    it('方法3：JAV 混合大小写 URL 码退化边缘 → 原始大小写（RED：现状再大写 Z4ZM2W）', () => {
        setPageDom('/v/z4Zm2W', null, null);
        expect(extractVideoIdFromPage()).toBe('z4Zm2W');
    });

    it('方法3：纯大写 URL 码 → raw 同值零漂移', () => {
        setPageDom('/v/82JB8K', null, null);
        expect(extractVideoIdFromPage()).toBe('82JB8K');
    });
});
