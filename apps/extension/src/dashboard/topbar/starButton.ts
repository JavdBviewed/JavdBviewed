/**
 * @file starButton.ts
 * @description topbar「给项目一个 star」按钮：共享地址常量与点击行为。
 *   React 壳（DashboardShell）以 JSX onClick 消费 openProjectStarPage；
 *   legacy fallback partial 以 bindTopbarStarButton 在 bootstrap 兜底路径绑一次。
 * @module dashboard/topbar
 */

/** 项目 GitHub 地址（README 多处引用的仓库地址） */
export const PROJECT_GITHUB_URL = 'https://github.com/JavdBviewed/JavdBviewed';

/** topbar 星星按钮稳定 id（React 壳与 legacy partial 一致） */
export const TOPBAR_STAR_BTN_ID = 'topbar-star-btn';

/**
 * 新标签页打开项目 GitHub 页面
 */
export function openProjectStarPage(): void {
  window.open(PROJECT_GITHUB_URL, '_blank', 'noopener');
}

/**
 * 为 legacy topbar 中的星星按钮绑定点击（幂等；按钮不存在时 no-op）
 *
 * React 壳的按钮由 JSX onClick 承载，不需也不应重复绑定。
 */
export function bindTopbarStarButton(): void {
  const btn = document.getElementById(TOPBAR_STAR_BTN_ID);
  if (!btn || btn.dataset.starBound === '1') return;
  btn.dataset.starBound = '1';
  btn.addEventListener('click', () => openProjectStarPage());
}
