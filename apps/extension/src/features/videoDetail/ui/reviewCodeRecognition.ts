/**
 * @file reviewCodeRecognition.ts
 * @description 详情页评论区番号识别与轻量链接化
 * @module features/videoDetail/ui
 */
import {
  buildSearchEngineUrl,
  getSearchEnginesForVideo,
  type SearchEngineTemplate,
} from '../../externalSearch';
import { extractVideoCodesFromText, type ExtractedVideoCode } from '../../../shared/utils/videoCodeExtractor';

export interface ReviewCodeRecognitionLibraryState {
  entries?: Record<string, unknown[]>;
}

export interface ReviewCodeRecognitionOptions {
  searchEngines?: unknown;
  libraryState?: ReviewCodeRecognitionLibraryState | null;
}

interface TextCodeTarget {
  code: ExtractedVideoCode;
  index: number;
  end: number;
}

interface TextRange {
  index: number;
  end: number;
}

const STYLE_ID = 'jdb-review-code-recognition-styles';
const MAGNET_TEXT_PATTERN = /magnet:\?[^\s\u00a0<>"']+/gi;

export function enhanceReviewCodeRecognition(
  root: ParentNode | null | undefined,
  options: ReviewCodeRecognitionOptions = {},
): void {
  if (!root) return;

  const containers = collectReviewContentContainers(root);
  if (containers.length === 0) return;

  let changed = false;
  for (const container of containers) {
    changed = enhanceReviewContainer(container, options) || changed;
  }

  if (changed) {
    injectReviewCodeRecognitionStyles();
  }
}

function collectReviewContentContainers(root: ParentNode): HTMLElement[] {
  const contents = Array.from(root.querySelectorAll<HTMLElement>('.review-item .content'));
  const containers: HTMLElement[] = [];

  for (const content of contents) {
    const paragraphs = Array.from(content.querySelectorAll<HTMLElement>('p'));
    if (paragraphs.length > 0) {
      containers.push(...paragraphs);
    } else {
      containers.push(content);
    }
  }

  return containers;
}

function enhanceReviewContainer(container: HTMLElement, options: ReviewCodeRecognitionOptions): boolean {
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
        if (parent.closest('a, button, script, style, textarea, select, .jhs-review-push-115, .jdb-review-code-library-hint')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }

  let changed = false;
  for (const textNode of textNodes) {
    changed = enhanceTextNode(textNode, options) || changed;
  }

  return changed;
}

function enhanceTextNode(textNode: Text, options: ReviewCodeRecognitionOptions): boolean {
  const text = textNode.textContent || '';
  const targets = getTextCodeTargets(text);
  if (targets.length === 0) return false;

  const parentNode = textNode.parentNode;
  if (!parentNode) return false;

  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const target of targets) {
    if (target.index < cursor) continue;
    if (target.index > cursor) {
      fragment.appendChild(document.createTextNode(text.slice(cursor, target.index)));
    }

    const videoCode = target.code.normalized;
    fragment.appendChild(createReviewCodeLink(videoCode, options.searchEngines));
    if (hasLocalLibraryMatch(options.libraryState, videoCode)) {
      fragment.appendChild(createLibraryHint());
    }
    cursor = target.end;
  }

  if (cursor < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(cursor)));
  }

  parentNode.replaceChild(fragment, textNode);
  return true;
}

function getTextCodeTargets(text: string): TextCodeTarget[] {
  const blockedRanges = getMagnetTextRanges(text);
  return extractVideoCodesFromText(text)
    .map(code => ({
      code,
      index: code.index,
      end: code.index + code.raw.length,
    }))
    .filter(target => !blockedRanges.some(range => rangesOverlap(target, range)));
}

function getMagnetTextRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  for (const match of text.matchAll(MAGNET_TEXT_PATTERN)) {
    if (match.index === undefined) continue;
    ranges.push({
      index: match.index,
      end: match.index + match[0].length,
    });
  }
  return ranges;
}

function rangesOverlap(a: TextRange, b: TextRange): boolean {
  return a.index < b.end && b.index < a.end;
}

function createReviewCodeLink(videoCode: string, searchEngines: unknown): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'jdb-review-code-link';
  link.href = buildReviewCodeSearchUrl(videoCode, searchEngines);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = videoCode;
  link.title = `搜索 ${videoCode}`;
  link.dataset.videoCode = videoCode;
  return link;
}

function createLibraryHint(): HTMLSpanElement {
  const hint = document.createElement('span');
  hint.className = 'jdb-review-code-library-hint';
  hint.textContent = '已入库';
  hint.title = '本地资料库已有匹配';
  return hint;
}

function buildReviewCodeSearchUrl(videoCode: string, searchEngines: unknown): string {
  const engines = getSearchEnginesForVideo(searchEngines, videoCode, 'detail');
  const engine = findPreferredSearchEngine(engines);
  if (engine?.urlTemplate) {
    return buildSearchEngineUrl(engine.urlTemplate, videoCode);
  }
  return `https://javdb.com/search?q=${encodeURIComponent(videoCode)}&f=all`;
}

function findPreferredSearchEngine(engines: SearchEngineTemplate[]): SearchEngineTemplate | null {
  const javdb = engines.find(engine => String(engine.id || '').trim().toLowerCase() === 'javdb' && engine.urlTemplate);
  if (javdb) return javdb;
  return engines.find(engine => Boolean(engine.urlTemplate)) || null;
}

function hasLocalLibraryMatch(
  libraryState: ReviewCodeRecognitionLibraryState | null | undefined,
  videoCode: string,
): boolean {
  const matches = libraryState?.entries?.[videoCode];
  return Array.isArray(matches) && matches.length > 0;
}

function injectReviewCodeRecognitionStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .jdb-review-code-link {
      font-weight: 600;
      color: var(--jdb-review-title, #0f73a8);
      text-decoration: none;
      border-bottom: 1px dotted currentColor;
    }

    .jdb-review-code-link:hover {
      text-decoration: underline;
    }

    .jdb-review-code-library-hint {
      display: inline-flex;
      align-items: center;
      margin-left: 4px;
      padding: 1px 5px;
      border-radius: 4px;
      font-size: 11px;
      line-height: 1.4;
      color: var(--jdb-review-success-text, #166534);
      background: var(--jdb-review-success-bg, #dcfce7);
      vertical-align: baseline;
    }
  `;
  document.head.appendChild(style);
}
