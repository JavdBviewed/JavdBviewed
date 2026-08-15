/**
 * @file manualPushDirectoryPicker.ts
 * @description 内容页手动推送的 115 目录选择弹层
 * @module features/drive115
 */

import {
  getDrive115V2Service,
  type Drive115V2FileListItem,
  type Drive115V2PathItem,
} from '../v2';
import { getJavdbTheme } from '../../../platform/browser';
import type { Drive115FolderSelection } from './manualPushDirectory';

type FolderDirectory = Drive115FolderSelection & {
  folders: Drive115V2FileListItem[];
};

const FOLDER_PAGE_SIZE = 10;

let closeActivePicker: ((selection: Drive115FolderSelection | null) => void) | null = null;

function normalizeCid(cid: string): string {
  const value = cid.trim();
  return value === '0' ? '' : value;
}

function folderId(item: Drive115V2FileListItem | Drive115V2PathItem): string {
  return String(item.fid ?? item.file_id ?? item.cid ?? '').trim();
}

function folderName(item: Drive115V2FileListItem | Drive115V2PathItem): string {
  return String((item.fn ?? item.name ?? item.file_name ?? folderId(item)) || '未命名文件夹');
}

function isFolder(item: Drive115V2FileListItem): boolean {
  return String(item.fc ?? item.file_category ?? '') === '0';
}

async function loadDirectory(cid: string): Promise<FolderDirectory> {
  const normalizedCid = normalizeCid(cid);
  const service = getDrive115V2Service();
  const token = await service.getValidAccessToken();
  if (token.success !== true) {
    throw new Error(token.message || '无法获取 115 授权信息');
  }
  if (!token.accessToken) throw new Error('无法获取 115 授权信息');

  const response = await service.listFiles({
    accessToken: token.accessToken,
    cid: normalizedCid,
    limit: 1150,
    offset: 0,
    show_dir: 1,
    stdir: 1,
    cur: 1,
  });
  if (!response.success) {
    throw new Error(response.message || '获取文件夹列表失败');
  }

  const pathItems = response.path || [];
  const pathNames = pathItems.map(folderName).filter(Boolean);
  const currentName = normalizedCid
    ? pathNames[pathNames.length - 1] || `目录 ${normalizedCid}`
    : '根目录';

  return {
    cid: normalizedCid || '0',
    name: currentName,
    path: pathNames.length > 0 ? `/${pathNames.join('/')}` : '/',
    folders: (response.data || []).filter(isFolder),
  };
}

