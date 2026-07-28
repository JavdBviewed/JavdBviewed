/**
 * @file subtitleCatSubtitleModal.ts
 * @description SubTitleCat 字幕原生弹窗
 * @module features/subtitles
 */
import { fetchSubtitleCatDocument, fetchSubtitleCatText } from '../adapters/subtitleCatApi';
import { normalizeSubtitleCatLanguageDownloads, normalizeSubtitleCatSearchItems } from '../domain/normalizeSubtitleCat';
import type { SubtitleCatLanguageDownload, SubtitleCatSearchItem } from '../domain/types';

export function isSubtitleCatLink(item: { name: string; url: string }): boolean {
  return /subtitlecat\.com/i.test(item.url) || /^SubTitleCat$/i.test(item.name);
}

export function openSubtitleCatModal(videoId: string, searchUrl: string): void {
  document.querySelector('.jdb-subtitlecat-subtitle-modal')?.remove();
  injectSubtitleCatStyles();

  const modal = document.createElement('div');
  modal.className = 'jdb-subtitlecat-subtitle-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'jdb-subtitlecat-subtitle-title');

  const backdrop = document.createElement('div');
  backdrop.className = 'jdb-subtitlecat-subtitle-backdrop';
  backdrop.dataset.jdbSubtitlecatClose = 'true';

  const dialog = document.createElement('div');
  dialog.className = 'jdb-subtitlecat-subtitle-dialog';

  const header = document.createElement('div');
  header.className = 'jdb-subtitlecat-subtitle-header';

  const titleWrap = document.createElement('div');
  const title = document.createElement('h3');
  title.id = 'jdb-subtitlecat-subtitle-title';
  title.dataset.videoId = videoId;
  title.textContent = 'SubTitleCat';
  const subtitle = document.createElement('p');
  subtitle.textContent = videoId;
  titleWrap.appendChild(title);
  titleWrap.appendChild(subtitle);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'jdb-subtitlecat-subtitle-close';
  close.dataset.jdbSubtitlecatClose = 'true';
  close.setAttribute('aria-label', '关闭');
  close.textContent = '×';

  header.appendChild(titleWrap);
  header.appendChild(close);

  const body = document.createElement('div');
  body.className = 'jdb-subtitlecat-subtitle-body';
  const state = document.createElement('div');
  state.className = 'jdb-subtitlecat-subtitle-state';
  state.textContent = '加载中...';
  body.appendChild(state);

  dialog.appendChild(header);
  dialog.appendChild(body);
  modal.appendChild(backdrop);
  modal.appendChild(dialog);

  modal.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('[data-jdb-subtitlecat-close]')) {
      modal.remove();
    }
  });
  modal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') modal.remove();
  });

  document.body.appendChild(modal);
  close.focus();
  void loadSubtitleCatSearchResults(modal, searchUrl, videoId);
}

async function loadSubtitleCatSearchResults(modal: HTMLElement, searchUrl: string, videoId: string): Promise<void> {
  const body = modal.querySelector<HTMLElement>('.jdb-subtitlecat-subtitle-body');
  if (!body) return;

  try {
    const doc = await fetchSubtitleCatDocument(searchUrl);
    const items = normalizeSubtitleCatSearchItems(doc, searchUrl, videoId);
    const title = modal.querySelector<HTMLElement>('#jdb-subtitlecat-subtitle-title');
    if (title) title.textContent = `SubTitleCat · ${videoId || '影片'} · ${items.length} 条`;

    body.textContent = '';
    if (items.length === 0) {
      body.appendChild(createSubtitleCatEmptyState(videoId));
      return;
    }

    const notice = createSubtitleCatNotice('已从 SubTitleCat 搜索页解析结果；点“获取下载”后再读取该字幕详情页的可下载语言。');
    body.appendChild(notice);

    const list = document.createElement('div');
    list.className = 'jdb-subtitlecat-subtitle-list';
    items.forEach((item) => {
      list.appendChild(createSubtitleCatSearchRow(item, videoId));
    });
    body.appendChild(list);
  } catch (error) {
    body.textContent = '';
    const state = document.createElement('div');
    state.className = 'jdb-subtitlecat-subtitle-state is-error';
    state.textContent = `加载失败：${error instanceof Error ? error.message : String(error)}`;
    body.appendChild(state);
  }
}

