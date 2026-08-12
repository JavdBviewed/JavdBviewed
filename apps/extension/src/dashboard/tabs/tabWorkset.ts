/**
 * 清理 Tab 隐藏后不再需要的渲染工作集。
 * 事件绑定和业务状态由各 Tab 自己管理，这里只负责释放指定容器的子节点。
 */
export function clearTabWorkset(
  root: Pick<ParentNode, 'querySelectorAll'> | null,
  selectors: readonly string[],
): void {
  if (!root) return;

  for (const selector of selectors) {
    root.querySelectorAll<HTMLElement>(selector).forEach(element => {
      element.replaceChildren();
    });
  }
}
