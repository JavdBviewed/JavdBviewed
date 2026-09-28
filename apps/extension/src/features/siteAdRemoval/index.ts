/**
 * @file index.ts
 * @description 去除原站广告：独立增强功能。隐藏原站推广位、移除推广按钮，与磁力搜索解耦。
 * @module features/siteAdRemoval
 */
import { log } from '../contentState';
import type { SiteAdRemovalSettings } from '../../types';

const STYLE_ID = 'x-javdb-site-ad-removal';

/**
 * 归一化设置（读语义与 DEFAULT_SETTINGS 对齐）：
 * 主开关/推广按钮默认开（`!== false`），额外广告位默认关（`=== true`）。
 */
export function normalizeSiteAdRemovalSettings(
  input?: Partial<SiteAdRemovalSettings> | null,
): SiteAdRemovalSettings {
  return {
    enabled: input?.enabled !== false,
    removePromoButtons: input?.removePromoButtons !== false,
    removeExtraAds: input?.removeExtraAds === true,
  };
}

/**
 * 幂等回填：存储中无 siteAdRemoval 键时，按旧 magnetSearch.blockMojContent 的意图生成。
 * - 存量用户显式关过 blockMojContent（=== false）→ enabled: false；
 * - 其余情况（含全新默认、磁力开未动过子开关）→ enabled: true（默认开）；
 * - removePromoButtons 恒 true（历史 always-on）；removeExtraAds 恒 false（新增能力默认关）。
 * 已有 siteAdRemoval 键时返回 null，不覆盖用户已保存值。
 */
export function backfillSiteAdRemovalSettings(
  stored: Record<string, unknown> | null | undefined,
): { siteAdRemoval: SiteAdRemovalSettings } | null {
  if (!stored || typeof stored !== 'object') return null;
  if ('siteAdRemoval' in stored) return null;
  const legacyBlockMoj = (stored.magnetSearch as { blockMojContent?: unknown } | undefined)?.blockMojContent;
  return {
    siteAdRemoval: {
      enabled: legacyBlockMoj !== false,
      removePromoButtons: true,
      removeExtraAds: false,
    },
  };
}

/**
 * 生成去除原站广告 CSS。主开关关闭返回空串。
 * - .moj-content：详情页推广位（.top-meta 与 article.message.video-panel 内），
 *   display:none 为主，.top-meta 内追加零尺寸塌缩兜底（与历史磁力侧效果对齐，防 flex 留缝）；
 * - #magnets-content .sda-content：详情页磁力区推广块（6 张外站推广图，静态 HTML 恒在），
 *   scoped 保守口径仅隐藏磁力区内变体（主开关 enabled 组，默认开即生效）。
 * - 推广按钮：与历史 removeUnwantedButtons 的永久 CSS 口径一致；
 * - 额外广告位（默认关）：.sub-header 顶部广告栏、.app-desktop-banner 桌面App推广位。
 */
export function buildSiteAdRemovalCss(s: SiteAdRemovalSettings): string {
  if (!s.enabled) return '';
  const sections: string[] = [];
  sections.push(`
    .moj-content {
      display: none !important;
    }
    #magnets-content .sda-content {
      display: none !important;
    }
    .top-meta .moj-content {
      width: 0 !important;
      height: 0 !important;
      min-width: 0 !important;
      min-height: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      line-height: 0 !important;
      overflow: hidden !important;
    }`);
  if (s.removePromoButtons) {
    sections.push(`
    a[href*="app.javdb"]:not([href*="javdb.com"]),
    a[href*="t.me/javdbnews"] {
      display: none !important;
    }`);
  }
  if (s.removeExtraAds) {
    sections.push(`
    .sub-header,
    .app-desktop-banner {
      display: none !important;
    }`);
  }
  return sections.join('\n');
}

/**
 * 移除「官方App / JavDB公告(Telegram)」推广按钮（自 pageChrome.removeUnwantedButtons 迁入，逻辑不变）。
 * JS 移除当前节点 + 调用方注入的持久 CSS 覆盖后续动态插入。
 */
export function removePromoButtons(): void {
  try {
    const appButtons = document.querySelectorAll('a[href*="app.javdb"], a[href*="t.me/javdbnews"]');
    appButtons.forEach(button => {
      if (
        button.textContent?.includes('官方App') ||
        button.textContent?.includes('JavDB公告') ||
        button.textContent?.includes('Telegram')
      ) {
        log('Removing promo button:', button.textContent);
        button.remove();
      }
    });
  } catch (error) {
    log('Error removing promo buttons:', error);
  }
}

/**
 * 应用去除原站广告：幂等注入单条命名空间样式 + 按子开关移除推广按钮。
 * 主开关关闭时不做任何 DOM 变更。页面加载期调用一次，设置变更下次加载生效（与历史行为一致）。
 */
export function applySiteAdRemoval(settings?: Partial<SiteAdRemovalSettings> | null): void {
  try {
    const s = normalizeSiteAdRemovalSettings(settings);
    if (!s.enabled) {
      return;
    }
    const css = buildSiteAdRemovalCss(s);
    const existing = document.getElementById(STYLE_ID);
    if (existing) {
      existing.remove();
    }
    if (css) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = css;
      document.head.appendChild(style);
    }
    if (s.removePromoButtons) {
      removePromoButtons();
    }
    log('Site ad removal applied', { removePromoButtons: s.removePromoButtons, removeExtraAds: s.removeExtraAds });
  } catch (error) {
    log('Error applying site ad removal:', error);
  }
}