function createSubtitleCatSearchRow(item: SubtitleCatSearchItem, videoId: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'jdb-subtitlecat-subtitle-row';

  const title = document.createElement('div');
  title.className = 'jdb-subtitlecat-subtitle-name';
  title.textContent = item.name;

  row.appendChild(title);
  row.appendChild(createSubtitleCatMeta(item));
  row.appendChild(createSubtitleCatActions(item, videoId, row));

  const languageContainer = document.createElement('div');
  languageContainer.className = 'jdb-subtitlecat-language-container';
  row.appendChild(languageContainer);

  return row;
}

function createSubtitleCatMeta(item: SubtitleCatSearchItem): HTMLElement {
  const meta = document.createElement('div');
  meta.className = 'jdb-subtitlecat-subtitle-meta';

  [
    item.translatedFrom || '',
    item.rating || '',
    item.size || '',
    item.downloads || '',
    item.languageCount || '',
  ].filter(Boolean).forEach((text) => {
    const tag = document.createElement('span');
    tag.className = 'jdb-subtitlecat-subtitle-tag';
    tag.textContent = text;
    meta.appendChild(tag);
  });

  return meta;
}

function createSubtitleCatActions(item: SubtitleCatSearchItem, videoId: string, row: HTMLElement): HTMLElement {
  const actions = document.createElement('div');
  actions.className = 'jdb-subtitlecat-subtitle-actions';

  const load = document.createElement('button');
  load.type = 'button';
  load.className = 'jdb-subtitlecat-load-downloads';
  load.textContent = '获取下载';
  load.addEventListener('click', () => {
    void loadSubtitleCatLanguageDownloads(item, videoId, row, load);
  });

  const external = document.createElement('a');
  external.href = item.pageUrl;
  external.target = '_blank';
  external.rel = 'noopener noreferrer';
  external.className = 'jdb-subtitlecat-open-external';
  external.textContent = '原页';

  actions.appendChild(load);
  actions.appendChild(external);
  return actions;
}

async function loadSubtitleCatLanguageDownloads(
  item: SubtitleCatSearchItem,
  videoId: string,
  row: HTMLElement,
  trigger: HTMLButtonElement,
): Promise<void> {
  const container = row.querySelector<HTMLElement>('.jdb-subtitlecat-language-container');
  if (!container) return;

  const originalText = trigger.textContent || '获取下载';
  try {
    trigger.disabled = true;
    trigger.textContent = '获取中...';
    container.textContent = '';
    const state = document.createElement('div');
    state.className = 'jdb-subtitlecat-language-state';
    state.textContent = '读取字幕详情中...';
    container.appendChild(state);

    const doc = await fetchSubtitleCatDocument(item.pageUrl);
    const downloads = normalizeSubtitleCatLanguageDownloads(doc, item.pageUrl);
    container.textContent = '';

    if (downloads.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'jdb-subtitlecat-language-state';
      empty.textContent = '该字幕详情页没有可直接下载的语言。';
      container.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'jdb-subtitlecat-language-list';
    downloads.forEach((download) => {
      list.appendChild(createSubtitleCatLanguageRow(download, videoId, item.name));
    });
    container.appendChild(list);
    trigger.textContent = '已获取';
  } catch (error) {
    container.textContent = '';
    const state = document.createElement('div');
    state.className = 'jdb-subtitlecat-language-state is-error';
    state.textContent = `获取失败：${error instanceof Error ? error.message : String(error)}`;
    container.appendChild(state);
    trigger.disabled = false;
    trigger.textContent = originalText;
  }
}

function createSubtitleCatLanguageRow(download: SubtitleCatLanguageDownload, videoId: string, sourceName: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'jdb-subtitlecat-language-row';

  const info = document.createElement('div');
  info.className = 'jdb-subtitlecat-language-info';
  const name = document.createElement('span');
  name.className = 'jdb-subtitlecat-language-name';
  name.textContent = download.language;
  const code = document.createElement('span');
  code.className = 'jdb-subtitlecat-language-code';
  code.textContent = download.code || download.ext.toUpperCase();
  info.appendChild(name);
  info.appendChild(code);

  const actions = document.createElement('div');
  actions.className = 'jdb-subtitlecat-language-actions';
  const filename = buildSubtitleCatDownloadFilename(videoId, download, sourceName);

  const preview = document.createElement('button');
  preview.type = 'button';
  preview.className = 'jdb-subtitlecat-language-preview';
  preview.textContent = '预览';
  preview.title = `预览 ${filename} 内容，下载前检查是否乱码`;
  preview.addEventListener('click', () => {
    void previewSubtitleCatFile(download.downloadUrl, filename, `${sourceName} / ${download.language}`, preview);
  });

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'jdb-subtitlecat-language-copy';
  copy.textContent = '复制链接';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(download.downloadUrl);
      copy.textContent = '已复制';
    } catch {
      copy.textContent = '复制失败';
    } finally {
      window.setTimeout(() => {
        copy.textContent = '复制链接';
      }, 1200);
    }
  });

  const link = document.createElement('a');
  link.href = download.downloadUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.className = 'jdb-subtitlecat-language-download';
  link.textContent = '下载';
  link.download = filename;
  link.title = `下载后保存为 ${filename}，方便 Emby/Jellyfin 按影片文件名匹配字幕`;
  link.addEventListener('click', (event) => {
    event.preventDefault();
    void downloadSubtitleCatFile(download.downloadUrl, filename, link);
  });

  actions.appendChild(preview);
  actions.appendChild(copy);
  actions.appendChild(link);
  row.appendChild(info);
  row.appendChild(actions);
  return row;
}

