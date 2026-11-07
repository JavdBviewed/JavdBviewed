/**
 * @file listsSubtabsStyles.test.ts
 * @description 收藏中心与下载任务共用分类 分段轨道式样式源码锁（10-05-lists-subtabs-style）：
 *   - 正锁：轨道容器（padding:5px / gap:4px / --lists-soft 底 / --lists-border 描边 / 12px 圆角 / margin-top:14px 保留）
 *           分段按钮（flex:1 1 0 / padding:10px 14px / 14px / 600 / 9px 圆角 / 透明底 / --lists-muted 字色）
 *           图标 13px / hover 8% 主色底 / active 保留原渐变 + 0 3px 10px 阴影 / 新增 focus-visible outline
 *   - 负锁：.lists-subtab 块级提取后，旧小胶囊 token（border-radius:999px / padding:7px 16px /
 *           font-size:13px 按钮级）零残留（块级提取防同文件其它处 13px/999px 误伤）
 * @module tests/dom
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cssPath = resolve(process.cwd(), 'apps/extension/src/dashboard/styles/04-components/categoryTabs.css');
const css = readFileSync(cssPath, 'utf8');

/**
 * 提取 `.category-tab` 按钮级规则块（基础块 + :hover/.active/:focus-visible 修饰块）。
 * 不含轨道容器 `.lists-subtabs`，不含图标子块 `.lists-subtab i`（图标 font-size:13px 是新规，
 * 不属「旧小胶囊按钮级 token」负锁范围）。
 */
function extractSubtabButtonBlocks(source: string): string {
  const blocks: string[] = [];
  const re = /\.category-tab\b[^{]*\{[^{}]*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const block = m[0];
    if (/\.category-tab\s+i\s*\{/.test(block)) continue;
    blocks.push(block);
  }
  return blocks.join('\n');
}

/** 按钮级块（去全部空白归一化，消除「: 后空格」格式差，防负锁被格式差异绕过）。 */
const subtabButtonBlocks = extractSubtabButtonBlocks(css).replace(/\s+/g, '');

/** 冒号归一化（仅消 `: ` 冒号后空格），兼容文件 spaced 写法与 spec compact token。 */
const norm = (block: string): string => block.replace(/:\s+/g, ':');

describe('lists sub-tabs segmented track styles', () => {
  it('locks the segmented track container (padding/gap/background/border/radius + margin-top preserved)', () => {
    expect(css).toContain('.category-tabs');
    const containerMatch = css.match(/\.category-tabs\s*\{[^{}]*\}/);
    expect(containerMatch, 'container rule missing').not.toBeNull();
    const container = norm(containerMatch![0]);
    expect(container).toContain('display:flex');
    expect(container).toContain('gap:4px');
    expect(container).toContain('padding:5px');
    expect(container).toContain('background:var(--lists-soft, var(--surface-secondary))');
    expect(container).toContain('border:1px solid var(--lists-border, var(--border-primary))');
    expect(container).toContain('border-radius:12px');
    expect(container).toContain('margin-top:14px');
  });

  it('locks the segmented buttons (flex:1 1 0 / padding 10px 14px / 14px / 600 / 9px radius / transparent bg / muted color)', () => {
    const buttonMatch = css.match(/\.category-tab\s*\{[^{}]*\}/);
    expect(buttonMatch, 'base button rule missing').not.toBeNull();
    const button = norm(buttonMatch![0]);
    expect(button).toContain('flex:1 1 0');
    expect(button).toContain('min-width:0');
    expect(button).toContain('justify-content:center');
    expect(button).toContain('gap:7px');
    expect(button).toContain('padding:10px 14px');
    expect(button).toContain('border:1px solid transparent');
    expect(button).toContain('border-radius:9px');
    expect(button).toContain('background:transparent');
    expect(button).toContain('color:var(--lists-muted, var(--text-secondary))');
    expect(button).toContain('font-size:14px');
    expect(button).toContain('font-weight:600');
    expect(button).toContain('transition:all .18s ease');
  });

  it('locks the icon size (13px), hover wash, active gradient + shadow, and focus-visible outline', () => {
    const iconMatch = css.match(/\.category-tab\s+i\s*\{[^{}]*\}/);
    expect(iconMatch, 'icon rule missing').not.toBeNull();
    expect(norm(iconMatch![0])).toContain('font-size:13px');

    const hoverMatch = css.match(/\.category-tab:hover\s*\{[^{}]*\}/);
    expect(hoverMatch, 'hover rule missing').not.toBeNull();
    expect(norm(hoverMatch![0])).toContain('color:var(--lists-primary, #2563eb)');
    expect(norm(hoverMatch![0])).toContain('background:color-mix(in srgb, var(--lists-primary, #2563eb) 8%, transparent)');

    const activeMatch = css.match(/\.category-tab\.active\s*\{[^{}]*\}/);
    expect(activeMatch, 'active rule missing').not.toBeNull();
    expect(norm(activeMatch![0])).toContain('linear-gradient(135deg, var(--lists-primary, #2563eb), color-mix(in srgb, var(--lists-info, #0891b2) 70%, var(--lists-primary, #2563eb)))');
    expect(norm(activeMatch![0])).toContain('box-shadow:0 3px 10px color-mix(in srgb, var(--lists-primary, #2563eb) 30%, transparent)');
    expect(norm(activeMatch![0])).toContain('color:#fff');
    expect(norm(activeMatch![0])).toContain('border-color:transparent');

    const focusMatch = css.match(/\.category-tab:focus-visible\s*\{[^{}]*\}/);
    expect(focusMatch, 'focus-visible rule missing').not.toBeNull();
    expect(norm(focusMatch![0])).toContain('outline:2px solid color-mix(in srgb, var(--lists-primary, #2563eb) 55%, transparent)');
    expect(norm(focusMatch![0])).toContain('outline-offset:2px');
  });

  it('locks no legacy pill token residue inside .lists-subtab button blocks (999px / 7px 16px / 13px button font)', () => {
    expect(subtabButtonBlocks.length).toBeGreaterThan(0);
    expect(subtabButtonBlocks).not.toContain('border-radius:999px');
    expect(subtabButtonBlocks).not.toContain('padding:7px16px');
    expect(subtabButtonBlocks).not.toContain('font-size:13px');
    expect(subtabButtonBlocks).not.toContain('background:var(--lists-soft, var(--surface-secondary))');
    expect(subtabButtonBlocks).not.toContain('font-weight:700');
  });
});

it('loads the shared categories for both collection and download pages', async () => {
  const { TAB_PARTIALS } = await import('../../apps/extension/src/dashboard/tabs/resources');
  for (const id of ['tab-lists', 'tab-drive115-tasks']) {
    expect(TAB_PARTIALS[id].styles).toContain('./styles/04-components/categoryTabs.css');
  }
  for (const file of ['lists', 'drive115-tasks']) {
    const html = readFileSync(resolve(process.cwd(), `apps/extension/src/dashboard/partials/tabs/${file}.html`), 'utf8');
    expect(html).toContain('category-tabs');
    expect(html).toContain('category-tab');
  }
});
