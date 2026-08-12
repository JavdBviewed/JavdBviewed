/**
 * @file listObserverPolicy.ts
 * @description 决定列表页是否需要独立的状态处理观察器。
 */

export function shouldInstallStandaloneListObserver(listEnhancementEnabled: boolean): boolean {
  return !listEnhancementEnabled;
}
