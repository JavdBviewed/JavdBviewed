import type { NewWorkRecord } from '../../types';
import { buildRecordsPaginationModel } from './records/paginationModel';

export interface BuildNewWorkItemHtmlOptions {
  selected?: boolean;
}

export interface BuildNewWorksPaginationHtmlInput {
  total: number;
  currentPage: number;
  pageSize: number;
}

export function buildNewWorksLoadingHtml(): string {
  return `
                <div class="new-works-loading">
                    <i class="fas fa-spinner fa-spin"></i>
                    <div>加载中...</div>
                </div>
            `;
}

export function buildNewWorksEmptyHtml(): string {
  return `
                    <div class="new-works-empty">
                        <i class="fas fa-inbox"></i>
                        <h3>暂无新作品</h3>
                        <p>添加演员订阅后，系统会自动检查新作品</p>
                    </div>
                `;
}

export function buildNewWorksErrorHtml(): string {
  return '<div class="error-message">加载新作品列表失败</div>';
}

export function buildNewWorkItemHtml(work: NewWorkRecord, options: BuildNewWorkItemHtmlOptions = {}): string {
  const readClass = work.isRead ? 'read' : 'unread';
  const selectedClass = options.selected ? 'selected' : '';
  const tagsHtml = buildNewWorkTagsHtml(work.tags || []);

  return `
            <li class="new-work-item ${readClass} ${selectedClass}" data-work-id="${work.id}" data-javdb-url="${work.javdbUrl}">
                <div class="new-work-checkbox">
                    <input type="checkbox" ${options.selected ? 'checked' : ''}>
                </div>
                ${buildNewWorkCoverHtml(work)}
                <div class="new-work-info">
                    <h3 class="new-work-title">${work.title}</h3>
                    <div class="new-work-meta">
                        <span class="new-work-actor">
                            <i class="fas fa-user"></i>
                            ${work.actorName}
                        </span>
                        <span class="new-work-date">
                            <i class="fas fa-calendar"></i>
                            发现于 ${formatNewWorkDate(work.discoveredAt)}
                        </span>
                        ${work.releaseDate ? `
                            <span class="new-work-release">
                                <i class="fas fa-film"></i>
                                发行于 ${work.releaseDate}
                            </span>
                        ` : ''}
                        ${work.sourceType === 'cloud-scan' ? '<span class="new-work-source-badge">云扫描</span>' : ''}
                    </div>
                    ${tagsHtml}
                </div>
                <div class="new-work-actions">
                    ${!work.isRead ? '<button class="new-work-action-btn mark-read-btn" data-action="mark-read"><i class="fas fa-check-circle"></i> 标为已读</button>' : ''}
                    <button class="new-work-action-btn visit-btn" data-action="visit"><i class="fas fa-play"></i> 去看看</button>
                    <button class="new-work-action-btn delete-btn" data-action="delete"><i class="fas fa-times"></i> 移除</button>
                </div>
            </li>
        `;
}

// 11-02 G4：页码窗口改 records 同形（复用 buildRecordsPaginationModel 纯函数）：
// 首末页恒显 + 当前页±2 窗口 + 空隙省略号；data-page/disabled 字符串契约不变
export function buildNewWorksPaginationHtml(input: BuildNewWorksPaginationHtmlInput): string {
  const model = buildRecordsPaginationModel({
    totalCount: input.total,
    recordsPerPage: input.pageSize,
    currentPage: input.currentPage,
  });
  if (!model.visible) return '';

  let paginationHtml = '';
  for (const item of model.items) {
    if (item.kind === 'ellipsis') {
      paginationHtml += '<button class="page-button ellipsis" disabled>...</button>';
    } else if (item.kind === 'page') {
      paginationHtml += `<button class="page-button${item.active ? ' active' : ''}" data-page="${item.page}">${item.page}</button>`;
    } else {
      const targetPage = Math.min(Math.max(item.page, 1), model.pageCount);
      paginationHtml += `<button class="page-button" data-page="${targetPage}" title="${item.title}"${item.disabled ? ' disabled' : ''}>${item.html}</button>`;
    }
  }
  return paginationHtml;
}

function buildNewWorkCoverHtml(work: NewWorkRecord): string {
  if (!work.coverImage) {
    return '<div class="new-work-cover-wrap"><div class="new-work-cover"></div></div>';
  }

  // L-3（cycle-5 S1-A）：hover 放大预览图改为进入视口交互时懒实例化（newWorksListRuntime.attachNewWorkItemListeners），
  // 初始 HTML 只保留 80×60 小封面，避免每个列表项都预建 560~820px 宽的大图层。
  return `
                <div class="new-work-cover-wrap">
                    <img src="${work.coverImage}" alt="${work.title}" class="new-work-cover">
                </div>
                `;
}

function buildNewWorkTagsHtml(tags: string[]): string {
  if (tags.length === 0) {
    return '';
  }

  return `<div class="new-work-tags">
                ${tags.slice(0, 3).map((tag: string) => `<span class="new-work-tag">${tag}</span>`).join('')}
                ${tags.length > 3 ? `<span class="new-work-tag">+${tags.length - 3}</span>` : ''}
               </div>`;
}

function formatNewWorkDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('zh-CN');
}
