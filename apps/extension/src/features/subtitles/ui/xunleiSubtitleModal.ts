/**
 * @file xunleiSubtitleModal.ts
 * @description xunleiSubtitleModal
 * @module features/subtitles
 */
import { fetchXunleiSubtitleResponse, fetchXunleiSubtitleText } from '../adapters/xunleiSubtitleApi';
import { formatXunleiSubtitleDuration, normalizeXunleiSubtitleItems } from '../domain/normalizeXunleiSubtitle';
import type { XunleiSubtitleItem } from '../domain/types';

export function isXunleiSubtitleLink(item: { name: string; url: string }): boolean {
  return /api-shoulei-ssl\.xunlei\.com\/oracle\/subtitle/i.test(item.url)
    || /迅雷/.test(item.name);
}

export function openXunleiSubtitleModal(videoId: string, apiUrl: string): void {
  document.querySelector('.jdb-xunlei-subtitle-modal')?.remove();
  injectXunleiSubtitleStyles();

  const modal = document.createElement('div');
  modal.className = 'jdb-xunlei-subtitle-modal';
  modal.innerHTML = `
    <div class="jdb-xunlei-subtitle-backdrop" data-jdb-xunlei-close></div>
    <div class="jdb-xunlei-subtitle-dialog" role="dialog" aria-modal="true" aria-labelledby="jdb-xunlei-subtitle-title">
      <div class="jdb-xunlei-subtitle-header">
        <div>
          <h3 id="jdb-xunlei-subtitle-title" data-video-id="${escapeHtml(videoId)}">迅雷字幕</h3>
          <p>${escapeHtml(videoId)}</p>
        </div>
        <button type="button" class="jdb-xunlei-subtitle-close" data-jdb-xunlei-close aria-label="关闭">×</button>
      </div>
      <div class="jdb-xunlei-subtitle-body">
        <div class="jdb-xunlei-subtitle-state">加载中...</div>
      </div>
    </div>
  `;

  modal.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('[data-jdb-xunlei-close]')) {
      modal.remove();
    }
  });
  modal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') modal.remove();
  });

  document.body.appendChild(modal);
  modal.querySelector<HTMLElement>('.jdb-xunlei-subtitle-close')?.focus();
  void loadXunleiSubtitleResults(modal, apiUrl);
}

