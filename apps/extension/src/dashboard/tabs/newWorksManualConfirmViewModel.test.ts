/**
 * @file newWorksManualConfirmViewModel.test.ts
 * @description 新作品手动确认弹窗展示层单测：六桶分项稳定、Y 口径取 pendingWorks 条数、
 *              脚注出现条件、HTML 转义与渲染上限、四类 toast 文案。
 * @module dashboard/tabs
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_RENDERED_CONFIRM_WORKS,
  NEW_WORKS_CONFIRM_CANCEL_LABEL,
  buildCommitFailedToastMessage,
  buildDiscardedToastMessage,
  buildNewWorksCommitToastMessage,
  buildNewWorksConfirmModalHtml,
  buildNewWorksConfirmSummary,
  buildNoPendingWorksToastMessage,
  formatNewWorksRuleBreakdownCounts,
  formatNewWorksRuleBreakdownParts,
  type NewWorksManualPendingWork,
} from './newWorksManualConfirmViewModel';

function makeWorks(count: number, prefix = 'ABC'): NewWorksManualPendingWork[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${String(i + 1).padStart(3, '0')}`,
    title: `T${i + 1}`,
    actorName: 'Alice',
  }));
}

describe('formatNewWorksRuleBreakdownCounts / Parts', () => {
  it('六个规则桶恒定全列（含 0 值），AR 桶标签为「AR 影片」', () => {
    const rows = formatNewWorksRuleBreakdownCounts({ dateRange: 38, viewed: 0, ar: 2 });
    expect(rows.map(r => r.label)).toEqual([
      '日期范围外', '已看', '已浏览', '想看', 'AR 影片', '类别黑名单',
    ]);
    expect(rows.map(r => r.value)).toEqual([38, 0, 0, 0, 2, 0]);
  });

  it('缺字段/脏值归零，负数与非数字不产生 NaN', () => {
    expect(formatNewWorksRuleBreakdownCounts().map(r => r.value))
      .toEqual([0, 0, 0, 0, 0, 0]);
    expect(formatNewWorksRuleBreakdownCounts({ dateRange: -5, viewed: undefined, want: 'x' as never })
      .map(r => r.value)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(formatNewWorksRuleBreakdownParts({ browsed: 3 }))
      .toEqual(['日期范围外 0', '已看 0', '已浏览 3', '想看 0', 'AR 影片 0', '类别黑名单 0']);
  });
});

describe('buildNewWorksConfirmSummary', () => {
  const source = {
    identifiedTotal: 43,
    existingCount: 3,
    breakdown: { dateRange: 30, viewed: 4, browsed: 3, want: 2, ar: 2, categoryBlack: 1 },
    pendingWorks: makeWorks(2),
  };

  it('概览/剔除行/按钮文案逐字，且可入库 Y 取 pendingWorks 条数', () => {
    const s = buildNewWorksConfirmSummary(source);
    expect(s.title).toBe('新作品检查完成');
    expect(s.overview).toBe('已识别 43 部 ｜ 可入库 2 部 ｜ 已在新作品库 3 部');
    expect(s.ruleLine).toBe('按规则剔除 42 部：日期范围外 30 / 已看 4 / 已浏览 3 / 想看 2 / AR 影片 2 / 类别黑名单 1');
    expect(s.removed).toBe(42);
    expect(s.pending).toBe(2);
    expect(s.confirmLabel).toBe('确认入库（2 部）');
    expect(s.cancelLabel).toBe(NEW_WORKS_CONFIRM_CANCEL_LABEL);
    expect(s.cancelLabel).toBe('不入库');
  });

  it('只分项陈列不写恒等式：剔除合计与识别数无必然关系（差额来自隐藏命中与条数截断）', () => {
    const s = buildNewWorksConfirmSummary({ identifiedTotal: 9, pendingWorks: makeWorks(1) });
    expect(s.ruleLine).toContain('按规则剔除 0 部');
    expect(s.ruleLine).not.toContain('＝');
    expect(s.ruleLine).not.toContain('=');
    expect(s.overview).toBe('已识别 9 部 ｜ 可入库 1 部 ｜ 已在新作品库 0 部');
  });

  it('脚注：AR 条目仅在 ar>0 出现；手动剔除条目恒有；取消场景追加停止后续演员说明', () => {
    const normal = buildNewWorksConfirmSummary(source);
    expect(normal.footnotes[0]).toContain('AR 影片');
    expect(normal.footnotes).toContain('手动检查固定剔除：已看 / 已浏览 / 想看（无需你在设置里勾选）。');
    expect(normal.footnotes.some(n => n.includes('取消 = 停止检查后续演员'))).toBe(false);

    const noAr = buildNewWorksConfirmSummary({ ...source, breakdown: { ...source.breakdown, ar: 0 } });
    expect(noAr.footnotes.some(n => n.includes('AR 影片'))).toBe(false);
    expect(noAr.footnotes).toHaveLength(1);

    const cancelled = buildNewWorksConfirmSummary({ ...source, cancelled: true });
    expect(cancelled.title).toBe('新作品检查已取消');
    expect(cancelled.footnotes).toHaveLength(3);
    expect(cancelled.footnotes[2]).toContain('取消 = 停止检查后续演员');
    expect(cancelled.footnotes[2]).toContain('仍由你决定是否入库');
  });

  it('空入参兜底为全零，不抛错', () => {
    const s = buildNewWorksConfirmSummary();
    expect(s).toMatchObject({ title: '新作品检查完成', pending: 0, identified: 0, existing: 0, removed: 0 });
    expect(s.overview).toBe('已识别 0 部 ｜ 可入库 0 部 ｜ 已在新作品库 0 部');
  });
});

describe('buildNewWorksConfirmModalHtml', () => {
  it('番号行数 = 渲染行数，data-pending-count 始终为完整 Y（含未列出的）', () => {
    const html = buildNewWorksConfirmModalHtml({ pendingWorks: makeWorks(3), identifiedTotal: 5 });
    expect((html.match(/class="newworks-confirm-work"/g) || []).length).toBe(3);
    expect(html).toContain('data-pending-count="3"');
    expect(html).toContain('data-work-id="ABC001"');
    expect(html).toContain('class="newworks-confirm-actor">Alice<');
    expect(html).not.toContain('newworks-confirm-more');
  });

  it('超过渲染上限只提示条数，列表容器仍可滚动（不裁剪提交集）', () => {
    const html = buildNewWorksConfirmModalHtml({ pendingWorks: makeWorks(MAX_RENDERED_CONFIRM_WORKS + 7) });
    expect((html.match(/class="newworks-confirm-work"/g) || []).length).toBe(MAX_RENDERED_CONFIRM_WORKS);
    expect(html).toContain('另有 7 条未列出，确认后将一并入库。');
    expect(html).toContain(`data-pending-count="${MAX_RENDERED_CONFIRM_WORKS + 7}"`);
  });

  it('番号/标题/演员名全部转义，脏记录降级为占位文案', () => {
    const html = buildNewWorksConfirmModalHtml({
      pendingWorks: [
        { id: '<img src=x onerror="1">', title: 'a"b\'c&d', actorName: '<b>Bob</b>' },
        { title: '' },
      ],
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=&quot;1&quot;&gt;');
    expect(html).toContain('a&quot;b&#39;c&amp;d');
    expect(html).toContain('&lt;b&gt;Bob&lt;/b&gt;');
    expect((html.match(/（无番号）/g) || []).length).toBe(2);
    expect(html).toContain('（无标题）');
    expect((html.match(/class="newworks-confirm-actor"/g) || []).length).toBe(1);
  });

  it('概览行与脚注进入 HTML，非数组 pendingWorks 视为空集', () => {
    const html = buildNewWorksConfirmModalHtml({
      identifiedTotal: 7,
      breakdown: { ar: 1 },
      pendingWorks: undefined,
    });
    expect(html).toContain('已识别 7 部 ｜ 可入库 0 部 ｜ 已在新作品库 0 部');
    expect((html.match(/<li>/g) || []).length).toBe(2);
    expect(html).toContain('AR 影片：标题中带独立「AR」标记的作品');
    expect((html.match(/class="newworks-confirm-work"/g) || []).length).toBe(0);
  });
});

describe('toast 文案', () => {
  it('Y=0 说明分项去向', () => {
    expect(buildNoPendingWorksToastMessage({ identifiedTotal: 7, existingCount: 3, breakdown: { dateRange: 4, ar: 3 } }))
      .toBe('本次检查没有可入库的新作品（已识别 7，按规则剔除 7，已在新作品库 3）');
  });

  it('放弃场景带条数且明确未写入', () => {
    expect(buildDiscardedToastMessage(2)).toBe('已放弃本次 2 条结果，未写入新作品库');
    expect(buildDiscardedToastMessage(undefined)).toBe('已放弃本次 0 条结果，未写入新作品库');
  });

  it('入库成功 success / 部分失败 warn / 零保存 info，total 缺失按 saved+failed 兜底', () => {
    expect(buildNewWorksCommitToastMessage({ total: 2, saved: 2, failed: 0 }))
      .toEqual({ message: '已入库 2 部', type: 'success' });
    expect(buildNewWorksCommitToastMessage({ total: 2, saved: 1, failed: 1 }))
      .toEqual({ message: '已入库 1/2 部，1 条写入失败，详见控制台', type: 'warn' });
    expect(buildNewWorksCommitToastMessage({ saved: 0, failed: 0 }))
      .toEqual({ message: '已入库 0 部', type: 'info' });
    expect(buildNewWorksCommitToastMessage({ saved: 3, failed: 2 }).message)
      .toBe('已入库 3/5 部，2 条写入失败，详见控制台');
    expect(buildNewWorksCommitToastMessage()).toEqual({ message: '已入库 0 部', type: 'info' });
  });

  it('入库失败带原因，缺原因降级「未知错误」', () => {
    expect(buildCommitFailedToastMessage('后台拒绝')).toBe('入库失败：后台拒绝');
    expect(buildCommitFailedToastMessage()).toBe('入库失败：未知错误');
  });
});


describe('sourceKind=restored 恢复回填脚注（10-19）', () => {
  const baseSource = {
    identifiedTotal: 8,
    existingCount: 0,
    breakdown: {},
    pendingWorks: makeWorks(2),
  };
  const R1 = '本批次为页面刷新后的恢复回填：作品已在本次检查中收集，尚未写入新作品库。';

  it('sourceKind=restored → 脚注末条追加恢复说明（逐字锁）', () => {
    const s = buildNewWorksConfirmSummary({ ...baseSource, sourceKind: 'restored' });
    expect(s.footnotes).toContain(R1);
    expect(s.footnotes[s.footnotes.length - 1]).toBe(R1);
  });

  it('与 cancelled 叠加：恢复脚注仍在末位（取消说明之后）', () => {
    const s = buildNewWorksConfirmSummary({ ...baseSource, cancelled: true, sourceKind: 'restored' });
    expect(s.title).toBe('新作品检查已取消');
    expect(s.footnotes[s.footnotes.length - 2]).toContain('取消 = 停止检查后续演员');
    expect(s.footnotes[s.footnotes.length - 1]).toBe(R1);
  });

  it('sourceKind 缺省 / live → 脚注零漂移（与基线逐条相等，不含恢复说明）', () => {
    const plain = buildNewWorksConfirmSummary(baseSource);
    const live = buildNewWorksConfirmSummary({ ...baseSource, sourceKind: 'live' });
    expect(plain.footnotes).not.toContain(R1);
    expect(live.footnotes).toEqual(plain.footnotes);
  });
});