function createSubtitleCatEmptyState(videoId: string): HTMLElement {
  const state = document.createElement('div');
  state.className = 'jdb-subtitlecat-subtitle-state';
  const first = document.createElement('p');
  first.textContent = videoId ? `SubTitleCat 未找到 ${videoId} 的精确字幕结果。` : 'SubTitleCat 未找到字幕结果。';
  const second = document.createElement('p');
  second.textContent = '为避免下错字幕，已过滤掉只包含同系列前缀但不匹配当前番号的结果。';
  state.appendChild(first);
  state.appendChild(second);
  return state;
}

function createSubtitleCatNotice(message: string): HTMLElement {
  const notice = document.createElement('div');
  notice.className = 'jdb-subtitlecat-subtitle-notice';
  notice.textContent = message;
  return notice;
}

async function previewSubtitleCatFile(url: string, filename: string, sourceName: string, trigger: HTMLElement): Promise<void> {
  const originalText = trigger.textContent || '预览';
  const modal = createSubtitleCatPreviewModal(url, filename, sourceName);
  const content = modal.querySelector<HTMLElement>('.jdb-subtitlecat-preview-content');
  document.body.appendChild(modal);
  modal.querySelector<HTMLElement>('.jdb-subtitlecat-preview-close')?.focus();

  try {
    trigger.textContent = '预览中...';
    const subtitleText = await fetchSubtitleCatText(url);
    if (content) {
      content.classList.remove('is-error');
      content.textContent = subtitleText || '字幕内容为空';
    }
  } catch (error) {
    if (content) {
      content.classList.add('is-error');
      content.textContent = `预览失败：${error instanceof Error ? error.message : String(error)}`;
    }
  } finally {
    trigger.textContent = originalText;
  }
}

function createSubtitleCatPreviewModal(url: string, filename: string, sourceName: string): HTMLElement {
  document.querySelector('.jdb-subtitlecat-preview-modal')?.remove();

  const modal = document.createElement('div');
  modal.className = 'jdb-subtitlecat-preview-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const backdrop = document.createElement('div');
  backdrop.className = 'jdb-subtitlecat-preview-backdrop';
  backdrop.dataset.jdbSubtitlecatPreviewClose = 'true';

  const dialog = document.createElement('div');
  dialog.className = 'jdb-subtitlecat-preview-dialog';

  const header = document.createElement('div');
  header.className = 'jdb-subtitlecat-preview-header';
  const titleWrap = document.createElement('div');
  const title = document.createElement('strong');
  title.className = 'jdb-subtitlecat-preview-title';
  title.textContent = `字幕预览 · ${filename}`;
  const hint = document.createElement('span');
  hint.className = 'jdb-subtitlecat-preview-hint';
  hint.textContent = `原字幕：${sourceName}；下载保存为：${filename}`;
  titleWrap.appendChild(title);
  titleWrap.appendChild(hint);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'jdb-subtitlecat-preview-close';
  close.dataset.jdbSubtitlecatPreviewClose = 'true';
  close.setAttribute('aria-label', '关闭字幕预览');
  close.textContent = '×';
  header.appendChild(titleWrap);
  header.appendChild(close);

  const content = document.createElement('pre');
  content.className = 'jdb-subtitlecat-preview-content';
  content.textContent = '字幕加载中...';

  const footer = document.createElement('div');
  footer.className = 'jdb-subtitlecat-preview-footer';
  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'jdb-subtitlecat-preview-download';
  download.textContent = '下载此字幕';
  download.addEventListener('click', () => {
    void downloadSubtitleCatFile(url, filename, download);
  });
  const closeFooter = document.createElement('button');
  closeFooter.type = 'button';
  closeFooter.className = 'jdb-subtitlecat-preview-close-secondary';
  closeFooter.dataset.jdbSubtitlecatPreviewClose = 'true';
  closeFooter.textContent = '关闭';
  footer.appendChild(download);
  footer.appendChild(closeFooter);

  dialog.appendChild(header);
  dialog.appendChild(content);
  dialog.appendChild(footer);
  modal.appendChild(backdrop);
  modal.appendChild(dialog);

  modal.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('[data-jdb-subtitlecat-preview-close]')) modal.remove();
  });
  modal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') modal.remove();
  });

  return modal;
}

