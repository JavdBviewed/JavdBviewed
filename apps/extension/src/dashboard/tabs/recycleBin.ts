/**
 * @file recycleBin.ts
 * @description 回收站标签页 —— 管理已删除的番号和演员记录
 * @module dashboard/tabs
 */

import type { VideoRecord, ActorRecord } from '../../types';
import {
  dbViewedQueryRecycleBin,
  dbViewedRestore,
  dbViewedBulkRestore,
  dbViewedPurge,
  dbViewedBulkPurge,
  dbActorsQueryRecycleBin,
  dbActorsRestore,
  dbActorsBulkRestore,
  dbActorsPurge,
  dbActorsBulkPurge,
} from '../dbClient';
import { showMessage } from '../ui/toast';
import { showConfirm } from '../components/confirmModal';
import {
  RECYCLE_BIN_PAGE_SIZE,
  formatRecycleDeletedAt,
  formatRecycleRemainingDays,
  getRecycleActorUrl,
  getRecycleVideoCoverUrl,
  getRecycleVideoJavdbUrl,
} from './recycleBinModel';
import { dashboardTabLifecycle } from './tabLifecycle';
import { clearTabWorkset } from './tabWorkset';

let isInitialized = false;
let active = false;
let lifecycleUnregister: (() => void) | null = null;

const PAGE_SIZE = RECYCLE_BIN_PAGE_SIZE;

/** 格式化剩余天数 */
function formatRemainingDays(deletedAt: number): string {
  return formatRecycleRemainingDays(deletedAt);
}

/** 格式化删除时间 */
function formatDeletedAt(deletedAt: number): string {
  return formatRecycleDeletedAt(deletedAt);
}

/** 获取封面 URL */
function getCoverUrl(record: VideoRecord): string | null {
  return getRecycleVideoCoverUrl(record);
}

/** 获取 JavDB 链接 */
function getJavdbUrl(record: VideoRecord): string | null {
  return getRecycleVideoJavdbUrl(record);
}