async function loadXunleiSubtitleResults(modal: HTMLElement, apiUrl: string): Promise<void> {
  const body = modal.querySelector<HTMLElement>('.jdb-xunlei-subtitle-body');
  if (!body) return;

  try {
    const response = await fetchXunleiSubtitleResponse(apiUrl);
    const title = modal.querySelector<HTMLElement>('#jdb-xunlei-subtitle-title');
    const videoId = title?.dataset.videoId || '';
    let items = normalizeXunleiSubtitleItems(response);
    let fallbackSummary: XunleiSubtitleFallbackSummary | null = null;

    if (items.length === 0) {
      fallbackSummary = await fetchXunleiSubtitleFallbackSummary(apiUrl, videoId);
      if (fallbackSummary?.exactItems.length) {
        items = fallbackSummary.exactItems;
      }
    }

    if (title) {
      title.textContent = `迅雷字幕 · ${videoId || '影片'} · ${items.length} 条${fallbackSummary?.exactItems.length ? ' · 备用查询' : ''}`;
    }

    body.innerHTML = '';

    if (items.length === 0) {
      body.appendChild(createXunleiSubtitleEmptyState(videoId, fallbackSummary));
      return;
    }

    if (fallbackSummary?.exactItems.length) {
      body.appendChild(createXunleiSubtitleNotice(`精确查询无结果，已用备用查询 ${fallbackSummary.query} 找到 ${fallbackSummary.exactItems.length} 条精确匹配。`));
    }

    const list = document.createElement('div');
    list.className = 'jdb-xunlei-subtitle-list';

    items.forEach((item) => {
      list.appendChild(createXunleiSubtitleRow(item, videoId));
    });

    body.appendChild(list);
  } catch (error) {
    body.innerHTML = `<div class="jdb-xunlei-subtitle-state is-error">加载失败：${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
  }
}

interface XunleiSubtitleFallbackSummary {
  query: string;
  totalCount: number;
  exactItems: XunleiSubtitleItem[];
  errorMessage?: string;
}

async function fetchXunleiSubtitleFallbackSummary(apiUrl: string, videoId: string): Promise<XunleiSubtitleFallbackSummary | null> {
  const fallback = buildXunleiSubtitleFallbackQuery(apiUrl, videoId);
  if (!fallback) return null;

  try {
    const response = await fetchXunleiSubtitleResponse(fallback.url);
    const items = normalizeXunleiSubtitleItems(response);
    return {
      query: fallback.query,
      totalCount: items.length,
      exactItems: items.filter(item => isXunleiSubtitleExactMatch(videoId, item)),
    };
  } catch (error) {
    return {
      query: fallback.query,
      totalCount: 0,
      exactItems: [],
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildXunleiSubtitleFallbackQuery(apiUrl: string, videoId: string): { url: string; query: string } | null {
  const query = normalizeXunleiSubtitleSearchKey(videoId);
  if (!query) return null;

  try {
    const url = new URL(apiUrl);
    const currentQuery = url.searchParams.get('name') || '';
    if (normalizeXunleiSubtitleSearchKey(currentQuery) === currentQuery.trim().toUpperCase()) return null;
    url.searchParams.set('name', query);
    return { url: url.toString(), query };
  } catch {
    const currentQuery = (apiUrl.match(/[?&]name=([^&]*)/)?.[1] || '').trim();
    if (normalizeXunleiSubtitleSearchKey(decodeURIComponent(currentQuery)) === query) return null;
    if (!/[?&]name=/.test(apiUrl)) return null;
    return {
      url: apiUrl.replace(/([?&]name=)[^&]*/, `$1${encodeURIComponent(query)}`),
      query,
    };
  }
}

function isXunleiSubtitleExactMatch(videoId: string, item: XunleiSubtitleItem): boolean {
  const key = normalizeXunleiSubtitleSearchKey(videoId);
  if (!key) return false;
  return [item.name, item.url]
    .map(value => normalizeXunleiSubtitleSearchKey(value || ''))
    .some(value => value.includes(key));
}

function normalizeXunleiSubtitleSearchKey(value: string): string {
  return String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function createXunleiSubtitleEmptyState(videoId: string, fallbackSummary: XunleiSubtitleFallbackSummary | null): HTMLElement {
  const state = document.createElement('div');
  state.className = 'jdb-xunlei-subtitle-state';

  const lines = [
    videoId ? `迅雷接口未返回 ${videoId} 的字幕。` : '迅雷接口未返回字幕。',
  ];

  if (fallbackSummary?.errorMessage) {
    lines.push(`备用模糊查询 ${fallbackSummary.query} 失败：${fallbackSummary.errorMessage}`);
  } else if (fallbackSummary && fallbackSummary.totalCount > 0) {
    lines.push(`备用模糊查询 ${fallbackSummary.query} 返回 ${fallbackSummary.totalCount} 条，但没有精确匹配 ${videoId || '当前影片'}，为避免下错字幕未展示。`);
  } else if (fallbackSummary) {
    lines.push(`备用模糊查询 ${fallbackSummary.query} 也没有返回字幕。`);
  }

  lines.push('可尝试 SubTitleCat 或其它字幕源。');

  lines.forEach((line) => {
    const paragraph = document.createElement('p');
    paragraph.textContent = line;
    state.appendChild(paragraph);
  });

  return state;
}

function createXunleiSubtitleNotice(message: string): HTMLElement {
  const notice = document.createElement('div');
  notice.className = 'jdb-xunlei-subtitle-notice';
  notice.textContent = message;
  return notice;
}

function createXunleiSubtitleRow(item: XunleiSubtitleItem, videoId: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'jdb-xunlei-subtitle-row';

  const title = document.createElement('div');
  title.className = 'jdb-xunlei-subtitle-name';
  title.textContent = item.name || '未命名字幕';

  row.appendChild(title);
  row.appendChild(createXunleiSubtitleMeta(item));
  row.appendChild(createXunleiSubtitleActions(item, videoId));

  return row;
}

function createXunleiSubtitleActions(item: XunleiSubtitleItem, videoId: string): HTMLElement {
  const actions = document.createElement('div');
  actions.className = 'jdb-xunlei-subtitle-actions';
  if (!item.url) return actions;

  const downloadUrl = item.url;

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'jdb-xunlei-subtitle-copy';
  copy.textContent = '复制链接';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(downloadUrl);
      copy.textContent = '已复制';
      window.setTimeout(() => {
        copy.textContent = '复制链接';
      }, 1200);
    } catch {
      copy.textContent = '复制失败';
      window.setTimeout(() => {
        copy.textContent = '复制链接';
      }, 1200);
    }
  });

  const suggestedFilename = buildXunleiSubtitleDownloadFilename(videoId, item);

  const preview = document.createElement('button');
  preview.type = 'button';
  preview.className = 'jdb-xunlei-subtitle-preview';
  preview.textContent = '预览';
  preview.title = `预览 ${suggestedFilename} 内容，下载前检查是否乱码`;
  preview.addEventListener('click', () => {
    void previewXunleiSubtitleFile(downloadUrl, suggestedFilename, item.name || suggestedFilename, preview);
  });

  const download = document.createElement('a');
  download.href = downloadUrl;
  download.target = '_blank';
  download.rel = 'noopener noreferrer';
  download.className = 'jdb-xunlei-subtitle-download';
  download.textContent = '下载';
  download.download = suggestedFilename;
  download.title = `下载后建议保存为 ${suggestedFilename}，方便 Emby/Jellyfin 按影片文件名匹配字幕`;
  download.addEventListener('click', (event) => {
    event.preventDefault();
    void downloadXunleiSubtitleFile(downloadUrl, suggestedFilename, download);
  });
  actions.appendChild(preview);
  actions.appendChild(copy);
  actions.appendChild(download);

  return actions;
}

async function previewXunleiSubtitleFile(url: string, filename: string, sourceName: string, trigger: HTMLElement): Promise<void> {
  const originalText = trigger.textContent || '预览';
  const modal = createXunleiSubtitlePreviewModal(url, filename, sourceName);
  const content = modal.querySelector<HTMLElement>('.jdb-xunlei-subtitle-preview-content');
  document.body.appendChild(modal);
  modal.querySelector<HTMLElement>('.jdb-xunlei-subtitle-preview-close')?.focus();

  try {
    trigger.textContent = '预览中...';
    const subtitleText = await fetchXunleiSubtitleText(url);
    if (content) {
      content.classList.remove('is-error');
      content.textContent = subtitleText || '字幕内容为空';
    }
  } catch (error) {
    console.error('[JavDB][Subtitles] 字幕预览失败:', error);
    if (content) {
      content.classList.add('is-error');
      content.textContent = `预览失败：${error instanceof Error ? error.message : String(error)}`;
    }
  } finally {
    trigger.textContent = originalText;
  }
}

function createXunleiSubtitlePreviewModal(url: string, filename: string, sourceName: string): HTMLElement {
  document.querySelector('.jdb-xunlei-subtitle-preview-modal')?.remove();

  const modal = document.createElement('div');
  modal.className = 'jdb-xunlei-subtitle-preview-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'jdb-xunlei-subtitle-preview-title');
  modal.tabIndex = -1;

  const backdrop = document.createElement('div');
  backdrop.className = 'jdb-xunlei-subtitle-preview-backdrop';
  backdrop.dataset.jdbXunleiPreviewClose = 'true';

  const dialog = document.createElement('div');
  dialog.className = 'jdb-xunlei-subtitle-preview-dialog';

  const header = document.createElement('div');
  header.className = 'jdb-xunlei-subtitle-preview-header';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'jdb-xunlei-subtitle-preview-title-wrap';

  const title = document.createElement('strong');
  title.id = 'jdb-xunlei-subtitle-preview-title';
  title.className = 'jdb-xunlei-subtitle-preview-title';
  title.textContent = `字幕预览 · ${filename}`;

  const hint = document.createElement('span');
  hint.className = 'jdb-xunlei-subtitle-preview-hint';
  hint.textContent = `原字幕：${sourceName || filename}；下载保存为：${filename}`;

  titleWrap.appendChild(title);
  titleWrap.appendChild(hint);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'jdb-xunlei-subtitle-preview-close';
  close.dataset.jdbXunleiPreviewClose = 'true';
  close.setAttribute('aria-label', '关闭字幕预览');
  close.textContent = '×';

  header.appendChild(titleWrap);
  header.appendChild(close);

  const content = document.createElement('pre');
  content.className = 'jdb-xunlei-subtitle-preview-content';
  content.textContent = '字幕加载中...';

  const footer = document.createElement('div');
  footer.className = 'jdb-xunlei-subtitle-preview-footer';

  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'jdb-xunlei-subtitle-preview-download';
  download.textContent = '下载此字幕';
  download.addEventListener('click', () => {
    void downloadXunleiSubtitleFile(url, filename, download);
  });

  const closeFooter = document.createElement('button');
  closeFooter.type = 'button';
  closeFooter.className = 'jdb-xunlei-subtitle-preview-close-secondary';
  closeFooter.dataset.jdbXunleiPreviewClose = 'true';
  closeFooter.textContent = '关闭';

  footer.appendChild(download);
  footer.appendChild(closeFooter);

  dialog.appendChild(header);
  dialog.appendChild(content);
  dialog.appendChild(footer);
  modal.appendChild(backdrop);
  modal.appendChild(dialog);

  modal.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('[data-jdb-xunlei-preview-close]')) {
      modal.remove();
    }
  });
  modal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') modal.remove();
  });

  return modal;
}

async function downloadXunleiSubtitleFile(url: string, filename: string, trigger: HTMLElement): Promise<void> {
  const originalText = trigger.textContent || '下载';
  try {
    trigger.textContent = '下载中...';
    const subtitleText = await fetchXunleiSubtitleText(url);
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
  } catch (error) {
    console.error('[JavDB][Subtitles] 字幕下载失败:', error);
    trigger.textContent = '下载失败';
    window.open(url, '_blank', 'noopener,noreferrer');
  } finally {
    window.setTimeout(() => {
      trigger.textContent = originalText;
    }, 1200);
  }
}

function inferSubtitleMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'vtt') return 'text/vtt';
  if (ext === 'ass' || ext === 'ssa') return 'text/plain';
  return 'application/x-subrip';
}

function buildXunleiSubtitleDownloadFilename(videoId: string, item: XunleiSubtitleItem): string {
  const baseName = sanitizeSubtitleFilenameBase(videoId) || sanitizeSubtitleFilenameBase(item.name) || 'subtitle';
  const ext = inferSubtitleExtension(item);
  return `${baseName}.${ext}`;
}

function sanitizeSubtitleFilenameBase(value: string): string {
  const withoutExtension = String(value || '')
    .trim()
    .replace(/\.[a-z0-9]{1,8}$/i, '');
  return withoutExtension
    .replace(/[<>:"\\|?*\u0000-\u001F]/g, '')
    .replace(/\//g, '')
    .replace(/[\s.]+$/g, '')
    .trim();
}

function inferSubtitleExtension(item: XunleiSubtitleItem): string {
  const candidates = [item.ext, item.name, item.url];
  for (const candidate of candidates) {
    const raw = String(candidate || '');
    const match = raw.match(/\.([a-z0-9]{1,8})(?:[?#].*)?$/i) || raw.match(/^([a-z0-9]{1,8})$/i);
    const ext = match?.[1]?.toLowerCase();
    if (ext) return ext;
  }
  return 'srt';
}

function createXunleiSubtitleMeta(item: XunleiSubtitleItem): HTMLElement {
  const meta = document.createElement('div');
  meta.className = 'jdb-xunlei-subtitle-meta';

  [
    item.ext ? item.ext.toUpperCase() : '',
    item.language || '未知语言',
    item.sourceLabel || '',
    formatXunleiSubtitleDuration(item.duration),
    item.hash ? `Hash ${item.hash}` : '',
    item.rate ? `匹配 ${item.rate}` : '',
  ].filter(Boolean).forEach((text) => {
    const tag = document.createElement('span');
    tag.className = 'jdb-xunlei-subtitle-tag';
    tag.textContent = text;
    meta.appendChild(tag);
  });

  return meta;
}

export function injectXunleiSubtitleStyles(): void {
  if (document.getElementById('jdb-xunlei-subtitle-styles')) return;

  const style = document.createElement('style');
  style.id = 'jdb-xunlei-subtitle-styles';
  style.textContent = `
    .jdb-xunlei-subtitle-modal,
    .jdb-xunlei-subtitle-preview-modal {
      --jdb-xunlei-bg: #ffffff;
      --jdb-xunlei-panel: #f8fafc;
      --jdb-xunlei-border: rgba(15, 23, 42, 0.12);
      --jdb-xunlei-text: #1f2937;
      --jdb-xunlei-muted: #64748b;
      --jdb-xunlei-action-bg: #e1f5fe;
      --jdb-xunlei-action-text: #0277bd;
    }

    .jdb-xunlei-subtitle-modal {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    html[data-theme="dark"] .jdb-xunlei-subtitle-modal,
    html[data-theme="dark"] .jdb-xunlei-subtitle-preview-modal {
      --jdb-xunlei-bg: #1f2937;
      --jdb-xunlei-panel: #111827;
      --jdb-xunlei-border: rgba(148, 163, 184, 0.22);
      --jdb-xunlei-text: #e5e7eb;
      --jdb-xunlei-muted: #9ca3af;
      --jdb-xunlei-action-bg: rgba(14, 165, 233, 0.18);
      --jdb-xunlei-action-text: #bae6fd;
    }

    .jdb-xunlei-subtitle-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(15, 23, 42, 0.42);
      backdrop-filter: blur(6px);
    }

    .jdb-xunlei-subtitle-dialog {
      position: relative;
      width: min(760px, 100%);
      max-height: min(72vh, 620px);
      display: flex;
      flex-direction: column;
      border: 1px solid var(--jdb-xunlei-border);
      border-radius: 8px;
      overflow: hidden;
      background: var(--jdb-xunlei-bg);
      color: var(--jdb-xunlei-text);
      box-shadow: 0 18px 50px rgba(0, 0, 0, 0.24);
    }

    .jdb-xunlei-subtitle-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--jdb-xunlei-border);
      background: var(--jdb-xunlei-panel);
    }

    .jdb-xunlei-subtitle-header h3 {
      margin: 0 0 4px;
      font-size: 16px;
      line-height: 1.3;
    }

    .jdb-xunlei-subtitle-header p {
      margin: 0;
      color: var(--jdb-xunlei-muted);
      font-size: 12px;
    }

    .jdb-xunlei-subtitle-close {
      width: 30px;
      height: 30px;
      border: 1px solid var(--jdb-xunlei-border);
      border-radius: 6px;
      background: var(--jdb-xunlei-bg);
      color: var(--jdb-xunlei-muted);
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
    }

    .jdb-xunlei-subtitle-body {
      overflow: auto;
      padding: 12px;
      background: var(--jdb-xunlei-bg);
    }

    .jdb-xunlei-subtitle-state {
      padding: 22px 12px;
      text-align: center;
      color: var(--jdb-xunlei-muted);
    }

    .jdb-xunlei-subtitle-state p {
      margin: 0 0 6px;
    }

    .jdb-xunlei-subtitle-state p:last-child {
      margin-bottom: 0;
    }

    .jdb-xunlei-subtitle-state.is-error {
      color: #dc2626;
    }

    .jdb-xunlei-subtitle-notice {
      margin-bottom: 8px;
      padding: 8px 10px;
      border: 1px solid var(--jdb-xunlei-border);
      border-radius: 7px;
      background: var(--jdb-xunlei-action-bg);
      color: var(--jdb-xunlei-action-text);
      font-size: 12px;
      line-height: 1.5;
    }

    .jdb-xunlei-subtitle-list {
      display: grid;
      gap: 8px;
    }

    .jdb-xunlei-subtitle-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border: 1px solid var(--jdb-xunlei-border);
      border-radius: 7px;
      background: var(--jdb-xunlei-panel);
    }

    .jdb-xunlei-subtitle-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 600;
    }

    .jdb-xunlei-subtitle-meta {
      display: inline-flex;
      align-items: center;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 4px;
      color: var(--jdb-xunlei-muted);
      font-size: 12px;
      min-width: 0;
    }

    .jdb-xunlei-subtitle-tag {
      display: inline-flex;
      align-items: center;
      max-width: 9rem;
      min-height: 22px;
      padding: 0 7px;
      border: 1px solid var(--jdb-xunlei-border);
      border-radius: 999px;
      background: var(--jdb-xunlei-bg);
      color: var(--jdb-xunlei-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .jdb-xunlei-subtitle-actions {
      display: inline-flex;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
    }

    .jdb-xunlei-subtitle-download,
    .jdb-xunlei-subtitle-preview,
    .jdb-xunlei-subtitle-copy {
      display: inline-flex;
      align-items: center;
      height: 28px;
      padding: 0 10px;
      border-radius: 6px;
      background: var(--jdb-xunlei-action-bg);
      color: var(--jdb-xunlei-action-text) !important;
      text-decoration: none !important;
      font-size: 12px;
      font-weight: 600;
    }

    .jdb-xunlei-subtitle-preview,
    .jdb-xunlei-subtitle-copy {
      border: 1px solid var(--jdb-xunlei-border);
      cursor: pointer;
      background: var(--jdb-xunlei-bg);
      color: var(--jdb-xunlei-text) !important;
    }

    .jdb-xunlei-subtitle-preview-modal {
      position: fixed;
      inset: 0;
      z-index: 10020;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      color: var(--jdb-xunlei-text);
    }

    .jdb-xunlei-subtitle-preview-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(15, 23, 42, 0.58);
      backdrop-filter: blur(7px);
    }

    .jdb-xunlei-subtitle-preview-dialog {
      position: relative;
      width: min(900px, 100%);
      max-height: min(86vh, 760px);
      display: flex;
      flex-direction: column;
      border: 1px solid var(--jdb-xunlei-border);
      border-radius: 9px;
      overflow: hidden;
      background: var(--jdb-xunlei-bg);
      box-shadow: 0 22px 70px rgba(0, 0, 0, 0.32);
    }

    .jdb-xunlei-subtitle-preview-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--jdb-xunlei-border);
      background: var(--jdb-xunlei-panel);
    }

    .jdb-xunlei-subtitle-preview-title-wrap {
      min-width: 0;
      display: grid;
      gap: 3px;
    }

    .jdb-xunlei-subtitle-preview-title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 14px;
    }

    .jdb-xunlei-subtitle-preview-hint {
      color: var(--jdb-xunlei-muted);
      font-size: 12px;
    }

    .jdb-xunlei-subtitle-preview-close {
      flex: 0 0 auto;
      width: 30px;
      height: 30px;
      border: 1px solid var(--jdb-xunlei-border);
      border-radius: 6px;
      background: var(--jdb-xunlei-bg);
      color: var(--jdb-xunlei-muted);
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
    }

    .jdb-xunlei-subtitle-preview-content {
      flex: 1 1 auto;
      min-height: 240px;
      max-height: 64vh;
      margin: 0;
      padding: 14px;
      overflow: auto;
      background: rgba(15, 23, 42, 0.94);
      color: #f8fafc;
      font-family: Consolas, Monaco, 'Courier New', monospace;
      font-size: 12px;
      line-height: 1.55;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .jdb-xunlei-subtitle-preview-content.is-error {
      color: #fecaca;
    }

    .jdb-xunlei-subtitle-preview-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 10px 14px;
      border-top: 1px solid var(--jdb-xunlei-border);
      background: var(--jdb-xunlei-panel);
    }

    .jdb-xunlei-subtitle-preview-download,
    .jdb-xunlei-subtitle-preview-close-secondary {
      display: inline-flex;
      align-items: center;
      height: 30px;
      padding: 0 12px;
      border: 1px solid var(--jdb-xunlei-border);
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
    }

    .jdb-xunlei-subtitle-preview-download {
      background: var(--jdb-xunlei-action-bg);
      color: var(--jdb-xunlei-action-text);
    }

    .jdb-xunlei-subtitle-preview-close-secondary {
      background: var(--jdb-xunlei-bg);
      color: var(--jdb-xunlei-text);
    }

    @media (max-width: 640px) {
      .jdb-xunlei-subtitle-modal {
        align-items: flex-end;
        padding: 10px;
      }

      .jdb-xunlei-subtitle-row {
        grid-template-columns: minmax(0, 1fr) auto;
      }

      .jdb-xunlei-subtitle-meta {
        grid-column: 1 / -1;
        order: 3;
        justify-content: flex-start;
      }
    }
  `;
  document.head.appendChild(style);
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
