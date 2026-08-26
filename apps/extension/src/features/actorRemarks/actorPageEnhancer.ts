/**
 * @file actorPageEnhancer.ts
 * @description 演员页「演员备注」节点渲染 —— 骨架先行 + 成功/失败终态
 *
 * 设计目标：
 * 1. 任务开始后立刻渲染“加载中”骨架，保证任何情况下用户都能看见功能生效；
 * 2. 抓取成功 → 徽章/外链；抓取失败/超时 → 失败提示 + 可点击外链（不再静默无效果）；
 * 3. 纯 DOM 逻辑，不依赖 chrome API，便于 jsdom 测试。
 * @module features/actorRemarks
 */

import type { ActorRemarks } from './index';

export type ActorRemarksMode = 'inline' | 'panel';
export type ActorRemarksPhase = 'loading' | 'success' | 'failure';

export interface ActorRemarksNodeOptions {
  mode: ActorRemarksMode;
  name: string;
  phase: ActorRemarksPhase;
  data?: ActorRemarks | null;
  failureMessage?: string;
}

const INLINE_CLASS = 'jdb-actor-remarks-inline actor-page';
const INLINE_SELECTOR = '.jdb-actor-remarks-inline.actor-page';
const PANEL_ID = 'enhanced-actor-remarks-actorpage';

/** 清理旧节点（重试/重复注入前调用，保证幂等） */
export function cleanActorRemarksNodes(): void {
  try {
    const existingInline = document.querySelector(INLINE_SELECTOR) as HTMLElement | null;
    if (existingInline) existingInline.remove();
    const existingPanel = document.getElementById(PANEL_ID);
    if (existingPanel) existingPanel.remove();
  } catch {}
}

function buildBadgeText(data: ActorRemarks | null | undefined): string {
  if (!data) return '';
  const parts: string[] = [];
  if (typeof data.age === 'number') parts.push(String(data.age));
  if (typeof data.heightCm === 'number') parts.push(`${data.heightCm}cm`);
  if (data.cup) parts.push(String(data.cup).toUpperCase());
  let txt = parts.length ? parts.join(' / ') : '';
  if (data.retired) txt = txt ? `${txt} / 引退` : '引退';
  return txt;
}

function buildWikiUrl(name: string, data?: ActorRemarks | null): string {
  return data?.wikiUrl || `https://ja.wikipedia.org/wiki/${encodeURIComponent(name)}`;
}

function buildXslistUrl(name: string, data?: ActorRemarks | null): string {
  return data?.xslistUrl || `https://xslist.org/search?query=${encodeURIComponent(name)}&lg=zh`;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cssText: string,
  text?: string,
  href?: string,
): HTMLElement {
  const node = document.createElement(tag) as HTMLElement;
  if (cssText) node.style.cssText = cssText;
  if (text !== undefined) node.textContent = text;
  if (href !== undefined) {
    (node as HTMLAnchorElement).href = href;
    (node as HTMLAnchorElement).target = '_blank';
  }
  return node;
}

/**
 * 构建演员备注节点（不插入 DOM）。
 * - loading：轻量占位（inline 为小 chip，panel 为带标题的卡片）
 * - success：有字段显示徽章；无字段显示 Wiki/xslist 外链
 * - failure：失败原因 + Wiki/xslist 外链（仍可手动查看）
 */
export function buildActorRemarksNode(options: ActorRemarksNodeOptions): HTMLElement {
  const { mode, name, phase } = options;
  const data = options.data ?? null;
  const badgeText = buildBadgeText(data);
  const linkCss = (fs?: string) =>
    `color:#b45309;text-decoration:underline;${fs ? `font-size:${fs};` : ''}`;

  const buildRow = (): HTMLElement => {
    const row = el('div', 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;');
    if (phase === 'loading') {
      row.appendChild(el('span', 'color:#92400e;', '备注加载中…'));
      return row;
    }
    if (phase === 'success') {
      if (badgeText) {
        row.appendChild(el('span', 'background:#ffedd5;color:#7c2d12;padding:2px 6px;border-radius:12px;font-size:12px;', badgeText));
      } else {
        row.appendChild(el('a', linkCss(), 'Wiki', buildWikiUrl(name, data)));
        row.appendChild(el('a', linkCss(), 'xslist', buildXslistUrl(name, data)));
      }
      return row;
    }
    // failure
    const reason = options.failureMessage ? `（${options.failureMessage}）` : '';
    row.appendChild(el('span', 'color:#92400e;', `备注获取失败${reason}`));
    row.appendChild(el('a', linkCss(), 'Wiki', buildWikiUrl(name, data)));
    row.appendChild(el('a', linkCss(), 'xslist', buildXslistUrl(name, data)));
    return row;
  };

  if (mode === 'inline') {
    const wrap = el('span', 'display:inline-flex;align-items:center;gap:6px;margin-left:8px;vertical-align:middle;');
    wrap.className = INLINE_CLASS;
    if (phase === 'loading') {
      wrap.appendChild(el('span', 'color:#92400e;font-size:12px;', '…'));
      return wrap;
    }
    if (phase === 'success' && badgeText) {
      wrap.appendChild(el('span', 'background:#ffedd5;color:#7c2d12;padding:1px 6px;border-radius:999px;font-size:12px;line-height:18px;', badgeText));
      return wrap;
    }
    // 走到这里只剩两种情况：success 无字段（仅外链）、failure（失败提示 + 外链）
    if (phase === 'failure') {
      wrap.appendChild(el('span', 'color:#92400e;font-size:12px;', '备注获取失败'));
    }
    wrap.appendChild(el('a', linkCss('12px'), 'Wiki', buildWikiUrl(name, data)));
    wrap.appendChild(el('a', linkCss('12px'), 'xslist', buildXslistUrl(name, data)));
    return wrap;
  }

  const panel = el('div', 'margin:10px 0;padding:10px;background:#fff7ed;border:1px solid #fde68a;border-left:4px solid #f59e0b;border-radius:8px;color:#78350f;font-size:13px;');
  panel.id = PANEL_ID;
  const title = el('div', 'font-weight:bold;margin-bottom:6px;color:#92400e;', '演员备注');
  panel.appendChild(title);
  panel.appendChild(buildRow());
  return panel;
}
