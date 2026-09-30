/**
 * @file newWorksManualConfirmViewModel.ts
 * @description 新作品手动检查「收集-确认-入库」弹窗的纯展示计算（无 DOM 依赖，可单测）
 * @module dashboard/tabs
 */

export interface NewWorksManualBreakdown {
  dateRange?: number;
  viewed?: number;
  browsed?: number;
  want?: number;
  ar?: number;
  categoryBlack?: number;
}

export interface NewWorksManualPendingWork {
  id?: string;
  title?: string;
  actorId?: string;
  actorName?: string;
  javdbUrl?: string;
  releaseDate?: string;
  coverImage?: string;
  tags?: string[];
  discoveredAt?: number;
  isRead?: boolean;
  status?: string;
}

export interface NewWorksManualConfirmSource {
  cancelled?: boolean;
  identifiedTotal?: number;
  existingCount?: number;
  breakdown?: NewWorksManualBreakdown;
  pendingWorks?: NewWorksManualPendingWork[];
}

export interface NewWorksConfirmSummary {
  title: string;
  overview: string;
  ruleLine: string;
  footnotes: string[];
  ruleParts: string[];
  confirmLabel: string;
  cancelLabel: string;
  identified: number;
  pending: number;
  existing: number;
  removed: number;
}

/** 弹窗「不入库」按钮文案（唯一出口，避免两处写死） */
export const NEW_WORKS_CONFIRM_CANCEL_LABEL = '不入库';

/** 列表最多渲染的行数（超出只提示条数，确认入库仍按完整 pendingWorks 提交） */
export const MAX_RENDERED_CONFIRM_WORKS = 500;