/** 获取演员详情页链接 */
function getActorUrl(actor: ActorRecord): string | null {
  return getRecycleActorUrl(actor);
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function ensureLifecycle(): void {
  if (lifecycleUnregister) return;
  lifecycleUnregister = dashboardTabLifecycle.register('tab-recycle-bin', {
    onActive: () => { active = true; },
    onRestore: () => {
      active = true;
      void loadRecordsRecycleBin(recordsCurrentPage);
      void loadActorsRecycleBin(actorsCurrentPage);
    },
    onHidden: () => clearRenderedWorkset(),
    onDispose: () => {
      clearRenderedWorkset();
      lifecycleUnregister?.();
      lifecycleUnregister = null;
    },
  });
}

function clearRenderedWorkset(): void {
  active = false;
  recordsSelectedIds.clear();
  actorsSelectedIds.clear();
  clearTabWorkset(document.getElementById('tab-recycle-bin'), [
    '#recordsRecycleList',
    '#recordsRecyclePagination',
    '#actorsRecycleList',
    '#actorsRecyclePagination',
  ]);
  updateRecordsButtons();
  updateActorsButtons();
}

// ============ 番号库回收站 ============

let recordsCurrentPage = 0;
let recordsSelectedIds = new Set<string>();
let recordsTotalCount = 0;

async function loadRecordsRecycleBin(page: number): Promise<void> {
  const listEl = document.getElementById('recordsRecycleList');
  const paginationEl = document.getElementById('recordsRecyclePagination');
  const countEl = document.getElementById('recordsRecycleCount');
  if (!listEl) return;

  recordsCurrentPage = page;
  recordsSelectedIds.clear();
  updateRecordsButtons();

  try {
    const { items, total } = await dbViewedQueryRecycleBin({ offset: page * PAGE_SIZE, limit: PAGE_SIZE });
    if (!active) return;
    recordsTotalCount = total;

    if (countEl) countEl.textContent = String(total);

    if (total === 0) {
      listEl.innerHTML = '<div class="recycle-bin-empty"><i class="fas fa-inbox"></i>暂无已删除的番号记录</div>';
      if (paginationEl) paginationEl.innerHTML = '';
      return;
    }

    listEl.innerHTML = items.map(r => {
      const coverUrl = getCoverUrl(r);
      const javdbUrl = getJavdbUrl(r);
      const tags = Array.isArray(r.tags) ? r.tags.slice(0, 3) : [];

      return `
        <div class="recycle-video-item" data-id="${r.id}">
          <label class="recycle-video-checkbox">
            <input type="checkbox" data-record-id="${r.id}" />
          </label>
          <div class="recycle-video-cover">
            ${coverUrl
              ? `<img src="${coverUrl}" alt="${escapeHtml(r.id)}" loading="lazy" />`
              : '<div class="recycle-video-cover-placeholder"><i class="fas fa-image"></i></div>'
            }
          </div>
          <div class="recycle-video-info">
            <div class="recycle-video-id-row">
              ${javdbUrl
                ? `<a class="recycle-video-id" href="${escapeHtml(javdbUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.id)}</a>`
                : `<span class="recycle-video-id">${escapeHtml(r.id)}</span>`
              }
              <span class="recycle-video-status status-${r.status}">${r.status}</span>
            </div>
            ${r.title ? `<div class="recycle-video-title" title="${escapeHtml(r.title)}">${escapeHtml(r.title)}</div>` : ''}
            ${tags.length > 0 ? `
              <div class="recycle-video-tags">
                ${tags.map(t => `<span class="recycle-video-tag">${escapeHtml(t)}</span>`).join('')}
              </div>
            ` : ''}
          </div>
          <div class="recycle-video-meta">
            <span class="recycle-video-deleted" title="${formatDeletedAt(r.deletedAt || 0)}">删除于 ${formatDeletedAt(r.deletedAt || 0)}</span>
            <span class="recycle-video-remaining"><i class="fas fa-clock"></i> ${formatRemainingDays(r.deletedAt || 0)}</span>
          </div>
          <div class="recycle-video-actions">
            <button class="btn-restore" data-id="${r.id}" title="恢复"><i class="fas fa-undo"></i> 恢复</button>
            <button class="btn-purge" data-id="${r.id}" title="永久删除"><i class="fas fa-times"></i></button>
          </div>
        </div>
      `;
    }).join('');

    // 绑定事件
    listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const id = (e.target as HTMLInputElement).dataset.recordId!;
        if ((e.target as HTMLInputElement).checked) recordsSelectedIds.add(id);
        else recordsSelectedIds.delete(id);
        updateRecordsButtons();
      });
    });

    listEl.querySelectorAll('.btn-restore').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.id!;
        await dbViewedRestore(id);
        showMessage('已恢复', 'success');
        await loadRecordsRecycleBin(recordsCurrentPage);
      });
    });

    listEl.querySelectorAll('.btn-purge').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.id!;
        const ok = await showConfirm({ title: '永久删除', message: '此操作不可恢复，确定永久删除？', type: 'danger' });
        if (!ok) return;
        await dbViewedPurge(id);
        showMessage('已永久删除', 'success');
        await loadRecordsRecycleBin(recordsCurrentPage);
      });
    });

    // 分页
    if (paginationEl) {
      const totalPages = Math.ceil(total / PAGE_SIZE);
      paginationEl.innerHTML = `
        <span>共 ${total} 条</span>
        <button ${page <= 0 ? 'disabled' : ''} id="recordsRecyclePrev"><i class="fas fa-chevron-left"></i> 上一页</button>
        <span>${page + 1} / ${totalPages}</span>
        <button ${page >= totalPages - 1 ? 'disabled' : ''} id="recordsRecycleNext">下一页 <i class="fas fa-chevron-right"></i></button>
      `;
      document.getElementById('recordsRecyclePrev')?.addEventListener('click', () => loadRecordsRecycleBin(page - 1));
      document.getElementById('recordsRecycleNext')?.addEventListener('click', () => loadRecordsRecycleBin(page + 1));
    }
  } catch (error: any) {
    listEl.innerHTML = `<div class="recycle-bin-empty"><i class="fas fa-exclamation-circle"></i>加载失败: ${escapeHtml(error.message)}</div>`;
  }
}

function updateRecordsButtons(): void {
  const hasSelection = recordsSelectedIds.size > 0;
  const restoreBtn = document.getElementById('recordsRecycleRestoreSelected') as HTMLButtonElement | null;
  const purgeBtn = document.getElementById('recordsRecyclePurgeSelected') as HTMLButtonElement | null;
  const selectAllBtn = document.getElementById('recordsRecycleSelectAll') as HTMLButtonElement | null;
  if (restoreBtn) restoreBtn.disabled = !hasSelection;
  if (purgeBtn) purgeBtn.disabled = !hasSelection;
  if (selectAllBtn) selectAllBtn.disabled = recordsTotalCount === 0;
}

// ============ 演员库回收站 ============

let actorsCurrentPage = 0;
let actorsSelectedIds = new Set<string>();
let actorsTotalCount = 0;

async function loadActorsRecycleBin(page: number): Promise<void> {
  const listEl = document.getElementById('actorsRecycleList');
  const paginationEl = document.getElementById('actorsRecyclePagination');
  const countEl = document.getElementById('actorsRecycleCount');
  if (!listEl) return;

  actorsCurrentPage = page;
  actorsSelectedIds.clear();
  updateActorsButtons();

  try {
    const { items, total } = await dbActorsQueryRecycleBin({ offset: page * PAGE_SIZE, limit: PAGE_SIZE });
    if (!active) return;
    actorsTotalCount = total;

    if (countEl) countEl.textContent = String(total);

    if (total === 0) {
      listEl.innerHTML = '<div class="recycle-bin-empty"><i class="fas fa-inbox"></i>暂无已删除的演员记录</div>';
      if (paginationEl) paginationEl.innerHTML = '';
      return;
    }

    listEl.innerHTML = items.map(a => {
      const actorUrl = getActorUrl(a);
      const genderText = a.gender === 'female' ? '女' : a.gender === 'male' ? '男' : '';
      const categoryText = a.category && a.category !== 'unknown' ? a.category : '';

      return `
        <div class="recycle-actor-item" data-id="${a.id}">
          <label class="recycle-actor-checkbox">
            <input type="checkbox" data-actor-id="${a.id}" />
          </label>
          <div class="recycle-actor-avatar">
            ${a.avatarUrl
              ? `<img src="${a.avatarUrl}" alt="${escapeHtml(a.name)}" loading="lazy" />`
              : '<div class="recycle-actor-avatar-placeholder"><i class="fas fa-user"></i></div>'
            }
          </div>
          <div class="recycle-actor-info">
            <div class="recycle-actor-name">
              ${actorUrl
                ? `<a href="${escapeHtml(actorUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(a.name)}</a>`
                : escapeHtml(a.name)
              }
            </div>
            <div class="recycle-actor-meta">
              ${genderText ? `<span><i class="fas fa-${a.gender === 'female' ? 'venus' : 'mars'}"></i> ${genderText}</span>` : ''}
              ${categoryText ? `<span><i class="fas fa-tag"></i> ${escapeHtml(categoryText)}</span>` : ''}
              ${a.details?.worksCount ? `<span><i class="fas fa-film"></i> ${a.details.worksCount} 作品</span>` : ''}
            </div>
          </div>
          <div class="recycle-actor-deleted-info">
            <span class="recycle-actor-deleted" title="${formatDeletedAt(a.deletedAt || 0)}">删除于 ${formatDeletedAt(a.deletedAt || 0)}</span>
            <span class="recycle-actor-remaining"><i class="fas fa-clock"></i> ${formatRemainingDays(a.deletedAt || 0)}</span>
          </div>
          <div class="recycle-actor-actions">
            <button class="btn-restore" data-id="${a.id}" title="恢复"><i class="fas fa-undo"></i> 恢复</button>
            <button class="btn-purge" data-id="${a.id}" title="永久删除"><i class="fas fa-times"></i></button>
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const id = (e.target as HTMLInputElement).dataset.actorId!;
        if ((e.target as HTMLInputElement).checked) actorsSelectedIds.add(id);
        else actorsSelectedIds.delete(id);
        updateActorsButtons();
      });
    });

    listEl.querySelectorAll('.btn-restore').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.id!;
        await dbActorsRestore(id);
        showMessage('已恢复', 'success');
        await loadActorsRecycleBin(actorsCurrentPage);
      });
    });

    listEl.querySelectorAll('.btn-purge').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.id!;
        const ok = await showConfirm({ title: '永久删除', message: '此操作不可恢复，确定永久删除？', type: 'danger' });
        if (!ok) return;
        await dbActorsPurge(id);
        showMessage('已永久删除', 'success');
        await loadActorsRecycleBin(actorsCurrentPage);
      });
    });

    if (paginationEl) {
      const totalPages = Math.ceil(total / PAGE_SIZE);
      paginationEl.innerHTML = `
        <span>共 ${total} 条</span>
        <button ${page <= 0 ? 'disabled' : ''} id="actorsRecyclePrev"><i class="fas fa-chevron-left"></i> 上一页</button>
        <span>${page + 1} / ${totalPages}</span>
        <button ${page >= totalPages - 1 ? 'disabled' : ''} id="actorsRecycleNext">下一页 <i class="fas fa-chevron-right"></i></button>
      `;
      document.getElementById('actorsRecyclePrev')?.addEventListener('click', () => loadActorsRecycleBin(page - 1));
      document.getElementById('actorsRecycleNext')?.addEventListener('click', () => loadActorsRecycleBin(page + 1));
    }
  } catch (error: any) {
    listEl.innerHTML = `<div class="recycle-bin-empty"><i class="fas fa-exclamation-circle"></i>加载失败: ${escapeHtml(error.message)}</div>`;
  }
}

