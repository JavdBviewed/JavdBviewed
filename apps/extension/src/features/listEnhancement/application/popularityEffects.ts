/**
 * @file popularityEffects.ts
 * @description popularityEffects
 * @module features/listEnhancement
 */
import type { PopularityEffectsConfig } from '../domain/config';
import { buildPopularityStyles } from '../ui/styles';

export interface RatingStats {
  score: number | null;
  count: number | null;
}

export interface PopularityEffectAttributes {
  count: string;
  score: string;
  effect?: 'fire';
  level?: '1';
}

export function parseRatingStatsText(scoreText: string): RatingStats {
  const countMatch = scoreText.match(/由\s*(\d+)\s*人評價|由\s*(\d+)\s*人评价|\b(\d+)\s*人評價|\b(\d+)\s*人评价/i);
  const scoreMatch = scoreText.match(/([0-5](?:\.\d+)?)\s*分/i);

  const rawCount = countMatch ? (countMatch[1] || countMatch[2] || countMatch[3] || countMatch[4]) : '';
  const rawScore = scoreMatch ? scoreMatch[1] : '';

  const count = rawCount ? parseInt(rawCount, 10) : null;
  const score = rawScore ? parseFloat(rawScore) : null;

  return {
    score: Number.isFinite(score as number) ? score : null,
    count: Number.isFinite(count as number) ? count : null,
  };
}

export function buildPopularityEffectAttributes(
  stats: RatingStats,
  config?: PopularityEffectsConfig,
): PopularityEffectAttributes | null {
  if (!config?.enabled || stats.count === null || stats.score === null) {
    return null;
  }

  const attrs: PopularityEffectAttributes = {
    count: String(stats.count),
    score: String(stats.score),
  };

  if (stats.count >= config.minRatingCount && stats.score >= config.minRating) {
    attrs.effect = 'fire';
    attrs.level = '1';
  }

  return attrs;
}

// ====== 热度效果 DOM 侧（A2：原 listEnhancementManager 热度簇，纯搬迁） ======
// 样式注入幂等标记（原 manager class 字段；manager 为模块单例，改模块级 flag 语义等价）
let popularityStylesInjected = false;

/** 注入/移除热度效果样式表（`x-popularity-effects-style` 单点重写，禁用时移除）。 */
export function ensurePopularityStyles(config?: PopularityEffectsConfig): void {
  const existingStyle = document.getElementById('x-popularity-effects-style');

  if (!config?.enabled) {
    existingStyle?.remove();
    popularityStylesInjected = false;
    return;
  }

  if (existingStyle) {
    existingStyle.remove();
  }

  const style = document.createElement('style');
  style.id = 'x-popularity-effects-style';
  style.textContent = buildPopularityStyles();
  document.head.appendChild(style);
  popularityStylesInjected = true;
}

/** 从卡片评分文本解析分数与评价人数。 */
export function extractRatingStats(item: HTMLElement): RatingStats {
  const scoreText = item.querySelector('.score .value')?.textContent || item.querySelector('.score')?.textContent || '';
  return parseRatingStatsText(scoreText);
}

/** 为单张卡片写入热度效果 data-* 属性（先全量清除，禁用态即返回）。 */
export function applyPopularityEffect(item: HTMLElement, config?: PopularityEffectsConfig): void {
  item.removeAttribute('data-popularity-effect');
  item.removeAttribute('data-popularity-level');
  item.removeAttribute('data-popularity-count');
  item.removeAttribute('data-popularity-score');

  if (!config?.enabled) {
    return;
  }

  const attrs = buildPopularityEffectAttributes(extractRatingStats(item), config);
  if (!attrs) {
    return;
  }

  item.setAttribute('data-popularity-count', attrs.count);
  item.setAttribute('data-popularity-score', attrs.score);
  if (attrs.effect) item.setAttribute('data-popularity-effect', attrs.effect);
  if (attrs.level) item.setAttribute('data-popularity-level', attrs.level);
}

/** 全列表重放热度效果。 */
export function reapplyPopularityEffects(config?: PopularityEffectsConfig): void {
  const items = document.querySelectorAll('.movie-list .item');
  items.forEach(item => applyPopularityEffect(item as HTMLElement, config));
}