const RULE_ITEMS: Array<{ key: keyof NewWorksManualBreakdown; label: string }> = [
  { key: 'dateRange', label: '日期范围外' },
  { key: 'viewed', label: '已看' },
  { key: 'browsed', label: '已浏览' },
  { key: 'want', label: '想看' },
  { key: 'ar', label: 'AR 影片' },
  { key: 'categoryBlack', label: '类别黑名单' },
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toCount(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.floor(num);
}

function normalizePendingWorks(value: unknown): NewWorksManualPendingWork[] {
  return Array.isArray(value) ? (value as NewWorksManualPendingWork[]) : [];
}

/** 六桶逐项计数（含 0 值，保证分项稳定不跳位） */
export function formatNewWorksRuleBreakdownCounts(
  breakdown?: NewWorksManualBreakdown,
): Array<{ label: string; value: number }> {
  return RULE_ITEMS.map(({ key, label }) => ({ label, value: toCount(breakdown?.[key]) }));
}

/** 「日期范围外 38 / 已看 0 / …」分项陈列（不写恒等式：差额来自内容过滤隐藏命中与 maxWorksPerCheck 截断） */
export function formatNewWorksRuleBreakdownParts(breakdown?: NewWorksManualBreakdown): string[] {
  return formatNewWorksRuleBreakdownCounts(breakdown).map(({ label, value }) => `${label} ${value}`);
}

export function buildNewWorksConfirmSummary(source: NewWorksManualConfirmSource = {}): NewWorksConfirmSummary {
  const pendingWorks = normalizePendingWorks(source.pendingWorks);
  const counts = formatNewWorksRuleBreakdownCounts(source.breakdown);
  const identified = toCount(source.identifiedTotal);
  const pending = pendingWorks.length;
  const existing = toCount(source.existingCount);
  const removed = counts.reduce((sum, item) => sum + item.value, 0);
  const arCount = toCount(source.breakdown?.ar);

  const footnotes: string[] = [];
  if (arCount > 0) {
    footnotes.push('AR 影片：标题中带独立「AR」标记的作品，已按你开启的『排除 AR 影片』规则剔除。');
  }
  footnotes.push('手动检查固定剔除：已看 / 已浏览 / 想看（无需你在设置里勾选）。');
  if (source.cancelled) {
    footnotes.push('取消 = 停止检查后续演员；上面已经收集到的作品仍由你决定是否入库。');
  }

  return {
    title: source.cancelled ? '新作品检查已取消' : '新作品检查完成',
    overview: `已识别 ${identified} 部 ｜ 可入库 ${pending} 部 ｜ 已在新作品库 ${existing} 部`,
    ruleLine: `按规则剔除 ${removed} 部：${counts.map(({ label, value }) => `${label} ${value}`).join(' / ')}`,
    footnotes,
    ruleParts: counts.map(({ label, value }) => `${label} ${value}`),
    confirmLabel: `确认入库（${pending} 部）`,
    cancelLabel: NEW_WORKS_CONFIRM_CANCEL_LABEL,
    identified,
    pending,
    existing,
    removed,
  };
}

function buildPendingWorkRow(work: NewWorksManualPendingWork): string {
  const id = escapeHtml(String(work?.id || '').trim() || '（无番号）');
  const title = escapeHtml(String(work?.title || '').trim() || '（无标题）');
  const actorName = String(work?.actorName || '').trim();
  const actor = actorName ? `<span class="newworks-confirm-actor">${escapeHtml(actorName)}</span>` : '';
  return `<div class="newworks-confirm-work" data-work-id="${id}">`
    + `<span class="newworks-confirm-work-id">${id}</span>`
    + `<span class="newworks-confirm-work-title">${title}</span>`
    + `${actor}</div>`;
}

/** 弹窗 HTML：概览行 + 分项剔除 + 可入库列表（可滚动）+ 脚注 */
export function buildNewWorksConfirmModalHtml(source: NewWorksManualConfirmSource = {}): string {
  const summary = buildNewWorksConfirmSummary(source);
  const pendingWorks = normalizePendingWorks(source.pendingWorks);
  const visible = pendingWorks.slice(0, MAX_RENDERED_CONFIRM_WORKS);
  const rows = visible.map(buildPendingWorkRow).join('');
  const hidden = pendingWorks.length - visible.length;
  const moreTip = hidden > 0
    ? `<p class="newworks-confirm-more">另有 ${hidden} 条未列出，确认后将一并入库。</p>`
    : '';
  const notes = summary.footnotes.map((note) => `<li>${escapeHtml(note)}</li>`).join('');

  return `
    <div class="newworks-confirm-summary">
      <p class="newworks-confirm-overview">${escapeHtml(summary.overview)}</p>
      <p class="newworks-confirm-rules">${escapeHtml(summary.ruleLine)}</p>
    </div>
    <div class="newworks-confirm-works" data-pending-count="${summary.pending}">
      ${rows}
      ${moreTip}
    </div>
    <ul class="newworks-confirm-notes">${notes}</ul>`;
}

/** Y=0：不弹窗，直接 toast */
export function buildNoPendingWorksToastMessage(source: NewWorksManualConfirmSource = {}): string {
  const summary = buildNewWorksConfirmSummary(source);
  return `本次检查没有可入库的新作品（已识别 ${summary.identified}，按规则剔除 ${summary.removed}，已在新作品库 ${summary.existing}）`;
}

/** 用户点「不入库」：结果放弃，零写入 */
export function buildDiscardedToastMessage(pendingCount: number): string {
  return `已放弃本次 ${toCount(pendingCount)} 条结果，未写入新作品库`;
}

export interface NewWorksManualCommitStats {
  requested?: number;
  total?: number;
  saved?: number;
  failed?: number;
}

export interface NewWorksToastCopy {
  message: string;
  type: 'success' | 'info' | 'warn';
}

/** 入库结果 toast：失败数 > 0 转 warn */
export function buildNewWorksCommitToastMessage(stats: NewWorksManualCommitStats = {}): NewWorksToastCopy {
  const saved = toCount(stats.saved);
  const failed = toCount(stats.failed);
  const total = toCount(stats.total) || saved + failed;
  if (failed > 0) {
    return { message: `已入库 ${saved}/${total} 部，${failed} 条写入失败，详见控制台`, type: 'warn' };
  }
  return { message: `已入库 ${saved} 部`, type: saved > 0 ? 'success' : 'info' };
}

export function buildCommitFailedToastMessage(error?: string): string {
  return `入库失败：${error || '未知错误'}`;
}
