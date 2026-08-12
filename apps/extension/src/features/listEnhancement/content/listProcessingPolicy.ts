/**
 * @file listProcessingPolicy.ts
 * @description 列表增强的增量处理选择策略。
 */

export interface ListProcessingMarker {
  hasAttribute(name: string): boolean;
}

export interface ListProcessingOptions {
  force?: boolean;
  codes?: readonly string[];
}

export function selectListItemsForProcessing<T extends ListProcessingMarker>(
  items: readonly T[],
  options: ListProcessingOptions = {},
): T[] {
  if (options.force === true) return [...items];
  return items.filter(item => !item.hasAttribute('data-processed'));
}

export function selectListItemsByCodes<T>(
  items: readonly T[],
  codes: ReadonlySet<string> | null,
  getCode: (item: T) => string | null,
): T[] {
  if (!codes) return [...items];
  return items.filter(item => {
    const code = getCode(item);
    return code !== null && codes.has(code);
  });
}
