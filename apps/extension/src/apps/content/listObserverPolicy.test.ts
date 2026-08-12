/**
 * @file listObserverPolicy.test.ts
 * @description 列表页观察器启用策略回归测试。
 */
import { describe, expect, it } from 'vitest';
import { shouldInstallStandaloneListObserver } from './listObserverPolicy';

describe('列表页观察器启用策略', () => {
  it('列表增强启用时不再安装独立状态观察器，避免重复监听 movie-list', () => {
    expect(shouldInstallStandaloneListObserver(true)).toBe(false);
  });

  it('列表增强关闭时仍安装独立状态观察器，保持状态标签和隐藏规则', () => {
    expect(shouldInstallStandaloneListObserver(false)).toBe(true);
  });
});