export function openManualPushDirectoryPicker(
  initialCid: string,
  defaultCid = '',
): Promise<Drive115FolderSelection | null> {
  closeActivePicker?.(null);

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.dataset.jbvDrive115Picker = 'true';
    overlay.className = 'c-modal-overlay drive115-folder-picker-overlay';
    overlay.innerHTML = `
      <style>
        [data-jbv-drive115-picker] { --d115-primary: #2563eb; --d115-info: #0891b2; --d115-surface: #ffffff; --d115-soft: #f4f7fb; --d115-border: #d8e1ee; --d115-text: #182235; --d115-muted: #64748b; --d115-danger: #c2413b; --d115-shadow: 0 24px 64px rgba(15, 23, 42, .22); --d115-shadow-soft: 0 8px 24px rgba(15, 23, 42, .08); position: fixed; inset: 0; z-index: 2147483646; display: grid; place-items: center; padding: 20px; background: rgba(15, 23, 42, .52); color: var(--d115-text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        [data-jbv-drive115-picker][data-theme="dark"], [data-theme="dark"] .drive115-folder-picker-overlay { --d115-surface: #182235; --d115-soft: #101826; --d115-border: #334155; --d115-text: #e5edf8; --d115-muted: #9aabc0; --d115-danger: #fca5a5; --d115-shadow: 0 26px 70px rgba(0, 0, 0, .48); --d115-shadow-soft: 0 10px 28px rgba(0, 0, 0, .28); background: rgba(2, 6, 23, .7); }
        [data-jbv-drive115-picker] *, [data-jbv-drive115-picker] *::before, [data-jbv-drive115-picker] *::after { box-sizing: border-box; }
        [data-jbv-drive115-picker] .drive115-folder-picker-modal { display: flex; width: min(760px, 100%); max-height: min(760px, calc(100vh - 40px)); max-height: min(760px, calc(100dvh - 40px)); min-height: 0; flex-direction: column; overflow: hidden; border: 1px solid var(--d115-border); border-radius: 18px; background: radial-gradient(circle at 7% 0%, rgba(37, 99, 235, .13), transparent 34%), radial-gradient(circle at 94% 7%, rgba(8, 145, 178, .12), transparent 30%), var(--d115-surface); box-shadow: var(--d115-shadow); }
        [data-jbv-drive115-picker] .c-modal__header, [data-jbv-drive115-picker] .c-modal__footer { display: flex; align-items: center; gap: 12px; padding: 16px 18px; }
        [data-jbv-drive115-picker] .c-modal__header { justify-content: space-between; }
        [data-jbv-drive115-picker] .c-modal__body { display: grid; min-height: 0; flex: 1 1 auto; align-content: start; gap: 11px; overflow-y: auto; overscroll-behavior: contain; padding: 0 18px 16px; }
        [data-jbv-drive115-picker] .c-modal__footer { border-top: 1px solid var(--d115-border); background: color-mix(in srgb, var(--d115-soft) 84%, transparent); }
        [data-jbv-drive115-picker] .drive115-folder-picker-heading { display: flex; min-width: 0; align-items: center; gap: 11px; }
        [data-jbv-drive115-picker] .drive115-folder-picker-mark { display: inline-grid; width: 38px; height: 38px; flex: 0 0 auto; place-items: center; border: 1px solid var(--d115-border); border-radius: 13px; background: linear-gradient(135deg, rgba(37, 99, 235, .2), rgba(8, 145, 178, .12)); color: var(--d115-primary); box-shadow: var(--d115-shadow-soft); font-size: 11px; font-weight: 850; letter-spacing: .04em; }
        [data-jbv-drive115-picker] .drive115-folder-picker-eyebrow { display: inline-flex; margin-bottom: 3px; color: var(--d115-info); font-size: 11px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
        [data-jbv-drive115-picker] .c-modal__title { margin: 0; color: var(--d115-text); font-size: 18px; font-weight: 800; letter-spacing: -.02em; }
        [data-jbv-drive115-picker] button { border: 0; font: inherit; }
        [data-jbv-drive115-picker] button:focus-visible, [data-jbv-drive115-picker] input:focus-visible { outline: 3px solid rgba(37, 99, 235, .28); outline-offset: 2px; }
        [data-jbv-drive115-picker] .c-modal__close, [data-jbv-drive115-picker] .drive115-folder-picker-actions button { display: inline-grid; width: 34px; height: 34px; place-items: center; border: 1px solid var(--d115-border); border-radius: 10px; background: var(--d115-soft); color: var(--d115-muted); cursor: pointer; font-size: 18px; line-height: 1; }
        [data-jbv-drive115-picker] .c-modal__close:hover, [data-jbv-drive115-picker] .drive115-folder-picker-actions button:hover { border-color: color-mix(in srgb, var(--d115-primary) 42%, var(--d115-border)); color: var(--d115-primary); }
        [data-jbv-drive115-picker] .drive115-folder-picker-pathbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 13px; border: 1px solid var(--d115-border); border-radius: 14px; background: color-mix(in srgb, var(--d115-soft) 78%, transparent); }
        [data-jbv-drive115-picker] .drive115-folder-picker-current-wrap { min-width: 0; display: grid; gap: 3px; }
        [data-jbv-drive115-picker] .drive115-folder-picker-current-wrap > span, [data-jbv-drive115-picker] .drive115-folder-picker-current-wrap small { color: var(--d115-muted); font-size: 12px; }
        [data-jbv-drive115-picker] .drive115-folder-picker-current { overflow: hidden; color: var(--d115-text); font-size: 14px; font-weight: 750; text-overflow: ellipsis; white-space: nowrap; }
        [data-jbv-drive115-picker] .drive115-folder-picker-actions { display: inline-flex; gap: 6px; flex: 0 0 auto; }
        [data-jbv-drive115-picker] .drive115-folder-picker-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        [data-jbv-drive115-picker] .drive115-folder-picker-status { min-height: 20px; color: var(--d115-muted); font-size: 13px; font-weight: 650; }
        [data-jbv-drive115-picker] .drive115-folder-picker-status[data-jbv-drive115-picker-status="error"] { color: var(--d115-danger); }
        [data-jbv-drive115-picker] .drive115-folder-picker-search { width: min(270px, 52%); border: 1px solid var(--d115-border); border-radius: 10px; background: var(--d115-surface); color: var(--d115-text); padding: 8px 10px; font-size: 13px; }
        [data-jbv-drive115-picker] .drive115-folder-picker-search::placeholder { color: var(--d115-muted); }
        [data-jbv-drive115-picker] .drive115-folder-picker-list { display: grid; min-height: 280px; max-height: min(45vh, 430px); align-content: start; gap: 6px; overflow: auto; padding: 7px; border: 1px solid var(--d115-border); border-radius: 14px; background: color-mix(in srgb, var(--d115-soft) 88%, transparent); }
        [data-jbv-drive115-picker] .drive115-folder-row { display: grid; width: 100%; min-width: 0; grid-template-columns: 32px minmax(0, 1fr) minmax(80px, auto) 14px; align-items: center; gap: 9px; padding: 10px 11px; border: 1px solid var(--d115-border); border-radius: 11px; background: var(--d115-surface); color: var(--d115-text); cursor: pointer; text-align: left; transition: border-color .16s ease, background .16s ease, box-shadow .16s ease; }
        [data-jbv-drive115-picker] .drive115-folder-row:hover { border-color: color-mix(in srgb, var(--d115-primary) 42%, var(--d115-border)); background: color-mix(in srgb, var(--d115-primary) 5%, var(--d115-surface)); box-shadow: var(--d115-shadow-soft); }
        [data-jbv-drive115-picker] .drive115-folder-row-icon { display: grid; width: 30px; height: 30px; place-items: center; border-radius: 9px; background: color-mix(in srgb, var(--d115-primary) 13%, transparent); }
        [data-jbv-drive115-picker] .drive115-folder-row-icon::before { width: 15px; height: 10px; border-radius: 2px; background: var(--d115-primary); box-shadow: 0 -3px 0 -1px var(--d115-primary); content: ''; }
        [data-jbv-drive115-picker] .drive115-folder-row-main { min-width: 0; overflow: hidden; }
        [data-jbv-drive115-picker] .drive115-folder-row-main strong { display: block; overflow: hidden; font-size: 14px; font-weight: 750; text-overflow: ellipsis; white-space: nowrap; }
        [data-jbv-drive115-picker] .drive115-folder-row-id, [data-jbv-drive115-picker] .drive115-folder-row-arrow { overflow: hidden; color: var(--d115-muted); font-size: 12px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
        [data-jbv-drive115-picker] .drive115-folder-row-arrow { font-size: 18px; font-weight: 400; }
        [data-jbv-drive115-picker] .drive115-folder-empty { display: grid; min-height: 230px; place-items: center; border: 1px dashed var(--d115-border); border-radius: 11px; color: var(--d115-muted); font-size: 13px; }
        [data-jbv-drive115-picker] .drive115-folder-picker-pagination { display: flex; min-height: 32px; align-items: center; justify-content: flex-end; gap: 8px; }
        [data-jbv-drive115-picker] .drive115-folder-picker-pagination button { min-height: 32px; border: 1px solid var(--d115-border); border-radius: 9px; background: var(--d115-surface); color: var(--d115-text); cursor: pointer; padding: 6px 10px; font-size: 12px; font-weight: 700; }
        [data-jbv-drive115-picker] .drive115-folder-picker-pagination button:disabled { cursor: default; opacity: .46; }
        [data-jbv-drive115-picker] .drive115-folder-picker-options { display: grid; gap: 8px; padding: 11px 12px; border: 1px solid var(--d115-border); border-radius: 12px; background: color-mix(in srgb, var(--d115-soft) 68%, transparent); }
        [data-jbv-drive115-picker] .drive115-folder-picker-options label { display: flex; align-items: center; gap: 8px; color: var(--d115-text); cursor: pointer; font-size: 13px; font-weight: 650; }
        [data-jbv-drive115-picker] .drive115-folder-picker-options input { accent-color: var(--d115-primary); }
        [data-jbv-drive115-picker] .drive115-folder-picker-selected { min-width: 0; margin-right: auto; overflow: hidden; color: var(--d115-muted); font-size: 12px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
        [data-jbv-drive115-picker] .button-like { min-height: 38px; border: 1px solid var(--d115-border); border-radius: 10px; background: var(--d115-surface); color: var(--d115-text); cursor: pointer; padding: 8px 13px; font-size: 13px; font-weight: 750; }
        [data-jbv-drive115-picker] .button-like--primary { border-color: var(--d115-primary); background: var(--d115-primary); color: #fff; }
        [data-jbv-drive115-picker] .button-like--primary:hover { background: #1d4ed8; }
        @media (max-width: 560px) { [data-jbv-drive115-picker] { padding: 10px; } [data-jbv-drive115-picker] .drive115-folder-picker-modal { max-height: calc(100vh - 20px); max-height: calc(100dvh - 20px); } [data-jbv-drive115-picker] .c-modal__header, [data-jbv-drive115-picker] .c-modal__footer { padding: 14px; } [data-jbv-drive115-picker] .c-modal__body { padding: 0 14px 14px; } [data-jbv-drive115-picker] .drive115-folder-picker-toolbar { align-items: stretch; flex-direction: column; gap: 8px; } [data-jbv-drive115-picker] .drive115-folder-picker-search { width: 100%; } [data-jbv-drive115-picker] .drive115-folder-row { grid-template-columns: 30px minmax(0, 1fr) 14px; } [data-jbv-drive115-picker] .drive115-folder-row-id { display: none; } [data-jbv-drive115-picker] .c-modal__footer { flex-wrap: wrap; } [data-jbv-drive115-picker] .drive115-folder-picker-selected { width: 100%; } [data-jbv-drive115-picker] .button-like { flex: 1; } }
      </style>
      <section class="c-modal c-modal--lg drive115-folder-picker-modal" role="dialog" aria-modal="true" aria-label="选择 115 保存目录">
        <header class="c-modal__header">
          <div class="drive115-folder-picker-heading"><span class="drive115-folder-picker-mark" aria-hidden="true">115</span><div><span class="drive115-folder-picker-eyebrow">Drive 115</span><h3 class="c-modal__title">选择保存目录</h3></div></div>
          <button type="button" class="c-modal__close" data-jbv-drive115-picker-cancel aria-label="关闭">×</button>
        </header>
        <div class="c-modal__body">
          <div class="drive115-folder-picker-pathbar">
            <div class="drive115-folder-picker-current-wrap"><span>当前目录</span><strong class="drive115-folder-picker-current" data-jbv-drive115-picker-current></strong><small data-jbv-drive115-picker-cid></small></div>
            <div class="drive115-folder-picker-actions"><button type="button" data-jbv-drive115-picker-root title="回到根目录" aria-label="回到根目录">⌂</button><button type="button" data-jbv-drive115-picker-refresh title="刷新当前目录" aria-label="刷新当前目录">↻</button></div>
          </div>
          <div class="drive115-folder-picker-toolbar"><div class="drive115-folder-picker-status" data-jbv-drive115-picker-status></div><input class="drive115-folder-picker-search" type="search" data-jbv-drive115-picker-search placeholder="搜索当前目录中的文件夹" aria-label="搜索当前目录中的文件夹"></div>
          <div class="drive115-folder-picker-list" data-jbv-drive115-picker-list></div>
          <div class="drive115-folder-picker-pagination" data-jbv-drive115-picker-pagination></div>
          <div class="drive115-folder-picker-options">
            <label><input type="checkbox" data-jbv-drive115-picker-set-default>设为默认下载目录</label>
            <label><input type="checkbox" data-jbv-drive115-picker-skip disabled>下次不再显示，直接使用默认目录</label>
          </div>
        </div>
        <footer class="c-modal__footer"><span class="drive115-folder-picker-selected" data-jbv-drive115-picker-selected></span><button type="button" class="button-like" data-jbv-drive115-picker-cancel>取消</button><button type="button" class="button-like button-like--primary" data-jbv-drive115-picker-use>使用此目录</button></footer>
      </section>`;
    const updateTheme = (): void => {
      overlay.dataset.theme = getJavdbTheme();
    };
    updateTheme();
    document.body.appendChild(overlay);
    const themeObserver = new MutationObserver(updateTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    let current: FolderDirectory = {
      cid: normalizeCid(initialCid) || '0',
      name: initialCid ? `目录 ${initialCid}` : '根目录',
      path: '/',
      folders: [],
    };
    let loading = false;
    let error = '';
    let page = 1;
    let searchQuery = '';
    const currentElement = overlay.querySelector<HTMLElement>('[data-jbv-drive115-picker-current]');
    const currentCidElement = overlay.querySelector<HTMLElement>('[data-jbv-drive115-picker-cid]');
    const statusElement = overlay.querySelector<HTMLElement>('[data-jbv-drive115-picker-status]');
    const listElement = overlay.querySelector<HTMLElement>('[data-jbv-drive115-picker-list]');
    const paginationElement = overlay.querySelector<HTMLElement>('[data-jbv-drive115-picker-pagination]');
    const selectedElement = overlay.querySelector<HTMLElement>('[data-jbv-drive115-picker-selected]');
    const searchElement = overlay.querySelector<HTMLInputElement>('[data-jbv-drive115-picker-search]');
    const setDefaultElement = overlay.querySelector<HTMLInputElement>('[data-jbv-drive115-picker-set-default]');
    const skipPickerElement = overlay.querySelector<HTMLInputElement>('[data-jbv-drive115-picker-skip]');

    const updateSkipPickerAvailability = (): void => {
      const canUseCurrentFolderAsDefault = current.cid !== '0';
      const isCurrentDefault = current.cid === normalizeCid(defaultCid);
      const canSkipPicker = canUseCurrentFolderAsDefault && (isCurrentDefault || setDefaultElement?.checked === true);
      if (skipPickerElement) {
        skipPickerElement.disabled = !canSkipPicker;
        if (!canSkipPicker) skipPickerElement.checked = false;
      }
    };

    const render = (): void => {
      if (currentElement) currentElement.textContent = current.path;
      if (currentCidElement) currentCidElement.textContent = current.cid === '0' ? '根目录 ID 0' : `目录 ID ${current.cid}`;
      if (selectedElement) selectedElement.textContent = `将保存到：${current.path}（${current.cid}）`;
      if (statusElement) {
        statusElement.textContent = loading ? '正在加载文件夹...' : error || `${current.folders.length} 个子文件夹`;
        statusElement.dataset.jbvDrive115PickerStatus = error ? 'error' : 'info';
      }
      if (!listElement) return;
      listElement.replaceChildren();
      if (paginationElement) paginationElement.replaceChildren();
      if (loading) return;
      if (error) {
        const retryButton = document.createElement('button');
        retryButton.type = 'button';
        retryButton.className = 'button-like';
        retryButton.textContent = '重试';
        retryButton.addEventListener('click', () => void refresh());
        listElement.appendChild(retryButton);
        return;
      }
      const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
      const visibleFolders = normalizedQuery
        ? current.folders.filter((folder) => folderName(folder).toLocaleLowerCase().includes(normalizedQuery))
        : current.folders;
      const totalPages = Math.max(1, Math.ceil(visibleFolders.length / FOLDER_PAGE_SIZE));
      page = Math.min(totalPages, Math.max(1, page));
      const pageStart = (page - 1) * FOLDER_PAGE_SIZE;
      const pageFolders = visibleFolders.slice(pageStart, pageStart + FOLDER_PAGE_SIZE);
      for (const folder of pageFolders) {
        const cid = folderId(folder);
        if (!cid) continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'drive115-folder-row';
        button.dataset.jbvDrive115PickerFolder = cid;
        const icon = document.createElement('span');
        icon.className = 'drive115-folder-row-icon';
        icon.setAttribute('aria-hidden', 'true');
        const main = document.createElement('span');
        main.className = 'drive115-folder-row-main';
        const name = document.createElement('strong');
        name.textContent = folderName(folder);
        main.appendChild(name);
        const id = document.createElement('small');
        id.className = 'drive115-folder-row-id';
        id.textContent = `ID ${cid}`;
        const arrow = document.createElement('span');
        arrow.className = 'drive115-folder-row-arrow';
        arrow.setAttribute('aria-hidden', 'true');
        arrow.textContent = '›';
        button.append(icon, main, id, arrow);
        button.addEventListener('click', () => void refresh(cid));
        listElement.appendChild(button);
      }
      if (paginationElement && (totalPages > 1 || normalizedQuery)) {
        const previous = document.createElement('button');
        previous.type = 'button';
        previous.textContent = '上一页';
        previous.disabled = page <= 1;
        previous.addEventListener('click', () => {
          page -= 1;
          render();
        });
        const pageInfo = document.createElement('span');
        pageInfo.textContent = `第 ${page} / ${totalPages} 页`;
        const next = document.createElement('button');
        next.type = 'button';
        next.textContent = '下一页';
        next.disabled = page >= totalPages;
        next.addEventListener('click', () => {
          page += 1;
          render();
        });
        paginationElement.append(previous, pageInfo, next);
      }
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close(null);
    };
    const close = (selection: Drive115FolderSelection | null): void => {
      document.removeEventListener('keydown', onKeyDown);
      themeObserver.disconnect();
      overlay.remove();
      if (closeActivePicker === close) closeActivePicker = null;
      resolve(selection);
    };
    const refresh = async (cid = current.cid): Promise<void> => {
      loading = true;
      error = '';
      page = 1;
      render();
      try {
        current = await loadDirectory(cid);
        updateSkipPickerAvailability();
      } catch (reason: unknown) {
        error = reason instanceof Error ? reason.message : '获取文件夹列表失败';
      } finally {
        loading = false;
        if (overlay.isConnected) render();
      }
    };

    closeActivePicker = close;
    document.addEventListener('keydown', onKeyDown);
    overlay.addEventListener('click', (event: MouseEvent) => {
      if (event.target === overlay) close(null);
    });
    overlay.querySelectorAll<HTMLButtonElement>('[data-jbv-drive115-picker-cancel]').forEach((button) => {
      button.addEventListener('click', () => close(null));
    });
    overlay.querySelector<HTMLButtonElement>('[data-jbv-drive115-picker-root]')?.addEventListener('click', () => {
      void refresh('0');
    });
    overlay.querySelector<HTMLButtonElement>('[data-jbv-drive115-picker-refresh]')?.addEventListener('click', () => {
      void refresh(current.cid);
    });
    searchElement?.addEventListener('input', () => {
      searchQuery = searchElement.value;
      page = 1;
      render();
    });
    setDefaultElement?.addEventListener('change', updateSkipPickerAvailability);
    overlay.querySelector<HTMLButtonElement>('[data-jbv-drive115-picker-use]')?.addEventListener('click', () => {
      const setAsDefault = current.cid !== '0' && setDefaultElement?.checked === true;
      const canSkipPicker = current.cid !== '0'
        && (current.cid === normalizeCid(defaultCid) || setAsDefault);
      close({
        cid: current.cid,
        name: current.name,
        path: current.path,
        setAsDefault,
        skipManualDirectoryPicker: canSkipPicker && skipPickerElement?.checked === true,
      });
    });
    void refresh(current.cid);
  });
}