function updateActorsButtons(): void {
  const hasSelection = actorsSelectedIds.size > 0;
  const restoreBtn = document.getElementById('actorsRecycleRestoreSelected') as HTMLButtonElement | null;
  const purgeBtn = document.getElementById('actorsRecyclePurgeSelected') as HTMLButtonElement | null;
  const selectAllBtn = document.getElementById('actorsRecycleSelectAll') as HTMLButtonElement | null;
  if (restoreBtn) restoreBtn.disabled = !hasSelection;
  if (purgeBtn) purgeBtn.disabled = !hasSelection;
  if (selectAllBtn) selectAllBtn.disabled = actorsTotalCount === 0;
}

/** 绑定批量操作按钮 */
function bindBatchActions(): void {
  // 番号库
  document.getElementById('recordsRecycleSelectAll')?.addEventListener('click', () => {
    const checkboxes = document.querySelectorAll<HTMLInputElement>('#recordsRecycleList input[type="checkbox"]');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => {
      cb.checked = !allChecked;
      const id = cb.dataset.recordId!;
      if (cb.checked) recordsSelectedIds.add(id);
      else recordsSelectedIds.delete(id);
    });
    updateRecordsButtons();
  });

  document.getElementById('recordsRecycleRestoreSelected')?.addEventListener('click', async () => {
    if (recordsSelectedIds.size === 0) return;
    await dbViewedBulkRestore(Array.from(recordsSelectedIds));
    showMessage(`已恢复 ${recordsSelectedIds.size} 条`, 'success');
    await loadRecordsRecycleBin(recordsCurrentPage);
  });

  document.getElementById('recordsRecyclePurgeSelected')?.addEventListener('click', async () => {
    if (recordsSelectedIds.size === 0) return;
    const ok = await showConfirm({ title: '永久删除', message: `确定永久删除 ${recordsSelectedIds.size} 条记录？此操作不可恢复。`, type: 'danger' });
    if (!ok) return;
    await dbViewedBulkPurge(Array.from(recordsSelectedIds));
    showMessage(`已永久删除 ${recordsSelectedIds.size} 条`, 'success');
    await loadRecordsRecycleBin(recordsCurrentPage);
  });

  document.getElementById('recordsRecycleEmpty')?.addEventListener('click', async () => {
    const ok = await showConfirm({ title: '清空回收站', message: '确定清空番号库回收站？所有记录将被永久删除，此操作不可恢复。', type: 'danger' });
    if (!ok) return;
    const { items } = await dbViewedQueryRecycleBin({ offset: 0, limit: 999999 });
    if (items.length > 0) {
      await dbViewedBulkPurge(items.map(r => r.id));
    }
    showMessage('番号库回收站已清空', 'success');
    await loadRecordsRecycleBin(0);
  });

  // 演员库
  document.getElementById('actorsRecycleSelectAll')?.addEventListener('click', () => {
    const checkboxes = document.querySelectorAll<HTMLInputElement>('#actorsRecycleList input[type="checkbox"]');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => {
      cb.checked = !allChecked;
      const id = cb.dataset.actorId!;
      if (cb.checked) actorsSelectedIds.add(id);
      else actorsSelectedIds.delete(id);
    });
    updateActorsButtons();
  });

  document.getElementById('actorsRecycleRestoreSelected')?.addEventListener('click', async () => {
    if (actorsSelectedIds.size === 0) return;
    await dbActorsBulkRestore(Array.from(actorsSelectedIds));
    showMessage(`已恢复 ${actorsSelectedIds.size} 条`, 'success');
    await loadActorsRecycleBin(actorsCurrentPage);
  });

  document.getElementById('actorsRecyclePurgeSelected')?.addEventListener('click', async () => {
    if (actorsSelectedIds.size === 0) return;
    const ok = await showConfirm({ title: '永久删除', message: `确定永久删除 ${actorsSelectedIds.size} 条记录？此操作不可恢复。`, type: 'danger' });
    if (!ok) return;
    await dbActorsBulkPurge(Array.from(actorsSelectedIds));
    showMessage(`已永久删除 ${actorsSelectedIds.size} 条`, 'success');
    await loadActorsRecycleBin(actorsCurrentPage);
  });

  document.getElementById('actorsRecycleEmpty')?.addEventListener('click', async () => {
    const ok = await showConfirm({ title: '清空回收站', message: '确定清空演员库回收站？所有记录将被永久删除，此操作不可恢复。', type: 'danger' });
    if (!ok) return;
    const { items } = await dbActorsQueryRecycleBin({ offset: 0, limit: 999999 });
    if (items.length > 0) {
      await dbActorsBulkPurge(items.map(a => a.id));
    }
    showMessage('演员库回收站已清空', 'success');
    await loadActorsRecycleBin(0);
  });
}

/** 初始化回收站标签页 */
export async function initRecycleBinTab(): Promise<void> {
  if (isInitialized) return;

  ensureLifecycle();
  active = true;
  bindBatchActions();
  await Promise.all([
    loadRecordsRecycleBin(0),
    loadActorsRecycleBin(0),
  ]);

  isInitialized = true;
}