async function downloadSubtitleCatFile(url: string, filename: string, trigger: HTMLElement): Promise<void> {
  const originalText = trigger.textContent || '下载';
  try {
    trigger.textContent = '下载中...';
    const subtitleText = await fetchSubtitleCatText(url);
    const blob = new Blob([subtitleText], { type: `${inferSubtitleMimeType(filename)};charset=utf-8` });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    trigger.textContent = '已下载';
  } catch {
    trigger.textContent = '下载失败';
    window.open(url, '_blank', 'noopener,noreferrer');
  } finally {
    window.setTimeout(() => {
      trigger.textContent = originalText;
    }, 1200);
  }
}

function buildSubtitleCatDownloadFilename(videoId: string, download: SubtitleCatLanguageDownload, sourceName: string): string {
  const baseName = sanitizeSubtitleFilenameBase(videoId) || sanitizeSubtitleFilenameBase(sourceName) || 'subtitle';
  const langSuffix = download.code ? `.${download.code}` : '';
  return `${baseName}${langSuffix}.${download.ext || 'srt'}`;
}

function sanitizeSubtitleFilenameBase(value: string): string {
  const withoutExtension = String(value || '').trim().replace(/\.[a-z0-9]{1,8}$/i, '');
  return withoutExtension
    .replace(/[<>:"\\|?*\u0000-\u001F]/g, '')
    .replace(/\//g, '')
    .replace(/[\s.]+$/g, '')
    .trim();
}

function inferSubtitleMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'vtt') return 'text/vtt';
  if (ext === 'ass' || ext === 'ssa') return 'text/plain';
  return 'application/x-subrip';
}

export function injectSubtitleCatStyles(): void {
  if (document.getElementById('jdb-subtitlecat-subtitle-styles')) return;

  const style = document.createElement('style');
  style.id = 'jdb-subtitlecat-subtitle-styles';
  style.textContent = `
    .jdb-subtitlecat-subtitle-modal,
    .jdb-subtitlecat-preview-modal {
      --jdb-subtitlecat-bg: #ffffff;
      --jdb-subtitlecat-panel: #f8fafc;
      --jdb-subtitlecat-border: rgba(15, 23, 42, 0.12);
      --jdb-subtitlecat-text: #1f2937;
      --jdb-subtitlecat-muted: #64748b;
      --jdb-subtitlecat-action-bg: #fff7ed;
      --jdb-subtitlecat-action-text: #c2410c;
    }

    html[data-theme="dark"] .jdb-subtitlecat-subtitle-modal,
    html[data-theme="dark"] .jdb-subtitlecat-preview-modal {
      --jdb-subtitlecat-bg: #1f2937;
      --jdb-subtitlecat-panel: #111827;
      --jdb-subtitlecat-border: rgba(148, 163, 184, 0.22);
      --jdb-subtitlecat-text: #e5e7eb;
      --jdb-subtitlecat-muted: #9ca3af;
      --jdb-subtitlecat-action-bg: rgba(249, 115, 22, 0.18);
      --jdb-subtitlecat-action-text: #fed7aa;
    }

    .jdb-subtitlecat-subtitle-modal,
    .jdb-subtitlecat-preview-modal {
      position: fixed;
      inset: 0;
      z-index: 10001;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    .jdb-subtitlecat-subtitle-backdrop,
    .jdb-subtitlecat-preview-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(15, 23, 42, 0.42);
      backdrop-filter: blur(6px);
    }

    .jdb-subtitlecat-subtitle-dialog,
    .jdb-subtitlecat-preview-dialog {
      position: relative;
      width: min(860px, 100%);
      max-height: min(78vh, 680px);
      display: flex;
      flex-direction: column;
      border: 1px solid var(--jdb-subtitlecat-border);
      border-radius: 8px;
      overflow: hidden;
      background: var(--jdb-subtitlecat-bg);
      color: var(--jdb-subtitlecat-text);
      box-shadow: 0 18px 50px rgba(0, 0, 0, 0.24);
    }

    .jdb-subtitlecat-subtitle-header,
    .jdb-subtitlecat-preview-header,
    .jdb-subtitlecat-preview-footer {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--jdb-subtitlecat-border);
      background: var(--jdb-subtitlecat-panel);
    }

    .jdb-subtitlecat-preview-footer {
      justify-content: flex-end;
      border-top: 1px solid var(--jdb-subtitlecat-border);
      border-bottom: 0;
    }

    .jdb-subtitlecat-subtitle-header h3,
    .jdb-subtitlecat-subtitle-header p,
    .jdb-subtitlecat-preview-title,
    .jdb-subtitlecat-preview-hint {
      margin: 0;
    }

    .jdb-subtitlecat-subtitle-header p,
    .jdb-subtitlecat-preview-hint,
    .jdb-subtitlecat-subtitle-meta,
    .jdb-subtitlecat-language-code {
      color: var(--jdb-subtitlecat-muted);
      font-size: 12px;
    }

    .jdb-subtitlecat-subtitle-close,
    .jdb-subtitlecat-preview-close {
      border: 0;
      background: transparent;
      color: var(--jdb-subtitlecat-text);
      font-size: 24px;
      line-height: 1;
      cursor: pointer;
    }

    .jdb-subtitlecat-subtitle-body {
      padding: 14px 16px;
      overflow: auto;
    }

    .jdb-subtitlecat-subtitle-state,
    .jdb-subtitlecat-language-state,
    .jdb-subtitlecat-subtitle-notice {
      padding: 14px;
      border-radius: 8px;
      background: var(--jdb-subtitlecat-panel);
      color: var(--jdb-subtitlecat-muted);
    }

    .jdb-subtitlecat-subtitle-state.is-error,
    .jdb-subtitlecat-language-state.is-error,
    .jdb-subtitlecat-preview-content.is-error {
      color: #dc2626;
    }

    .jdb-subtitlecat-subtitle-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 12px;
    }

    .jdb-subtitlecat-subtitle-row {
      padding: 12px;
      border: 1px solid var(--jdb-subtitlecat-border);
      border-radius: 8px;
      background: var(--jdb-subtitlecat-bg);
    }

    .jdb-subtitlecat-subtitle-name {
      font-weight: 700;
      word-break: break-word;
    }

    .jdb-subtitlecat-subtitle-meta,
    .jdb-subtitlecat-subtitle-actions,
    .jdb-subtitlecat-language-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }

    .jdb-subtitlecat-subtitle-tag,
    .jdb-subtitlecat-language-code {
      padding: 2px 7px;
      border-radius: 999px;
      background: var(--jdb-subtitlecat-panel);
      border: 1px solid var(--jdb-subtitlecat-border);
    }

    .jdb-subtitlecat-load-downloads,
    .jdb-subtitlecat-open-external,
    .jdb-subtitlecat-language-preview,
    .jdb-subtitlecat-language-copy,
    .jdb-subtitlecat-language-download,
    .jdb-subtitlecat-preview-download,
    .jdb-subtitlecat-preview-close-secondary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 28px;
      padding: 0 10px;
      border-radius: 6px;
      border: 1px solid var(--jdb-subtitlecat-border);
      background: var(--jdb-subtitlecat-action-bg);
      color: var(--jdb-subtitlecat-action-text);
      text-decoration: none;
      cursor: pointer;
      font-size: 12px;
    }

    .jdb-subtitlecat-language-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 10px;
    }

    .jdb-subtitlecat-language-row {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      padding: 8px;
      border-radius: 8px;
      background: var(--jdb-subtitlecat-panel);
    }

    .jdb-subtitlecat-language-info,
    .jdb-subtitlecat-preview-header > div {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .jdb-subtitlecat-preview-content {
      margin: 0;
      min-height: 260px;
      max-height: 58vh;
      overflow: auto;
      padding: 14px 16px;
      white-space: pre-wrap;
      word-break: break-word;
      background: var(--jdb-subtitlecat-bg);
      color: var(--jdb-subtitlecat-text);
    }

    @media (max-width: 640px) {
      .jdb-subtitlecat-language-row {
        flex-direction: column;
      }
    }
  `;
  document.head.appendChild(style);
}



